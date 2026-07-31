import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, Ban, CheckCircle2, CircleAlert, Download, FileCode2, FileImage, Files, FileText, Filter, Folder, GitCommitHorizontal, HardDrive, History, List, ListTree, LoaderCircle, LockKeyhole, Minus, Pencil, Plus, ScanSearch, Search, Settings2, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import { addFiles, createWorkspace, deleteFiles, deleteLocalFile, deleteWorkspace, editFiles, fileHistory, ignoreLocalFile, inspectWorkspace, listLocalWorkspaceDirectory, listOpenedFiles, listPendingChanges, listSubmittedChanges, listWorkspaceFiles, lockFiles, moveFile, normalizeAppError, previewResolve, previewRevertSelected, renameWorkspace, resolveFiles, revealPath, revertFiles, startReconcile, startReconcilePreview, unlockFiles, updateWorkspace } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, FileRevision, OperationEvent, P4Info, PendingChange, ReconcileItem, ResolveMode, ResolvePreviewItem, RevertPreviewItem, WorkspaceFile, WorkspaceSpec } from "../../shared/models";
import { isOperationTerminal, startObservedOperation } from "../../shared/operations";
import { SafeSyncConflictDialog, useSafeSync } from "../../shared/SafeSync";
import { RefreshButton } from "../../shared/RefreshButton";
import { ChangelistHistory } from "../../shared/ChangelistHistory";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { RevisionGraph } from "../history/RevisionGraphView";
import { ItemRowCopy, SelectableRow, SelectableSurface, TreeItemRow } from "../../shared/ItemList";
import { isContextMenuShortcut, retainAvailableSelection, selectionMode, updateSelection } from "../../shared/selection";
import { ActionDialog, CompactEmpty, ContextMenu, EmptyState, MenuButton, Modal, View } from "../../shared/View";
import { useContextMenu } from "../../shared/useContextMenu";
import { ChangeHistoryDialog } from "./ChangeHistoryDialog";
import { ResolveDialog } from "./ResolveDialog";
import { SpecializedResolveDialog } from "./SpecializedResolveDialog";
import { buildWorkspaceTree, defaultReconcileSelection, filterWorkspaceFiles, formatWorkspaceHistoryTime, groupReconcileItems, loadWorkspaceDirectoryCache, loadWorkspaceFileCache, loadWorkspaceFileCachePersistent, loadWorkspaceStatusVersion, mergeWorkspaceFileStatuses, saveWorkspaceDirectoryCache, saveWorkspaceFileCache, saveWorkspaceStatusVersion, toggleReconcileSelection, type WorkspaceDirectorySnapshot, type WorkspaceFilter, type WorkspaceHistorySelection, workspaceDirectoryCacheKey, workspaceDirectoryPaths, workspaceDirectoryStatusScope, workspaceFileCacheKey, workspaceFileHistoryPath, workspaceHistorySyncScopes, workspaceLazyRoot, workspaceSelectionOrder, workspaceStatus, workspaceStatusVersion, type WorkspaceTreeFolder } from "./workspace";

type WorkspaceDialog = "details" | "create" | "edit" | "rename" | "delete";
type WorkspaceDraft = { name: string; root: string; stream: string; description: string };

const emptyDraft: WorkspaceDraft = { name: "", root: "", stream: "", description: "" };

