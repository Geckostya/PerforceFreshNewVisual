import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Activity, X } from "lucide-react";
import { cancelOperation, startSync } from "./api";
import { useLocale } from "./i18n";
import type { ConnectionInput, OperationEvent } from "./models";
import { formatEta, isOperationActive, operationProgress, reduceOperationSnapshots, type OperationSnapshot } from "./operations";
import { ActionDialog } from "./View";

export function OperationsCenter({ connection, onRecover }: {
  connection: ConnectionInput;
  onRecover: (actionId: string) => void;
}) {
  const { t } = useLocale();
  const [items, setItems] = useState<OperationSnapshot[]>([]);
  const [open, setOpen] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  const [cancelling, setCancelling] = useState<string[]>([]);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryCandidate, setRetryCandidate] = useState<OperationSnapshot>();
  const [announcement, setAnnouncement] = useState("");
  const activeCount = items.filter((item) => isOperationActive(item.status)).length;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<OperationEvent>("operation-event", (event) => {
      if (!disposed) {
        setItems((current) => reduceOperationSnapshots(current, event.payload));
        if (event.payload.kind === "cancel_requested") {
          setCancelling((current) => [...new Set([...current, event.payload.operationId])]);
        }
        if (!isOperationActive(event.payload.kind)) setCancelling((current) => current.filter((id) => id !== event.payload.operationId));
        if (event.payload.kind !== "progress") {
          const outcome = event.payload.kind === "started"
            ? t("operationStarted")
            : event.payload.kind === "cancel_requested"
              ? t("operationCancelRequested")
              : operationStatusLabel(event.payload.kind);
          setAnnouncement(`${operationLabel(event.payload.operationKind)}: ${outcome}`);
        }
        setOpen(true);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  async function cancel(item: OperationSnapshot) {
    setCancelError(false);
    setCancelling((current) => [...new Set([...current, item.operationId])]);
    try {
      if (!await cancelOperation(item.operationId)) throw new Error("cancel rejected");
    } catch {
      setCancelling((current) => current.filter((id) => id !== item.operationId));
      setCancelError(true);
    }
  }

  async function retry(item: OperationSnapshot) {
    if (!item.retryable || item.operationKind !== "sync") return;
    setRetryBusy(true);
    setRetryError(false);
    try {
      await startSync(connection, item.scopes?.length ? item.scopes : [item.scope || "//..."]);
      setRetryCandidate(undefined);
    } catch {
      setRetryError(true);
    } finally { setRetryBusy(false); }
  }

  function operationLabel(kind: string) {
    if (kind === "submit") return t("operationSubmit");
    if (kind === "reconcile_preview") return t("operationReconcilePreview");
    if (kind === "reconcile") return t("operationReconcile");
    return t("operationSync");
  }

  function operationPhase(item: OperationSnapshot) {
    if (item.phase === "scan") return t("reconcilePhaseScan");
    if (item.phase === "validate") return t("reconcilePhaseValidate");
    if (item.phase === "apply") return t("reconcilePhaseApply");
    return undefined;
  }

  function operationStatusLabel(status: OperationEvent["kind"]) {
    if (status === "completed") return t("operationCompleted");
    if (status === "cancelled") return t("operationCancelled");
    if (status === "cancel_requested") return t("operationCancelling");
    if (status === "partial") return t("operationPartial");
    if (status === "unknown") return t("operationUnknown");
    if (status === "failed") return t("operationFailed");
    return t("operationRunning");
  }

  function operationSummary(item: OperationSnapshot) {
    const progress = operationProgress(item);
    const count = item.operationKind === "reconcile_preview"
      ? `${item.processed} ${t("reconcileCandidatesFound")}`
      : item.operationKind === "reconcile" && item.phase === "validate"
        ? item.totalFiles === undefined ? `${item.processed} ${t("reconcileFilesChecked")}` : `${item.processed} / ${item.totalFiles} ${t("reconcileFilesChecked")}`
        : item.operationKind === "reconcile" && item.phase === "apply"
          ? item.totalFiles === undefined ? `${item.processed} ${t("reconcileFilesOpened")}` : `${item.processed} / ${item.totalFiles} ${t("reconcileFilesOpened")}`
          : item.totalFiles ? `${item.processed} / ${item.totalFiles}` : `${item.processed} ${t("operationFilesProcessed")}`;
    return [
      operationPhase(item),
      count,
      progress.remaining !== undefined ? `${progress.remaining} ${t("operationFilesRemaining")}` : undefined,
      progress.etaSeconds !== undefined ? formatEta(progress.etaSeconds) : undefined,
    ].filter(Boolean).join(" · ");
  }

  if (items.length === 0) return null;
  return <><div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div><div className={`operations-center${open ? " open" : ""}`}>
    {open && <section className="operations-panel" aria-label={t("operationsCenter")}>
      <header><div><strong>{t("operationsCenter")}</strong><span>{activeCount} {t("operationsActive")}</span></div><button type="button" onClick={() => setOpen(false)} aria-label={t("close")}><X className="ui-icon" aria-hidden="true" /></button></header>
      <div className="operations-list">
        {retryError && <p className="error-banner" role="alert">{t("operationRetryFailed")}</p>}
        {cancelError && <p className="error-banner" role="alert">{t("operationCancelFailed")}</p>}
        {[...items].reverse().slice(0, 12).map((item) => { const progress = operationProgress(item); const recovery = item.itemResults.find((result) => result.recoveryActionId)?.recoveryActionId; const succeeded = item.itemResults.filter((result) => result.status === "succeeded").length; const failed = item.itemResults.filter((result) => result.status === "failed").length; const skipped = item.itemResults.filter((result) => result.status === "skipped").length; return <article className={`operation-item operation-${item.status}`} key={item.operationId}>
          <div><strong>{operationLabel(item.operationKind)}<span className="operation-state">{cancelling.includes(item.operationId) && isOperationActive(item.status) ? t("operationCancelling") : operationStatusLabel(item.status)}</span></strong><small className="operation-summary">{operationSummary(item)}</small>{item.currentPath && <small className="operation-current-path" title={item.currentPath}>{item.currentPath}</small>}{progress.ratio !== undefined && <span className="operation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}><span style={{ width: `${progress.ratio * 100}%` }} /></span>}{item.message && <span className="operation-message">{item.message}</span>}{item.itemResults.length > 0 && <small className="operation-summary">{t("operationSucceeded")}: {succeeded} · {t("operationFailedItems")}: {failed} · {t("operationSkipped")}: {skipped}</small>}{item.readBack && item.readBack.status !== "succeeded" && item.readBack.status !== "not_required" && <small className="operation-message">{t("operationReadBack")}: {item.readBack.status}</small>}</div>
          {isOperationActive(item.status) && <button type="button" className="secondary-button" onClick={() => void cancel(item)} disabled={cancelling.includes(item.operationId)}>{cancelling.includes(item.operationId) ? t("operationCancelling") : t("cancelOperation")}</button>}
          {(item.status === "failed" || item.status === "cancelled" || item.status === "partial") && item.retryable && item.operationKind === "sync" && <button type="button" className="secondary-button" onClick={() => setRetryCandidate(item)}>{t("retryOperation")}</button>}
          {recovery && <button type="button" className="secondary-button" onClick={() => { onRecover(recovery); setOpen(false); }}>{t("operationRecoveryAction")}</button>}
        </article>; })}
      </div>
    </section>}
    <button className={`operations-toggle${activeCount > 0 ? " active" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={t("operationsCenter")}>
      <Activity className="ui-icon" aria-hidden="true" />{activeCount > 0 ? `${activeCount} ${t("operationsActive")}` : t("operationsCenter")}
    </button>
  </div>{retryCandidate && <ActionDialog title={t("retryOperation")} confirmLabel={t("retryOperation")} busy={retryBusy} onClose={() => setRetryCandidate(undefined)} onConfirm={() => void retry(retryCandidate)}><p>{t("operationRetryConfirm")}</p>{retryCandidate.scope && <strong>{retryCandidate.scope}</strong>}</ActionDialog>}</>;
}
