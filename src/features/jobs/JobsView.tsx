import { useEffect, useMemo, useState } from "react";
import { fixJob, listFixes, listJobs, normalizeAppError, unfixJob } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, Fix, Job } from "../../shared/models";
import { ActionDialog, CompactEmpty, EmptyState, View } from "../../shared/View";

type JobDialog = { kind: "attach"; change: string } | { kind: "detach"; change: string };

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

  async function applyDialog() {
    if (!selectedJob || !dialog) return;
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
    eyebrow={t("jobsEyebrow")}
    title={t("jobsTitle")}
    subtitle={t("jobsBody")}
    error={error}
    actions={<button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? t("loadingJobs") : t("refresh")}</button>}
  >
    <div className="resource-toolbar">
      <label className="field"><span className="field-label">{t("jobsSearch")}</span><input value={query} placeholder={t("jobsSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
      <span className="selection-count">{visibleJobs.length} / {jobs.length} {t("jobsCount")}</span>
    </div>
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{t("jobsTitle")}</strong><span>{visibleJobs.length}</span></div>
        {visibleJobs.length ? visibleJobs.map((job) => <button className={`resource-row${selectedJob === job.id ? " selected" : ""}`} type="button" key={job.id} onClick={() => void inspectJob(job.id)}>
          <span><strong>{job.id}</strong><small>{[job.status, job.user, job.date].filter(Boolean).join(" · ") || "—"}</small></span>
          <span>{job.description || t("jobNoDescription")}</span>
        </button>) : <CompactEmpty text={t("jobsEmpty")} />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("jobFixes")}</strong><span>{selectedJob || "—"}</span></div>
        {!selectedJob ? <EmptyState title={t("jobsTitle")} body={t("jobsBody")} /> : <div className="inspector-content">
          <div><h2>{selectedJob}</h2><button className="primary-button" type="button" onClick={() => setDialog({ kind: "attach", change: "" })} disabled={fixActionBusy}>{t("attachJob")}</button></div>
          {fixesBusy ? <CompactEmpty text={t("loadingFixes")} /> : fixes.length ? fixes.map((fix) => <div className="resource-detail-row" key={`${fix.job}-${fix.change}`}>
            <span><strong>CL {fix.change}</strong><small>{[fix.status, fix.user, fix.date].filter(Boolean).join(" · ") || "—"}</small></span>
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
  </View>;
}
