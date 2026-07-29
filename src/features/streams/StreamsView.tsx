import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { listStreams, normalizeAppError, openWorkspace, previewSync, switchStream } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { partitionArchived } from "../../shared/localArchive";
import { useArchiveDragDrop } from "../../shared/useArchiveDragDrop";
import { useLocalArchive } from "../../shared/useLocalArchive";
import type { AppError, ConnectionInput, P4Info, StreamLocalStrategy, StreamSummary, SyncPreview } from "../../shared/models";
import { ItemRowCopy, SelectableSurface, TreeDisclosure } from "../../shared/ItemList";
import { RefreshButton } from "../../shared/RefreshButton";
import { SafeSyncConflictDialog, SyncPreviewDialog, useSafeSync } from "../../shared/SafeSync";
import { isContextMenuShortcut, selectionMode, updateSelection } from "../../shared/selection";
import { ActionDialog, CompactEmpty, ContextMenu, MenuButton, View } from "../../shared/View";
import { useContextMenu } from "../../shared/useContextMenu";
import { buildStreamForest, flattenStreamForest, layoutStreamGraph, streamDescendantPaths, streamSubtreePaths, streamTypeClass, updateArchivedStreamPaths, updateStreamVisibility, type StreamTreeNode } from "./streams";
import { loadStreamPreferences, saveStreamPreferences, streamPreferencesStorageKey, type StreamPreferences } from "./streamPreferences";

