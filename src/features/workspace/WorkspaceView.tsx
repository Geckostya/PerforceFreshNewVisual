import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addFiles, createWorkspace, deleteFiles, deleteLocalFile, deleteWorkspace, editFiles, fileHistory, ignoreLocalFile, inspectWorkspace, listLocalWorkspaceDirectory, listOpenedFiles, listPendingChanges, listSubmittedChanges, listWorkspaceFiles, lockFiles, moveFile, normalizeAppError, previewReconcile, previewResolve, previewRevertSelected, previewSync, reconcileFiles, renameWorkspace, resolveFiles, revertFiles, unlockFiles, updateWorkspace } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, FileRevision, P4Info, PendingChange, ReconcileItem, ResolveMode, ResolvePreviewItem, RevertPreviewItem, SyncPreview, WorkspaceFile, WorkspaceSpec } from "../../shared/models";
import { PathActions } from "../../shared/PathActions";
import { SafeSyncConflictDialog, SyncPreviewDialog, useSafeSync } from "../../shared/SafeSync";
import { isContextMenuShortcut, selectionMode, updateSelection } from "../../shared/selection";
import { ActionDialog, CompactEmpty, ContextMenu, EmptyState, MenuButton, Modal, View } from "../../shared/View";
import { buildWorkspaceTree, filterWorkspaceFiles, loadWorkspaceDirectoryCache, loadWorkspaceFileCache, loadWorkspaceFileCachePersistent, loadWorkspaceStatusVersion, mergeWorkspaceFileStatuses, saveWorkspaceDirectoryCache, saveWorkspaceFileCache, saveWorkspaceStatusVersion, type WorkspaceDirectorySnapshot, type WorkspaceFilter, workspaceDirectoryCacheKey, workspaceDirectoryPaths, workspaceDirectoryStatusScope, workspaceFileCacheKey, workspaceFileHistoryPath, workspaceLazyRoot, workspaceSelectionOrder, workspaceStatus, workspaceStatusVersion, type WorkspaceTreeFolder } from "./workspace";

type WorkspaceDialog = "details" | "create" | "edit" | "rename" | "delete";
type WorkspaceDraft = { name: string; root: string; stream: string; description: string };

const emptyDraft: WorkspaceDraft = { name: "", root: "", stream: "", description: "" };

