import { useEffect, useState, type ReactNode } from "react";
import { fileHistory, listDepotDirectories, listDepotFiles, listSubmittedChanges, listWorkspaceFiles, normalizeAppError, previewSync, printRevision } from "../../shared/api";
import { DiffViewer } from "../../shared/DiffViewer";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, DepotDirectory, DepotFile, FileDiff, FileRevision, PendingChange, SyncPreview, WorkspaceFile } from "../../shared/models";
import { PathActions } from "../../shared/PathActions";
import { SafeSyncConflictDialog, SyncPreviewDialog, useSafeSync } from "../../shared/SafeSync";
import { CompactEmpty, EmptyState, View } from "../../shared/View";
import { directoryPattern, directoryScope, filePattern, parentScope, scopeBase, scopeSegments } from "./depot";

export function DepotView({ connection, initialScope, sourceControl }: { connection: ConnectionInput; initialScope?: string; sourceControl?: ReactNode }) {
  const { t } = useLocale();
  const [scope, setScope] = useState(initialScope?.trim() || "//...");
  const [directories, setDirectories] = useState<DepotDirectory[]>([]);
  const [files, setFiles] = useState<DepotFile[]>([]);
  const [localFiles, setLocalFiles] = useState<WorkspaceFile[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [inspectorPath, setInspectorPath] = useState<string>();
  const [inspectorRevisions, setInspectorRevisions] = useState<FileRevision[]>([]);
  const [folderHistory, setFolderHistory] = useState<PendingChange[]>([]);
  const [inspectorDiff, setInspectorDiff] = useState<FileDiff>();
  const [syncPreview, setSyncPreview] = useState<SyncPreview>();
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const safeSync = useSafeSync(connection, { refresh: load, setNotice, setError });

  async function load(nextScope = scope) {
    setBusy(true);
    setError(undefined);
    try {
      const [nextDirectories, nextFiles, nextLocalFiles] = await Promise.all([
        listDepotDirectories(connection, directoryPattern(nextScope)),
        listDepotFiles(connection, filePattern(nextScope), includeDeleted),
        listWorkspaceFiles(connection, filePattern(nextScope), true),
      ]);
      setDirectories(nextDirectories);
      setFiles(nextFiles);
      setLocalFiles(nextLocalFiles);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const nextScope = initialScope?.trim();
    if (!nextScope || nextScope === scope) return;
    setScope(nextScope);
    void load(nextScope);
  }, [initialScope]);

  useEffect(() => {
    void load();
  }, [connection.port, connection.user, connection.client, includeDeleted]);

  async function inspectFile(path: string) {
    setInspectorPath(path);
    setInspectorDiff(undefined);
    setBusy(true);
    setError(undefined);
    try { setInspectorRevisions(await fileHistory(connection, path, 100)); setFolderHistory([]); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function inspectDirectory(path: string) {
    setInspectorPath(`${path.replace(/\/+$/, "")}/...`);
    setInspectorDiff(undefined);
    setBusy(true);
    setError(undefined);
    try { setFolderHistory(await listSubmittedChanges(connection, `${path.replace(/\/+$/, "")}/...`, 100)); setInspectorRevisions([]); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function showSyncPreview() {
    if (!inspectorPath) return;
    setBusy(true);
    setError(undefined);
    setSyncPreview(undefined);
    setSyncPreviewOpen(true);
    try { setSyncPreview(await previewSync(connection, [inspectorPath])); setSyncAcknowledged(false); }
    catch (reason) { setSyncPreviewOpen(false); setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function runSync() {
    if (!inspectorPath) return;
    const requestedPath = inspectorPath;
    setSyncPreview(undefined);
    setSyncPreviewOpen(false);
    await safeSync.start([requestedPath]);
  }

  async function previewRevision(revision: string) {
    if (!inspectorPath) return;
    setBusy(true);
    setError(undefined);
    try { setInspectorDiff(await printRevision(connection, inspectorPath, revision)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  function navigate(next: string) {
    setScope(next);
    void load(next);
  }

  const depotPaths = new Set(files.map((file) => file.depotPath));
  const localOnly = localFiles.filter((file) => !depotPaths.has(file.depotPath));

  return <View
    id="depot-title"
    eyebrow={t("depotEyebrow")}
    title={t("filesTitle")}
    subtitle={t("depotBrowserBody")}
    error={error}
    notice={notice}
    operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    onDismissNotice={() => setNotice("")}
    actions={<>{sourceControl}<button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? t("loadingDepot") : t("refresh")}</button></>}
  >
    <div className="resource-toolbar">
      <label className="field"><span className="field-label">{t("depotScope")}</span><input value={scope} onChange={(event) => setScope(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="//depot/project/..." /></label>
      <label className="check-field compact"><input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} /><span><strong>{t("depotIncludeDeleted")}</strong></span></label>
      <span className="selection-count">{directories.length} {t("depotDirectories")} · {files.length} {t("depotFiles")}</span>
    </div>
    <nav className="breadcrumb-row" aria-label={t("depotBreadcrumbs")}>
      <button className="text-button" type="button" onClick={() => navigate("//...")}>{t("depotRoot")}</button>
      {scopeSegments(scope).map((segment, index, segments) => { const next = `//${segments.slice(0, index + 1).join("/")}/...`; return <span key={next}> / <button className="text-button" type="button" onClick={() => navigate(next)}>{segment}</button></span>; })}
      {scopeBase(scope) !== "//" && <button className="text-button" type="button" onClick={() => navigate(parentScope(scope))}>{t("depotUp")}</button>}
    </nav>
    <div className="resource-workbench three-pane">
      <div className="resource-pane">
        <div className="column-heading"><strong>{t("depotDirectories")}</strong><span>{directories.length}</span></div>
        {directories.length ? directories.map((directory) => <button className={`resource-entry depot-directory${inspectorPath === `${directory.path.replace(/\/+$/, "")}/...` ? " selected" : ""}`} type="button" key={directory.path} title={t("openFolderHint")} onClick={() => void inspectDirectory(directory.path)} onDoubleClick={() => navigate(directoryScope(directory.path))}>{directory.path}<small>{t("openFolderHint")}</small></button>) : <CompactEmpty text={t("depotNoDirectories")} />}
      </div>
      <div className="resource-pane">
        <div className="column-heading"><strong>{t("depotFiles")}</strong><span>{files.length}</span></div>
        {files.length ? files.map((file) => <button className={`resource-entry depot-file${inspectorPath === file.depotPath ? " selected" : ""}`} type="button" key={file.depotPath} onClick={() => void inspectFile(file.depotPath)}><strong>{file.depotPath}</strong><small>#{file.revision || "—"} · {file.action || "—"} · CL {file.change || "—"}{file.fileType ? ` · ${file.fileType}` : ""}</small></button>) : <CompactEmpty text={t("depotNoFiles")} />}
        {localOnly.map((file) => <button className="resource-entry local-only-file" type="button" key={`local-${file.depotPath}`} disabled title={t("localOnlyFile")}><strong>{file.localPath || file.depotPath}</strong><small>{t("localOnlyFile")}</small></button>)}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("depotInspectorTitle")}</strong><span>{inspectorRevisions.length}</span></div>
        {!inspectorPath ? <EmptyState title={t("depotInspectorTitle")} body={t("depotInspectorBody")} /> : <div className="inspector-content">
          <div><h2>{inspectorPath}</h2><PathActions depotPath={inspectorPath} /><button className="primary-button" type="button" onClick={() => void showSyncPreview()} disabled={busy || safeSync.phase !== "idle"}>{t("getSelectedFiles")}</button></div>
          <div className="resource-detail-list">{inspectorRevisions.length ? inspectorRevisions.map((revision) => <div className="resource-detail-row" key={revision.revision}><span><strong>#{revision.revision} · {revision.action}</strong><small>{revision.user} · CL {revision.change || "—"}</small></span><button className="text-button" type="button" onClick={() => void previewRevision(revision.revision)} disabled={busy}>{t("depotPreviewRevision")}</button></div>) : folderHistory.length ? folderHistory.map((change) => <div className="resource-detail-row" key={change.id}><span><strong>CL {change.id} · {change.user}</strong><small>{change.description}</small></span></div>) : <CompactEmpty text={t("depotNoHistory")} />}</div>
          {inspectorDiff && <div className="history-diff"><h2>{t("depotRevisionPreview")}</h2><DiffViewer text={inspectorDiff.text || t("filesIdentical")} truncated={inspectorDiff.truncated} /></div>}
        </div>}
      </aside>
    </div>
    {syncPreviewOpen && <SyncPreviewDialog preview={syncPreview} busy={busy} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} onClose={() => setSyncPreviewOpen(false)} onConfirm={() => void runSync()} />}
    <SafeSyncConflictDialog sync={safeSync} />
  </View>;
}
