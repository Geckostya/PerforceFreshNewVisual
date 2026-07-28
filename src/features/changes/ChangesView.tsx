import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  createChange,
  deleteChange,
  deleteShelfFiles,
  diffFile,
  diffShelvedFile,
  editChange,
  loadSettings,
  lockFiles,
  normalizeAppError,
  previewRevertAll,
  previewRevertSelected,
  previewUnshelve,
  previewRevertUnchanged,
  reopenFiles,
  revertFiles,
  revertUnchanged,
  saveRevertPreference,
  shelveFiles,
  startSubmit,
  submitChange,
  submitPreflight,
  unlockFiles,
  unshelveFiles,
} from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { DiffViewer } from "../../shared/DiffViewer";
import { ItemRowCopy, SelectableRow, SelectableSurface } from "../../shared/ItemList";
import { startObservedOperation } from "../../shared/operations";
import { ActionDialog, CompactEmpty, ContextMenu, EmptyState, MenuButton, View } from "../../shared/View";
import { SafeSyncConflictDialog, useSafeSync } from "../../shared/SafeSync";
import { partitionArchived } from "../../shared/localArchive";
import { useArchiveDragDrop } from "../../shared/useArchiveDragDrop";
import { useLocalArchive } from "../../shared/useLocalArchive";
import { useContextMenu } from "../../shared/useContextMenu";
import { isContextMenuShortcut, selectionMode, updateSelection } from "../../shared/selection";
import type {
  ConnectionInput,
  DiffMode,
  FileDiff,
  OpenedFile,
  P4Info,
  SubmitMode,
  RevertPreviewItem,
  SubmitPreflightIssue,
  SubmitPreflightSummary,
  UnshelveConflict,
} from "../../shared/models";
import {
  changeOptionLabel,
  filterChangeGroups,
  selectedChangesForArchive,
  type ChangeDropTarget,
} from "./changes";
import {
  CheckField,
  DescriptionField,
  Fact,
  FileSelectionSummary,
  RefreshIcon,
  SubmitDialog,
  fileName,
  formatTime,
  parentPath,
} from "./ChangeComponents";
import { useChangeDragDrop } from "./useChangeDragDrop";
import { useChangesData } from "./useChangesData";
import { useFileSelection } from "./useFileSelection";

interface Props {
  connection: ConnectionInput;
  info: P4Info;
  onFileCountChange: (count: number) => void;
  initialChange?: string;
}

type DialogName =
  | "create"
  | "submit"
  | "edit"
  | "shelve-file"
  | "replace-shelf"
  | "unshelve"
  | "delete-shelf"
  | "delete-shelf-file"
  | "revert"
  | "revert-all"
  | "revert-unchanged"
  | "move-files"
  | "unshelve-conflicts"
  | "delete-change";
type MenuTarget = { kind: "opened" | "shelved"; depotPath: string; change: string } | {
  kind: "change";
  change: string;
  depotPath: string;
} | {
  kind: "section";
  section: "opened" | "shelved";
  change: string;
};

