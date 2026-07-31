import { useEffect, useMemo, useState } from "react";
import { fixJob, inspectJobForm, listFixes, listJobs, normalizeAppError, saveJob, unfixJob } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, Fix, Job, JobForm } from "../../shared/models";
import { RefreshButton } from "../../shared/RefreshButton";
import { ActionDialog, BoundedListNotice, CompactEmpty, EmptyState, View } from "../../shared/View";
import { SERVER_LIST_LIMIT } from "../../shared/scale";

type JobDialog = { kind: "attach"; change: string } | { kind: "detach"; change: string } | { kind: "form"; form: JobForm };

export function JobsView({ connection, initialSearch }: { connection: ConnectionInput; initialSearch?: string }) {
  const { t } = useLocale();
  const [query, setQuery] = useState(initialSearch || "");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [selectedJob, setSelectedJob] = useState<string>();
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [fixesBusy, setFixesBusy] = useState(false);
  const [fixActionBusy, setFixActionBusy] = useState(false);
  const [dialog, setDialog] = useState<JobDialog>();

  async function load(search = query) {
    setBusy(true);
    setError(undefined);
    try { setJobs(await listJobs(connection, search.trim() || undefined)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(initialSearch || ""); }, [connection, initialSearch]);

  const visibleJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((job) => [job.id, job.status, job.user, job.date, job.description]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [jobs, query]);

  async function inspectJob(job: string) {
    setSelectedJob(job);
    setFixesBusy(true);
    setError(undefined);
    try { setFixes(await listFixes(connection, job)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setFixesBusy(false); }
  }

  async function openForm(job?: string) {
    setFixActionBusy(true);
    setError(undefined);
    try { setDialog({ kind: "form", form: await inspectJobForm(connection, job) }); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setFixActionBusy(false); }
  }

  async function applyDialog() {
    if (!dialog) return;
    if (dialog.kind === "form") {
      setFixActionBusy(true);
      setError(undefined);
      try {
        const saved = await saveJob(connection, dialog.form.job, dialog.form.fields, dialog.form.formToken);
        await load();
        await inspectJob(saved.id);
        setDialog(undefined);
      } catch (reason) { setError(normalizeAppError(reason)); }
      finally { setFixActionBusy(false); }
      return;
    }
    if (!selectedJob) return;
    setFixActionBusy(true);
    setError(undefined);
    try {
      setFixes(dialog.kind === "attach"
        ? await fixJob(connection, dialog.change.trim(), selectedJob)
        : await unfixJob(connection, dialog.change, selectedJob));
      setDialog(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setFixActionBusy(false); }
  }

  return <View
    id="jobs-title"
    title={t("jobsTitle")}
    subtitle={t("jobsBody")}
    busy={busy}
    error={error}
    actions={<><button className="secondary-button" type="button" onClick={() => void openForm()} disabled={busy || fixActionBusy}>{t("createJob")}</button><RefreshButton busy={busy} onClick={() => void load()} /></>}
  >
    <div className="resource-toolbar">
      <label className="field"><span className="field-label">{t("jobsSearch")}</span><input value={query} placeholder={t("jobsSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
      <span className="selection-count">{visibleJobs.length} / {jobs.length} {t("jobsCount")}</span>
    </div>
    {jobs.length >= SERVER_LIST_LIMIT && <BoundedListNotice count={SERVER_LIST_LIMIT} />}
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{t("jobsTitle")}</strong><span>{visibleJobs.length}</span></div>
        {visibleJobs.length ? visibleJobs.map((job) => <SelectableRow selected={selectedJob === job.id} className="resource-row" key={job.id} onClick={() => void inspectJob(job.id)}>
          <ItemRowCopy primary={job.id} secondary={[job.status, job.user, job.date].filter(Boolean).join(" · ") || "—"} />
          <span>{job.description || t("jobNoDescription")}</span>
        </SelectableRow>) : <CompactEmpty text={t("jobsEmpty")} />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("jobFixes")}</strong><span>{selectedJob || "—"}</span></div>
        {!selectedJob ? <EmptyState title={t("jobsTitle")} body={t("jobsBody")} /> : <div className="inspector-content">
          <div><h2>{selectedJob}</h2><button className="secondary-button" type="button" onClick={() => void openForm(selectedJob)} disabled={fixActionBusy}>{t("editJob")}</button><button className="primary-button" type="button" onClick={() => setDialog({ kind: "attach", change: "" })} disabled={fixActionBusy}>{t("attachJob")}</button></div>
          {fixesBusy ? <CompactEmpty text={t("loadingFixes")} /> : fixes.length ? fixes.map((fix) => <div className="resource-detail-row" key={`${fix.job}-${fix.change}`}>
            <span><strong className="changelist-number">CL {fix.change}</strong><small>{[fix.status, fix.user, fix.date].filter(Boolean).join(" · ") || "—"}</small></span>
            <button className="text-button" type="button" onClick={() => setDialog({ kind: "detach", change: fix.change })} disabled={fixActionBusy}>{t("detachJob")}</button>
          </div>) : <CompactEmpty text={t("jobNoFixes")} />}
        </div>}
      </aside>
    </div>

    {dialog?.kind === "attach" && <ActionDialog title={t("attachJob")} confirmLabel={t("attachJob")} busy={fixActionBusy} confirmDisabled={!dialog.change.trim()} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}>
      <p>{t("fixChangePrompt")}</p>
      <label className="field"><span className="field-label">{t("changelistLabel")}</span><input autoFocus value={dialog.change} onChange={(event) => setDialog({ ...dialog, change: event.target.value })} /></label>
    </ActionDialog>}
    {dialog?.kind === "detach" && <ActionDialog danger title={t("detachJob")} confirmLabel={t("detachJob")} busy={fixActionBusy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("unfixConfirm")}</p></ActionDialog>}
    {dialog?.kind === "form" && <ActionDialog title={dialog.form.job ? t("editJob") : t("createJob")} confirmLabel={t("save")} busy={fixActionBusy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("jobFormBody")}</p>{dialog.form.fields.map((field, index) => <label className="field" key={field.name}><span className="field-label">{field.name}</span>{field.value.includes("\n") || field.name === "Description" ? <textarea value={field.value} onChange={(event) => { const fields = [...dialog.form.fields]; fields[index] = { ...field, value: event.target.value }; setDialog({ ...dialog, form: { ...dialog.form, fields } }); }} /> : <input value={field.value} onChange={(event) => { const fields = [...dialog.form.fields]; fields[index] = { ...field, value: event.target.value }; setDialog({ ...dialog, form: { ...dialog.form, fields } }); }} />}</label>)}</ActionDialog>}
  </View>;
}
