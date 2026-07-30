import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Boxes, Clock3, File, Folder, Map, Search, Server, Waypoints } from "lucide-react";
import { fileHistory, listDepotDirectories, listDepotFiles, listDepots, listSubmittedChanges, normalizeAppError, printRevision } from "../../shared/api";
import { DiffViewer } from "../../shared/DiffViewer";
import { ChangelistHistory } from "../../shared/ChangelistHistory";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { RevisionGraph } from "../history/RevisionGraphView";
import { useLocale } from "../../shared/i18n";
import { SelectableSurface, TreeItemRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, DepotFile, DepotSummary, FileDiff, FileRevision, PendingChange } from "../../shared/models";
import { PathActions } from "../../shared/PathActions";
import { isContextMenuShortcut } from "../../shared/selection";
import { contextMenuPoint } from "../../shared/useContextMenu";
import { CompactEmpty, EmptyState, ErrorBanner } from "../../shared/View";
import { directoryPattern, directoryScope, scopeBase } from "./depot";

export type DepotOverviewFilter = "all" | "stream" | "classic";

export type DepotOverviewMenuTarget = {
  kind: "file" | "folder";
  path: string;
  revision?: string;
  change?: string;
};

type MenuPosition = { x: number; y: number };

export type DepotTreeChildren = {
  directories: string[];
  files: DepotFile[];
};

export type DepotTreeNode = {
  kind: "depot" | "folder" | "file";
  path: string;
  name: string;
  depth: number;
  depot: DepotSummary;
  file?: DepotFile;
};

type SelectedResource = Pick<DepotTreeNode, "kind" | "path" | "depot" | "file">;

export function filterOverviewDepots(depots: DepotSummary[], filter: DepotOverviewFilter, query: string): DepotSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return depots.filter((depot) => {
    if (filter === "stream" && depot.depotType.toLocaleLowerCase() !== "stream") return false;
    if (filter === "classic" && depot.depotType.toLocaleLowerCase() === "stream") return false;
    return !needle || [depot.name, depot.path, depot.depotType, depot.description]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

export function buildDepotRows(depots: DepotSummary[], children: Record<string, DepotTreeChildren>, expanded: Set<string>, query: string): DepotTreeNode[] {
  const result: DepotTreeNode[] = [];
  const needle = query.trim().toLocaleLowerCase();

  function appendDirectory(path: string, depth: number, depot: DepotSummary, kind: "depot" | "folder") {
    const name = path.split("/").filter(Boolean).at(-1) || depot.name;
    if (!needle || `${name} ${path}`.toLocaleLowerCase().includes(needle) || kind === "depot") result.push({ kind, path, name, depth, depot });
    if (!expanded.has(path) && !needle) return;
    const loaded = children[path];
    if (!loaded) return;
    loaded.directories.forEach((child) => appendDirectory(child, depth + 1, depot, "folder"));
    loaded.files.forEach((file) => {
      const fileName = depotItemName(file.depotPath);
      if (!needle || `${fileName} ${file.depotPath}`.toLocaleLowerCase().includes(needle)) {
        result.push({ kind: "file", path: file.depotPath, name: fileName, depth: depth + 1, depot, file });
      }
    });
  }

  depots.forEach((depot) => appendDirectory(depot.path, 0, depot, "depot"));
  return result;
}

export function formatDepotDate(value: string | undefined, language: string): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(seconds * 1000))
    : value;
}