export function StreamsView({ connection, currentStream, onSwitched }: { connection: ConnectionInput; currentStream?: string; onSwitched: (info: P4Info) => void }) {
  const { t } = useLocale();
  const preferencesKey = streamPreferencesStorageKey(connection.port, connection.user, connection.client);
  const initialPreferences = loadStreamPreferences(preferencesKey);
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [archiveReady, setArchiveReady] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(initialPreferences?.archivedOpen ?? true);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(initialPreferences?.visiblePaths));
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set(initialPreferences?.collapsedPaths));
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [switchTarget, setSwitchTarget] = useState<StreamSummary>();
  const [localStrategy, setLocalStrategy] = useState<StreamLocalStrategy>("shelve");
  const [downloadNow, setDownloadNow] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreview>();
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const streamMenu = useContextMenu<StreamSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const archiveDragDrop = useArchiveDragDrop("streams");
  const { archivedIds, updateArchivedIds } = useLocalArchive(
    "streams",
    connection,
    streams.map((stream) => stream.path),
    archiveReady,
  );
  const safeSync = useSafeSync(connection, { refresh: load, setNotice, setError });

  async function load(preferences?: StreamPreferences, restorePreferences = false) {
    setBusy(true);
    setError(undefined);
    try {
      const next = await listStreams(connection);
      setStreams(next);
      setArchiveReady(true);
      const availablePaths = new Set(next.map((stream) => stream.path));
      setVisible((current) => new Set((restorePreferences ? preferences?.visiblePaths ?? [...availablePaths] : [...current]).filter((path) => availablePaths.has(path))));
      setCollapsedPaths((current) => new Set((restorePreferences ? preferences?.collapsedPaths ?? [] : [...current]).filter((path) => availablePaths.has(path))));
      setSelectedPaths((current) => {
        const retainedSelection = current.filter((path) => next.some((stream) => stream.path === path));
        return retainedSelection.length > 0
          ? retainedSelection
          : next[0] ? [currentStream && next.some((stream) => stream.path === currentStream) ? currentStream : next[0].path] : [];
      });
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const preferences = loadStreamPreferences(preferencesKey);
    setArchiveReady(false);
    setArchivedOpen(preferences?.archivedOpen ?? true);
    setVisible(new Set(preferences?.visiblePaths));
    setCollapsedPaths(new Set(preferences?.collapsedPaths));
    void load(preferences, true);
  }, [connection.port, connection.user, connection.client]);

  const partition = partitionArchived(streams, archivedIds, (stream) => stream.path);
  const currentForest = useMemo(() => buildStreamForest(partition.current), [partition.current]);
  const archivedForest = useMemo(() => buildStreamForest(partition.archived), [partition.archived]);
  const graph = useMemo(() => layoutStreamGraph(streams.filter((stream) => visible.has(stream.path))), [streams, visible]);
  const graphByPath = new Map(graph.nodes.map((node) => [node.stream.path, node]));
  const selectedStream = selectedPaths.length === 1 ? streams.find((stream) => stream.path === selectedPaths[0]) : undefined;
  const menu = streamMenu.menu?.target;
  const menuSelection = menu
    ? (selectedPaths.includes(menu.path) ? selectedPaths : [menu.path])
      .filter((path) => archivedIds.includes(path) === archivedIds.includes(menu.path))
    : [];
  const orderedPaths = useMemo(
    () => [...flattenStreamForest(currentForest, collapsedPaths), ...flattenStreamForest(archivedForest, collapsedPaths)].map((stream) => stream.path),
    [currentForest, archivedForest, collapsedPaths],
  );
  const menuDescendants = menu ? streamDescendantPaths(streams, menu.path) : [];

  useEffect(() => {
    if (selectionAnchor.current && !orderedPaths.includes(selectionAnchor.current)) {
      selectionAnchor.current = [...selectedPaths].reverse().find((path) => orderedPaths.includes(path));
    }
  }, [orderedPaths, selectedPaths]);

  function setUnactual(paths: string[], archived: boolean) {
    updateArchivedIds((current) => updateArchivedStreamPaths(streams, current, paths, archived));
  }

  function toggleVisible(path: string, show: boolean) {
    setPathsVisible(selectedPaths.includes(path) ? selectedPaths : [path], show);
  }

  function setPathsVisible(paths: string[], show: boolean) {
    setVisible((current) => {
      const next = updateStreamVisibility(streams, current, paths, show);
      saveStreamPreferences(preferencesKey, { visiblePaths: [...next], collapsedPaths: [...collapsedPaths], archivedOpen });
      return next;
    });
  }

  function toggleCollapsed(path: string) {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveStreamPreferences(preferencesKey, { visiblePaths: [...visible], collapsedPaths: [...next], archivedOpen });
      return next;
    });
  }

  function setArchivedExpanded(open: boolean) {
    setArchivedOpen(open);
    saveStreamPreferences(preferencesKey, { visiblePaths: [...visible], collapsedPaths: [...collapsedPaths], archivedOpen: open });
  }

  function showAllStreams(show: boolean) {
    const next = new Set(show ? streams.map((stream) => stream.path) : []);
    setVisible(next);
    saveStreamPreferences(preferencesKey, { visiblePaths: [...next], collapsedPaths: [...collapsedPaths], archivedOpen });
  }

  function selectStream(path: string, event?: React.MouseEvent) {
    const selection = updateSelection(orderedPaths, selectedPaths, path, selectionAnchor.current, selectionMode(event));
    setSelectedPaths(selection.selected);
    selectionAnchor.current = selection.anchor;
  }

  function openMenu(event: React.MouseEvent | React.KeyboardEvent, stream: StreamSummary) {
    if (!selectedPaths.includes(stream.path)) selectStream(stream.path);
    streamMenu.open(event, stream);
  }

  function beginSwitch(stream: StreamSummary) {
    if (stream.path === currentStream) return;
    setSwitchTarget(stream);
    setLocalStrategy("shelve");
    setDownloadNow(false);
  }

  async function applySwitch() {
    if (!switchTarget) return;
    setBusy(true);
    setError(undefined);
    try {
      await switchStream(connection, switchTarget.path, localStrategy);
      const info = await openWorkspace(connection);
      onSwitched(info);
      setNotice(t("streamSwitched"));
      setSwitchTarget(undefined);
      if (downloadNow) {
        const preview = await previewSync(connection, ["//..."]);
        if (preview.modifiedFiles.length > 0) {
          setSyncPreview(preview);
          setSyncAcknowledged(false);
        } else if (preview.items.length > 0) {
          await runSync();
        }
      }
      await load();
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    setSyncPreview(undefined);
    await safeSync.start(["//..."]);
  }

  const renderTree = (nodes: StreamTreeNode[], archived: boolean) => <ul role="group">
    {nodes.map((node) => {
      const collapsed = collapsedPaths.has(node.stream.path);
      return <li key={node.stream.path}>
      <SelectableSurface
        selected={selectedPaths.includes(node.stream.path)}
        selectionRole="treeitem"
        className={`stream-tree-row tree-item-row${node.stream.path === currentStream ? " current" : ""}`}
        aria-expanded={node.children.length > 0 ? !collapsed : undefined}
        aria-label={`${node.stream.name} · ${node.stream.streamType}${node.stream.path === currentStream ? ` · ${t("currentStream")}` : ""}`}
        draggable title={t("unactualDragHint")}
        onClick={(event) => selectStream(node.stream.path, event)} onDoubleClick={() => beginSwitch(node.stream)}
        onContextMenu={(event) => openMenu(event, node.stream)}
        onDragStart={(event) => {
          const ids = selectedPaths.includes(node.stream.path)
            ? selectedPaths.filter((path) => archivedIds.includes(path) === archived)
            : [node.stream.path];
          if (!selectedPaths.includes(node.stream.path)) selectStream(node.stream.path);
          archiveDragDrop.beginDrag(event, ids, archived);
        }}
        onDragEnd={archiveDragDrop.endDrag}
        onKeyDown={(event) => {
          if (event.key === "Enter") beginSwitch(node.stream);
          if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, node.stream);
        }}>
        <TreeDisclosure expanded={!collapsed} label={`${t(collapsed ? "expandStreamBranch" : "collapseStreamBranch")}: ${node.stream.path}`} onToggle={node.children.length > 0 ? () => toggleCollapsed(node.stream.path) : undefined} />
        <input
          type="checkbox"
          checked={visible.has(node.stream.path)}
          ref={(element) => { if (element) { const paths = streamSubtreePaths(streams, node.stream.path); element.indeterminate = paths.some((path) => visible.has(path)) && paths.some((path) => !visible.has(path)); } }}
          onChange={(event) => toggleVisible(node.stream.path, event.currentTarget.checked)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={`${t("showStreamOnGraph")}: ${node.stream.path}`}
        />
        <span className={`stream-type-dot ${streamTypeClass(node.stream.streamType)}`} aria-hidden="true" />
        <ItemRowCopy primary={node.stream.name} secondary={<>{node.stream.streamType}{node.stream.path === currentStream ? ` · ${t("currentStream")}` : ""}</>} />
      </SelectableSurface>
      {node.children.length > 0 && !collapsed && renderTree(node.children, archived)}
    </li>;
    })}
  </ul>;

  return <View id="streams-title" title={t("streamsTitle")} subtitle={t("streamsBody")} error={error} notice={notice} operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined} onDismissNotice={() => setNotice("")} actions={<RefreshButton busy={busy} onClick={() => void load()} />}>
    <div className="streams-workbench">
      <aside className="streams-tree-pane">
        <div className="column-heading">
          <strong>{t("streamsTree")}</strong>
          <div className="column-heading-actions">
            {selectedPaths.length > 0 && <><button type="button" onClick={() => setPathsVisible(selectedPaths, true)}>{t("showSelectedStreams")}</button><button type="button" onClick={() => setPathsVisible(selectedPaths, false)}>{t("hideSelectedStreams")}</button></>}
            <button type="button" onClick={() => showAllStreams(true)}>{t("showAllStreams")}</button>
            <button type="button" onClick={() => showAllStreams(false)}>{t("hideAllStreams")}</button>
            <span>{selectedPaths.length > 0 ? `${selectedPaths.length} / ` : ""}{partition.current.length}</span>
          </div>
        </div>
        <div
          className={`streams-tree archive-drop-zone${archiveDragDrop.dropTarget === "current" ? " drag-over" : ""}`}
          role="tree"
          aria-multiselectable="true"
          onDragOver={(event) => archiveDragDrop.allowDrop(event, "current")}
          onDrop={(event) => { const paths = archiveDragDrop.takeDrop(event, "current"); if (paths) setUnactual(paths, false); }}
        >{currentForest.length ? renderTree(currentForest, false) : <CompactEmpty text={t("streamsEmpty")} />}</div>
        <section
          className={`unactual-section archive-drop-zone${archiveDragDrop.dropTarget === "archived" ? " drag-over" : ""}`}
          onDragOver={(event) => archiveDragDrop.allowDrop(event, "archived")}
          onDrop={(event) => { const paths = archiveDragDrop.takeDrop(event, "archived"); if (paths) setUnactual(paths, true); }}
        >
          <button className="unactual-heading" type="button" aria-expanded={archivedOpen} onClick={() => setArchivedExpanded(!archivedOpen)}>{archivedOpen ? <ChevronDown className="ui-icon" aria-hidden="true" /> : <ChevronRight className="ui-icon" aria-hidden="true" />}<strong>{t("unactual")}</strong><small>{partition.archived.length}</small></button>
          {archivedOpen && <div className="streams-tree archived" role="tree" aria-multiselectable="true">{archivedForest.length ? renderTree(archivedForest, true) : <CompactEmpty text={t("unactualStreamsEmpty")} />}</div>}
        </section>
      </aside>
      <section className="stream-graph-pane" aria-label={t("streamGraph")}>
        <div className="column-heading"><strong>{t("streamGraph")}</strong><span>{graph.nodes.length}</span></div>
        {selectedStream ? <div className="stream-selection-summary"><strong>{selectedStream.path}</strong><span>{selectedStream.description || selectedStream.streamType}</span></div> : selectedPaths.length > 1 ? <div className="stream-selection-summary"><strong>{selectedPaths.length} {t("streamsSelected")}</strong></div> : null}
        {graph.nodes.length ? <div className="stream-graph-scroll"><svg className="stream-graph" role="img" aria-label={t("streamGraph")} viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height}>
          <g className="stream-edges">{graph.edges.map((edge) => { const from = graphByPath.get(edge.from)!; const to = graphByPath.get(edge.to)!; return <path key={`${edge.from}-${edge.to}`} d={`M ${from.x + 190} ${from.y + 27} C ${from.x + 215} ${from.y + 27}, ${to.x - 25} ${to.y + 27}, ${to.x} ${to.y + 27}`} />; })}</g>
          {graph.nodes.map((node) => <g className={`stream-node ${streamTypeClass(node.stream.streamType)}${selectedPaths.includes(node.stream.path) ? " selected" : ""}${node.stream.path === currentStream ? " current" : ""}`} key={node.stream.path} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} onClick={(event) => selectStream(node.stream.path, event)} onDoubleClick={() => beginSwitch(node.stream)} onContextMenu={(event) => openMenu(event, node.stream)} onKeyDown={(event) => { if (event.key === "Enter") beginSwitch(node.stream); if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, node.stream); }}>
            <rect width="190" height="54" rx="8" /><circle cx="16" cy="17" r="5" /><text className="stream-node-name" x="28" y="21">{node.stream.name.slice(0, 22)}</text><text className="stream-node-type" x="16" y="41">{node.stream.streamType}{node.stream.path === currentStream ? ` · ${t("currentStream")}` : ""}</text>
          </g>)}
        </svg></div> : <CompactEmpty text={t("streamGraphEmpty")} />}
      </section>
    </div>

    {menu && streamMenu.menu && <ContextMenu x={streamMenu.menu.x} y={streamMenu.menu.y} onSelect={streamMenu.close}>
      <MenuButton disabled={selectedPaths.length !== 1 || menu.path === currentStream} onClick={() => beginSwitch(menu)}>{t("switchToStream")}</MenuButton>
      <MenuButton onClick={() => {
        const paths = selectedPaths.includes(menu.path) ? selectedPaths : [menu.path];
        const show = paths.some((path) => !visible.has(path));
        setPathsVisible(paths, show);
      }}>{(selectedPaths.includes(menu.path) ? selectedPaths : [menu.path]).every((path) => visible.has(path)) ? t("hideFromGraph") : t("showOnGraph")}</MenuButton>
      <MenuButton disabled={menuDescendants.length === 0} onClick={() => setPathsVisible(menuDescendants, true)}>{t("showChildStreams")}</MenuButton>
      <MenuButton disabled={menuDescendants.length === 0} onClick={() => setPathsVisible(menuDescendants, false)}>{t("hideChildStreams")}</MenuButton>
      <MenuButton onClick={() => setUnactual(menuSelection, !archivedIds.includes(menu.path))}>{archivedIds.includes(menu.path) ? t("restoreFromUnactual") : t("moveToUnactual")}</MenuButton>
      <MenuButton disabled={menuDescendants.length === 0} onClick={() => setUnactual(menuDescendants, true)}>{t("moveChildStreamsToUnactual")}</MenuButton>
      <MenuButton disabled={menuDescendants.length === 0} onClick={() => setUnactual(menuDescendants, false)}>{t("restoreChildStreamsFromUnactual")}</MenuButton>
    </ContextMenu>}

    {switchTarget && <ActionDialog title={t("switchStreamTitle")} confirmLabel={busy ? t("switchingStream") : t("switchToStream")} busy={busy} onClose={() => setSwitchTarget(undefined)} onConfirm={() => void applySwitch()}>
      <p>{t("switchStreamBody")}</p>
      <dl className="dialog-facts"><dt>{t("streamSource")}</dt><dd>{currentStream || "—"}</dd><dt>{t("streamTarget")}</dt><dd>{switchTarget.path}</dd></dl>
      <fieldset className="strategy-fieldset"><legend>{t("localFilesStrategy")}</legend><label className="check-field"><input type="radio" name="local-strategy" checked={localStrategy === "shelve"} onChange={() => setLocalStrategy("shelve")} /><span><strong>{t("streamShelveLocal")}</strong><small>{t("streamShelveLocalBody")}</small></span></label><label className="check-field"><input type="radio" name="local-strategy" checked={localStrategy === "keep"} onChange={() => setLocalStrategy("keep")} /><span><strong>{t("streamKeepLocal")}</strong><small>{t("streamKeepLocalBody")}</small></span></label></fieldset>
      <fieldset className="strategy-fieldset"><legend>{t("depotFilesStrategy")}</legend><label className="check-field"><input type="radio" name="depot-strategy" checked={downloadNow} onChange={() => setDownloadNow(true)} /><span><strong>{t("streamDownloadNow")}</strong><small>{t("streamDownloadNowBody")}</small></span></label><label className="check-field"><input type="radio" name="depot-strategy" checked={!downloadNow} onChange={() => setDownloadNow(false)} /><span><strong>{t("streamKeepDepot")}</strong><small>{t("streamKeepDepotBody")}</small></span></label></fieldset>
    </ActionDialog>}

    {syncPreview && <SyncPreviewDialog preview={syncPreview} busy={busy} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} onClose={() => setSyncPreview(undefined)} onConfirm={() => void runSync()} />}
    <SafeSyncConflictDialog sync={safeSync} />
  </View>;
}
