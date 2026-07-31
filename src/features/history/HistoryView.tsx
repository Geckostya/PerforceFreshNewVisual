import { useEffect, useMemo, useRef, useState } from "react";
import { describeChange, diffRevisions, listStreams, listSubmittedHistoryPage, listSubmittedFilterOptions, normalizeAppError, previewSync } from "../../shared/api";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { ChangelistHistory } from "../../shared/ChangelistHistory";
import { DiffViewer } from "../../shared/DiffViewer";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, FileDiff, P4Info, PendingChange, StreamSummary, SubmittedChangeDetail, SubmittedFilterOptions, SyncPreview } from "../../shared/models";
import { RefreshButton } from "../../shared/RefreshButton";
import { SafeSyncConflictDialog, SyncPreviewDialog, useSafeSync } from "../../shared/SafeSync";
import { ActionDialog, EmptyState, View } from "../../shared/View";
import { filterSubmittedChanges, isLargeSubmittedChange, nextSubmittedFileRenderLimit, previousRevision, SUBMITTED_DETAIL_PREVIEW_LIMIT, submittedChangeStream, submittedRevisionScopes, submittedScope } from "./history";
import { CherryPickDialog } from "./CherryPickDialog";
import { UndoDialog } from "./UndoDialog";

export function HistoryView({ connection, info }: { connection: ConnectionInput; info: P4Info }) {
  const { t } = useLocale();
  const [submitted, setSubmitted] = useState<PendingChange[]>([]);
  const [selectedChange, setSelectedChange] = useState<string>();
  const [changeDetail, setChangeDetail] = useState<SubmittedChangeDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [fullDetailLoading, setFullDetailLoading] = useState(false);
  const [confirmFullDetail, setConfirmFullDetail] = useState(false);
  const [visibleFileLimit, setVisibleFileLimit] = useState(SUBMITTED_DETAIL_PREVIEW_LIMIT);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyUser, setHistoryUser] = useState(connection.user);
  const [historyClient, setHistoryClient] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "current">("all");
  const [filterOptions, setFilterOptions] = useState<SubmittedFilterOptions>({ users: [], clients: [] });
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [historyJob, setHistoryJob] = useState("");
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [historyCursors, setHistoryCursors] = useState<(string | undefined)[]>([undefined]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPartial, setHistoryPartial] = useState(false);
  const [undoSource, setUndoSource] = useState<string>();
  const [cherrySource, setCherrySource] = useState<{ change: string; stream: string }>();
  const [diff, setDiff] = useState<FileDiff>();
  const [diffTitle, setDiffTitle] = useState("");
  const [syncPreview, setSyncPreview] = useState<SyncPreview>();
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const submittedRequest = useRef(0);
  const detailRequest = useRef(0);
  const safeSync = useSafeSync(connection, { refresh: refreshSelectedChange, setNotice, setError });

  useEffect(() => {
    let active = true;
    void Promise.allSettled([listSubmittedFilterOptions(connection), listStreams(connection)])
      .then(([options, streamCatalog]) => {
        if (!active) return;
        if (options.status === "fulfilled") setFilterOptions(options.value);
        if (streamCatalog.status === "fulfilled") setStreams(streamCatalog.value);
      });
    return () => { active = false; };
  }, [connection.client, connection.port, connection.user]);

  useEffect(() => {
    void loadSubmitted(undefined, 0, true);
  }, [streamFilter, historyUser, historyClient, connection.client, connection.port, connection.user, info.clientStream]);

  async function loadSubmitted(cursor: string | undefined = undefined, page = 0, reset = true, filters = {
    stream: streamFilter,
    user: historyUser,
    client: historyClient,
    job: historyJob,
  }) {
    const request = ++submittedRequest.current;
    if (reset) detailRequest.current += 1;
    setBusy(true);
    setError(undefined);
    if (reset) {
      setChangeDetail(undefined);
      setDiff(undefined);
      setDetailLoading(false);
      setFullDetailLoading(false);
      setConfirmFullDetail(false);
    }
    try {
      const result = await listSubmittedHistoryPage(
        connection,
        submittedScope(info.clientStream, filters.stream),
        100,
        cursor,
        filters.job,
        filters.user || undefined,
        filters.client || undefined,
        true,
      );
      if (request !== submittedRequest.current) return;
      setSubmitted(result.items);
      setHistoryCursor(result.nextCursor);
      setHistoryPartial(result.partial);
      setHistoryPage(page);
      if (reset) setHistoryCursors([undefined]);
      if (reset) setSelectedChange(undefined);
    } catch (reason) {
      if (request === submittedRequest.current) setError(normalizeAppError(reason));
    } finally {
      if (request === submittedRequest.current) setBusy(false);
    }
  }

  async function selectSubmitted(change: string) {
    const request = ++detailRequest.current;
    setSelectedChange(change);
    setChangeDetail(undefined);
    setVisibleFileLimit(SUBMITTED_DETAIL_PREVIEW_LIMIT);
    setConfirmFullDetail(false);
    setFullDetailLoading(false);
    setDetailLoading(true);
    setBusy(true);
    setError(undefined);
    setDiff(undefined);
    try {
      const detail = await describeChange(connection, change, SUBMITTED_DETAIL_PREVIEW_LIMIT);
      if (request === detailRequest.current) setChangeDetail(detail);
    } catch (reason) {
      if (request === detailRequest.current) setError(normalizeAppError(reason));
    } finally {
      if (request === detailRequest.current) {
        setDetailLoading(false);
        setBusy(false);
      }
    }
  }

  async function loadFullDetail() {
    if (!selectedChange) return;
    const change = selectedChange;
    const request = ++detailRequest.current;
    setConfirmFullDetail(false);
    setFullDetailLoading(true);
    setBusy(true);
    setError(undefined);
    try {
      const detail = await describeChange(connection, change);
      if (request === detailRequest.current) {
        setChangeDetail(detail);
        setVisibleFileLimit(SUBMITTED_DETAIL_PREVIEW_LIMIT);
      }
    } catch (reason) {
      if (request === detailRequest.current) setError(normalizeAppError(reason));
    } finally {
      if (request === detailRequest.current) {
        setFullDetailLoading(false);
        setBusy(false);
      }
    }
  }

  async function refreshSelectedChange() {
    if (!selectedChange) return;
    try { setChangeDetail(await describeChange(connection, selectedChange, changeDetail?.filesTruncated ? SUBMITTED_DETAIL_PREVIEW_LIMIT : undefined)); }
    catch (reason) { setError(normalizeAppError(reason)); }
  }

  async function runPreview(task: () => Promise<FileDiff>, title: string) {
    setBusy(true);
    setError(undefined);
    try { setDiff(await task()); setDiffTitle(title); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function showRevisionSyncPreview() {
    if (!changeDetail) return;
    const scopes = submittedRevisionScopes(changeDetail.files);
    if (!scopes.length) return;
    setSyncPreview(undefined);
    setSyncAcknowledged(false);
    setSyncPreviewOpen(true);
    setBusy(true);
    setError(undefined);
    try { setSyncPreview(await previewSync(connection, scopes)); }
    catch (reason) { setSyncPreviewOpen(false); setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function getThisRevision() {
    if (!changeDetail) return;
    const scopes = submittedRevisionScopes(changeDetail.files);
    setSyncPreviewOpen(false);
    setSyncPreview(undefined);
    await safeSync.start(scopes);
  }

  const historyUsers = useMemo(() => [...new Set([...filterOptions.users, ...submitted.map((change) => change.user)])].filter((user) => user && user !== connection.user).sort(), [connection.user, filterOptions.users, submitted]);
  const historyClients = useMemo(() => [...new Set([...filterOptions.clients, ...submitted.map((change) => change.client)])].filter((client) => client && client !== connection.client).sort(), [connection.client, filterOptions.clients, submitted]);
  const visibleSubmitted = filterSubmittedChanges(submitted, historyQuery, historyUser, historyClient);
  const exactFilesReady = Boolean(changeDetail && !changeDetail.filesTruncated && !fullDetailLoading);
  const sourceStream = useMemo(() => exactFilesReady && changeDetail ? submittedChangeStream(changeDetail.files, streams) : undefined, [changeDetail, exactFilesReady, streams]);
  const canCherryPick = Boolean(exactFilesReady && sourceStream && info.clientStream && sourceStream !== info.clientStream);
  const hasRevisionScopes = Boolean(exactFilesReady && changeDetail?.files.some((file) => file.revision && /^\d+$/.test(file.revision)));
  const largeChange = Boolean(changeDetail && isLargeSubmittedChange(changeDetail.files.length, changeDetail.filesTruncated));
  const visibleFiles = changeDetail?.files.slice(0, visibleFileLimit) || [];
  const filesFact = changeDetail ? `${changeDetail.files.length}${changeDetail.filesTruncated ? "+" : ""}` : "—";

  return <View
    id="history-title"
    title={t("submittedHistory")}
    subtitle={t("submittedHistoryBody")}
    busy={busy}
    error={error}
    notice={notice}
    operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    onDismissNotice={() => setNotice("")}
    actions={<RefreshButton busy={busy} onClick={() => void loadSubmitted(undefined, 0, true)} agentId="submitted-refresh" />}
  >
    <div className="resource-toolbar history-filters">
      <label className="field"><span className="field-label">{t("historyStreamFilter")}</span><select data-agent-id="submitted-stream-filter" value={streamFilter} onChange={(event) => setStreamFilter(event.target.value as "all" | "current")}><option value="all">{t("allStreams")}</option><option value="current" disabled={!info.clientStream}>{t("currentStream")}{info.clientStream ? ` · ${info.clientStream}` : ""}</option></select></label>
      <label className="field"><span className="field-label">{t("factUser")}</span><select data-agent-id="submitted-user-filter" value={historyUser} onChange={(event) => setHistoryUser(event.target.value)}><option value={connection.user}>{t("currentUser")} · {connection.user}</option><option value="">{t("allUsers")}</option>{historyUsers.map((user) => <option key={user} value={user}>{user}</option>)}</select></label>
      <label className="field"><span className="field-label">{t("workspaceLabel")}</span><select data-agent-id="submitted-workspace-filter" value={historyClient} onChange={(event) => setHistoryClient(event.target.value)}><option value="">{t("allWorkspaces")}</option><option value={connection.client}>{t("currentWorkspace")} · {connection.client}</option>{historyClients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
      <label className="field"><span className="field-label">{t("historyFilterSearch")}</span><input value={historyQuery} placeholder={t("historyFilterPlaceholder")} onChange={(event) => setHistoryQuery(event.target.value)} /></label>
      <label className="field"><span className="field-label">{t("historyJob")}</span><input value={historyJob} placeholder={t("historyJobPlaceholder")} onChange={(event) => setHistoryJob(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadSubmitted(); }} /></label>
    </div>
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{t("submittedHistory")}</strong><span>{visibleSubmitted.length}</span></div>
        <ChangelistHistory
          className="embedded history-submitted-list"
          items={visibleSubmitted}
          busy={busy}
          showStream
          emptyText={submitted.length === 0 ? t("submittedEmpty") : t("historyFilterEmpty")}
          selectedId={selectedChange}
          agentId={(change) => `submitted-history:${change.id}`}
          onSelect={(change) => void selectSubmitted(change.id)}
          footer={<div className="depot-history-pagination">{historyPage > 0 && <button className="secondary-button" type="button" disabled={busy} onClick={() => { const previous = historyPage - 1; void loadSubmitted(historyCursors[previous], previous, false); }}>{t("depotHistoryPrevious")}</button>}{historyPartial && <button className="load-more" type="button" disabled={busy} onClick={() => { if (!historyCursor) return; const next = historyPage + 1; setHistoryCursors((current) => [...current.slice(0, next), historyCursor]); void loadSubmitted(historyCursor, next, false); }}>{t("loadMoreHistory")}</button>}</div>}
        />
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("changeDetails")}</strong><span className={selectedChange ? "changelist-number" : undefined}>{selectedChange || "—"}</span></div>
        {detailLoading && !changeDetail ? <div className="inspector-content"><div className="submitted-detail-loading" role="status"><span className="folder-loading-indicator" aria-hidden="true" /><strong>{t("loadingChangeDetails")}</strong></div></div> : !changeDetail ? <EmptyState title={t("changeDetails")} body={t("selectSubmitted")} /> : <div className="inspector-content">
          <div><h2 className="changelist-number">CL {changeDetail.id}</h2><ChangelistDescription value={changeDetail.description} fallback={t("noDescription")} /></div>
          <dl className="file-facts"><dt>{t("factUser")}</dt><dd>{changeDetail.user}</dd><dt>{t("workspaceLabel")}</dt><dd>{changeDetail.client}</dd><dt>{t("streamLabel")}</dt><dd>{changeDetail.filesTruncated ? t("largeChangeFullLoadRequired") : sourceStream || t("streamUnknown")}</dd><dt>{t("jobsLabel")}</dt><dd>{changeDetail.jobs.length ? changeDetail.jobs.join(", ") : "—"}</dd><dt>{t("filesLabel")}</dt><dd>{filesFact}</dd></dl>
          {changeDetail.filesTruncated && <div className="large-change-warning" role="status"><div><strong>{t("largeSubmittedChangeTitle")} · {changeDetail.files.length}+</strong><p>{t("largeSubmittedChangeBody")}</p></div>{fullDetailLoading ? <span className="submitted-detail-loading"><span className="folder-loading-indicator" aria-hidden="true" />{t("loadingAllChangeFiles")}</span> : <button data-agent-id="submitted-load-all-files" className="secondary-button" type="button" onClick={() => setConfirmFullDetail(true)}>{t("loadAllChangeFiles")}</button>}</div>}
          <div className="column-heading submitted-files-heading"><strong>{t("filesLabel")}</strong><span>{visibleFiles.length} / {filesFact}</span></div>
          <div className="resource-detail-list">{visibleFiles.map((file) => { const previous = previousRevision(file.revision); return <div className="resource-detail-row" key={`${file.depotPath}-${file.revision}`}><span><strong>{file.depotPath}</strong><small>{file.action}{file.revision ? ` · #${file.revision}` : ""}</small></span><button className="text-button" type="button" onClick={() => previous && void runPreview(() => diffRevisions(connection, file.depotPath, previous, file.revision!), `${file.depotPath}#${previous} ↔ #${file.revision}`)} disabled={!previous || busy}>{t("previewFileDiff")}</button></div>; })}</div>
          {!changeDetail.filesTruncated && visibleFiles.length < changeDetail.files.length && <button className="load-more submitted-files-more" type="button" onClick={() => setVisibleFileLimit((current) => nextSubmittedFileRenderLimit(current, changeDetail.files.length))}>{t("showMoreChangeFiles")}</button>}
          {diff && <div className="history-diff"><h2>{diffTitle}</h2><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} binary={diff.binary} invalidEncoding={diff.invalidEncoding} /></div>}
          <div className="inspector-actions"><button className="primary-button" type="button" disabled={busy || safeSync.phase !== "idle" || !hasRevisionScopes} title={!exactFilesReady ? t("largeChangeFullLoadRequired") : undefined} onClick={() => void showRevisionSyncPreview()}>{t("getThisRevision")}</button><button className="secondary-button" type="button" disabled={busy || !canCherryPick} title={!exactFilesReady ? t("largeChangeFullLoadRequired") : !info.clientStream ? t("cherryPickNeedsStreamWorkspace") : !sourceStream ? t("cherryPickUnknownSource") : sourceStream === info.clientStream ? t("cherryPickSameStream") : undefined} onClick={() => selectedChange && sourceStream && setCherrySource({ change: selectedChange, stream: sourceStream })}>{t("cherryPickChange")}</button><button className="danger-button" type="button" disabled={busy} onClick={() => selectedChange && setUndoSource(selectedChange)}>{t("rollbackChange")}</button></div>
        </div>}
      </aside>
    </div>

    {syncPreviewOpen && <SyncPreviewDialog preview={syncPreview} busy={busy} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} title={t("getThisRevision")} confirmLabel={t("getThisRevision")} onClose={() => setSyncPreviewOpen(false)} onConfirm={() => void getThisRevision()} />}
    <SafeSyncConflictDialog sync={safeSync} />
    {undoSource && <UndoDialog connection={connection} sourceChange={undoSource} previewDisabledReason={largeChange ? t("undoPreviewTooManyFiles") : undefined} onClose={() => setUndoSource(undefined)} onComplete={() => { setUndoSource(undefined); setNotice(t("undoSucceeded")); void loadSubmitted(undefined, 0, true); }} />}
    {cherrySource && info.clientStream && <CherryPickDialog connection={connection} sourceChange={cherrySource.change} sourceStream={cherrySource.stream} targetStream={info.clientStream} onClose={() => setCherrySource(undefined)} onComplete={() => { setCherrySource(undefined); setNotice(t("cherryPickSucceeded")); }} />}
    {confirmFullDetail && changeDetail && <ActionDialog title={t("loadAllChangeFilesTitle")} confirmLabel={t("loadAllChangeFiles")} busy={false} onClose={() => setConfirmFullDetail(false)} onConfirm={() => void loadFullDetail()}><p>{t("loadAllChangeFilesBody")}</p><dl className="dialog-facts"><dt>{t("changelistLabel")}</dt><dd className="changelist-number">CL {changeDetail.id}</dd><dt>{t("filesLabel")}</dt><dd>{changeDetail.files.length}+</dd></dl></ActionDialog>}
  </View>;
}