export function DepotOverview({ connection, refreshKey, initialScope, onDownload, onContextMenu, onBusyChange, onNavigateLocal }: {
  connection: ConnectionInput;
  refreshKey: number;
  initialScope?: string;
  onDownload: (target: DepotOverviewMenuTarget) => void;
  onContextMenu: (target: DepotOverviewMenuTarget, position: MenuPosition) => void;
  onBusyChange?: (busy: boolean) => void;
  onNavigateLocal?: (scope: string) => void;
}) {
  const { language, t } = useLocale();
  const [depots, setDepots] = useState<DepotSummary[]>([]);
  const [children, setChildren] = useState<Record<string, DepotTreeChildren>>({});
  const [loadedPaths, setLoadedPaths] = useState(() => new Set<string>());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set<string>());
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [selected, setSelected] = useState<SelectedResource>();
  const [folderHistory, setFolderHistory] = useState<PendingChange[]>([]);
  const [fileRevisions, setFileRevisions] = useState<FileRevision[]>([]);
  const [revisionPreview, setRevisionPreview] = useState<FileDiff>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DepotOverviewFilter>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [busy, setBusy] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const resourceRequest = useRef(0);

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(undefined);
    setChildren({});
    setLoadedPaths(new Set());
    setLoadingPaths(new Set());
    setExpanded(new Set());
    setFolderHistory([]);
    setFileRevisions([]);
    setRevisionPreview(undefined);
    void listDepots(connection).then(async (nextDepots) => {
      if (!active) return;
      setDepots(nextDepots);
      if (!nextDepots.length) { setSelected(undefined); return; }
      await revealInitialTarget(nextDepots, initialScope, () => active);
    }).catch((reason) => {
      if (active) setError(normalizeAppError(reason));
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [connection.port, connection.user, connection.client, includeDeleted, initialScope, refreshKey]);

  async function readChildren(path: string, isActive = () => true): Promise<DepotTreeChildren> {
    setLoadingPaths((current) => new Set(current).add(path));
    try {
      const pattern = directoryPattern(directoryScope(path));
      const [directories, files] = await Promise.all([
        listDepotDirectories(connection, pattern),
        listDepotFiles(connection, pattern, includeDeleted),
      ]);
      const next = { directories: directories.map((item) => item.path), files };
      if (isActive()) {
        setChildren((current) => ({ ...current, [path]: next }));
        setLoadedPaths((current) => new Set(current).add(path));
      }
      return next;
    } catch (reason) {
      if (isActive()) setError(normalizeAppError(reason));
      return { directories: [], files: [] };
    } finally {
      if (isActive()) setLoadingPaths((current) => { const next = new Set(current); next.delete(path); return next; });
    }
  }

  async function revealInitialTarget(nextDepots: DepotSummary[], requestedScope: string | undefined, isActive: () => boolean) {
    const requestedPath = scopeBase((requestedScope || "//...").replace(/[#@].*$/, ""));
    const parts = requestedPath === "//" ? [] : requestedPath.slice(2).split("/").filter(Boolean);
    const depot = nextDepots.find((item) => item.name.toLocaleLowerCase() === parts[0]?.toLocaleLowerCase()) || nextDepots[0];
    if (!depot || !isActive()) return;

    const nextExpanded = new Set<string>([depot.path]);
    setExpanded(nextExpanded);
    let currentPath = depot.path;
    let currentChildren = await readChildren(currentPath, isActive);

    for (let index = 1; index < parts.length && isActive(); index += 1) {
      const candidate = `//${parts.slice(0, index + 1).join("/")}`;
      const file = currentChildren.files.find((item) => item.depotPath.toLocaleLowerCase() === candidate.toLocaleLowerCase());
      if (file) {
        await inspectFile(file, depot, isActive);
        return;
      }
      const directory = currentChildren.directories.find((item) => item.toLocaleLowerCase() === candidate.toLocaleLowerCase());
      if (!directory) break;
      currentPath = directory;
      nextExpanded.add(currentPath);
      setExpanded(new Set(nextExpanded));
      currentChildren = await readChildren(currentPath, isActive);
    }

    if (!isActive()) return;
    await inspectDirectory({ kind: currentPath === depot.path ? "depot" : "folder", path: currentPath, depot }, isActive);
  }

  async function inspectDirectory(resource: SelectedResource, isActive = () => true) {
    const request = ++resourceRequest.current;
    setSelected(resource);
    setError(undefined);
    setHistoryBusy(true);
    setFileRevisions([]);
    setRevisionPreview(undefined);
    try {
      const nextHistory = await listSubmittedChanges(connection, directoryScope(resource.path), 20);
      if (isActive() && request === resourceRequest.current) setFolderHistory(nextHistory);
    } catch (reason) {
      if (isActive() && request === resourceRequest.current) { setFolderHistory([]); setError(normalizeAppError(reason)); }
    } finally {
      if (isActive() && request === resourceRequest.current) setHistoryBusy(false);
    }
  }

  async function inspectFile(file: DepotFile, depot: DepotSummary, isActive = () => true) {
    const request = ++resourceRequest.current;
    setSelected({ kind: "file", path: file.depotPath, depot, file });
    setError(undefined);
    setHistoryBusy(true);
    setFolderHistory([]);
    setRevisionPreview(undefined);
    try {
      const revisions = await fileHistory(connection, file.depotPath, 100);
      if (isActive() && request === resourceRequest.current) setFileRevisions(revisions);
    } catch (reason) {
      if (isActive() && request === resourceRequest.current) { setFileRevisions([]); setError(normalizeAppError(reason)); }
    } finally {
      if (isActive() && request === resourceRequest.current) setHistoryBusy(false);
    }
  }

  async function previewRevision(revision: string) {
    if (!selected || selected.kind !== "file") return;
    setHistoryBusy(true);
    setError(undefined);
    try { setRevisionPreview(await printRevision(connection, selected.path, revision)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setHistoryBusy(false); }
  }

  function togglePath(path: string) {
    if (expanded.has(path)) {
      setExpanded((current) => { const next = new Set(current); next.delete(path); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(path));
    if (!loadedPaths.has(path) && !loadingPaths.has(path)) void readChildren(path);
  }

  function inspectNode(item: DepotTreeNode) {
    if (item.kind === "file" && item.file) void inspectFile(item.file, item.depot);
    else void inspectDirectory({ kind: item.kind, path: item.path, depot: item.depot });
  }

  function showPointerMenu(event: ReactMouseEvent<HTMLElement>, target: DepotOverviewMenuTarget) {
    event.preventDefault();
    onContextMenu(target, contextMenuPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()));
  }

  function showKeyboardMenu(event: ReactKeyboardEvent<HTMLElement>, target: DepotOverviewMenuTarget) {
    if (!isContextMenuShortcut(event.key, event.shiftKey)) return;
    event.preventDefault();
    onContextMenu(target, contextMenuPoint(undefined, undefined, event.currentTarget.getBoundingClientRect()));
  }

  const visibleDepots = useMemo(() => {
    const filtered = filterOverviewDepots(depots, filter, "");
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return filtered;
    return filtered.filter((depot) => [depot.name, depot.path, depot.depotType, depot.description]
      .some((value) => value.toLocaleLowerCase().includes(needle))
      || Object.values(children).some((loaded) => [...loaded.directories, ...loaded.files.map((file) => file.depotPath)]
        .some((path) => path.startsWith(`${depot.path}/`) && path.toLocaleLowerCase().includes(needle))));
  }, [children, depots, filter, query]);
  const rows = useMemo(() => buildDepotRows(visibleDepots, children, expanded, query), [children, expanded, query, visibleDepots]);
  const selectedChildren = selected && selected.kind !== "file" ? children[selected.path] : undefined;
  const selectedName = selected ? depotItemName(selected.path) : "";
  const currentTarget: DepotOverviewMenuTarget | undefined = selected && {
    kind: selected.kind === "file" ? "file" : "folder",
    path: selected.path,
  };

  return <div className="depot-overview" data-agent-id="depot-overview" aria-busy={busy || historyBusy || loadingPaths.size > 0}>
    {error && <ErrorBanner error={error} />}

    <div className="depot-overview-toolbar">
      <label className="depot-overview-search">
        <Search aria-hidden="true" />
        <span className="sr-only">{t("depotOverviewSearch")}</span>
        <input data-agent-id="depot-overview-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("depotOverviewSearchPlaceholder")} />
      </label>
      <div className="depot-overview-toolbar-actions">
        <label className="check-field compact"><input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} /><span><strong>{t("depotIncludeDeleted")}</strong></span></label>
        <div className="depot-overview-filters" role="group" aria-label={t("depotOverviewFilter")}>{(["all", "stream", "classic"] as const).map((value) => <button data-agent-id={`depot-overview-filter-${value}`} type="button" aria-pressed={filter === value} className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{t(`depotOverviewFilter_${value}` as never)}</button>)}</div>
      </div>
    </div>

    <div className="depot-overview-workbench">
      <section className="depot-overview-tree" aria-label={t("depotOverviewStructure")}>
        <div className="column-heading"><strong>{t("depotOverviewStructure")}</strong><span>{rows.length}</span></div>
        {busy && !depots.length ? <CompactEmpty text={t("depotOverviewLoading")} /> : !depots.length ? <EmptyState title={t("depotOverviewNoDepots")} body={t("depotOverviewNoDepotsBody")} /> : <div role="tree">
          {rows.map((item) => {
            const isFile = item.kind === "file";
            const isLoading = loadingPaths.has(item.path);
            const loaded = children[item.path];
            const knownEmpty = !isFile && loadedPaths.has(item.path) && loaded && loaded.directories.length + loaded.files.length === 0;
            const expandedNow = expanded.has(item.path);
            const ItemIcon = item.kind === "depot" ? Boxes : isFile ? File : Folder;
            const target: DepotOverviewMenuTarget = { kind: isFile ? "file" : "folder", path: item.path };
            return <TreeItemRow
              key={item.path}
              depth={item.depth}
              selected={selected?.path === item.path}
              className={`depot-overview-row ${item.kind}`}
              selectClassName="depot-overview-row-select"
              disclosure={!isFile && !knownEmpty ? { agentId: `depot-overview-toggle:${item.path}`, expanded: expandedNow, loading: isLoading, label: t(expandedNow ? "depotOverviewCollapse" : "depotOverviewExpand"), onToggle: () => togglePath(item.path) } : undefined}
              agentId={`${isFile ? "depot-overview-file" : "depot-overview-row"}:${item.path}`}
              icon={<ItemIcon className="ui-icon" aria-hidden="true" />}
              primary={item.name}
              secondary={item.path}
              trailing={item.kind === "depot" ? <span className="depot-overview-type">{item.depot.depotType.toLocaleUpperCase()}</span> : isFile ? <span className="depot-overview-file-meta">#{item.file?.revision || "—"} · {item.file?.action || "—"}</span> : undefined}
              selectProps={{ onClick: () => inspectNode(item), onDoubleClick: () => { if (!isFile) togglePath(item.path); }, onContextMenu: (event) => { inspectNode(item); showPointerMenu(event, target); }, onKeyDown: (event) => showKeyboardMenu(event, target) }}
            />;
          })}
          {!rows.length && <p className="compact-empty">{t("depotOverviewNoMatches")}</p>}
        </div>}
      </section>

      <aside className="depot-overview-inspector">
        {!selected || !currentTarget ? <EmptyState title={t("depotInspectorTitle")} body={t("depotOverviewSelectBody")} /> : <>
          <div className="depot-overview-inspector-heading">
            <div><span>{selected.kind === "depot" ? t("depotOverviewDepot") : selected.kind === "file" ? t("depotOverviewFile") : t("depotOverviewFolder")}</span><h2>{selectedName}</h2><p title={selected.path}>{selected.path}</p></div>
            <div className="depot-overview-inspector-actions"><PathActions depotPath={selected.path} connection={connection} onNavigateLocal={(mapping) => mapping.depotPath && onNavigateLocal?.(mapping.depotPath)} /><button data-agent-id="depot-overview-download" className="primary-button" type="button" onClick={() => onDownload(currentTarget)}>{t("depotDownloadToWorkspace")}</button></div>
          </div>

          {selected.kind === "file" ? <>
            <dl className="file-facts depot-overview-file-facts"><dt>{t("revisionLabel")}</dt><dd>#{selected.file?.revision || "—"}</dd><dt>{t("actionLabel")}</dt><dd>{selected.file?.action || "—"}</dd><dt>{t("changelistLabel")}</dt><dd className={selected.file?.change ? "changelist-number" : undefined}>{selected.file?.change || "—"}</dd><dt>{t("typeLabel")}</dt><dd>{selected.file?.fileType || "—"}</dd></dl>
            <section className="selection-history depot-overview-file-history"><h3>{t("selectedHistory")}</h3>{historyBusy && !fileRevisions.length ? <CompactEmpty text={t("loadingHistory")} /> : fileRevisions.length ? fileRevisions.map((revision) => {
              const target: DepotOverviewMenuTarget = { kind: "file", path: selected.path, revision: revision.revision };
              return <SelectableSurface data-agent-id={`depot-overview-revision:${selected.path}#${revision.revision}`} className="history-compact-row" tabIndex={historyBusy ? -1 : 0} aria-disabled={historyBusy} key={revision.revision} onClick={() => { if (!historyBusy) void previewRevision(revision.revision); }} onContextMenu={(event) => { if (!historyBusy) showPointerMenu(event, target); }} onKeyDown={(event) => { if (historyBusy) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void previewRevision(revision.revision); } else showKeyboardMenu(event, target); }}><ChangelistDescription value={revision.description} fallback={`${t("revisionLabel")} #${revision.revision}`} compact /><span><span className="changelist-number">CL {revision.change || "—"}</span> · {revision.user}{revision.client ? ` · ${revision.client}` : ""}</span><small>#{revision.revision} · {revision.action || "—"}{revision.fileType ? ` · ${revision.fileType}` : ""}</small></SelectableSurface>;
            }) : <CompactEmpty text={t("depotNoHistory")} />}</section>
            <RevisionGraph revisions={fileRevisions} historyMayBePartial={fileRevisions.length >= 100} />
            {revisionPreview && <div className="history-diff"><h2>{t("depotRevisionPreview")}</h2><DiffViewer text={revisionPreview.text || t("filesIdentical")} truncated={revisionPreview.truncated} /></div>}
          </> : <>
            <dl className="depot-overview-facts">
              <div><Server aria-hidden="true" /><dt>{t("depotOverviewDepotType")}</dt><dd>{selected.depot.depotType}</dd></div>
              <div><Clock3 aria-hidden="true" /><dt>{t("depotOverviewCreated")}</dt><dd>{formatDepotDate(selected.depot.date, language) || "—"}</dd></div>
              <div><Waypoints aria-hidden="true" /><dt>{t("depotOverviewChildPaths")}</dt><dd>{selectedChildren ? selectedChildren.directories.length + selectedChildren.files.length : t("depotOverviewNotLoaded")}</dd></div>
              <div><Map aria-hidden="true" /><dt>{t("depotOverviewMap")}</dt><dd title={selected.depot.map}>{selected.depot.map || "—"}</dd></div>
            </dl>

            <section className="depot-overview-description"><strong>{t("depotOverviewDescription")}</strong><p>{selected.depot.description || t("depotOverviewNoDescription")}</p>{selected.depot.streamDepth && <small>{t("depotOverviewStreamDepth")}: {selected.depot.streamDepth}</small>}</section>

            <ChangelistHistory
              className="fill"
              title={t("depotOverviewRecentActivity")}
              summary={t("depotOverviewActivityLimit")}
              items={folderHistory}
              busy={historyBusy}
              emptyText={t("depotOverviewNoActivity")}
              agentId={(item) => `depot-overview-change:${selected.path}@${item.id}`}
              onContextMenu={(item, position) => onContextMenu({ kind: "folder", path: selected.path, change: item.id }, position)}
            />
          </>}
        </>}
      </aside>
    </div>
  </div>;
}

function depotItemName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}
