import { useLocale, type TranslationKey } from "../../shared/i18n";
import { RefreshCw } from "lucide-react";
import type { SubmitMode, SubmitPreflightIssue, SubmitPreflightSummary } from "../../shared/models";
import { Modal } from "../../shared/View";
import { formatSubmitJob, groupChanges, hasUnresolvedSubmitIssue } from "./changes";

export function SubmitDialog({ group, shelfCount, description, setDescription, busy, preflightIssues, preflightSummary, preflightReady, onClose, onSubmit }: {
  group: ReturnType<typeof groupChanges>[number];
  shelfCount: number;
  description: string;
  setDescription: (value: string) => void;
  busy: boolean;
  preflightIssues: SubmitPreflightIssue[];
  preflightSummary: SubmitPreflightSummary;
  preflightReady: boolean;
  onClose: () => void;
  onSubmit: (mode: SubmitMode) => void;
}) {
  const { t } = useLocale();
  const both = group.files.length > 0 && group.isShelved;
  const defaultInvalid = group.isDefault && !description.trim();
  const unresolved = hasUnresolvedSubmitIssue(preflightIssues);
  const simpleMode: SubmitMode = group.isShelved && group.files.length === 0 ? "shelf" : "local";
  return <Modal title={both ? t("chooseSubmitVersion") : simpleMode === "shelf" ? t("submitShelfTitle") : t("submitTitle")} busy={busy} onClose={onClose} wide>
    <div className="dialog-body">
      <p>{both ? t("submitConflictExplanation") : t("submitWarning")}</p>
      <dl className="dialog-facts"><dt>{t("changelistLabel")}</dt><dd>{group.isDefault ? t("defaultChangelist") : `CL ${group.id}`}</dd><dt>{t("openedFilesLabel")}</dt><dd>{group.files.length}</dd><dt>{t("shelvedFilesLabel")}</dt><dd>{shelfCount}</dd></dl>
      {group.isDefault && <DescriptionField value={description} onChange={setDescription} />}
      {!group.isDefault && <p className="dialog-description">{group.description}</p>}
      {preflightReady && <dl className="dialog-facts"><dt>{t("submitTotalSize")}</dt><dd>{preflightSummary.totalSize.toLocaleString()} B</dd><dt>{t("submitJobs")}</dt><dd>{preflightSummary.jobs.length ? preflightSummary.jobs.join(", ") : "—"}</dd><dt>{t("submitJobStatus")}</dt><dd>{preflightSummary.jobDetails?.length ? preflightSummary.jobDetails.map(formatSubmitJob).join(", ") : "—"}</dd><dt>{t("submitStream")}</dt><dd>{preflightSummary.stream || "—"}</dd></dl>}
      {preflightReady && preflightSummary.warnings?.length ? <div className="submit-preflight-warning" role="status"><strong>{t("submitServerWarnings")}</strong><p>{t("submitServerWarningsBody")}</p>{preflightSummary.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div> : null}
      {preflightIssues.length > 0 && <div className="submit-preflight-warning" role="alert"><strong>{t("submitPreflightFound")}</strong><p>{unresolved ? t("submitResolveRequiredBody") : t("submitPreflightContinue")}</p>{preflightIssues.map((issue) => <div className="submit-preflight-issue" key={`${issue.depotPath}-${issue.kind}`}><strong>{preflightIssueLabel(issue.kind, t)}</strong><span>{issue.depotPath}</span><small>{issue.detail}</small></div>)}</div>}
      {both ? <div className="submit-options">
        <button type="button" disabled={busy} onClick={() => onSubmit("shelf")}><strong>{t("submitShelfOption")}</strong><span>{t("submitShelfOptionBody")}</span></button>
        <button type="button" className="danger-option" disabled={busy || unresolved} onClick={() => onSubmit("local_delete_shelf")}><strong>{t("submitLocalDeleteOption")}</strong><span>{unresolved ? t("submitResolveRequired") : t("submitLocalDeleteOptionBody")}</span></button>
        <button type="button" disabled={busy || unresolved} onClick={() => onSubmit("local_update_shelf")}><strong>{t("submitLocalUpdateOption")}</strong><span>{unresolved ? t("submitResolveRequired") : t("submitLocalUpdateOptionBody")}</span></button>
      </div> : <div className="dialog-actions inline"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className="primary-button" type="button" onClick={() => onSubmit(simpleMode)} disabled={busy || defaultInvalid || unresolved}>{busy ? t("submitting") : unresolved ? t("submitResolveRequired") : preflightReady ? t("submitNow") : t("reviewBeforeSubmit")}</button></div>}
    </div>
  </Modal>;
}

function preflightIssueLabel(kind: string, t: (key: TranslationKey) => string): string {
  const labels: Record<string, TranslationKey> = {
    missing: "submitIssueMissing",
    unresolved: "submitIssueUnresolved",
    locked_or_open_elsewhere: "submitIssueLocked",
    out_of_date: "submitIssueOutOfDate",
  };
  const key = labels[kind];
  return key ? t(key) : kind;
}

export function DescriptionField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLocale();
  return <label className="field"><span className="field-label">{t("descriptionLabel")}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={10_000} autoFocus /></label>;
}

export function Fact({ label, value }: { label: string; value: string }) {
  return <dl className="dialog-facts"><dt>{label}</dt><dd>{value}</dd></dl>;
}

export function FileSelectionSummary({ paths }: { paths: string[] }) {
  const { t } = useLocale();
  return <div className="file-selection-summary"><strong>{paths.length} {t("filesSelected")}</strong>{paths.slice(0, 5).map((path) => <span key={path}>{path}</span>)}{paths.length > 5 && <span>+{paths.length - 5}</span>}</div>;
}

export function CheckField({ checked, onChange, label, body }: { checked: boolean; onChange: (checked: boolean) => void; label: string; body: string }) {
  return <label className="check-field"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{body}</small></span></label>;
}

export function RefreshIcon() {
  return <RefreshCw className="ui-icon" aria-hidden="true" />;
}

export function fileName(path: string) {
  return path.split("/").at(-1) || path;
}

export function parentPath(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1).join("/") || path;
}

export function formatTime(value: string, language: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(seconds * 1000));
}