export function WorkspaceView({ connection, info, initialScope, initialResolveRequest, sourceControl, onNavigateDepot, onDeleted, onRenamed }: { connection: ConnectionInput; info: P4Info; initialScope?: string; initialResolveRequest?: { id: number; change: string; paths: string[] }; sourceControl?: ReactNode; onNavigateDepot?: (scope: string) => void; onDeleted?: () => void; onRenamed?: (name: string) => void }) {
  const { t, language } = useLocale();
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
  const [reconcileCandidates, setReconcileCandidates] = useState<ReconcileItem[]>();
  const [reconcileSelected, setReconcileSelected] = useState<ReconcileItem[]>([]);
  const [reconcileStale, setReconcileStale] = useState(false);
  const [reconcileOperation, setReconcileOperation] = useState<OperationEvent>();
  const [pendingResolveMode, setPendingResolveMode] = useState<ResolveMode>();
  const [pendingResolvePaths, setPendingResolvePaths] = useState<string[]>([]);
  const [resolvePreview, setResolvePreview] = useState<ResolvePreviewItem[]>([]);
  const [resolveEditorItem, setResolveEditorItem] = useState<ResolvePreviewItem>();
  const [specializedResolveItems, setSpecializedResolveItems] = useState<ResolvePreviewItem[]>();
  const [workspaceSpec, setWorkspaceSpec] = useState<WorkspaceSpec>();
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialog>();
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>(emptyDraft);
  const [renameDestination, setRenameDestination] = useState<string>();
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [revisionHistory, setRevisionHistory] = useState<FileRevision[]>([]);
  const [folderHistory, setFolderHistory] = useState<PendingChange[]>([]);
  const [historySelection, setHistorySelection] = useState<WorkspaceHistorySelection>();
  const [historyChange, setHistoryChange] = useState<string>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const [revertPreviewItems, setRevertPreviewItems] = useState<RevertPreviewItem[]>();
  const [deleteLocalPath, setDeleteLocalPath] = useState<string>();
  const workspaceMenu = useContextMenu<{ file: WorkspaceFile; paths: string[] }>();
  const selectionAnchor = useRef<string | undefined>(undefined);
  const handledResolveRequest = useRef<number | undefined>(undefined);
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
    setSelected((current) => retainAvailableSelection(current, nextFiles.map((file) => file.depotPath)));
    setSelectedFolders((current) => retainAvailableSelection(current, [...directories]));
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

  async function loadEager(nextScope: string, preserveSelection = false) {
    const sequence = ++loadSequence.current;
    setBusy(true);
    setError(undefined);
    if (!preserveSelection) {
      setSelected([]);
      setSelectedFolders([]);
      setExpandedFolders(new Set());
      setCollapsedFolders(new Set());
    }
    lazyRoot.current = undefined;
    const key = workspaceFileCacheKey(connection, nextScope);
    let cached = loadWorkspaceFileCache(key);
    setFiles(cached);
    setDirectoryPaths(workspaceDirectoryPaths(cached));
    if (preserveSelection && cached.length) {
      setSelected((current) => retainAvailableSelection(current, cached.map((file) => file.depotPath)));
      setSelectedFolders((current) => retainAvailableSelection(current, workspaceDirectoryPaths(cached)));
    }
    setIgnoredDirectoryPaths(new Set());
    setLoadingDirectoryPaths(new Set());
    setLoadedDirectoryPaths(new Set());
    const persisted = await loadWorkspaceFileCachePersistent(key);
    if (loadSequence.current !== sequence) return;
    if (persisted !== cached) {
      cached = persisted;
      setFiles(cached);
      setDirectoryPaths(workspaceDirectoryPaths(cached));
      if (preserveSelection && cached.length) {
        setSelected((current) => retainAvailableSelection(current, cached.map((file) => file.depotPath)));
        setSelectedFolders((current) => retainAvailableSelection(current, workspaceDirectoryPaths(cached)));
      }
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
        if (preserveSelection) {
          setSelected((current) => retainAvailableSelection(current, nextFiles.map((file) => file.depotPath)));
          setSelectedFolders((current) => retainAvailableSelection(current, workspaceDirectoryPaths(nextFiles)));
        }
        await saveWorkspaceFileCache(key, nextFiles);
      }
    } catch (reason) {
      if (loadSequence.current === sequence) setError(normalizeAppError(reason));
    } finally {
      if (loadSequence.current === sequence) setBusy(false);
    }
  }

  async function load(nextScope = scope, preserveSelection = false) {
    const nextRoot = workspaceLazyRoot(connection, nextScope);
    if (nextRoot) await loadLazy(nextRoot);
    else await loadEager(nextScope, preserveSelection);
  }

  async function refreshLoadedDirectories() {
    const root = lazyRoot.current;
    if (!root) return load(scope, true);
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

  async function showReconcilePreview() {
    setBusy(true);
    setError(undefined);
    setNotice("");
    setReconcileStale(false);
    try {
      await startObservedOperation("reconcile_preview", () => startReconcilePreview(connection, scope), (event) => {
        setReconcileOperation(isOperationTerminal(event.kind) ? undefined : event);
        if (!isOperationTerminal(event.kind)) return;
        setBusy(false);
        if (event.kind === "completed") {
          const items = event.reconcileItems || [];
          setReconcileCandidates(items);
          setReconcileSelected(defaultReconcileSelection(items));
        } else if (event.kind === "cancelled") {
          setNotice(t("reconcilePreviewCancelled"));
        } else {
          setError({ kind: event.kind === "partial" ? "partial_result" : "command_failed", message: event.message || (event.kind === "unknown" ? t("operationUnknown") : t("operationFailed")), hints: [] });
        }
      });
    } catch (reason) {
      setBusy(false);
      setReconcileOperation(undefined);
      setError(normalizeAppError(reason));
    }
  }

  async function applyReconcile() {
    const previousCandidates = reconcileCandidates;
    const previousSelection = reconcileSelected;
    setReconcileCandidates(undefined);
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await startObservedOperation("reconcile", () => startReconcile(connection, change, scope, reconcileSelected), (event) => {
        setReconcileOperation(isOperationTerminal(event.kind) ? undefined : event);
        if (!isOperationTerminal(event.kind)) return;
        void (async () => {
          try {
            await refreshLoadedDirectories();
            if (event.kind === "completed") setNotice(t("reconcileSucceeded"));
            else if (event.kind === "cancelled") setNotice(t("reconcileCancelled"));
            else {
              setReconcileCandidates(previousCandidates);
              setReconcileSelected(previousSelection);
              const stale = (event.message || "").toLowerCase().includes("stale");
              setReconcileStale(stale);
              setError({
                kind: stale ? "stale" : event.kind === "partial" ? "partial_result" : "command_failed",
                message: event.message || (event.kind === "unknown" ? t("operationUnknown") : t("operationFailed")),
                hints: [],
              });
            }
          } catch (reason) {
            setError(normalizeAppError(reason));
          } finally {
            setBusy(false);
          }
        })();
      });
    } catch (reason) {
      setBusy(false);
      setReconcileOperation(undefined);
      setReconcileCandidates(previousCandidates);
      setReconcileSelected(previousSelection);
      setError(normalizeAppError(reason));
    }
  }

  async function showResolvePreview(mode: ResolveMode, requestedPaths = selectedUnresolvedPaths) {
    if (!requestedPaths.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const preview = await previewResolve(connection, requestedPaths);
      const specialized = preview.filter((item) => item.conflictKind !== "text" && item.conflictKind !== "unknown");
      if (specialized.length) {
        setSpecializedResolveItems(specialized);
        setPendingResolveMode(undefined);
        setPendingResolvePaths([]);
        setResolvePreview([]);
        return;
      }
      setResolvePreview(preview);
      setPendingResolvePaths(requestedPaths);
      setPendingResolveMode(mode);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!initialResolveRequest || handledResolveRequest.current === initialResolveRequest.id) return;
    handledResolveRequest.current = initialResolveRequest.id;
    setChange(initialResolveRequest.change);
    void showResolvePreview("autoSafe", initialResolveRequest.paths);
  }, [initialResolveRequest?.id]);

  async function applyResolve() {
    if (!pendingResolveMode || !pendingResolvePaths.length) return;
    const mode = pendingResolveMode;
    const paths = pendingResolvePaths;
    setPendingResolveMode(undefined);
    setPendingResolvePaths([]);
    setResolvePreview([]);
    setBusy(true);
    setError(undefined);
    try {
      const readBack = await resolveFiles(connection, paths, mode);
      const pending = readBack.items.filter((item) => item.state !== "resolved");
      await refreshLoadedDirectories();
      if (pending.length) {
        setError({ kind: "partial_result", message: t("resolveStillPending"), hints: pending.map((item) => item.reason ? `${item.depotPath}: ${item.reason}` : item.depotPath) });
      } else {
        setNotice(t("resolveSucceeded"));
      }
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function showResolveEditor(path: string) {
    setBusy(true);
    setError(undefined);
    try {
      const item = (await previewResolve(connection, [path])).find((candidate) => candidate.depotPath === path && candidate.conflictKind === "text");
      if (!item || item.conflictKind !== "text" || !item.allowedActions.includes("editResult")) {
        setError({ kind: "command_failed", message: t("resolveEditorUnsupportedContent"), hints: [] });
        return;
      }
      setResolveEditorItem(item);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setNotice(t("pathCopied"));
    } catch {
      setError({ kind: "command_failed", message: t("copyPathFailed"), hints: [] });
    }
  }

  async function revealLocalPath(path: string) {
    try { await revealPath(path); }
    catch { setError({ kind: "command_failed", message: t("revealPathFailed"), hints: [] }); }
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
    const paths = selected.includes(file.depotPath) ? selected : [file.depotPath];
    if (!selected.includes(file.depotPath)) setSelected(paths);
    setSelectedFolders([]);
    workspaceMenu.open(event, { file, paths });
  }

  const selectedFiles = files.filter((file) => selected.includes(file.depotPath));
  const paths = selectedFiles.map((file) => file.depotPath);
  const defaultSelectedSyncScopes = [...selectedFolders.map((folder) => `${folder.replace(/\/+$/, "")}/...`), ...paths];
  const selectedFile = selectedFiles.length === 1 && selectedFolders.length === 0 ? selectedFiles[0] : undefined;
  const selectedFolder = selectedFolders.length === 1 && selected.length === 0 ? selectedFolders[0] : undefined;
  const selectedSyncScopes = workspaceHistorySyncScopes(selectedFile, selectedFolder, historySelection, defaultSelectedSyncScopes);
  const selectedHistoryPath = workspaceFileHistoryPath(selectedFile);
  const selectedUnresolvedPaths = selectedFiles.filter((file) => file.unresolved).map((file) => file.depotPath);
  const visibleFiles = useMemo(() => filterWorkspaceFiles(files, filter, query), [files, filter, query]);
  const visibleDirectories = useMemo(() => filter === "all" && !query.trim() ? directoryPaths : [], [directoryPaths, filter, query]);
  const tree = useMemo(() => buildWorkspaceTree(visibleFiles, visibleDirectories, loadingDirectoryPaths, lazyRoot.current ? loadedDirectoryPaths : undefined, ignoredDirectoryPaths), [visibleFiles, visibleDirectories, loadingDirectoryPaths, loadedDirectoryPaths, ignoredDirectoryPaths]);
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

  const renderFile = (file: WorkspaceFile, depth = 0) => {
    const statuses = workspaceStatus(file);
    const statusText = file.statusPending ? t("workspaceStatusLoading") : statuses.map((status) => t(`workspaceStatus_${status}` as never)).join(" · ") || t("workspaceStatusClean");
    const title = `${file.depotPath}\n${t("workspaceStatus")}: ${statusText}\n${t("fileSize")}: ${file.fileSize === undefined ? "—" : formatBytes(file.fileSize)}\n${t("changelistLabel")}: ${file.change || "default"}`;
    const FileIcon = fileIcon(file.depotPath);
    return <TreeItemRow
      key={file.depotPath}
      depth={depth}
      selected={selected.includes(file.depotPath)}
      className={file.ignored ? "ignored" : ""}
      selectClassName="workspace-file-row"
      agentId={`workspace-file:${file.depotPath}`}
      agentIgnored={file.ignored}
      icon={<FileIcon className="file-tree-icon" aria-hidden="true" />}
      primary={file.depotPath.split("/").at(-1) || file.depotPath}
      secondary={<>{file.localPath || file.clientPath || file.depotPath} · {statusText}</>}
      trailing={<><span className="file-status-markers" aria-label={statusText}>{statusMarkers(file).map(({ icon: StatusIcon, status, className }) => <span title={status === "clean" ? t("workspaceStatusClean") : status === "loading" ? t("workspaceStatusLoading") : t(`workspaceStatus_${status}` as never)} className={className} key={status}><StatusIcon aria-hidden="true" /></span>)}</span><span className="revision-cell">{file.haveRevision || "—"} / {file.headRevision || "—"}</span></>}
      selectProps={{ title, onClick: (event) => selectFile(file, event), onContextMenu: (event) => openFileMenu(event, file), onKeyDown: (event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openFileMenu(event, file); } }}
    />;
  };

  function setFolderOpen(folder: WorkspaceTreeFolder, nextOpen: boolean) {
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
  }

  const renderTree = (folders: WorkspaceTreeFolder[], depth = 0): ReactNode => folders.map((folder) => {
    const isRoot = folder.path.slice(2).split("/").filter(Boolean).length === 1;
    const open = !collapsedFolders.has(folder.path) && (isRoot || expandedFolders.has(folder.path));
    const ignored = folderIsIgnored(folder);
    const knownEmpty = folder.loaded && folder.folders.length + folder.files.length === 0;
    const FolderIcon = isRoot ? HardDrive : Folder;
    return <div className="workspace-tree-node" key={folder.path}>
      <TreeItemRow
        depth={depth}
        selected={selectedFolders.includes(folder.path)}
        busy={folder.loading}
        className={ignored ? "ignored" : ""}
        selectClassName="workspace-folder-select"
        disclosure={!knownEmpty ? { agentId: `workspace-folder-toggle:${folder.path}`, expanded: open, loading: folder.loading, label: t(open ? "depotOverviewCollapse" : "depotOverviewExpand"), onToggle: () => setFolderOpen(folder, !open) } : undefined}
        agentId={`workspace-folder:${folder.path}`}
        agentIgnored={ignored}
        icon={<FolderIcon className="ui-icon" aria-hidden="true" />}
        primary={folder.name}
        secondary={folder.path}
        trailing={<span className="folder-summary-meta"><small>{folder.loaded ? folderFileCount(folder) : "…"}</small></span>}
        selectProps={{ "aria-label": ignored ? `${folder.name} · ${t("workspaceStatus_ignored")}` : folder.name, onClick: (event) => selectFolder(folder, event), onDoubleClick: () => setFolderOpen(folder, !open) }}
      />
      {open && <div role="group">{renderTree(folder.folders, depth + 1)}{folder.files.map((file) => renderFile(file, depth + 1))}</div>}
    </div>;
  });

  useEffect(() => {
    setHistorySelection(undefined);
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

  const menu = workspaceMenu.menu?.target;
  const menuFiles = menu ? files.filter((file) => menu.paths.includes(file.depotPath)) : [];
  const menuChange = menuFiles[0]?.change || "default";
  const menuCanRevert = menuFiles.length > 0 && menuFiles.every((file) => Boolean(file.action) && (file.change || "default") === menuChange);
  const menuCanResolve = menuFiles.length > 0 && menuFiles.every((file) => file.unresolved);
  const selectedCount = selected.length + selectedFolders.length;
  const selectedKind = selectedFile ? t("workspaceInspectorFile") : selectedFolder ? t("workspaceInspectorFolder") : t("workspaceInspectorSelection");
  const selectedTitle = selectedFile?.depotPath.split("/").at(-1)
    || selectedFolder?.split("/").filter(Boolean).at(-1)
    || (selectedFolders.length ? `${selectedFolders.length} ${t("foldersSelected")}` : `${selected.length} ${t("filesSelected")}`);
  const selectedPath = selectedFile?.localPath || selectedFile?.clientPath || selectedFile?.depotPath || selectedFolder;
  const SelectedIcon = selectedFile ? fileIcon(selectedFile.depotPath) : selectedFolder ? Folder : Files;
  const reconcilePhase = reconcileOperation?.phase === "apply"
    ? t("reconcilePhaseApply")
    : reconcileOperation?.phase === "validate"
      ? t("reconcilePhaseValidate")
      : t("reconcilePhaseScan");
  const reconcileRatio = reconcileOperation?.totalFiles
    ? Math.min(1, reconcileOperation.processed / reconcileOperation.totalFiles)
    : undefined;
  const reconcileCount = reconcileOperation
    ? reconcileOperation.phase === "scan"
      ? `${reconcileOperation.processed} ${t("reconcileCandidatesFound")}`
      : reconcileOperation.phase === "apply"
        ? `${reconcileOperation.processed} / ${reconcileOperation.totalFiles || 0} ${t("reconcileFilesOpened")}`
        : `${reconcileOperation.processed} / ${reconcileOperation.totalFiles || 0} ${t("reconcileFilesChecked")}`
    : undefined;
  const reconcileCurrentPath = reconcileOperation?.currentPath?.split(/[\\/]/).at(-1);
  const reconcileDetail = reconcileOperation
    ? [reconcileCurrentPath, reconcileRatio === undefined ? undefined : reconcilePhase, reconcileCount].filter(Boolean).join(" · ")
    : undefined;
  const reconcileGroups = groupReconcileItems(reconcileCandidates || []);

  return <View
    id="workspace-files-title"
    title={t("filesTitle")}
    subtitle={`${info.clientRoot || connection.client} · ${t("workspaceFilesBody")}`}
    busy={busy}
    error={error}
    notice={notice}
    operationLabel={reconcileOperation ? reconcilePhase : safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    operationDetail={reconcileDetail}
    operationRatio={reconcileRatio}
    onDismissNotice={() => setNotice("")}
    actions={<><button className="secondary-button button-with-icon" type="button" onClick={() => void openWorkspaceSettings()} disabled={busy}><Settings2 className="ui-icon" aria-hidden="true" />{t("workspaceSpec")}</button><button className="secondary-button button-with-icon" type="button" onClick={() => void showReconcilePreview()} disabled={busy}><ScanSearch className="ui-icon" aria-hidden="true" />{t("reconcile")}</button><RefreshButton busy={busy} onClick={() => void refreshLoadedDirectories()} /><button className="primary-button button-with-icon update-project-button" type="button" onClick={() => void safeSync.start([scope])} disabled={busy || safeSync.phase !== "idle"}><Download className="ui-icon" aria-hidden="true" />{safeSync.phase === "idle" ? t("updateProject") : t("updatingProject")}</button></>}
    statusBarActions={sourceControl}
  >
    <details className="files-options workspace-options">
      <summary><span className="workspace-options-title"><SlidersHorizontal className="ui-icon" aria-hidden="true" /><strong>{t("filesSearchAndFilters")}</strong></span><span>{t(filtersActive ? "filesFiltersActive" : "filesFiltersOptional")}</span></summary>
      <div className="workspace-overview-toolbar">
        <label className="workspace-toolbar-input" title={t("fileScopeHelp")}><HardDrive aria-hidden="true" /><span className="sr-only">{t("fileScope")}</span><input aria-label={t("fileScope")} value={scope} placeholder={t("fileScopePlaceholder")} onChange={(event) => setScope(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(scope); }} /></label>
        <button className="secondary-button button-with-icon" type="button" onClick={() => void load(scope)} disabled={busy}><Search className="ui-icon" aria-hidden="true" />{t("applyScope")}</button>
        <label className="workspace-toolbar-input workspace-search-input" title={t("workspaceSearchHelp")}><Search aria-hidden="true" /><span className="sr-only">{t("workspaceSearch")}</span><input aria-label={t("workspaceSearch")} value={query} placeholder={t("workspaceSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="workspace-toolbar-select"><Filter aria-hidden="true" /><span className="sr-only">{t("workspaceFilter")}</span><select aria-label={t("workspaceFilter")} value={filter} onChange={(event) => setFilter(event.target.value as WorkspaceFilter)}><option value="all">{t("workspaceFilterAll")}</option><option value="opened">{t("workspaceFilterOpened")}</option><option value="outdated">{t("workspaceFilterOutdated")}</option><option value="unresolved">{t("workspaceFilterUnresolved")}</option><option value="otherOpen">{t("workspaceFilterOtherOpen")}</option><option value="locked">{t("workspaceFilterLocked")}</option><option value="unmapped">{t("workspaceFilterUnmapped")}</option><option value="untracked">{t("workspaceFilterUntracked")}</option></select></label>
        <div className="workspace-view-toggle" role="group" aria-label={t("workspaceViewMode")}>
          <button type="button" className={viewMode === "list" ? "active" : ""} aria-pressed={viewMode === "list"} onClick={() => { setViewMode("list"); setSelectedFolders([]); }}><List aria-hidden="true" /><span>{t("workspaceViewList")}</span></button>
          <button type="button" className={viewMode === "tree" ? "active" : ""} aria-pressed={viewMode === "tree"} onClick={() => setViewMode("tree")}><ListTree aria-hidden="true" /><span>{t("workspaceViewTree")}</span></button>
        </div>
      </div>
    </details>
    <div className="resource-workbench workspace-workbench">
      <div className="resource-list workspace-resource-list" role="list">
        <div className="column-heading"><strong>{t("workspaceFiles")}</strong><span>{selected.length > 0 ? `${selected.length} / ` : ""}{visibleFiles.length}</span></div>
        {viewMode === "tree" && tree.length > 0 ? <div className="workspace-file-tree" role="tree">{renderTree(tree)}</div> : busy && files.length === 0 ? <CompactEmpty text={t("loadingFiles")} /> : files.length === 0 ? <CompactEmpty text={t("workspaceNoFiles")} /> : visibleFiles.length === 0 ? <CompactEmpty text={t("workspaceNoFilterMatches")} /> : visibleFiles.map((file) => renderFile(file))}
      </div>
      <aside className="resource-inspector workspace-inspector">
        {!selectedCount ? <EmptyState title={t("selectWorkspaceFile")} body={t("selectWorkspaceFileBody")} /> : <div className="workspace-inspector-content">
          <div className="workspace-inspector-heading">
            <div><span className="workspace-inspector-kind"><SelectedIcon className="ui-icon" aria-hidden="true" />{selectedKind}</span><h2>{selectedTitle}</h2>{selectedPath && <p title={selectedPath}>{selectedPath}</p>}</div>
            {selectedSyncScopes.length > 0 && <div className="workspace-inspector-actions"><button className="primary-button button-with-icon" type="button" onClick={() => void safeSync.start(selectedSyncScopes)} disabled={busy || safeSync.phase !== "idle"}><Download className="ui-icon" aria-hidden="true" />{t("updateSelected")}</button>{historySelection && <small>{historySelection.revision ? `#${historySelection.revision}` : <span className="changelist-number">CL {historySelection.change}</span>}</small>}</div>}
          </div>
          {selectedFile && <dl className="workspace-inspector-facts">
            <div><Pencil aria-hidden="true" /><dt>{t("actionLabel")}</dt><dd>{selectedFile.action || "—"}</dd></div>
            <div><History aria-hidden="true" /><dt>{t("revisionLabel")}</dt><dd>{selectedFile.haveRevision || "—"} / {selectedFile.headRevision || "—"}</dd></div>
            <div><Activity aria-hidden="true" /><dt>{t("workspaceStatus")}</dt><dd title={selectedFile.statusPending ? t("workspaceStatusLoading") : workspaceStatus(selectedFile).map((status) => t(`workspaceStatus_${status}` as never)).join(" · ") || t("workspaceStatusClean")}>{selectedFile.statusPending ? t("workspaceStatusLoading") : workspaceStatus(selectedFile).map((status) => t(`workspaceStatus_${status}` as never)).join(" · ") || t("workspaceStatusClean")}</dd></div>
            <div><GitCommitHorizontal aria-hidden="true" /><dt>{t("changelistLabel")}</dt><dd className={selectedFile.change && selectedFile.change !== "default" ? "changelist-number" : undefined}>{selectedFile.change || "default"}</dd></div>
          </dl>}
          {selected.length > 0 && <label className="field"><span className="field-label">{t("destinationChangelist")}</span><input value={change} onChange={(event) => setChange(event.target.value)} /></label>}
          {selectedFolder ? <ChangelistHistory
            className="fill"
            title={t("selectedHistory")}
            summary={folderHistory.length}
            items={folderHistory}
            busy={historyBusy}
            emptyText={t("depotNoHistory")}
            selectedId={historySelection?.change}
            agentId={(changeItem) => `workspace-history:${changeItem.id}`}
            onSelect={(changeItem) => setHistorySelection({ change: changeItem.id })}
            onOpen={(changeItem) => setHistoryChange(changeItem.id)}
          /> : <><section className="selection-history"><h3>{t("selectedHistory")}</h3>{historyBusy ? <CompactEmpty text={t("loadingHistory")} /> : revisionHistory.length ? revisionHistory.map((revision) => <SelectableSurface selected={historySelection?.revision === revision.revision} data-agent-id={`workspace-history:${revision.change}:${revision.revision}`} className="history-compact-row" key={revision.revision} onClick={() => setHistorySelection({ change: revision.change, revision: revision.revision })} onDoubleClick={() => revision.change && setHistoryChange(revision.change)} onKeyDown={(event) => { if (event.key === "Enter" && revision.change) { event.preventDefault(); setHistoryChange(revision.change); } }}><ChangelistDescription value={revision.description} fallback={t("noDescription")} compact /><span><span className="changelist-number">CL {revision.change || "—"}</span>{[revision.user, revision.client, formatWorkspaceHistoryTime(revision.time, language)].filter(Boolean).map((value) => ` · ${value}`)}</span><small>#{revision.revision} · {revision.action || "—"}</small></SelectableSurface>) : <CompactEmpty text={t("depotNoHistory")} />}</section><RevisionGraph revisions={revisionHistory} historyMayBePartial={revisionHistory.length >= 50} /></>}
        </div>}
      </aside>
    </div>

    {menu && workspaceMenu.menu && <ContextMenu x={workspaceMenu.menu.x} y={workspaceMenu.menu.y} onSelect={workspaceMenu.close}>
      <MenuButton onClick={() => void safeSync.start(menu.paths)}>{t("updateSelected")}</MenuButton>
      {menu.paths.length === 1 && <MenuButton onClick={() => void copyPath(menu.file.depotPath)}>{t("copyDepotPath")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.localPath && <MenuButton onClick={() => void copyPath(menu.file.localPath!)}>{t("copyLocalPath")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.localPath && <MenuButton onClick={() => void revealLocalPath(menu.file.localPath!)}>{t("revealInExplorer")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.mapped && onNavigateDepot && <MenuButton onClick={() => onNavigateDepot(menu.file.depotPath)}>{t("showInDepotFiles")}</MenuButton>}
      {menuFiles.every((file) => !file.action && !file.untracked) && <MenuButton onClick={() => void run(() => editFiles(connection, change, menu.paths))}>{t("openForEdit")}</MenuButton>}
      {menuFiles.every((file) => file.untracked && !file.ignored) && <MenuButton onClick={() => void run(() => addFiles(connection, change, menu.paths))}>{t("markForAdd")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.untracked && menu.file.localPath && <MenuButton onClick={() => void run(() => ignoreLocalFile(connection, menu.file.localPath!), t("fileIgnored"))}>{t("addToIgnore")}</MenuButton>}
      {menuFiles.every((file) => !file.untracked && !file.action) && <MenuButton onClick={() => void run(() => deleteFiles(connection, change, menu.paths))}>{t("markForDelete")}</MenuButton>}
      {menu.paths.length === 1 && <MenuButton onClick={() => setRenameDestination(menu.file.depotPath)}>{t("renameFile")}</MenuButton>}
      {menuCanRevert && <MenuButton onClick={() => void run(() => lockFiles(connection, menuChange, menu.paths))}>{t("lockFiles")}</MenuButton>}
      {menuCanRevert && <MenuButton onClick={() => void run(() => unlockFiles(connection, menuChange, menu.paths))}>{t("unlockFiles")}</MenuButton>}
      {menuCanResolve && <MenuButton onClick={() => void showResolvePreview("yours", menu.paths)}>{t("resolveKeepWorkspace")}</MenuButton>}
      {menuCanResolve && <MenuButton onClick={() => void showResolvePreview("theirs", menu.paths)}>{t("resolveAcceptServer")}</MenuButton>}
      {menuCanResolve && <MenuButton onClick={() => void showResolvePreview("autoSafe", menu.paths)}>{t("resolveAutoSafe")}</MenuButton>}
      {menuCanResolve && <MenuButton onClick={() => void showResolvePreview("autoMerge", menu.paths)}>{t("resolveAutoMerge")}</MenuButton>}
      {menuCanResolve && menu.paths.length === 1 && <MenuButton onClick={() => void showResolveEditor(menu.paths[0])}>{t("resolveEditor")}</MenuButton>}
      {menuCanResolve && <MenuButton onClick={() => void showResolvePreview("yours", menu.paths)}>{t("resolveSpecializedReview")}</MenuButton>}
      {menuCanRevert && <MenuButton danger onClick={() => void openRevert(menu.paths)}>{t("revertSelected")}</MenuButton>}
      {menu.paths.length === 1 && menu.file.localPath && <MenuButton danger onClick={() => setDeleteLocalPath(menu.file.localPath)}>{t("deleteLocally")}</MenuButton>}
    </ContextMenu>}

    <SafeSyncConflictDialog sync={safeSync} />

    {reconcileCandidates && <ActionDialog title={t("reconcilePreviewTitle")} confirmLabel={t("applyReconcile")} busy={busy} confirmDisabled={!reconcileSelected.length || reconcileStale} onClose={() => setReconcileCandidates(undefined)} onConfirm={() => void applyReconcile()}><p>{reconcileStale ? t("reconcileStaleBody") : t("reconcilePreviewBody")}</p>{reconcileStale && <button className="secondary-button" type="button" onClick={() => void showReconcilePreview()}>{t("refreshReconcilePreview")}</button>}<div className="resource-detail-list">{reconcileCandidates.length ? reconcileGroups.map((group) => <section key={group.action} className="reconcile-group"><h3>{t(`reconcileGroup_${group.action}` as never)} · {group.items.length}</h3>{group.items.map((item) => { const disabled = item.ignored || item.unsafeItem || item.action === "unsafe"; const reasons = item.reasons.map((reason) => t(`reconcileReason_${reason}` as never)).join(" · "); return <SelectableRow aria-disabled={disabled} selected={reconcileSelected.some((selectedItem) => selectedItem.stableId === item.stableId)} className="resource-entry preview-select" key={item.stableId} onClick={() => setReconcileSelected((current) => toggleReconcileSelection(current, item))}><ItemRowCopy primary={item.depotPath} secondary={<>{t(`reconcileGroup_${item.action}` as never)}{item.localPath ? ` · ${item.localPath}` : ""}{reasons ? ` · ${reasons}` : ""}</>} /></SelectableRow>; })}</section>) : <CompactEmpty text={t("noReconcileChanges")} />}</div></ActionDialog>}

    {pendingResolveMode && <ActionDialog danger={pendingResolveMode === "theirs"} title={t("resolveConfirmTitle")} confirmLabel={t("resolveConfirm")} busy={busy} confirmDisabled={!resolvePreview.length || resolvePreview.some((item) => !item.allowedActions.includes(pendingResolveMode))} onClose={() => { setPendingResolveMode(undefined); setPendingResolvePaths([]); setResolvePreview([]); }} onConfirm={() => void applyResolve()}><p>{pendingResolveMode === "yours" ? t("resolveKeepWorkspaceBody") : t("resolveAcceptServerBody")}</p>{resolvePreview.length ? resolvePreview.map((item) => <div className="resource-detail-row" key={`${item.depotPath}-${item.conflictKind}-${item.action}`}><span><strong>{item.depotPath}</strong><small>{t(`resolveKind_${item.conflictKind}` as never)} · {item.action} · {item.detail || ""}</small></span></div>) : <CompactEmpty text={t("resolveNoPreview")} />}</ActionDialog>}

    {resolveEditorItem && <ResolveDialog connection={connection} item={resolveEditorItem} onClose={() => setResolveEditorItem(undefined)} onResolved={() => { setResolveEditorItem(undefined); setNotice(t("resolveSucceeded")); void refreshLoadedDirectories(); }} onError={setError} />}

    {specializedResolveItems && <SpecializedResolveDialog connection={connection} items={specializedResolveItems} onClose={() => setSpecializedResolveItems(undefined)} onReadBack={() => void refreshLoadedDirectories()} onError={setError} />}

    {renameDestination !== undefined && selectedFile && <ActionDialog title={t("renameFile")} confirmLabel={t("renameFile")} busy={busy} confirmDisabled={!renameDestination.trim() || renameDestination.trim() === selectedFile.depotPath} onClose={() => setRenameDestination(undefined)} onConfirm={() => void applyRename()}><p>{selectedFile.depotPath}</p><label className="field"><span className="field-label">{t("renameDestinationPrompt")}</span><input autoFocus value={renameDestination} onChange={(event) => setRenameDestination(event.target.value)} /></label></ActionDialog>}

    {revertPreviewItems && <ActionDialog danger title={t("revertSelected")} confirmLabel={t("revertNow")} busy={busy} confirmDisabled={!revertPreviewItems.length} onClose={() => setRevertPreviewItems(undefined)} onConfirm={() => void applyRevert()}><p>{t("revertWarning")}</p>{revertPreviewItems.length ? <div className="file-selection-summary">{revertPreviewItems.map((item) => <span key={item.depotPath}>{item.action}: {item.depotPath}</span>)}</div> : <CompactEmpty text={t("noRevertFiles")} />}</ActionDialog>}

    {deleteLocalPath && <ActionDialog danger title={t("deleteLocally")} confirmLabel={t("deleteLocally")} busy={busy} onClose={() => setDeleteLocalPath(undefined)} onConfirm={() => { const path = deleteLocalPath; setDeleteLocalPath(undefined); void run(() => deleteLocalFile(connection, path), t("localFileDeleted")); }}><p>{t("deleteLocallyWarning")}</p><strong>{deleteLocalPath}</strong></ActionDialog>}

    {historyChange && <ChangeHistoryDialog connection={connection} change={historyChange} onClose={() => setHistoryChange(undefined)} />}

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

function fileIcon(path: string): LucideIcon {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension || "")) return FileImage;
  if (["ts", "tsx", "js", "jsx", "rs", "cpp", "h", "cs", "py"].includes(extension || "")) return FileCode2;
  return FileText;
}

function statusMarkers(file: WorkspaceFile): { icon: LucideIcon; status: string; className: string }[] {
  const markers: { icon: LucideIcon; status: string; className: string }[] = [];
  if (file.statusPending) return [{ icon: LoaderCircle, status: "loading", className: "pending" }];
  if (file.action === "add") markers.push({ icon: Plus, status: "added", className: "added" });
  else if (file.action === "delete") markers.push({ icon: Minus, status: "deleted", className: "deleted" });
  else if (file.action) markers.push({ icon: Pencil, status: "edited", className: "opened" });
  if (file.otherLock) markers.push({ icon: LockKeyhole, status: "locked", className: "locked" });
  if (file.otherOpen) markers.push({ icon: Users, status: "otherOpen", className: "other-open" });
  if (file.unresolved) markers.push({ icon: CircleAlert, status: "unresolved", className: "unresolved" });
  if (file.ignored) markers.push({ icon: Ban, status: "ignored", className: "ignored" });
  if (!markers.length) markers.push({ icon: CheckCircle2, status: "clean", className: "clean" });
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
