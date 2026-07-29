import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { fileHistory, listSubmittedChanges, normalizeAppError, previewSync } from "../../shared/api";
import { ChangelistHistory } from "../../shared/ChangelistHistory";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { SelectableSurface } from "../../shared/ItemList";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, FileRevision, PendingChange, SyncPreview } from "../../shared/models";
import { PathActions } from "../../shared/PathActions";
import { RefreshButton } from "../../shared/RefreshButton";
import { SafeSyncConflictDialog, SyncPreviewDialog, useSafeSync } from "../../shared/SafeSync";
import { isContextMenuShortcut } from "../../shared/selection";
import { CompactEmpty, ContextMenu, ErrorBanner, MenuButton, Modal, View } from "../../shared/View";
import { useContextMenu } from "../../shared/useContextMenu";
import { changeScope, DEPOT_HISTORY_LIMIT, DEPOT_HISTORY_PAGE_SIZE, directoryScope, hasNextHistoryPage, historyPageItems, historyPageLimit, revisionScope } from "./depot";
import { DepotOverview, type DepotOverviewMenuTarget } from "./DepotOverview";

type DepotResourceTarget = {
  kind: "file" | "folder";
  path: string;
  syncScope: string;
};

type FullHistoryState = {
  kind: "file" | "folder";
  path: string;
  page: number;
  revisions: FileRevision[];
  changes: PendingChange[];
  complete: boolean;
  busy: boolean;
  error?: AppError;
};