export function WorkspaceView({ connection, info, initialScope, sourceControl, onDeleted, onRenamed }: { connection: ConnectionInput; info: P4Info; initialScope?: string; sourceControl?: ReactNode; onDeleted?: () => void; onRenamed?: (name: string) => void }) {
  const { t } = useLocale();
  const initialWorkspaceScope = initialScope?.trim() || "//...";
  const initialLazyRoot = workspaceLazyRoot(connection, initialWorkspaceScope);
  const initialFiles = initialLazyRoot ? [] : loadWorkspaceFileCache(workspaceFileCacheKey(connection, initialWorkspaceScope));
  const [scope, setScope] = useState(initialWorkspaceScope);
  const [files, setFiles] = useState<WorkspaceFile[]>(initialFiles);
  const [directoryPaths, setDirectoryPaths] = useState<string[]>(initialLazyRoot ? [initialLazyRoot] : workspaceDirectoryPaths(initialFiles));
  const [ignoredDirectoryPaths, setIgnoredDirectoryPaths] = useState<Set<string>>(new Set());
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<Set<string>>(new Set());
  const [loadedDirectoryPaths, setLoadedDirectoryPaths] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [change, setChange] = useState("default");
  const [targetRevision, setTargetRevision] = useState("");
  const [preview, setPreview] = useState<SyncPreview>();
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncPreviewBusy, setSyncPreviewBusy] = useState(false);
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const [syncScopes, setSyncScopes] = useState<string[]>([]);
  const [reconcileCandidates, setReconcileCandidates] = useState<ReconcileItem[]>();
  const [reconcileSelected, setReconcileSelected] = useState<ReconcileItem[]>([]);
  const [pendingResolveMode, setPendingResolveMode] = useState<ResolveMode>();
  const [resolvePreview, setResolvePreview] = useState<ResolvePreviewItem[]>([]);
  const [workspaceSpec, setWorkspaceSpec] = useState<WorkspaceSpec>();
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialog>();
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>(emptyDraft);
  const [renameDestination, setRenameDestination] = useState<string>();
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [revisionHistory, setRevisionHistory] = useState<FileRevision[]>([]);
  const [folderHistory, setFolderHistory] = useState<PendingChange[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [revertPreviewItems, setRevertPreviewItems] = useState<RevertPreviewItem[]>();
  const [deleteLocalPath, setDeleteLocalPath] = useState<string>();
  const [menu, setMenu] = useState<{ file: WorkspaceFile; paths: string[]; x: number; y: number }>();
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [filter, setFilter] = useState<WorkspaceFilter>("all");
  const [viewMode, setViewMode] = useState<"list" | "tree">("tree");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);
  const lazyRoot = useRef<string | undefined>(undefined);
  const directorySnapshots = useRef(new Map<string, WorkspaceDirectorySnapshot>());
  const loadedDirectories = useRef(new Set<string>());
  const loadingDirectories = useRef(new Set<string>());
  const directoryRequests = useRef(new Map<string, Promise<void>>());
  const statusVersionRequest = useRef<Promise<string | undefined>>(Promise.resolve(undefined));
  const safeSync = useSafeSync(connection, { refresh: refreshLoadedDirectories, setNotice, setError });

  function statusVersion(root: string): Promise<string | undefined> {
    return Promise.all([
      listPendingChanges(connection),
      listOpenedFiles(connection),
      listSubmittedChanges(connection, `${root}/...`, 1),
    ]).then(([pending, opened, submitted]) => workspaceStatusVersion(pending, opened, submitted), () => undefined);
  }

  function publishLazyDirectories(sequence: number) {
    if (loadSequence.current !== sequence || !lazyRoot.current) return;
    const directories = new Set<string>([lazyRoot.current]);
    const ignoredDirectories = new Set<string>();
    const nextFiles: WorkspaceFile[] = [];
    for (const snapshot of directorySnapshots.current.values()) {
      snapshot.directories.forEach((path) => directories.add(path));
      snapshot.ignoredDirectories.forEach((path) => ignoredDirectories.add(path));
      nextFiles.push(...mergeWorkspaceFileStatuses(
        snapshot.files,
        snapshot.statuses,
        snapshot.statusVersion !== undefined,
      ));
    }
    setDirectoryPaths([...directories]);
    setIgnoredDirectoryPaths(ignoredDirectories);
    setFiles(nextFiles);
    setLoadingDirectoryPaths(new Set(loadingDirectories.current));
    setLoadedDirectoryPaths(new Set(loadedDirectories.current));
  }

  function pruneMissingDirectories(parent: string, nextChildren: string[]) {
    const previous = directorySnapshots.current.get(parent)?.directories || [];
    const next = new Set(nextChildren.map((path) => path.toLowerCase()));
    const removed = previous.filter((path) => !next.has(path.toLowerCase()));
    if (!removed.length) return;
    const isRemoved = (path: string) => removed.some((root) => {
      const normalized = path.toLowerCase();
      const prefix = root.toLowerCase();
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    });
    for (const path of directorySnapshots.current.keys()) {
      if (isRemoved(path)) directorySnapshots.current.delete(path);
    }
    for (const path of loadedDirectories.current) {
      if (isRemoved(path)) loadedDirectories.current.delete(path);
    }
    setExpandedFolders((current) => new Set([...current].filter((path) => !isRemoved(path))));
    setCollapsedFolders((current) => new Set([...current].filter((path) => !isRemoved(path))));
  }

  async function loadDirectory(directory: string, refresh = false): Promise<void> {
    const sequence = loadSequence.current;
    if (!lazyRoot.current || loadSequence.current !== sequence) return;
    const existing = directoryRequests.current.get(directory);
    if (existing) return existing;
    if (!refresh && loadedDirectories.current.has(directory)) return;

    loadingDirectories.current.add(directory);
    publishLazyDirectories(sequence);
    const request = (async () => {
      const key = workspaceDirectoryCacheKey(connection, directory);
      const diskRequest = listLocalWorkspaceDirectory(connection, directory);
      const cached = await loadWorkspaceDirectoryCache(key);
      if (loadSequence.current !== sequence) return;
      if (cached?.directory.toLowerCase() === directory.toLowerCase()) {
        directorySnapshots.current.set(directory, cached);
        loadedDirectories.current.add(directory);
        publishLazyDirectories(sequence);
      }

      let snapshot: WorkspaceDirectorySnapshot;
      try {
        const batch = await diskRequest;
        if (loadSequence.current !== sequence) return;
        pruneMissingDirectories(directory, batch.directories);
        snapshot = {
          directory,
          directories: batch.directories,
          ignoredDirectories: batch.ignoredDirectories,
          files: batch.files,
          statuses: cached?.statuses || [],
          statusVersion: cached?.statusVersion,
        };
        directorySnapshots.current.set(directory, snapshot);
        loadedDirectories.current.add(directory);
        publishLazyDirectories(sequence);
        void saveWorkspaceDirectoryCache(key, snapshot);
      } catch (reason) {
        if (loadSequence.current !== sequence) return;
        if (cached) loadedDirectories.current.add(directory);
        setError(normalizeAppError(reason));
        return;
      }

      const version = await statusVersionRequest.current;
      if (!version || version !== snapshot.statusVersion) {
        try {
          const statuses = await listWorkspaceFiles(connection, workspaceDirectoryStatusScope(directory), false);
          if (loadSequence.current !== sequence) return;
          snapshot = { ...snapshot, statuses, statusVersion: version || "" };
          directorySnapshots.current.set(directory, snapshot);
          publishLazyDirectories(sequence);
          void saveWorkspaceDirectoryCache(key, snapshot);
        } catch (reason) {
          if (loadSequence.current === sequence) setError(normalizeAppError(reason));
        }
      }
    })().finally(() => {
      if (loadSequence.current !== sequence) return;
      loadingDirectories.current.delete(directory);
      directoryRequests.current.delete(directory);
      publishLazyDirectories(sequence);
    });
    directoryRequests.current.set(directory, request);
    return request;
  }

  async function loadLazy(nextRoot: string) {
    const sequence = ++loadSequence.current;
    setBusy(true);
    setError(undefined);
    setSelected([]);
    setSelectedFolders([]);
    setExpandedFolders(new Set());
    setCollapsedFolders(new Set());
    lazyRoot.current = nextRoot;
    directorySnapshots.current = new Map();
    loadedDirectories.current = new Set();
    loadingDirectories.current = new Set();
    directoryRequests.current = new Map();
    setFiles([]);
    setDirectoryPaths([nextRoot]);
    setIgnoredDirectoryPaths(new Set());
    setLoadingDirectoryPaths(new Set([nextRoot]));
    setLoadedDirectoryPaths(new Set());
    statusVersionRequest.current = statusVersion(nextRoot);
    await loadDirectory(nextRoot, true);
    if (loadSequence.current === sequence) setBusy(false);
  }

  async function loadEager(nextScope: string) {
    const sequence = ++loadSequence.current;
    setBusy(true);
    setError(undefined);
    setSelected([]);
    setSelectedFolders([]);
    setExpandedFolders(new Set());
    setCollapsedFolders(new Set());
    lazyRoot.current = undefined;
    const key = workspaceFileCacheKey(connection, nextScope);
    let cached = loadWorkspaceFileCache(key);
    setFiles(cached);
    setDirectoryPaths(workspaceDirectoryPaths(cached));
    setIgnoredDirectoryPaths(new Set());
    setLoadingDirectoryPaths(new Set());
    setLoadedDirectoryPaths(new Set());
    const persisted = await loadWorkspaceFileCachePersistent(key);
    if (loadSequence.current !== sequence) return;
    if (persisted !== cached) {
      cached = persisted;
      setFiles(cached);
      setDirectoryPaths(workspaceDirectoryPaths(cached));
    }
    const cachedVersion = loadWorkspaceStatusVersion(key);
    try {
      const [pending, opened, submitted] = await Promise.all([
        listPendingChanges(connection),
        listOpenedFiles(connection),
        listSubmittedChanges(connection, nextScope, 1),
      ]);
      const version = workspaceStatusVersion(pending, opened, submitted);
      if (version !== cachedVersion || !cached.length) {
        saveWorkspaceStatusVersion(key, version);
        const nextFiles = await listWorkspaceFiles(connection, nextScope, false);
        if (loadSequence.current !== sequence) return;
        setFiles(nextFiles);
        setDirectoryPaths(workspaceDirectoryPaths(nextFiles));
        await saveWorkspaceFileCache(key, nextFiles);
      }
    } catch (reason) {
      if (loadSequence.current === sequence) setError(normalizeAppError(reason));
    } finally {
      if (loadSequence.current === sequence) setBusy(false);
    }
  }

  async function load(nextScope = scope) {
    const nextRoot = workspaceLazyRoot(connection, nextScope);
    if (nextRoot) await loadLazy(nextRoot);
    else await loadEager(nextScope);
  }

  async function refreshLoadedDirectories() {
    const root = lazyRoot.current;
    if (!root) return load();
    setBusy(true);
    setError(undefined);
    statusVersionRequest.current = statusVersion(root);
    const paths = directorySnapshots.current.size ? [...directorySnapshots.current.keys()] : [root];
    for (const path of paths) {
      if (path === root || directorySnapshots.current.has(path)) await loadDirectory(path, true);
    }
    setBusy(false);
  }

  useEffect(() => { void load(); }, [connection.port, connection.user, connection.client, info.clientRoot, info.clientStream]);
  useEffect(() => () => { loadSequence.current += 1; }, []);
  useEffect(() => {
    const nextScope = initialScope?.trim();
    if (!nextScope || nextScope === scope) return;
    setScope(nextScope);
    void load(nextScope);
  }, [initialScope]);

  async function run(action: () => Promise<void>, message = t("operationSucceeded")) {
    setBusy(true);
    setError(undefined);
    try { await action(); setNotice(message); await refreshLoadedDirectories(); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function showSyncPreview(requestedScope = scope) {
    setBusy(true);
    setSyncPreviewBusy(true);
    setPreview(undefined);
    setSyncPreviewOpen(true);
    setError(undefined);
    try {
      setSyncScopes([requestedScope]);
      setPreview(await previewSync(connection, [requestedScope]));
      setSyncAcknowledged(false);
    } catch (reason) { setSyncPreviewOpen(false); setError(normalizeAppError(reason)); }
    finally { setSyncPreviewBusy(false); setBusy(false); }
  }

  async function runSync() {
    const requestedScopes = syncScopes.length ? syncScopes : [scope];
    setPreview(undefined);
    setSyncPreviewOpen(false);
    await safeSync.start(requestedScopes);
  }

  async function showReconcilePreview() {
    setBusy(true);
    setError(undefined);
    try {
      const items = await previewReconcile(connection, scope);
      setReconcileCandidates(items);
      setReconcileSelected(items);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyReconcile() {
    const paths = reconcileSelected.map((item) => item.depotPath);
    setReconcileCandidates(undefined);
    await run(() => reconcileFiles(connection, change, paths), t("reconcileSucceeded"));
  }

  async function showResolvePreview(mode: ResolveMode) {
    setBusy(true);
    setError(undefined);
    try {
      setResolvePreview(await previewResolve(connection, selectedUnresolvedPaths));
      setPendingResolveMode(mode);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyResolve() {
    if (!pendingResolveMode) return;
    const mode = pendingResolveMode;
    setPendingResolveMode(undefined);
    setResolvePreview([]);
    await run(() => resolveFiles(connection, selectedUnresolvedPaths, mode), t("resolveSucceeded"));
  }

  async function openWorkspaceSettings() {
    setBusy(true);
    setError(undefined);
    try {
      const spec = await inspectWorkspace(connection);
      setWorkspaceSpec(spec);
      setWorkspaceDraft({ name: spec.name, root: spec.root, stream: spec.stream || "", description: spec.description });
      setWorkspaceDialog("details");
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  function openWorkspaceEditor(dialog: Exclude<WorkspaceDialog, "details" | "delete">) {
    setWorkspaceDraft(dialog === "create" || !workspaceSpec ? emptyDraft : { name: workspaceSpec.name, root: workspaceSpec.root, stream: workspaceSpec.stream || "", description: workspaceSpec.description });
    setWorkspaceDialog(dialog);
  }

  async function applyWorkspaceDialog() {
    if (!workspaceDialog) return;
    setBusy(true);
    setError(undefined);
    try {
      if (workspaceDialog === "create") {
        await createWorkspace(connection, { name: workspaceDraft.name.trim(), root: workspaceDraft.root.trim(), stream: workspaceDraft.stream.trim() || undefined, description: workspaceDraft.description });
        setNotice(t("workspaceCreated"));
      } else if (workspaceDialog === "edit" && workspaceSpec) {
        await updateWorkspace(connection, { name: workspaceSpec.name, root: workspaceDraft.root.trim(), stream: workspaceDraft.stream.trim() || undefined, description: workspaceDraft.description });
        setWorkspaceSpec(await inspectWorkspace(connection));
        setNotice(t("workspaceUpdated"));
      } else if (workspaceDialog === "rename" && workspaceSpec) {
        const name = workspaceDraft.name.trim();
        await renameWorkspace(connection, workspaceSpec.name, name);
        setNotice(t("workspaceRenamed"));
        onRenamed?.(name);
      } else if (workspaceDialog === "delete" && workspaceSpec) {
        await deleteWorkspace(connection, workspaceSpec.name);
        setNotice(t("workspaceDeleted"));
        onDeleted?.();
      }
      setWorkspaceDialog(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyRename() {
    if (selected.length !== 1 || !renameDestination?.trim()) return;
    const source = selected[0];
    const destination = renameDestination.trim();
    setRenameDestination(undefined);
    await run(() => moveFile(connection, change, source, destination), t("renameSucceeded"));
  }

  async function openRevert(paths: string[]) {
    const candidates = files.filter((file) => paths.includes(file.depotPath));
    const changeId = candidates[0]?.change || "default";
    if (!candidates.length || candidates.some((file) => !file.action || (file.change || "default") !== changeId)) return;
    setBusy(true);
    setError(undefined);
    try { setRevertPreviewItems(await previewRevertSelected(connection, changeId, paths)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyRevert() {
    if (!revertPreviewItems?.length) return;
    const changeId = files.find((file) => file.depotPath === revertPreviewItems[0].depotPath)?.change || "default";
    const paths = revertPreviewItems.map((item) => item.depotPath);
    setRevertPreviewItems(undefined);
    await run(() => revertFiles(connection, changeId, paths, false), t("filesReverted"));
  }

  function openFileMenu(event: React.MouseEvent | React.KeyboardEvent, file: WorkspaceFile) {
    event.preventDefault();
    event.stopPropagation();
    const paths = selected.includes(file.depotPath) ? selected : [file.depotPath];
    if (!selected.includes(file.depotPath)) setSelected(paths);
    setSelectedFolders([]);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ file, paths, x: "clientX" in event && event.clientX > 0 ? event.clientX : rect.left, y: "clientY" in event && event.clientY > 0 ? event.clientY : rect.bottom });
  }

  const selectedFiles = files.filter((file) => selected.includes(file.depotPath));
  const paths = selectedFiles.map((file) => file.depotPath);
  const selectedSyncScopes = [...selectedFolders.map((folder) => `${folder.replace(/\/+$/, "")}/...`), ...paths];
  const selectedFile = selectedFiles.length === 1 && selectedFolders.length === 0 ? selectedFiles[0] : undefined;
  const selectedHistoryPath = workspaceFileHistoryPath(selectedFile);
  const selectedUnresolvedPaths = selectedFiles.filter((file) => file.unresolved).map((file) => file.depotPath);
  const visibleFiles = useMemo(() => filterWorkspaceFiles(files, filter, query), [files, filter, query]);
  const visibleDirectories = useMemo(() => filter === "all" && !query.trim() ? directoryPaths : [], [directoryPaths, filter, query]);
  const tree = useMemo(() => buildWorkspaceTree(visibleFiles, visibleDirectories, loadingDirectoryPaths, lazyRoot.current ? loadedDirectoryPaths : undefined, ignoredDirectoryPaths), [visibleFiles, visibleDirectories, loadingDirectoryPaths, loadedDirectoryPaths, ignoredDirectoryPaths]);
  const revisionScope = targetRevision.trim() ? `${scope.trim()}#${targetRevision.trim()}` : scope;
  const filtersActive = scope.trim() !== "//..." || query.trim() !== "" || filter !== "all" || viewMode !== "tree";

  useEffect(() => {
    const ordered = viewMode === "tree"
      ? workspaceSelectionOrder(tree, collapsedFolders)
      : visibleFiles.map((file) => `file:${file.depotPath}`);
    if (selectionAnchor.current && !ordered.includes(selectionAnchor.current)) {
      const current = [...selectedFolders.map((path) => `folder:${path}`), ...selected.map((path) => `file:${path}`)];
      selectionAnchor.current = current.reverse().find((item) => ordered.includes(item));
    }
  }, [collapsedFolders, selected, selectedFolders, tree, viewMode, visibleFiles]);

  function applyTreeSelection(target: string, event: React.MouseEvent) {
    const current = [
      ...selectedFolders.map((path) => `folder:${path}`),
      ...selected.map((path) => `file:${path}`),
    ];
    const ordered = viewMode === "tree"
      ? workspaceSelectionOrder(tree, collapsedFolders)
      : visibleFiles.map((file) => `file:${file.depotPath}`);
    const next = updateSelection(ordered, current, target, selectionAnchor.current, selectionMode(event));
    selectionAnchor.current = next.anchor;
    setSelectedFolders(next.selected.filter((item) => item.startsWith("folder:")).map((item) => item.slice(7)));
    setSelected(next.selected.filter((item) => item.startsWith("file:")).map((item) => item.slice(5)));
  }

  function selectFile(file: WorkspaceFile, event: React.MouseEvent) {
    applyTreeSelection(`file:${file.depotPath}`, event);
  }

  function selectFolder(folder: WorkspaceTreeFolder, event: React.MouseEvent) {
    applyTreeSelection(`folder:${folder.path}`, event);
  }

  const renderFile = (file: WorkspaceFile) => {
    const statuses = workspaceStatus(file);
    const statusText = file.statusPending ? t("workspaceStatusLoading") : statuses.map((status) => t(`workspaceStatus_${status}` as never)).join(" · ") || t("workspaceStatusClean");
    const title = `${file.depotPath}\n${t("workspaceStatus")}: ${statusText}\n${t("fileSize")}: ${file.fileSize === undefined ? "—" : formatBytes(file.fileSize)}\n${t("changelistLabel")}: ${file.change || "default"}`;
    return <button type="button" role="treeitem" title={title} aria-selected={selected.includes(file.depotPath)} data-agent-ignored={file.ignored} className={`workspace-file-row${selected.includes(file.depotPath) ? " selected" : ""}${file.ignored ? " ignored" : ""}`} key={file.depotPath} onClick={(event) => selectFile(file, event)} onContextMenu={(event) => openFileMenu(event, file)} onKeyDown={(event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openFileMenu(event, file); }}>
      <span className="file-tree-icon" aria-hidden="true">{fileIcon(file.depotPath)}</span>
      <span><strong>{file.depotPath.split("/").at(-1) || file.depotPath}</strong><small>{file.localPath || file.clientPath || file.depotPath} · {statusText}</small></span>
      <span className="file-status-markers" aria-label={statusText}>{statusMarkers(file).map((marker) => <span title={marker.status === "clean" ? t("workspaceStatusClean") : marker.status === "loading" ? t("workspaceStatusLoading") : t(`workspaceStatus_${marker.status}` as never)} className={marker.className} key={marker.status}>{marker.symbol}</span>)}</span>
      <span className="revision-cell">{file.haveRevision || "—"} / {file.headRevision || "—"}</span>
    </button>;
  };

  const renderTree = (folders: WorkspaceTreeFolder[]) => folders.map((folder) => {
    const isRoot = folder.path.slice(2).split("/").filter(Boolean).length === 1;
    const open = !collapsedFolders.has(folder.path) && (isRoot || expandedFolders.has(folder.path));
    const ignored = folderIsIgnored(folder);
    return <details className={`workspace-tree-folder${selectedFolders.includes(folder.path) ? " selected" : ""}${ignored ? " ignored" : ""}`} key={folder.path} open={open} onToggle={(event) => {
      const nextOpen = event.currentTarget.open;
      if (nextOpen && lazyRoot.current) void loadDirectory(folder.path);
      setCollapsedFolders((current) => {
        const next = new Set(current);
        if (nextOpen) next.delete(folder.path); else next.add(folder.path);
        return next;
      });
      setExpandedFolders((current) => {
        const next = new Set(current);
        if (nextOpen) next.add(folder.path); else next.delete(folder.path);
        return next;
      });
    }} aria-busy={folder.loading}><summary role="treeitem" aria-label={ignored ? `${folder.name} · ${t("workspaceStatus_ignored")}` : folder.name} aria-selected={selectedFolders.includes(folder.path)} aria-expanded={open} aria-busy={folder.loading} data-agent-id={`workspace-folder:${folder.path}`} data-agent-ignored={ignored} onClick={(event) => selectFolder(folder, event)}><span className="folder-icon" aria-hidden="true">▸</span><strong>{folder.name}</strong><span className="folder-summary-meta">{folder.loading ? <span className="folder-loading-indicator" role="status" aria-label={t("folderLoading")} title={t("folderLoading")} /> : null}<small>{folder.loaded ? folderFileCount(folder) : "…"}</small></span></summary>{open && <div role="group">{renderTree(folder.folders)}{folder.files.map(renderFile)}</div>}</details>;
  });

  const selectedFolder = selectedFolders.length === 1 && selected.length === 0 ? selectedFolders[0] : undefined;

  useEffect(() => {
    if (!selectedFile && !selectedFolder) {
      setRevisionHistory([]);
      setFolderHistory([]);
      return;
    }
    if (selectedFile && !selectedHistoryPath) {
      setRevisionHistory([]);
      setFolderHistory([]);
      setHistoryBusy(false);
      return;
    }
    let active = true;
    setHistoryBusy(true);
    setRevisionHistory([]);
    setFolderHistory([]);
    const request = selectedHistoryPath
      ? fileHistory(connection, selectedHistoryPath, 50).then((items) => { if (active) { setRevisionHistory(items); setFolderHistory([]); } })
      : listSubmittedChanges(connection, `${selectedFolder}/...`, 50).then((items) => { if (active) { setFolderHistory(items); setRevisionHistory([]); } });
    void request.catch((reason) => { if (active) setError(normalizeAppError(reason)); }).finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  }, [connection, selectedFile, selectedFolder, selectedHistoryPath]);

  const menuFiles = menu ? files.filter((file) => menu.paths.includes(file.depotPath)) : [];
  const menuChange = menuFiles[0]?.change || "default";
  const menuCanRevert = menuFiles.length > 0 && menuFiles.every((file) => Boolean(file.action) && (file.change || "default") === menuChange);

  return <View
    id="workspace-files-title"
    eyebrow={t("workspaceEyebrow")}
    title={t("filesTitle")}
    subtitle={`${info.clientRoot || connection.client} · ${t("workspaceFilesBody")}`}
    error={error}
    notice={notice}
    operationLabel={syncPreviewBusy ? t("preparingUpdate") : safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    onDismissNotice={() => setNotice("")}
    actions={<>{sourceControl}<button className="secondary-button" type="button" onClick={() => void openWorkspaceSettings()} disabled={busy}>{t("workspaceSpec")}</button><button className="secondary-button" type="button" onClick={() => void showReconcilePreview()} disabled={busy}>{t("reconcile")}</button><button className="secondary-button" type="button" onClick={() => void refreshLoadedDirectories()} disabled={busy}>{busy && !syncPreviewBusy ? t("updatingFileStatuses") : t("refresh")}</button><button className="primary-button update-project-button" type="button" onClick={() => void safeSync.start([scope])} disabled={busy || safeSync.phase !== "idle"}>{safeSync.phase === "idle" ? t("updateProject") : t("updatingProject")}</button></>}
  >
    <details className="files-options">
      <summary><strong>{t("filesSearchAndFilters")}</strong><span>{t(filtersActive ? "filesFiltersActive" : "filesFiltersOptional")}</span></summary>
      <div className="resource-toolbar">
        <label className="field"><span className="field-label">{t("fileScope")}</span><input value={scope} placeholder={t("fileScopePlaceholder")} onChange={(event) => setScope(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(scope); }} /><small>{t("fileScopeHelp")}</small></label>
        <button className="secondary-button apply-scope-button" type="button" onClick={() => void load(scope)} disabled={busy}>{t("applyScope")}</button>
        <label className="field"><span className="field-label">{t("workspaceSearch")}</span><input value={query} placeholder={t("workspaceSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /><small>{t("workspaceSearchHelp")}</small></label>
        <label className="field"><span className="field-label">{t("workspaceFilter")}</span><select value={filter} onChange={(event) => setFilter(event.target.value as WorkspaceFilter)}><option value="all">{t("workspaceFilterAll")}</option><option value="opened">{t("workspaceFilterOpened")}</option><option value="outdated">{t("workspaceFilterOutdated")}</option><option value="unresolved">{t("workspaceFilterUnresolved")}</option><option value="otherOpen">{t("workspaceFilterOtherOpen")}</option><option value="locked">{t("workspaceFilterLocked")}</option><option value="unmapped">{t("workspaceFilterUnmapped")}</option><option value="untracked">{t("workspaceFilterUntracked")}</option></select></label>
        <label className="field compact-field"><span className="field-label">{t("workspaceViewMode")}</span><select value={viewMode} onChange={(event) => {
          const next = event.target.value as "list" | "tree";
          setViewMode(next);
          if (next === "list") setSelectedFolders([]);
        }}><option value="list">{t("workspaceViewList")}</option><option value="tree">{t("workspaceViewTree")}</option></select></label>
      </div>
    </details>
    <div className="resource-workbench workspace-workbench">
      <div className="resource-list workspace-resource-list" role="list">
        <div className="column-heading"><strong>{t("workspaceFiles")}</strong><span>{selected.length > 0 ? `${selected.length} / ` : ""}{visibleFiles.length}</span></div>
        {viewMode === "tree" && tree.length > 0 ? <div className="workspace-file-tree" role="tree">{renderTree(tree)}</div> : busy && files.length === 0 ? <CompactEmpty text={t("loadingFiles")} /> : files.length === 0 ? <CompactEmpty text={t("workspaceNoFiles")} /> : visibleFiles.length === 0 ? <CompactEmpty text={t("workspaceNoFilterMatches")} /> : visibleFiles.map(renderFile)}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("fileDetailsLabel")}</strong><span>{selectedFolders.length ? `${selectedFolders.length} ${t("foldersSelected")}` : selected.length}</span></div>
        {!selected.length && !selectedFolders.length ? <EmptyState title={t("selectWorkspaceFile")} body={t("selectWorkspaceFileBody")} /> : <div className="inspector-content">
          <div><h2>{selectedFolder || (selectedFolders.length ? `${selectedFolders.length} ${t("foldersSelected")}` : selectedFile?.depotPath || `${selected.length} ${t("filesSelected")}`)}</h2>{selectedFile && <PathActions depotPath={selectedFile.depotPath} localPath={selectedFile.localPath} />}</div>
          {selectedSyncScopes.length > 0 && <div className="inspector-actions"><button className="primary-button" type="button" onClick={() => void safeSync.start(selectedSyncScopes)} disabled={busy || safeSync.phase !== "idle"}>{t("updateSelected")}</button></div>}
          {selectedFile && <dl className="file-facts"><dt>{t("actionLabel")}</dt><dd>{selectedFile.action || "—"}</dd><dt>{t("revisionLabel")}</dt><dd>{selectedFile.haveRevision || "—"} / {selectedFile.headRevision || "—"}</dd><dt>{t("workspaceStatus")}</dt><dd>{selectedFile.statusPending ? t("workspaceStatusLoading") : workspaceStatus(selectedFile).map((status) => t(`workspaceStatus_${status}` as never)).join(" · ") || t("workspaceStatusClean")}</dd></dl>}
          <section className="selection-history"><h3>{t("selectedHistory")}</h3>{historyBusy ? <CompactEmpty text={t("loadingHistory")} /> : revisionHistory.length ? revisionHistory.map((revision) => <div className="history-compact-row" key={revision.revision}><strong>#{revision.revision} · {revision.action}</strong><span>CL {revision.change} · {revision.user}</span><small>{revision.description}</small></div>) : folderHistory.length ? folderHistory.map((changeItem) => <div className="history-compact-row" key={changeItem.id}><strong>CL {changeItem.id} · {changeItem.user}</strong><span>{changeItem.client}</span><small>{changeItem.description}</small></div>) : <CompactEmpty text={t("depotNoHistory")} />}</section>
          {selected.length > 0 && <><label className="field"><span className="field-label">{t("destinationChangelist")}</span><input value={change} onChange={(event) => setChange(event.target.value)} /></label>
          <div className="inspector-actions"><button className="secondary-button" type="button" onClick={() => void run(() => editFiles(connection, change, paths))} disabled={busy || !paths.length}>{t("openForEdit")}</button><button className="secondary-button" type="button" onClick={() => void run(() => addFiles(connection, change, paths))} disabled={busy || !paths.length}>{t("markForAdd")}</button><button className="secondary-button" type="button" onClick={() => void run(() => deleteFiles(connection, change, paths))} disabled={busy || !paths.length}>{t("markForDelete")}</button><button className="secondary-button" type="button" onClick={() => void openRevert(paths)} disabled={busy || !selectedFiles.every((file) => file.action && (file.change || "default") === (selectedFiles[0]?.change || "default"))}>{t("revertSelected")}</button><button className="secondary-button" type="button" onClick={() => setRenameDestination(selectedFile?.depotPath || "")} disabled={!selectedFile || busy}>{t("renameFile")}</button><button className="secondary-button" type="button" onClick={() => void run(() => lockFiles(connection, change, paths))} disabled={busy || !paths.length}>{t("lockFiles")}</button><button className="secondary-button" type="button" onClick={() => void run(() => unlockFiles(connection, change, paths))} disabled={busy || !paths.length}>{t("unlockFiles")}</button></div>
          {selectedUnresolvedPaths.length > 0 && <div className="inline-preview"><strong>{t("unresolvedFilesSelected")}: {selectedUnresolvedPaths.length}</strong><div className="inspector-actions"><button className="secondary-button" type="button" onClick={() => void showResolvePreview("yours")} disabled={busy}>{t("resolveKeepWorkspace")}</button><button className="secondary-button" type="button" onClick={() => void showResolvePreview("theirs")} disabled={busy}>{t("resolveAcceptServer")}</button><button className="secondary-button" type="button" onClick={() => void showResolvePreview("autoSafe")} disabled={busy}>{t("resolveAutoSafe")}</button><button className="secondary-button" type="button" onClick={() => void showResolvePreview("autoMerge")} disabled={busy}>{t("resolveAutoMerge")}</button></div></div>}
          <div className="inline-preview"><label className="field"><span className="field-label">{t("targetRevision")}</span><input value={targetRevision} placeholder={t("targetRevisionPlaceholder")} onChange={(event) => setTargetRevision(event.target.value)} /></label><button className="secondary-button" type="button" onClick={() => void showSyncPreview(revisionScope)} disabled={busy || !targetRevision.trim()}>{t("getRevision")}</button></div></>}
        </div>}
      </aside>
    </div>

    {menu && <ContextMenu x={menu.x} y={menu.y} onSelect={() => setMenu(undefined)}>
      <MenuButton onClick={() => void safeSync.start(menu.paths)}>{t("updateSelected")}</MenuButton>
      {menuFiles.every((file) => !file.action && !file.untracked) && <MenuButton onClick={() => void run(() => editFiles(connection, change, menu.paths))}>{t("openForEdit")}</MenuButton>}
      {menuFiles.every((file) => file.untracked && !file.ignored) && <MenuButton onClick={() => void run(() => addFiles(connection, change, menu.paths))}>{t("markForAdd")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.untracked && menu.file.localPath && <MenuButton onClick={() => void run(() => ignoreLocalFile(connection, menu.file.localPath!), t("fileIgnored"))}>{t("addToIgnore")}</MenuButton>}
      {menuFiles.every((file) => !file.untracked && !file.action) && <MenuButton onClick={() => void run(() => deleteFiles(connection, change, menu.paths))}>{t("markForDelete")}</MenuButton>}
      {menuCanRevert && <MenuButton danger onClick={() => void openRevert(menu.paths)}>{t("revertSelected")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.localPath && <MenuButton danger onClick={() => setDeleteLocalPath(menu.file.localPath)}>{t("deleteLocally")}</MenuButton>}
    </ContextMenu>}

    {syncPreviewOpen && <SyncPreviewDialog preview={preview} busy={busy} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} onClose={() => setSyncPreviewOpen(false)} onConfirm={() => void runSync()} />}
    <SafeSyncConflictDialog sync={safeSync} />

    {reconcileCandidates && <ActionDialog title={t("reconcilePreviewTitle")} confirmLabel={t("applyReconcile")} busy={busy} confirmDisabled={!reconcileSelected.length} onClose={() => setReconcileCandidates(undefined)} onConfirm={() => void applyReconcile()}><p>{t("reconcilePreviewBody")}</p><div className="resource-detail-list">{reconcileCandidates.length ? reconcileCandidates.map((item) => <button type="button" className={`resource-entry preview-select${reconcileSelected.some((selectedItem) => selectedItem.depotPath === item.depotPath) ? " selected" : ""}`} key={`${item.depotPath}-${item.action}`} onClick={() => setReconcileSelected((current) => current.some((selectedItem) => selectedItem.depotPath === item.depotPath) ? current.filter((selectedItem) => selectedItem.depotPath !== item.depotPath) : [...current, item])}><strong>{item.depotPath}</strong><small>{item.action}{item.localPath ? ` · ${item.localPath}` : ""}</small></button>) : <CompactEmpty text={t("noReconcileChanges")} />}</div></ActionDialog>}

    {pendingResolveMode && <ActionDialog danger={pendingResolveMode === "theirs"} title={t("resolveConfirmTitle")} confirmLabel={t("resolveConfirm")} busy={busy} confirmDisabled={!resolvePreview.length} onClose={() => { setPendingResolveMode(undefined); setResolvePreview([]); }} onConfirm={() => void applyResolve()}><p>{pendingResolveMode === "yours" ? t("resolveKeepWorkspaceBody") : t("resolveAcceptServerBody")}</p>{resolvePreview.length ? resolvePreview.map((item) => <div className="resource-detail-row" key={item.depotPath}><span><strong>{item.depotPath}</strong><small>{item.action} · {item.detail || ""}</small></span></div>) : <CompactEmpty text={t("resolveNoPreview")} />}</ActionDialog>}

    {renameDestination !== undefined && selectedFile && <ActionDialog title={t("renameFile")} confirmLabel={t("renameFile")} busy={busy} confirmDisabled={!renameDestination.trim() || renameDestination.trim() === selectedFile.depotPath} onClose={() => setRenameDestination(undefined)} onConfirm={() => void applyRename()}><p>{selectedFile.depotPath}</p><label className="field"><span className="field-label">{t("renameDestinationPrompt")}</span><input autoFocus value={renameDestination} onChange={(event) => setRenameDestination(event.target.value)} /></label></ActionDialog>}

    {revertPreviewItems && <ActionDialog danger title={t("revertSelected")} confirmLabel={t("revertNow")} busy={busy} confirmDisabled={!revertPreviewItems.length} onClose={() => setRevertPreviewItems(undefined)} onConfirm={() => void applyRevert()}><p>{t("revertWarning")}</p>{revertPreviewItems.length ? <div className="file-selection-summary">{revertPreviewItems.map((item) => <span key={item.depotPath}>{item.action}: {item.depotPath}</span>)}</div> : <CompactEmpty text={t("noRevertFiles")} />}</ActionDialog>}

    {deleteLocalPath && <ActionDialog danger title={t("deleteLocally")} confirmLabel={t("deleteLocally")} busy={busy} onClose={() => setDeleteLocalPath(undefined)} onConfirm={() => { const path = deleteLocalPath; setDeleteLocalPath(undefined); void run(() => deleteLocalFile(connection, path), t("localFileDeleted")); }}><p>{t("deleteLocallyWarning")}</p><strong>{deleteLocalPath}</strong></ActionDialog>}

    {workspaceDialog === "details" && workspaceSpec && <Modal title={t("workspaceSpecTitle")} busy={busy} onClose={() => setWorkspaceDialog(undefined)}><div className="dialog-body"><p>{workspaceSpec.description || t("workspaceSpecNoValue")}</p><dl className="dialog-facts"><dt>{t("workspaceSpecName")}</dt><dd>{workspaceSpec.name}</dd><dt>{t("workspaceSpecOwner")}</dt><dd>{workspaceSpec.owner}</dd><dt>{t("workspaceSpecRoot")}</dt><dd>{workspaceSpec.root}</dd><dt>{t("workspaceSpecHost")}</dt><dd>{workspaceSpec.host || "—"}</dd><dt>{t("workspaceSpecStream")}</dt><dd>{workspaceSpec.stream || "—"}</dd><dt>{t("workspaceSpecOptions")}</dt><dd>{workspaceSpec.options.join(", ") || "—"}</dd></dl><div className="resource-detail-list">{workspaceSpec.mappings.map((mapping) => <div className="resource-detail-row" key={mapping}><span><strong>{mapping}</strong></span></div>)}</div></div><div className="dialog-actions workspace-spec-actions"><button className="secondary-button" type="button" onClick={() => openWorkspaceEditor("create")}>{t("createWorkspace")}</button><button className="secondary-button" type="button" onClick={() => openWorkspaceEditor("edit")}>{t("editWorkspace")}</button><button className="secondary-button" type="button" onClick={() => openWorkspaceEditor("rename")}>{t("renameWorkspace")}</button><button className="danger-button" type="button" onClick={() => setWorkspaceDialog("delete")}>{t("deleteWorkspace")}</button></div></Modal>}

    {(workspaceDialog === "create" || workspaceDialog === "edit" || workspaceDialog === "rename") && <ActionDialog title={workspaceDialog === "create" ? t("createWorkspace") : workspaceDialog === "edit" ? t("editWorkspace") : t("renameWorkspace")} confirmLabel={workspaceDialog === "create" ? t("createWorkspace") : workspaceDialog === "edit" ? t("save") : t("renameWorkspace")} busy={busy} confirmDisabled={!workspaceDraft.name.trim() || (workspaceDialog !== "rename" && !workspaceDraft.root.trim())} onClose={() => setWorkspaceDialog(workspaceSpec ? "details" : undefined)} onConfirm={() => void applyWorkspaceDialog()}><p>{workspaceDialog === "create" ? t("workspaceCreateConfirm") : workspaceDialog === "edit" ? t("workspaceEditConfirm") : t("workspaceRenameConfirm")}</p><label className="field"><span className="field-label">{t("workspaceSpecName")}</span><input value={workspaceDraft.name} onChange={(event) => setWorkspaceDraft({ ...workspaceDraft, name: event.target.value })} disabled={workspaceDialog === "edit"} /></label>{workspaceDialog !== "rename" && <><label className="field"><span className="field-label">{t("workspaceSpecRoot")}</span><input value={workspaceDraft.root} onChange={(event) => setWorkspaceDraft({ ...workspaceDraft, root: event.target.value })} /></label><label className="field"><span className="field-label">{t("workspaceSpecStream")}</span><input value={workspaceDraft.stream} onChange={(event) => setWorkspaceDraft({ ...workspaceDraft, stream: event.target.value })} /></label><label className="field"><span className="field-label">{t("workspaceDescriptionPrompt")}</span><textarea value={workspaceDraft.description} onChange={(event) => setWorkspaceDraft({ ...workspaceDraft, description: event.target.value })} /></label></>}</ActionDialog>}

    {workspaceDialog === "delete" && workspaceSpec && <ActionDialog danger title={t("deleteWorkspace")} confirmLabel={t("deleteWorkspace")} busy={busy} onClose={() => setWorkspaceDialog("details")} onConfirm={() => void applyWorkspaceDialog()}><p>{t("workspaceDeleteConfirm")}</p><strong>{workspaceSpec.name}</strong></ActionDialog>}
  </View>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}

function fileIcon(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension || "")) return "▧";
  if (["ts", "tsx", "js", "jsx", "rs", "cpp", "h", "cs", "py"].includes(extension || "")) return "<>";
  return "▤";
}

function statusMarkers(file: WorkspaceFile): { symbol: string; status: string; className: string }[] {
  const markers: { symbol: string; status: string; className: string }[] = [];
  if (file.statusPending) return [{ symbol: "…", status: "loading", className: "pending" }];
  if (file.action === "add") markers.push({ symbol: "+", status: "added", className: "added" });
  else if (file.action === "delete") markers.push({ symbol: "−", status: "deleted", className: "deleted" });
  else if (file.action) markers.push({ symbol: "✎", status: "edited", className: "opened" });
  if (file.otherLock) markers.push({ symbol: "▣", status: "locked", className: "locked" });
  if (file.otherOpen) markers.push({ symbol: "●", status: "otherOpen", className: "other-open" });
  if (file.unresolved) markers.push({ symbol: "!", status: "unresolved", className: "unresolved" });
  if (file.ignored) markers.push({ symbol: "∅", status: "ignored", className: "ignored" });
  if (!markers.length) markers.push({ symbol: "·", status: "clean", className: "clean" });
  return markers;
}

function folderIsIgnored(folder: WorkspaceTreeFolder): boolean {
  return folder.ignored || (folderFileCount(folder) > 0
    && folder.files.every((file) => file.ignored)
    && folder.folders.every(folderIsIgnored));
}

function folderFileCount(folder: WorkspaceTreeFolder): number {
  return folder.files.length + folder.folders.reduce((total, child) => total + folderFileCount(child), 0);
}
