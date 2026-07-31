import { useState } from "react";
import { normalizeAppError, resolveSpecialized } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, ResolveApplyResult, ResolveConflictKind, ResolveMode, ResolvePreviewItem } from "../../shared/models";
import { Modal } from "../../shared/View";

export function specializedResolveModes(kind: ResolveConflictKind): ResolveMode[] {
  switch (kind) {
    case "binary": return ["yours", "theirs"];
    case "move_name":
    case "filetype_attribute": return ["yours", "theirs", "autoMerge"];
    case "stream_spec": return ["yours", "theirs", "autoSafe", "autoMerge"];
    default: return [];
  }
}

export function resolveOutcome(result: ResolveApplyResult): "resolved" | "partial" | "unknown" {
  if (result.items.some((item) => item.state === "unknown")) return "unknown";
  if (result.items.some((item) => item.state !== "resolved")) return "partial";
  return "resolved";
}

export function SpecializedResolveDialog({ connection, items, onClose, onReadBack, onError }: {
  connection: ConnectionInput;
  items: ResolvePreviewItem[];
  onClose: () => void;
  onReadBack: () => void;
  onError: (error: AppError) => void;
}) {
  const { t } = useLocale();
  const kind = items[0]?.conflictKind || "unknown";
  const modes = specializedResolveModes(kind);
  const [mode, setMode] = useState<ResolveMode>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolveApplyResult>();
  const [error, setError] = useState<AppError>();

  async function apply() {
    if (!mode || !items.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await resolveSpecialized(connection, items, mode);
      setResult(next);
      onReadBack();
    } catch (reason) {
      const next = normalizeAppError(reason);
      setError(next);
      onError(next);
    } finally {
      setBusy(false);
    }
  }

  const outcome = result && resolveOutcome(result);
  return <Modal title={`${t("resolveSpecializedTitle")} · ${t(`resolveKind_${kind}` as never)}`} wide busy={busy} onClose={onClose}>
    <div className="dialog-body">
      <p>{t("resolveSpecializedBody")}</p>
      <div className="resource-detail-list">
        {items.map((item) => <div className="resource-detail-row" key={`${item.depotPath}-${item.previewToken}`}><span><strong>{item.depotPath}</strong><small>{item.action}{item.detail ? ` · ${item.detail}` : ""}</small></span></div>)}
      </div>
      {!result && <div className="specialized-resolve-options" role="group" aria-label={t("resolveSpecializedChoices")}>
        {modes.map((candidate) => <button key={candidate} type="button" className={`specialized-resolve-choice${mode === candidate ? " selected" : ""}`} aria-pressed={mode === candidate} onClick={() => setMode(candidate)}>
          <strong>{t(`resolveSpecialized_${candidate}` as never)}</strong>
          <span>{candidate === "theirs" ? t("resolveSpecializedTheirsWarning") : t("resolveSpecializedChoiceBody")}</span>
        </button>)}
      </div>}
      {error && <div className="inline-error" role="alert"><strong>{error.message}</strong>{error.hints.length > 0 && <small>{error.hints.join(" · ")}</small>}</div>}
      {result && <div className={`specialized-resolve-outcome ${outcome}`} role="status">
        <strong>{t(`resolveSpecializedOutcome_${outcome}` as never)}</strong>
        {result.items.map((item) => <div className="resource-detail-row" key={`${item.depotPath}-${item.state}`}><span>{item.depotPath}</span><small>{item.state}{item.reason ? ` · ${item.reason}` : ""}</small></div>)}
      </div>}
    </div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button>
      {result ? <button className="primary-button" type="button" onClick={onClose} disabled={busy}>{t("resolveSpecializedDone")}</button>
        : <button className="primary-button" type="button" onClick={() => void apply()} disabled={busy || !mode}>{t("resolveSpecializedApply")}</button>}
    </div>
  </Modal>;
}
