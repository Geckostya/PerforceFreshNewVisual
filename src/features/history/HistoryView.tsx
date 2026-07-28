import { useMemo, useState } from "react";
import { annotateFile, describeChange, diffRevisionWorkspace, diffRevisions, fileHistory, listSubmittedChanges, normalizeAppError, printRevision, saveRevision } from "../../shared/api";
import { ChangelistHistory } from "../../shared/ChangelistHistory";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { DiffViewer } from "../../shared/DiffViewer";
import { useLocale } from "../../shared/i18n";
import { SelectableSurface } from "../../shared/ItemList";
import type { AnnotationLine, AppError, ConnectionInput, DiffMode, FileDiff, FileRevision, PendingChange, SubmittedChangeDetail } from "../../shared/models";
import { PathActions } from "../../shared/PathActions";
import { ActionDialog, CompactEmpty, EmptyState, View } from "../../shared/View";
import { filterSubmittedChanges, previousRevision } from "./history";
import { UndoDialog } from "./UndoDialog";

export function HistoryView({ connection }: { connection: ConnectionInput }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<"file" | "changes">("file");
  const [path, setPath] = useState("");
  const [revisions, setRevisions] = useState<FileRevision[]>([]);
  const [fileHistoryLimit, setFileHistoryLimit] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<FileDiff>();
  const [diffTitle, setDiffTitle] = useState("");
  const [diffMode, setDiffMode] = useState<DiffMode>("default");
  const [annotations, setAnnotations] = useState<AnnotationLine[]>([]);
  const [submitted, setSubmitted] = useState<PendingChange[]>([]);
  const [selectedChange, setSelectedChange] = useState<string>();
  const [changeDetail, setChangeDetail] = useState<SubmittedChangeDetail>();
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyUser, setHistoryUser] = useState("");
  const [historyClient, setHistoryClient] = useState("");
  const [historyJob, setHistoryJob] = useState("");
  const [historyLimit, setHistoryLimit] = useState(100);
  const [undoSource, setUndoSource] = useState<string>();
  const [outputPath, setOutputPath] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");

  async function loadHistory(limit = 100, reset = true) {
    if (!path.trim()) return;
    setBusy(true);
    setError(undefined);
    setDiff(undefined);
    try {
      setRevisions(await fileHistory(connection, path.trim(), limit));
      setFileHistoryLimit(limit);
      if (reset) setSelected([]);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function loadSubmitted(limit = 100, reset = true) {
    if (!path.trim()) return;
    setBusy(true);
    setError(undefined);
    setChangeDetail(undefined);
    setDiff(undefined);
    try {
      setSubmitted(await listSubmittedChanges(connection, path.trim(), limit, historyJob));
      setHistoryLimit(limit);
      if (reset) setSelectedChange(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function runPreview(task: () => Promise<FileDiff>, title: string) {
    setBusy(true);
    setError(undefined);
    try { setDiff(await task()); setDiffTitle(title); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function loadAnnotations() {
    if (!path.trim()) return;
    setBusy(true);
    setError(undefined);
    try { setAnnotations(await annotateFile(connection, path.trim())); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function exportRevision() {
    if (!selectedRevision || !outputPath?.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveRevision(connection, path.trim(), selectedRevision.revision, outputPath.trim());
      setNotice(t("revisionSaved"));
      setOutputPath(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function selectSubmitted(change: string) {
    setSelectedChange(change);
    setBusy(true);
    setError(undefined);
    setDiff(undefined);
    try { setChangeDetail(await describeChange(connection, change)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  function toggleRevision(revision: string) {
    setSelected((current) => current.includes(revision)
      ? current.filter((item) => item !== revision)
      : current.length < 2 ? [...current, revision] : [current[1], revision]);
    setDiff(undefined);
  }

  const selectedRevision = selected.length === 1 ? revisions.find((item) => item.revision === selected[0]) : undefined;
  const historyUsers = useMemo(() => [...new Set(submitted.map((change) => change.user))].sort(), [submitted]);
  const historyClients = useMemo(() => [...new Set(submitted.map((change) => change.client))].sort(), [submitted]);
  const visibleSubmitted = filterSubmittedChanges(submitted, historyQuery, historyUser, historyClient);

  return <View
    id="history-title"
    title={mode === "file" ? t("fileHistory") : t("submittedHistory")}
    subtitle={mode === "file" ? t("fileHistoryBody") : t("submittedHistoryBody")}
    error={error}
    notice={notice}
    onDismissNotice={() => setNotice("")}
  >
    <div className="history-mode" role="tablist">
      <button type="button" role="tab" aria-selected={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => { setMode("file"); setDiff(undefined); }}>{t("fileHistory")}</button>
      <button type="button" role="tab" aria-selected={mode === "changes"} className={mode === "changes" ? "active" : ""} onClick={() => { setMode("changes"); setDiff(undefined); }}>{t("submittedHistory")}</button>
    </div>
    <div className="resource-toolbar">
      <label className="field"><span className="field-label">{mode === "file" ? t("depotFilePath") : t("scopePath")}</span><input value={path} placeholder={mode === "file" ? "//depot/project/file.txt" : "//depot/project/..."} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void (mode === "file" ? loadHistory() : loadSubmitted()); }} /></label>
      <button className="primary-button" type="button" onClick={() => void (mode === "file" ? loadHistory() : loadSubmitted())} disabled={busy || !path.trim()}>{busy ? t("loadingHistory") : t("loadHistory")}</button>
      {mode === "file" && path.trim() && <PathActions depotPath={path.trim()} />}
    </div>
    {mode === "changes" && <div className="resource-toolbar history-filters">
      <label className="field"><span className="field-label">{t("historyFilterSearch")}</span><input value={historyQuery} placeholder={t("historyFilterPlaceholder")} onChange={(event) => setHistoryQuery(event.target.value)} /></label>
      <label className="field"><span className="field-label">{t("factUser")}</span><select value={historyUser} onChange={(event) => setHistoryUser(event.target.value)}><option value="">{t("historyFilterAll")}</option>{historyUsers.map((user) => <option key={user} value={user}>{user}</option>)}</select></label>
      <label className="field"><span className="field-label">{t("workspaceLabel")}</span><select value={historyClient} onChange={(event) => setHistoryClient(event.target.value)}><option value="">{t("historyFilterAll")}</option>{historyClients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
      <label className="field"><span className="field-label">{t("historyJob")}</span><input value={historyJob} placeholder={t("historyJobPlaceholder")} onChange={(event) => setHistoryJob(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadSubmitted(); }} /></label>
    </div>}
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{mode === "file" ? t("fileHistory") : t("submittedHistory")}</strong><span>{mode === "file" ? revisions.length : visibleSubmitted.length}</span></div>
        {mode === "file" ? <>
          {revisions.length ? revisions.map((revision) => <SelectableSurface selected={selected.includes(revision.revision)} className="resource-row history-row" key={revision.revision} onClick={() => toggleRevision(revision.revision)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleRevision(revision.revision); } }}><span><strong>#{revision.revision} · {revision.action || t("unknownAction")}</strong><small>{revision.user} · <span className="changelist-number">CL {revision.change || "—"}</span>{revision.time ? ` · ${revision.time}` : ""}</small></span><span><ChangelistDescription value={revision.description} compact />{revision.labels.length ? ` · ${revision.labels.join(", ")}` : ""}</span></SelectableSurface>) : <CompactEmpty text={t("historyEmpty")} />}
          {revisions.length === fileHistoryLimit && fileHistoryLimit < 5000 && <button className="load-more" type="button" onClick={() => void loadHistory(fileHistoryLimit + 100, false)} disabled={busy}>{t("loadMoreHistory")}</button>}
        </> : <ChangelistHistory
          className="embedded history-submitted-list"
          items={visibleSubmitted}
          busy={busy}
          emptyText={submitted.length === 0 ? t("submittedEmpty") : t("historyFilterEmpty")}
          selectedId={selectedChange}
          agentId={(change) => `submitted-history:${change.id}`}
          onSelect={(change) => void selectSubmitted(change.id)}
          footer={submitted.length === historyLimit && historyLimit < 5000 ? <button className="load-more" type="button" onClick={() => void loadSubmitted(historyLimit + 100, false)} disabled={busy}>{t("loadMoreHistory")}</button> : undefined}
        />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{mode === "file" ? t("revisionActions") : t("changeDetails")}</strong><span className={mode === "changes" && selectedChange ? "changelist-number" : undefined}>{mode === "file" ? selected.length : selectedChange || "—"}</span></div>
        {mode === "file" ? <div className="inspector-content">
          {selected.length === 0 ? <EmptyState title={t("selectRevision")} body={t("previewSelectedRevision")} /> : <>
            <p>{selected.length === 2 ? t("compareSelectedRevisions") : t("previewSelectedRevision")}</p>
            <label className="field"><span className="field-label">{t("diffMode")}</span><select value={diffMode} onChange={(event) => setDiffMode(event.target.value as DiffMode)}><option value="default">{t("diffModeDefault")}</option><option value="ignoreWhitespaceChanges">{t("diffModeWhitespaceChanges")}</option><option value="ignoreWhitespace">{t("diffModeWhitespace")}</option><option value="ignoreLineEndings">{t("diffModeLineEndings")}</option></select></label>
            <div className="inspector-actions"><button className="primary-button" type="button" disabled={!selectedRevision || busy} onClick={() => selectedRevision && void runPreview(() => printRevision(connection, path.trim(), selectedRevision.revision), `${path.trim()}#${selectedRevision.revision}`)}>{t("previewRevision")}</button><button className="secondary-button" type="button" disabled={!selectedRevision || busy} onClick={() => setOutputPath("")}>{t("saveRevision")}</button><button className="secondary-button" type="button" disabled={selected.length !== 2 || busy} onClick={() => void runPreview(() => diffRevisions(connection, path.trim(), selected[0], selected[1], diffMode), `${path.trim()}#${selected[0]} ↔ #${selected[1]}`)}>{t("compareRevisions")}</button><button className="secondary-button" type="button" disabled={!selectedRevision || !previousRevision(selectedRevision.revision) || busy} onClick={() => selectedRevision && void runPreview(() => diffRevisions(connection, path.trim(), previousRevision(selectedRevision.revision)!, selectedRevision.revision, diffMode), path.trim())}>{t("comparePreviousRevision")}</button><button className="secondary-button" type="button" disabled={!selectedRevision || busy} onClick={() => selectedRevision && void runPreview(() => diffRevisionWorkspace(connection, path.trim(), selectedRevision.revision, diffMode), `${path.trim()}#${selectedRevision.revision} ↔ workspace`)}>{t("compareWorkspace")}</button><button className="secondary-button" type="button" disabled={!path.trim() || busy} onClick={() => void loadAnnotations()}>{t("annotateFile")}</button></div>
          </>}
          {diff && <div className="history-diff"><h2>{diffTitle}</h2><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} /></div>}
          {annotations.length > 0 && <div className="history-diff annotation-view"><h2>{t("annotationTitle")}</h2>{annotations.map((line, index) => <div className="preview-row" key={`${line.change}-${index}`}><span className="changelist-number">{line.change}</span><small>{[line.user, line.date].filter(Boolean).join(" · ")}</small><code>{line.text || " "}</code></div>)}</div>}
        </div> : !changeDetail ? <EmptyState title={t("changeDetails")} body={t("selectSubmitted")} /> : <div className="inspector-content">
          <div><h2 className="changelist-number">CL {changeDetail.id}</h2><ChangelistDescription value={changeDetail.description} fallback={t("noDescription")} /></div>
          <dl className="file-facts"><dt>{t("factUser")}</dt><dd>{changeDetail.user}</dd><dt>{t("workspaceLabel")}</dt><dd>{changeDetail.client}</dd><dt>{t("jobsLabel")}</dt><dd>{changeDetail.jobs.length ? changeDetail.jobs.join(", ") : "—"}</dd><dt>{t("filesLabel")}</dt><dd>{changeDetail.files.length}</dd></dl>
          <div className="resource-detail-list">{changeDetail.files.map((file) => { const previous = previousRevision(file.revision); return <div className="resource-detail-row" key={`${file.depotPath}-${file.revision}`}><span><strong>{file.depotPath}</strong><small>{file.action}{file.revision ? ` · #${file.revision}` : ""}</small></span><button className="text-button" type="button" onClick={() => previous && void runPreview(() => diffRevisions(connection, file.depotPath, previous, file.revision!, diffMode), `${file.depotPath}#${previous} ↔ #${file.revision}`)} disabled={!previous || busy}>{t("previewFileDiff")}</button></div>; })}</div>
          {diff && <div className="history-diff"><h2>{diffTitle}</h2><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} /></div>}
          <button className="danger-button" type="button" onClick={() => selectedChange && setUndoSource(selectedChange)}>{t("rollbackChange")}</button>
        </div>}
      </aside>
    </div>

    {outputPath !== undefined && selectedRevision && <ActionDialog title={t("saveRevision")} confirmLabel={t("saveRevision")} busy={busy} confirmDisabled={!outputPath.trim()} onClose={() => setOutputPath(undefined)} onConfirm={() => void exportRevision()}><p>{path.trim()}#{selectedRevision.revision}</p><label className="field"><span className="field-label">{t("saveRevisionPathPrompt")}</span><input autoFocus value={outputPath} onChange={(event) => setOutputPath(event.target.value)} /></label></ActionDialog>}
    {undoSource && <UndoDialog connection={connection} sourceChange={undoSource} onClose={() => setUndoSource(undefined)} onComplete={() => { setUndoSource(undefined); setNotice(t("undoSucceeded")); void loadSubmitted(historyLimit); }} />}
  </View>;
}