export function ChangesView({ connection, info, onFileCountChange, initialChange }: Props) {
  const { language, t } = useLocale();
  const [selectedChange, setSelectedChange] = useState(initialChange || "default");
  const [selectedChanges, setSelectedChanges] = useState([initialChange || "default"]);
  const changeSelectionAnchor = useRef<string | undefined>(initialChange || "default");
  const {
    changes,
    files,
    groups,
    currentGroup,
    currentShelfFiles,
    state,
    shelfLoading,
    error,
    setError,
    refreshData,
  } = useChangesData(connection, selectedChange, onFileCountChange);
  const fileSelection = useFileSelection(currentGroup.files, currentShelfFiles);
  const {
    openedSelection,
    shelvedSelection,
    currentOpened,
    currentShelved,
  } = fileSelection;
  const dragDrop = useChangeDragDrop();
  const archiveDragDrop = useArchiveDragDrop("changes");
  const [notice, setNotice] = useState("");
  const [targetChange, setTargetChange] = useState("default");
  const [diff, setDiff] = useState<FileDiff>();
  const [diffTitle, setDiffTitle] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffMode>("default");
  const [dialog, setDialog] = useState<DialogName>();
  const [dialogFiles, setDialogFiles] = useState<string[]>([]);
  const [revertPreviewItems, setRevertPreviewItems] = useState<RevertPreviewItem[]>([]);
  const [submitDescription, setSubmitDescription] = useState("");
  const [submitPreflightIssues, setSubmitPreflightIssues] = useState<SubmitPreflightIssue[]>([]);
  const [submitPreflightSummary, setSubmitPreflightSummary] = useState<SubmitPreflightSummary>({ issues: [], jobs: [], totalSize: 0 });
  const [submitPreflightReady, setSubmitPreflightReady] = useState(false);
  const [description, setDescription] = useState("");
  const [unshelveTarget, setUnshelveTarget] = useState("default");
  const [actionRunning, setActionRunning] = useState(false);
  const [deleteAddedFiles, setDeleteAddedFiles] = useState(false);
  const [revertAfterShelf, setRevertAfterShelf] = useState(false);
  const [unshelvePaths, setUnshelvePaths] = useState<string[]>([]);
  const [unshelveConflicts, setUnshelveConflicts] = useState<UnshelveConflict[]>([]);
  const [overwriteConflicts, setOverwriteConflicts] = useState<string[]>([]);
  const [conflictSelection, setConflictSelection] = useState<string[]>([]);
  const conflictAnchor = useRef<string | undefined>(undefined);
  const [conflictMenu, setConflictMenu] = useState<{ x: number; y: number }>();
  const changeMenu = useContextMenu<MenuTarget>();
  const [changeQuery, setChangeQuery] = useState("");
  const [unactualOpen, setUnactualOpen] = useState(true);
  const { archivedIds: archivedChanges, setArchived } = useLocalArchive(
    "changes",
    connection,
    groups.filter((group) => !group.isDefault).map((group) => group.id),
    state === "ready",
  );
  const canSubmit = currentGroup.files.length > 0 || currentGroup.isShelved;
  const safeSync = useSafeSync(connection, { refresh: refreshData, setNotice, setError });

  useEffect(() => {
    void loadSettings()
      .then((settings) => setDeleteAddedFiles(settings.deleteAddedFilesOnRevert))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state !== "ready") return;
    const available = groups.map((group) => group.id);
    setSelectedChanges((current) => {
      const retained = current.filter((id) => available.includes(id));
      if (retained.length > 0) return retained.length === current.length ? current : retained;
      return available.includes(selectedChange) ? [selectedChange] : [];
    });
    if (changeSelectionAnchor.current && !available.includes(changeSelectionAnchor.current)) {
      changeSelectionAnchor.current = available.includes(selectedChange) ? selectedChange : undefined;
    }
  }, [groups, selectedChange, state]);

  function selectChange(change: string, event?: React.MouseEvent) {
    const next = updateSelection(orderedChangeIds, selectedChanges, change, changeSelectionAnchor.current, selectionMode(event));
    setSelectedChanges(next.selected);
    changeSelectionAnchor.current = next.anchor;
    if (change === selectedChange) return;
    setSelectedChange(change);
    fileSelection.clear();
    setDiff(undefined);
  }

  function selectOpened(file: OpenedFile, event?: React.MouseEvent) {
    fileSelection.selectOpened(file, event);
    setTargetChange(file.change || "default");
    setDiff(undefined);
  }

  function selectShelved(file: (typeof currentShelfFiles)[number], event?: React.MouseEvent) {
    fileSelection.selectShelved(file, event);
    setDiff(undefined);
  }

  async function execute(task: () => Promise<void>, success: string, after?: () => void) {
    setActionRunning(true);
    setError(undefined);
    setNotice("");
    try {
      await task();
      setDialog(undefined);
      setDialogFiles([]);
      setNotice(success);
      after?.();
      refreshData();
    } catch (reason) {
      setDialog(undefined);
      refreshData();
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  async function moveOpened(paths: string[], destination: string) {
    if (paths.length === 0 || destination === currentGroup.id) return;
    await execute(
      () => reopenFiles(connection, paths, destination),
      t("fileMoved"),
      () => {
        setSelectedChange(destination);
        fileSelection.setOpened(paths, paths[0]);
      },
    );
  }

  async function openRevertUnchanged() {
    setActionRunning(true);
    setError(undefined);
    try {
      setRevertPreviewItems(await previewRevertUnchanged(connection, currentGroup.id));
      setDialog("revert-unchanged");
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  async function openRevertAll() {
    setActionRunning(true);
    setError(undefined);
    try {
      setRevertPreviewItems(await previewRevertAll(connection, currentGroup.id));
      setDialog("revert-all");
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  async function openRevertSelected(paths: string[]) {
    if (paths.length === 0) return;
    setActionRunning(true);
    setError(undefined);
    try {
      setDialogFiles(paths);
      setRevertPreviewItems(await previewRevertSelected(connection, currentGroup.id, paths));
      setDialog("revert");
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  async function showDiff(kind: "opened" | "shelved", path: string, againstLocal = false) {
    setDiffLoading(true);
    setError(undefined);
    try {
      const result = kind === "opened"
        ? await diffFile(connection, path, diffMode)
        : await diffShelvedFile(connection, currentGroup.id, path, againstLocal, diffMode);
      setDiff(result);
      setDiffTitle(againstLocal ? t("diffLocalShelf") : kind === "shelved" ? t("diffShelfDepot") : t("diffLocalDepot"));
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setDiffLoading(false);
    }
  }

  async function handleDrop(event: DragEvent, target: ChangeDropTarget) {
    const action = dragDrop.takeDrop(event, target);
    if (!action) return;
    if (action.kind === "move") {
      await moveOpened(action.depotPaths, action.targetChange);
      return;
    }
    if (action.kind === "unshelve") {
      setUnshelvePaths(action.depotPaths);
      setUnshelveTarget(action.targetChange);
      await confirmUnshelve(action.sourceChange, action.depotPaths, action.targetChange);
      return;
    }

    await execute(async () => {
      if (action.sourceChange !== action.targetChange) {
        await reopenFiles(connection, action.depotPaths, action.targetChange);
        try {
          await shelveFiles(connection, action.targetChange, action.depotPaths);
        } catch (reason) {
          await reopenFiles(connection, action.depotPaths, action.sourceChange).catch(() => undefined);
          throw reason;
        }
      } else {
        await shelveFiles(connection, action.targetChange, action.depotPaths);
      }
    }, t("shelveSucceeded"), () => selectChange(action.targetChange));
  }

  function openSubmit() {
    setSubmitDescription(currentGroup.isDefault ? "" : currentGroup.description);
    setSubmitPreflightIssues([]);
    setSubmitPreflightSummary({ issues: [], jobs: [], totalSize: 0 });
    setSubmitPreflightReady(false);
    setDialog("submit");
  }

  async function confirmSubmit(mode: SubmitMode) {
    setActionRunning(true);
    setError(undefined);
    try {
      if (!submitPreflightReady) {
        const summary = await submitPreflight(connection, currentGroup.id);
        setSubmitPreflightSummary(summary);
        if (summary.issues.length > 0) {
          setSubmitPreflightIssues(summary.issues);
          setSubmitPreflightReady(true);
          return;
        }
        setSubmitPreflightReady(true);
      }
      if (mode === "local") {
        await startObservedOperation(
          "submit",
          () => startSubmit(connection, currentGroup.id, currentGroup.isDefault ? submitDescription : undefined, mode),
          (event) => {
            if (!["completed", "failed", "cancelled"].includes(event.kind)) return;
            if (event.kind === "completed") setNotice(t("submitSucceeded"));
            else if (event.kind === "cancelled") setNotice(t("submitCancelled"));
            else if (event.kind === "failed") setError({ kind: "command_failed", message: event.message || t("operationFailed"), hints: [] });
            refreshData();
          },
        );
        setDialog(undefined);
        return;
      }
      const outcome = await submitChange(
        connection,
        currentGroup.id,
        currentGroup.isDefault ? submitDescription : undefined,
        mode,
      );
      setDialog(undefined);
      setSelectedChange(outcome.preservedLocalChange ?? "default");
      fileSelection.clear();
      setNotice(outcome.preservedLocalChange
        ? `${t("submitShelfPreserved")} CL ${outcome.preservedLocalChange}.`
        : t("submitSucceeded"));
      refreshData();
    } catch (reason) {
      setDialog(undefined);
      refreshData();
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  function openUnshelve(paths: string[] = []) {
    setUnshelvePaths(paths);
    setUnshelveTarget(currentGroup.id);
    setDialog("unshelve");
  }

  async function confirmUnshelve(
    sourceChange = currentGroup.id,
    paths = unshelvePaths,
    destination = unshelveTarget,
  ) {
    setActionRunning(true);
    setError(undefined);
    try {
      const preview = await previewUnshelve(connection, sourceChange, paths);
      if (preview.conflicts.length > 0) {
        setUnshelvePaths(paths.length > 0 ? paths : currentShelfFiles.map((file) => file.depotPath));
        setUnshelveConflicts(preview.conflicts);
        setConflictSelection(preview.conflicts.map((conflict) => conflict.depotPath));
        setOverwriteConflicts([]);
        setDialog("unshelve-conflicts");
        return;
      }
      await unshelveFiles(connection, sourceChange, destination, paths);
      setDialog(undefined);
      setNotice(t("unshelveSucceeded"));
      selectChange(destination);
      refreshData();
    } catch (reason) {
      setDialog(undefined);
      setError(normalizeAppError(reason));
    } finally {
      setActionRunning(false);
    }
  }

  async function continueUnshelve() {
    const conflictPaths = new Set(unshelveConflicts.map((conflict) => conflict.depotPath));
    const normal = unshelvePaths.filter((path) => !conflictPaths.has(path));
    if (normal.length === 0 && overwriteConflicts.length === 0) {
      setDialog(undefined);
      setNotice(t("allConflictsSkipped"));
      return;
    }
    await execute(
      () => unshelveFiles(connection, currentGroup.id, unshelveTarget, normal, overwriteConflicts),
      t("unshelveSucceeded"),
      () => selectChange(unshelveTarget),
    );
  }

  function setConflictResolution(overwrite: boolean) {
    setOverwriteConflicts((current) => overwrite
      ? [...new Set([...current, ...conflictSelection])]
      : current.filter((path) => !conflictSelection.includes(path)));
    setConflictMenu(undefined);
  }

  function changeDeleteAddedFiles(value: boolean) {
    setDeleteAddedFiles(value);
    void saveRevertPreference(value).catch((reason) => setError(normalizeAppError(reason)));
  }

  function openMenu(event: React.MouseEvent | React.KeyboardEvent, next: MenuTarget) {
    if (next.change !== selectedChange) {
      setSelectedChange(next.change);
      fileSelection.clear();
      setDiff(undefined);
    }
    if (!selectedChanges.includes(next.change)) {
      setSelectedChanges([next.change]);
      changeSelectionAnchor.current = next.change;
    }
    if (next.kind === "opened" && !openedSelection.includes(next.depotPath)) {
      const file = files.find((item) => item.depotPath === next.depotPath);
      if (file) selectOpened(file);
    }
    if (next.kind === "shelved" && !shelvedSelection.includes(next.depotPath)) {
      const file = currentShelfFiles.find((item) => item.depotPath === next.depotPath);
      if (file) selectShelved(file);
    }
    changeMenu.open(event, next);
  }

  const menu = changeMenu.menu?.target;
  const contextGroup = menu ? groups.find((group) => group.id === menu.change) : undefined;
  const visibleGroups = filterChangeGroups(groups, changeQuery, currentGroup.id);
  const partitionedGroups = partitionArchived(visibleGroups, archivedChanges, (group) => group.id);
  const orderedChangeIds = [...partitionedGroups.current, ...(unactualOpen ? partitionedGroups.archived : [])].map((group) => group.id);
  const contextOpened = menu?.kind === "opened"
    ? files.find((file) => file.depotPath === menu.depotPath)
    : undefined;

  useEffect(() => {
    if (changeSelectionAnchor.current && !orderedChangeIds.includes(changeSelectionAnchor.current)) {
      changeSelectionAnchor.current = [...selectedChanges].reverse().find((id) => orderedChangeIds.includes(id));
    }
  }, [orderedChangeIds, selectedChanges]);

  function setUnactual(groupIds: string[], archived: boolean) {
    setArchived(groupIds.filter((id) => id !== "default"), archived);
  }

  function toggleUnactual(groupId: string) {
    const archived = archivedChanges.includes(groupId);
    const ids = selectedChangesForArchive(selectedChanges, groupId, archivedChanges);
    setUnactual(ids, !archived);
  }

  const renderChange = (group: (typeof groups)[number]) => (
    <SelectableSurface
      selected={selectedChanges.includes(group.id)}
      draggable={!group.isDefault}
      title={!group.isDefault ? t("unactualDragHint") : undefined}
      aria-label={`${group.isDefault ? t("defaultChangelist") : `CL ${group.id} · ${group.description || t("noDescription")}`} · ${group.files.length} ${t("localFilesCount")}`}
      className="change-item"
      key={group.id}
      onClick={(event) => selectChange(group.id, event)}
      onContextMenu={(event) => openMenu(event, { kind: "change", change: group.id, depotPath: "" })}
      onKeyDown={(event) => {
        if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, { kind: "change", change: group.id, depotPath: "" });
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectChange(group.id); }
      }}
      onDragOver={(event) => dragDrop.allowDrop(event, { kind: "changelist", change: group.id })}
      onDrop={(event) => void handleDrop(event, { kind: "changelist", change: group.id })}
      onDragStart={(event) => {
        const archived = archivedChanges.includes(group.id);
        const ids = selectedChangesForArchive(selectedChanges, group.id, archivedChanges);
        if (!selectedChanges.includes(group.id)) selectChange(group.id);
        archiveDragDrop.beginDrag(event, ids, archived);
      }}
      onDragEnd={archiveDragDrop.endDrag}
    >
      <span className="change-title-row">
        {group.isDefault ? <span className="change-title">{t("defaultChangelist")}</span> : <ChangelistDescription className="change-title" value={group.description} fallback={t("noDescription")} compact />}
        {group.isShelved && <span className="shelf-badge">{t("shelvedBadge")}</span>}
      </span>
      {!group.isDefault && <span className="change-description changelist-number">CL {group.id}</span>}
      <span className="change-meta">{group.files.length} {t("localFilesCount")}{group.isShelved ? ` · ${t("hasShelf")}` : ""}{group.time ? ` · ${formatTime(group.time, language)}` : ""}</span>
    </SelectableSurface>
  );

  return (
    <View
      id="changes-title"
      title={t("myChanges")}
      subtitle={info.clientRoot || info.clientStream || connection.client}
      error={error}
      notice={notice}
      operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
      onDismissNotice={() => setNotice("")}
      actions={<>
          <span className="auto-refresh"><span aria-hidden="true" />{t("refreshOnFocus")}</span>
          <button className="secondary-button" type="button" onClick={refreshData} disabled={state === "loading"}>
            <RefreshIcon /> {state === "loading" ? t("refreshing") : t("refresh")}
          </button>
          <button className="primary-button update-project-button" type="button" onClick={() => void safeSync.start(["//..."])} disabled={safeSync.phase !== "idle"}>{safeSync.phase === "idle" ? t("updateProject") : t("updatingProject")}</button>
      </>}
    >
      <div className="change-toolbar">
        <div>
          <strong className={currentGroup.isDefault ? undefined : "changelist-number"}>{currentGroup.isDefault ? t("defaultChangelist") : `CL ${currentGroup.id}`}</strong>
          <ChangelistDescription value={currentGroup.description} fallback={t("noDescription")} compact />
        </div>
        <div className="change-toolbar-actions">
          <button className="secondary-button" type="button" onClick={() => { setDescription(""); setDialog("create"); }}>
            {t("newChangelist")}
          </button>
          <button className="primary-button" type="button" disabled={!canSubmit} onClick={openSubmit}>
            {currentGroup.isShelved && currentGroup.files.length === 0 ? t("submitShelf") : t("submitChange")}
          </button>
        </div>
      </div>

      <div className="changes-workbench">
        <aside className="change-column" aria-label={t("changelistsLabel")}>
          <div className="column-heading"><strong>{t("changelistsLabel")}</strong><span>{partitionedGroups.current.length} / {groups.length}</span></div>
          <label className="field change-filter"><span className="sr-only">{t("pendingChangesFilter")}</span><input value={changeQuery} placeholder={t("pendingChangesFilterPlaceholder")} onChange={(event) => setChangeQuery(event.target.value)} /></label>
          <div
            className={`actual-list archive-drop-zone${archiveDragDrop.dropTarget === "current" ? " drag-over" : ""}`}
            onDragOver={(event) => archiveDragDrop.allowDrop(event, "current")}
            onDrop={(event) => { const ids = archiveDragDrop.takeDrop(event, "current"); if (ids) setUnactual(ids, false); }}
          >
            {partitionedGroups.current.map(renderChange)}
          </div>
          <section
            className={`unactual-section archive-drop-zone${archiveDragDrop.dropTarget === "archived" ? " drag-over" : ""}`}
            onDragOver={(event) => archiveDragDrop.allowDrop(event, "archived")}
            onDrop={(event) => { const ids = archiveDragDrop.takeDrop(event, "archived"); if (ids) setUnactual(ids, true); }}
          >
            <button className="unactual-heading" type="button" aria-expanded={unactualOpen} onClick={() => setUnactualOpen((value) => !value)}>{unactualOpen ? <ChevronDown className="ui-icon" aria-hidden="true" /> : <ChevronRight className="ui-icon" aria-hidden="true" />}<strong>{t("unactual")}</strong><small>{partitionedGroups.archived.length}</small></button>
            {unactualOpen && <div className="unactual-list">{partitionedGroups.archived.length ? partitionedGroups.archived.map(renderChange) : <CompactEmpty text={t("unactualChangesEmpty")} />}</div>}
          </section>
        </aside>

        <section className="file-column" aria-label={t("changeContentsLabel")}>
          <div className="file-section" onDragOver={(event) => dragDrop.allowDrop(event, { kind: "changelist", change: currentGroup.id })} onDrop={(event) => void handleDrop(event, { kind: "changelist", change: currentGroup.id })}>
            <div className="column-heading section-heading" onContextMenu={(event) => { if (currentGroup.files.length > 0) openMenu(event, { kind: "section", section: "opened", change: currentGroup.id }); }}><strong>{t("openedFilesLabel")}</strong><span>{openedSelection.length > 0 ? `${openedSelection.length} / ` : ""}{currentGroup.files.length}</span></div>
            {state === "loading" && changes.length === 0 && files.length === 0
              ? <EmptyState title={t("loadingChanges")} body={t("loadingChangesBody")} />
              : currentGroup.files.length === 0
                ? <CompactEmpty text={t("emptyChange")} />
                : <div className="file-list">{currentGroup.files.map((file) => (
                  <SelectableRow
                    selected={openedSelection.includes(file.depotPath)}
                    draggable
                    className="file-item"
                    key={file.depotPath}
                    onClick={(event) => selectOpened(file, event)}
                    onKeyDown={(event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, { kind: "opened", change: currentGroup.id, depotPath: file.depotPath }); }}
                    onDragStart={(event) => dragDrop.beginDrag(event, { kind: "opened", depotPaths: openedSelection.includes(file.depotPath) ? openedSelection : [file.depotPath], sourceChange: file.change })}
                    onDragEnd={dragDrop.endDrag}
                    onContextMenu={(event) => openMenu(event, { kind: "opened", change: currentGroup.id, depotPath: file.depotPath })}
                  >
                    <span className={`action-badge action-${file.action}`}>{file.action}</span>
                    <ItemRowCopy primary={fileName(file.depotPath)} secondary={parentPath(file.depotPath)} />
                  </SelectableRow>
                ))}</div>}
          </div>

          <div className={`file-section shelf-section${currentGroup.isDefault ? " disabled" : ""}`} onDragOver={(event) => dragDrop.allowDrop(event, { kind: "shelf", change: currentGroup.id })} onDrop={(event) => void handleDrop(event, { kind: "shelf", change: currentGroup.id })}>
            <div className="column-heading section-heading" onContextMenu={(event) => { if (currentShelfFiles.length > 0) openMenu(event, { kind: "section", section: "shelved", change: currentGroup.id }); }}><strong>{t("shelvedFilesLabel")}</strong><span>{shelvedSelection.length > 0 ? `${shelvedSelection.length} / ` : ""}{currentShelfFiles.length}</span></div>
            {currentGroup.isDefault
              ? <CompactEmpty text={t("shelfNeedsNumbered")} />
              : shelfLoading
                ? <CompactEmpty text={t("loadingShelfFiles")} />
                : currentShelfFiles.length === 0
                  ? <CompactEmpty text={t("emptyShelfDrop")} />
                  : <div className="file-list">{currentShelfFiles.map((file) => (
                    <SelectableRow
                      selected={shelvedSelection.includes(file.depotPath)}
                      draggable
                      className="file-item shelf-file"
                      key={file.depotPath}
                      onClick={(event) => selectShelved(file, event)}
                      onKeyDown={(event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, { kind: "shelved", change: currentGroup.id, depotPath: file.depotPath }); }}
                      onDragStart={(event) => dragDrop.beginDrag(event, { kind: "shelved", depotPaths: shelvedSelection.includes(file.depotPath) ? shelvedSelection : [file.depotPath], sourceChange: currentGroup.id })}
                      onDragEnd={dragDrop.endDrag}
                      onContextMenu={(event) => openMenu(event, { kind: "shelved", change: currentGroup.id, depotPath: file.depotPath })}
                    >
                      <span className={`action-badge action-${file.action}`}>{file.action}</span>
                      <ItemRowCopy primary={fileName(file.depotPath)} secondary={parentPath(file.depotPath)} />
                    </SelectableRow>
                  ))}</div>}
          </div>
        </section>

        <aside className="inspector" aria-label={t("fileDetailsLabel")}>
          <div className="column-heading"><strong>{t("fileDetailsLabel")}</strong></div>
          {!currentOpened && !currentShelved ? <EmptyState title={t("selectFile")} body={t("selectFileBody")} /> : (
            <div className="inspector-content">
              <div>
                <span className={`source-badge ${currentShelved ? "shelf" : "local"}`}>{currentShelved ? t("shelfSource") : t("localSource")}</span>
                <h2>{(openedSelection.length || shelvedSelection.length) > 1 ? `${openedSelection.length || shelvedSelection.length} ${t("filesSelected")}` : fileName((currentOpened ?? currentShelved)!.depotPath)}</h2>
                <p className="depot-path">{(currentOpened ?? currentShelved)!.depotPath}</p>
              </div>
              <dl className="file-facts">
                <dt>{t("actionLabel")}</dt><dd>{(currentOpened ?? currentShelved)!.action}</dd>
                {(currentOpened ?? currentShelved)!.revision && <><dt>{t("revisionLabel")}</dt><dd>#{(currentOpened ?? currentShelved)!.revision}</dd></>}
                {(currentOpened ?? currentShelved)!.fileType && <><dt>{t("typeLabel")}</dt><dd>{(currentOpened ?? currentShelved)!.fileType}</dd></>}
              </dl>
              {currentOpened && <div className="inspector-action">
                <label className="field">
                  <span className="field-label">{t("moveToChangelist")}</span>
                  <select value={targetChange} onChange={(event) => setTargetChange(event.target.value)}>
                    {groups.map((group) => <option value={group.id} key={group.id}>{changeOptionLabel(group, t("defaultChangelist"), t("noDescription"))}</option>)}
                  </select>
                </label>
                <button className="secondary-button" type="button" disabled={actionRunning || targetChange === currentOpened.change} onClick={() => void moveOpened(openedSelection, targetChange)}>
                  {actionRunning ? t("moving") : t("moveFile")}
                </button>
              </div>}
              <div className="file-actions">
                <button className="primary-button" type="button" disabled={diffLoading || (openedSelection.length || shelvedSelection.length) > 1} onClick={() => void showDiff(currentOpened ? "opened" : "shelved", (currentOpened ?? currentShelved)!.depotPath)}>
                  {diffLoading ? t("loadingDiff") : currentShelved ? t("viewShelfDiff") : t("viewDiff")}
                </button>
                {currentShelved && currentGroup.files.some((file) => file.depotPath === currentShelved.depotPath) && (
                  <button className="secondary-button" type="button" disabled={diffLoading} onClick={() => void showDiff("shelved", currentShelved.depotPath, true)}>{t("compareLocalShelf")}</button>
                )}
              </div>
              <label className="field diff-mode-field"><span className="field-label">{t("diffMode")}</span><select value={diffMode} onChange={(event) => setDiffMode(event.target.value as DiffMode)}><option value="default">{t("diffModeDefault")}</option><option value="ignoreWhitespaceChanges">{t("diffModeWhitespaceChanges")}</option><option value="ignoreWhitespace">{t("diffModeWhitespace")}</option><option value="ignoreLineEndings">{t("diffModeLineEndings")}</option></select></label>{diff && <div className="diff-panel"><strong>{diffTitle}</strong><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} /></div>}
            </div>
          )}
        </aside>
      </div>

      {menu && changeMenu.menu && <ContextMenu x={changeMenu.menu.x} y={changeMenu.menu.y} onSelect={changeMenu.close}>
        {menu.kind === "change" && contextGroup && <>
          {contextGroup.id !== "default" && <MenuButton onClick={() => { setDescription(contextGroup.description); setDialog("edit"); }}>{t("editChangelist")}</MenuButton>}
          {contextGroup.id !== "default" && <MenuButton onClick={() => toggleUnactual(contextGroup.id)}>{archivedChanges.includes(contextGroup.id) ? t("restoreFromUnactual") : t("moveToUnactual")}</MenuButton>}
          {contextGroup.files.length > 0 && contextGroup.id !== "default" && <MenuButton onClick={() => setDialog("replace-shelf")}>{contextGroup.isShelved ? t("updateShelf") : t("shelveAll")}</MenuButton>}
          {contextGroup.isShelved && <MenuButton onClick={() => openUnshelve()}>{t("unshelveAll")}</MenuButton>}
          {contextGroup.isShelved && <MenuButton danger onClick={() => setDialog("delete-shelf")}>{t("deleteShelf")}</MenuButton>}
          {contextGroup.id !== "default" && contextGroup.files.length === 0 && !contextGroup.isShelved && <MenuButton danger onClick={() => setDialog("delete-change")}>{t("deleteChangelist")}</MenuButton>}
          {(contextGroup.files.length > 0 || contextGroup.isShelved) && <MenuButton onClick={openSubmit}>{t("submitChange")}</MenuButton>}
        </>}
        {menu.kind === "section" && menu.section === "opened" && currentGroup.files.length > 0 && <>
          <MenuButton onClick={() => fileSelection.setOpened(currentGroup.files.map((file) => file.depotPath))}>{t("selectAllFiles")}</MenuButton>
          <MenuButton onClick={() => void execute(() => lockFiles(connection, currentGroup.id, currentGroup.files.map((file) => file.depotPath)), t("filesLocked"))}>{t("lockFiles")}</MenuButton>
          <MenuButton onClick={() => void execute(() => unlockFiles(connection, currentGroup.id, currentGroup.files.map((file) => file.depotPath)), t("filesUnlocked"))}>{t("unlockFiles")}</MenuButton>
          <MenuButton onClick={() => { setDialogFiles(currentGroup.files.map((file) => file.depotPath)); setTargetChange(currentGroup.id); setDialog("move-files"); }}>{t("moveAllFiles")}</MenuButton>
          {!currentGroup.isDefault && <MenuButton onClick={() => { setDialogFiles(currentGroup.files.map((file) => file.depotPath)); setDialog("shelve-file"); }}>{t("shelveAll")}</MenuButton>}
          <MenuButton danger onClick={() => void openRevertAll()}>{t("revertAllFiles")}</MenuButton>
          <MenuButton danger onClick={() => void openRevertUnchanged()}>{t("revertUnchanged")}</MenuButton>
        </>}
        {menu.kind === "section" && menu.section === "shelved" && currentShelfFiles.length > 0 && <>
          <MenuButton onClick={() => fileSelection.setShelved(currentShelfFiles.map((file) => file.depotPath))}>{t("selectAllFiles")}</MenuButton>
          <MenuButton onClick={() => openUnshelve()}>{t("unshelveAll")}</MenuButton>
          <MenuButton danger onClick={() => setDialog("delete-shelf")}>{t("deleteShelf")}</MenuButton>
        </>}
        {menu.kind === "opened" && contextOpened && <>
          {openedSelection.length === 1 && <MenuButton onClick={() => void showDiff("opened", contextOpened.depotPath)}>{t("viewDiff")}</MenuButton>}
          {contextOpened.change !== "default" && <MenuButton onClick={() => { setDialogFiles(openedSelection); setDialog("shelve-file"); }}>{openedSelection.length > 1 ? t("shelveSelected") : t("shelveFile")}</MenuButton>}
          <MenuButton onClick={() => void execute(() => lockFiles(connection, contextOpened.change, openedSelection), t("filesLocked"))}>{t("lockFiles")}</MenuButton>
          <MenuButton onClick={() => void execute(() => unlockFiles(connection, contextOpened.change, openedSelection), t("filesUnlocked"))}>{t("unlockFiles")}</MenuButton>
          <MenuButton danger onClick={() => void openRevertSelected(openedSelection)}>{openedSelection.length > 1 ? t("revertSelected") : t("revertFile")}</MenuButton>
        </>}
        {menu.kind === "shelved" && <>
          {shelvedSelection.length === 1 && <MenuButton onClick={() => void showDiff("shelved", menu.depotPath)}>{t("viewShelfDiff")}</MenuButton>}
          {shelvedSelection.length === 1 && files.some((file) => file.depotPath === menu.depotPath) && <MenuButton onClick={() => void showDiff("shelved", menu.depotPath, true)}>{t("compareLocalShelf")}</MenuButton>}
          <MenuButton onClick={() => openUnshelve(shelvedSelection)}>{shelvedSelection.length > 1 ? t("unshelveSelected") : t("unshelveFile")}</MenuButton>
          <MenuButton danger onClick={() => { setDialogFiles(shelvedSelection); setDialog("delete-shelf-file"); }}>{shelvedSelection.length > 1 ? t("deleteSelectedFromShelf") : t("deleteShelfFile")}</MenuButton>
        </>}
      </ContextMenu>}
      {conflictMenu && <ContextMenu x={conflictMenu.x} y={conflictMenu.y} onSelect={() => setConflictMenu(undefined)}>
        <MenuButton onClick={() => setConflictResolution(false)}>{t("skipSelected")}</MenuButton>
        <MenuButton danger onClick={() => setConflictResolution(true)}>{t("overwriteSelected")}</MenuButton>
      </ContextMenu>}

      <SafeSyncConflictDialog sync={safeSync} />

      {(dialog === "create" || dialog === "edit") && <ActionDialog title={dialog === "create" ? t("newChangelistTitle") : t("editChangelist")} confirmLabel={actionRunning ? t(dialog === "create" ? "creating" : "saving") : t(dialog === "create" ? "createChangelist" : "save")} busy={actionRunning} confirmDisabled={!description.trim()} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => dialog === "create" ? createChange(connection, description).then((id) => { selectChange(id); }) : editChange(connection, currentGroup.id, description), t(dialog === "create" ? "changeCreated" : "changeUpdated"))}>
        {dialog === "create" && <p>{t("newChangelistBody")}</p>}<DescriptionField value={description} onChange={setDescription} />
      </ActionDialog>}

      {dialog === "submit" && <SubmitDialog group={currentGroup} shelfCount={currentShelfFiles.length} description={submitDescription} setDescription={setSubmitDescription} busy={actionRunning} preflightIssues={submitPreflightIssues} preflightSummary={submitPreflightSummary} preflightReady={submitPreflightReady} onClose={() => setDialog(undefined)} onSubmit={(mode) => void confirmSubmit(mode)} />}

      {dialog === "move-files" && dialogFiles.length > 0 && <ActionDialog title={t("moveAllFiles")} confirmLabel={actionRunning ? t("moving") : t("moveFiles")} busy={actionRunning} confirmDisabled={targetChange === currentGroup.id} onClose={() => setDialog(undefined)} onConfirm={() => void moveOpened(dialogFiles, targetChange)}>
        <FileSelectionSummary paths={dialogFiles} /><label className="field"><span className="field-label">{t("destinationChangelist")}</span><select value={targetChange} onChange={(event) => setTargetChange(event.target.value)} autoFocus>{groups.map((group) => <option value={group.id} key={group.id}>{changeOptionLabel(group, t("defaultChangelist"), t("noDescription"))}</option>)}</select></label>
      </ActionDialog>}

      {dialog === "shelve-file" && dialogFiles.length > 0 && <ActionDialog title={t("shelveTitle")} confirmLabel={actionRunning ? t("shelving") : t("shelveNow")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => shelveFiles(connection, currentGroup.id, dialogFiles), t("shelveSucceeded"))}>
        <p>{t("shelveWarning")}</p><FileSelectionSummary paths={dialogFiles} />
      </ActionDialog>}

      {dialog === "replace-shelf" && <ActionDialog title={currentGroup.isShelved ? t("updateShelf") : t("shelveAll")} confirmLabel={actionRunning ? t("shelving") : t("shelveNow")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => shelveFiles(connection, currentGroup.id, [], true, revertAfterShelf, deleteAddedFiles), t("shelfUpdated"))}>
        <p>{t("replaceShelfWarning")}</p><Fact label={t("filesLabel")} value={String(currentGroup.files.length)} />
        <CheckField checked={revertAfterShelf} onChange={setRevertAfterShelf} label={t("revertAfterShelf")} body={t("revertAfterShelfHint")} />
        {revertAfterShelf && currentGroup.files.some((file) => file.action === "add") && <CheckField checked={deleteAddedFiles} onChange={changeDeleteAddedFiles} label={t("deleteAddedFilesOnRevert")} body={t("deleteAddedFilesHint")} />}
      </ActionDialog>}

      {dialog === "unshelve" && <ActionDialog title={unshelvePaths.length > 0 ? t("unshelveFile") : t("unshelveTitle")} confirmLabel={actionRunning ? t("unshelving") : t("unshelveNow")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void confirmUnshelve()}>
        <p>{t("unshelveWarning")}</p>{unshelvePaths.length > 0 && <FileSelectionSummary paths={unshelvePaths} />}<label className="field"><span className="field-label">{t("destinationChangelist")}</span><select value={unshelveTarget} onChange={(event) => setUnshelveTarget(event.target.value)} autoFocus>{groups.map((group) => <option value={group.id} key={group.id}>{changeOptionLabel(group, t("defaultChangelist"), t("noDescription"))}</option>)}</select></label>
      </ActionDialog>}

      {dialog === "unshelve-conflicts" && <ActionDialog title={t("unshelveConflictsTitle")} confirmLabel={actionRunning ? t("unshelving") : t("continueUnshelve")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void continueUnshelve()}>
        <p>{t("unshelveConflictsBody")}</p>
        <div className="conflict-list">{unshelveConflicts.map((conflict) => <SelectableRow
          selected={conflictSelection.includes(conflict.depotPath)}
          key={conflict.depotPath}
          className="conflict-item"
          onClick={(event) => {
            const next = updateSelection(unshelveConflicts.map((item) => item.depotPath), conflictSelection, conflict.depotPath, conflictAnchor.current, selectionMode(event));
            conflictAnchor.current = next.anchor;
            setConflictSelection(next.selected);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!conflictSelection.includes(conflict.depotPath)) setConflictSelection([conflict.depotPath]);
            setConflictMenu({ x: event.clientX, y: event.clientY });
          }}
        ><ItemRowCopy primary={fileName(conflict.depotPath)} secondary={conflict.localPath} /><em>{overwriteConflicts.includes(conflict.depotPath) ? t("overwriteFromShelf") : t("skipFile")}</em></SelectableRow>)}</div>
        <p className="dialog-description">{t("overwriteWarning")}</p>
      </ActionDialog>}

      {dialog === "delete-shelf" && <ActionDialog danger title={t("deleteShelf")} confirmLabel={actionRunning ? t("deleting") : t("delete")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => deleteShelfFiles(connection, currentGroup.id), t("shelfDeleted"))}>
        <p>{t("deleteShelfWarning")}</p>
      </ActionDialog>}

      {dialog === "delete-shelf-file" && dialogFiles.length > 0 && <ActionDialog danger title={t("deleteShelfFile")} confirmLabel={actionRunning ? t("deleting") : t("delete")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => deleteShelfFiles(connection, currentGroup.id, dialogFiles), t("shelfFileDeleted"), () => fileSelection.setShelved([]))}>
        <p>{t("deleteShelfFileWarning")}</p><FileSelectionSummary paths={dialogFiles} />
      </ActionDialog>}

      {(dialog === "revert" || dialog === "revert-all") && <ActionDialog danger title={dialog === "revert-all" ? t("revertAllFiles") : dialogFiles.length > 1 ? t("revertSelected") : t("revertFile")} confirmLabel={actionRunning ? t("reverting") : t("revertNow")} busy={actionRunning} confirmDisabled={revertPreviewItems.length === 0} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => revertFiles(connection, currentGroup.id, revertPreviewItems.map((item) => item.depotPath), deleteAddedFiles), t(dialog === "revert-all" ? "filesReverted" : "fileReverted"), () => fileSelection.setOpened([]))}><p>{t(dialog === "revert-all" ? "revertAllPreviewWarning" : "revertWarning")}</p>{revertPreviewItems.length === 0 ? <CompactEmpty text={t("noRevertFiles")} /> : <div className="file-selection-summary"><strong>{revertPreviewItems.length} {t("filesCount")}</strong>{revertPreviewItems.slice(0, 50).map((item) => <span key={item.depotPath}>{item.action}: {item.depotPath}</span>)}</div>}{revertPreviewItems.some((item) => item.action === "add") && <CheckField checked={deleteAddedFiles} onChange={changeDeleteAddedFiles} label={t("deleteAddedFilesOnRevert")} body={t("deleteAddedFilesHint")} />}</ActionDialog>}
     {dialog === "revert-unchanged" && <ActionDialog danger title={t("revertUnchanged")} confirmLabel={actionRunning ? t("reverting") : t("revertUnchangedNow")} busy={actionRunning} confirmDisabled={revertPreviewItems.length === 0} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => revertUnchanged(connection, currentGroup.id), t("revertUnchangedSucceeded"))}>
        <p>{t("revertUnchangedWarning")}</p>
        {revertPreviewItems.length === 0 ? <CompactEmpty text={t("noUnchangedFiles")} /> : <div className="file-selection-summary"><strong>{revertPreviewItems.length} {t("filesCount")}</strong>{revertPreviewItems.slice(0, 20).map((item) => <span key={item.depotPath}>{item.action}: {item.depotPath}</span>)}</div>}
      </ActionDialog>}

      {dialog === "delete-change" && <ActionDialog danger title={t("deleteChangelist")} confirmLabel={actionRunning ? t("deleting") : t("delete")} busy={actionRunning} onClose={() => setDialog(undefined)} onConfirm={() => void execute(() => deleteChange(connection, currentGroup.id), t("changeDeleted"), () => selectChange("default"))}>
        <p>{t("deleteChangeWarning")}</p>
      </ActionDialog>}
    </View>
  );
}