export function DepotView({ connection, initialScope, sourceControl, onNavigateLocal }: { connection: ConnectionInput; initialScope?: string; sourceControl?: ReactNode; onNavigateLocal?: (scope: string) => void }) {
  const { t } = useLocale();
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [overviewBusy, setOverviewBusy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const depotMenu = useContextMenu<DepotResourceTarget>();
  const [fullHistory, setFullHistory] = useState<FullHistoryState>();
  const [syncTarget, setSyncTarget] = useState<string>();
  const [syncPreview, setSyncPreview] = useState<SyncPreview>();
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const safeSync = useSafeSync(connection, { refresh: () => setOverviewRefreshKey((value) => value + 1), setNotice, setError });

  async function showSyncPreview(target: string) {
    setSyncTarget(target);
    setBusy(true);
    setError(undefined);
    setSyncPreview(undefined);
    setSyncPreviewOpen(true);
    try { setSyncPreview(await previewSync(connection, [target])); setSyncAcknowledged(false); }
    catch (reason) { setSyncPreviewOpen(false); setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function runSync() {
    if (!syncTarget) return;
    const requestedPath = syncTarget;
    setSyncPreview(undefined);
    setSyncPreviewOpen(false);
    setSyncTarget(undefined);
    await safeSync.start([requestedPath]);
  }

  async function openFullHistory(target: DepotResourceTarget) {
    depotMenu.close();
    await loadFullHistoryPage(target, 0, true);
  }

  async function loadFullHistoryPage(target: DepotResourceTarget, page: number, reset = false) {
    const limit = historyPageLimit(page);
    setFullHistory((current) => !reset && current?.kind === target.kind && current.path === target.path
      ? { ...current, busy: true, error: undefined }
      : { kind: target.kind, path: target.path, page: 0, revisions: [], changes: [], complete: false, busy: true });
    try {
      if (target.kind === "file") {
        const revisions = await fileHistory(connection, target.path, limit);
        setFullHistory({ kind: target.kind, path: target.path, page, revisions, changes: [], complete: revisions.length < limit || limit === DEPOT_HISTORY_LIMIT, busy: false });
      } else {
        const changes = await listSubmittedChanges(connection, directoryScope(target.path), limit);
        setFullHistory({ kind: target.kind, path: target.path, page, revisions: [], changes, complete: changes.length < limit || limit === DEPOT_HISTORY_LIMIT, busy: false });
      }
    } catch (reason) {
      setFullHistory((current) => current?.kind === target.kind && current.path === target.path
        ? { ...current, busy: false, error: normalizeAppError(reason) }
        : { kind: target.kind, path: target.path, page: 0, revisions: [], changes: [], complete: false, busy: false, error: normalizeAppError(reason) });
    }
  }

  function goToHistoryPage(page: number) {
    if (!fullHistory || page < 0) return;
    const itemCount = fullHistory.kind === "file" ? fullHistory.revisions.length : fullHistory.changes.length;
    const cachedThrough = Math.min((page + 1) * DEPOT_HISTORY_PAGE_SIZE + 1, DEPOT_HISTORY_LIMIT);
    if (page < fullHistory.page || itemCount >= cachedThrough || (fullHistory.complete && itemCount > page * DEPOT_HISTORY_PAGE_SIZE)) {
      setFullHistory({ ...fullHistory, page, error: undefined });
      return;
    }
    void loadFullHistoryPage({ kind: fullHistory.kind, path: fullHistory.path, syncScope: fullHistory.path }, page);
  }

  function openPointerMenu(event: ReactMouseEvent<HTMLElement>, target: DepotResourceTarget) {
    depotMenu.open(event, target);
  }

  function openKeyboardMenu(event: ReactKeyboardEvent<HTMLElement>, target: DepotResourceTarget) {
    if (!isContextMenuShortcut(event.key, event.shiftKey)) return;
    depotMenu.open(event, target);
  }

  function resourceTarget(target: DepotOverviewMenuTarget): DepotResourceTarget {
    if (target.kind === "file") {
      return { kind: "file", path: target.path, syncScope: target.revision ? revisionScope(target.path, target.revision) : target.path };
    }
    return { kind: "folder", path: target.path, syncScope: target.change ? changeScope(target.path, target.change) : directoryScope(target.path) };
  }

  const historyItemCount = fullHistory?.kind === "file" ? fullHistory.revisions.length : fullHistory?.changes.length || 0;
  const visibleRevisions = fullHistory?.kind === "file" ? historyPageItems(fullHistory.revisions, fullHistory.page) : [];
  const visibleChanges = fullHistory?.kind === "folder" ? historyPageItems(fullHistory.changes, fullHistory.page) : [];
  const visibleHistoryCount = visibleRevisions.length + visibleChanges.length;
  const pageStart = fullHistory && visibleHistoryCount ? fullHistory.page * DEPOT_HISTORY_PAGE_SIZE + 1 : 0;
  const pageEnd = pageStart ? pageStart + visibleHistoryCount - 1 : 0;
  const canShowNext = fullHistory ? hasNextHistoryPage(historyItemCount, fullHistory.page) : false;
  const menu = depotMenu.menu?.target;

  return <View
    id="depot-title"
    title={t("depotTitle")}
    subtitle={t("depotOverviewBody")}
    error={error}
    notice={notice}
    operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    onDismissNotice={() => setNotice("")}
    actions={<RefreshButton busy={overviewBusy} onClick={() => setOverviewRefreshKey((value) => value + 1)} />}
    statusBarActions={sourceControl}
  >
    <DepotOverview
      connection={connection}
      refreshKey={overviewRefreshKey}
      initialScope={initialScope}
      onBusyChange={setOverviewBusy}
      onDownload={(target) => void showSyncPreview(resourceTarget(target).syncScope)}
      onContextMenu={(target, position) => depotMenu.openAt(resourceTarget(target), position)}
      onNavigateLocal={onNavigateLocal}
    />

    {menu && depotMenu.menu && <ContextMenu x={depotMenu.menu.x} y={depotMenu.menu.y} onSelect={depotMenu.close}>
      <MenuButton disabled={safeSync.phase !== "idle"} onClick={() => void showSyncPreview(menu.syncScope)}>{t("depotDownloadToWorkspace")}</MenuButton>
      <MenuButton onClick={() => void openFullHistory(menu)}>{t("depotViewFullHistory")}</MenuButton>
    </ContextMenu>}

    {fullHistory && <Modal title={fullHistory.kind === "file" ? t("depotFullFileHistory") : t("depotFullFolderHistory")} busy={fullHistory.busy} wide onClose={() => setFullHistory(undefined)}>
      <div className="dialog-body depot-full-history">
        <div className="depot-full-history-heading"><div><strong>{fullHistory.path}</strong><small>{pageStart}–{pageEnd} · {t("depotHistoryPage")} {fullHistory.page + 1}</small></div><PathActions depotPath={fullHistory.path} connection={connection} onNavigateLocal={(mapping) => mapping.depotPath && onNavigateLocal?.(mapping.depotPath)} /></div>
        {fullHistory.error && <ErrorBanner error={fullHistory.error} />}
        {fullHistory.kind === "file" ? <div className="selection-history" key={`${fullHistory.kind}:${fullHistory.path}:${fullHistory.page}`}>
          {fullHistory.busy && !visibleHistoryCount ? <CompactEmpty text={t("loadingHistory")} /> : visibleRevisions.map((revision) => {
            const target = { kind: "file" as const, path: fullHistory.path, syncScope: revisionScope(fullHistory.path, revision.revision) };
            return <SelectableSurface data-agent-id={`depot-full-history-revision:${fullHistory.path}#${revision.revision}`} className="history-compact-row depot-context-history-row" key={revision.revision} onContextMenu={(event) => openPointerMenu(event, target)} onKeyDown={(event) => openKeyboardMenu(event, target)}><ChangelistDescription value={revision.description} fallback={`${t("revisionLabel")} #${revision.revision}`} compact /><span><span className="changelist-number">CL {revision.change || "—"}</span> · {revision.user}{revision.client ? ` · ${revision.client}` : ""}</span><small>#{revision.revision} · {revision.action || "—"}{revision.fileType ? ` · ${revision.fileType}` : ""}</small></SelectableSurface>;
          })}
          {!fullHistory.busy && !fullHistory.error && !visibleRevisions.length && <CompactEmpty text={t("depotNoHistory")} />}
        </div> : <ChangelistHistory
          className="embedded depot-full-history-changes"
          key={`${fullHistory.kind}:${fullHistory.path}:${fullHistory.page}`}
          items={visibleChanges}
          busy={fullHistory.busy}
          emptyText={fullHistory.error ? undefined : t("depotNoHistory")}
          agentId={(change) => `depot-full-history-change:${fullHistory.path}@${change.id}`}
          onContextMenu={(change, position) => depotMenu.openAt({ kind: "folder", path: fullHistory.path, syncScope: changeScope(fullHistory.path, change.id) }, position)}
        />}
        <div className="depot-history-pagination" aria-label={t("depotHistoryPagination")}>
          <button data-agent-id="depot-history-previous" className="secondary-button" type="button" onClick={() => goToHistoryPage(fullHistory.page - 1)} disabled={fullHistory.busy || fullHistory.page === 0}>{t("depotHistoryPrevious")}</button>
          <span>{t("depotHistoryPage")} {fullHistory.page + 1}</span>
          <button data-agent-id="depot-history-next" className="secondary-button" type="button" onClick={() => goToHistoryPage(fullHistory.page + 1)} disabled={fullHistory.busy || !canShowNext}>{fullHistory.busy ? t("loadingHistory") : t("depotHistoryNext")}</button>
        </div>
      </div>
    </Modal>}

    {syncPreviewOpen && <SyncPreviewDialog preview={syncPreview} busy={busy} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} onClose={() => { setSyncPreviewOpen(false); setSyncTarget(undefined); }} onConfirm={() => void runSync()} />}
    <SafeSyncConflictDialog sync={safeSync} />
  </View>;
}
