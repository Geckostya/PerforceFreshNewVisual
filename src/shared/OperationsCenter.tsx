import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Activity, X } from "lucide-react";
import { cancelOperation, startSync } from "./api";
import { useLocale, type TranslationKey } from "./i18n";
import type { ConnectionInput, OperationCompensationStatus, OperationEvent, OperationItemStatus } from "./models";
import { formatEta, isOperationActive, operationAnnouncementPriority, operationConnectionKey, operationProgress, reduceOperationSnapshots, type OperationSnapshot } from "./operations";
import { ActionDialog } from "./View";

export function operationLabelKey(kind: string): TranslationKey {
  if (kind === "submit") return "operationSubmit";
  if (kind === "reconcile_preview") return "operationReconcilePreview";
  if (kind === "reconcile") return "operationReconcile";
  if (kind === "integrate") return "operationIntegrate";
  return "operationSync";
}

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
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const connectionKey = operationConnectionKey(connection);
  const connectionKeyRef = useRef(connectionKey);
  connectionKeyRef.current = connectionKey;
  const activeCount = items.filter((item) => isOperationActive(item.status)).length;

  useEffect(() => {
    setRetryCandidate(undefined);
    setRetryError(false);
  }, [connectionKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<OperationEvent>("operation-event", (event) => {
      if (!disposed) {
        setItems((current) => reduceOperationSnapshots(current, event.payload, connectionKeyRef.current));
        if (event.payload.kind === "cancel_requested") {
          setCancelling((current) => [...new Set([...current, event.payload.operationId])]);
        }
        if (!isOperationActive(event.payload.kind)) setCancelling((current) => current.filter((id) => id !== event.payload.operationId));
        const priority = operationAnnouncementPriority(event.payload.kind);
        if (priority !== "none") {
          const outcome = event.payload.kind === "started"
            ? t("operationStarted")
            : event.payload.kind === "cancel_requested"
              ? t("operationCancelRequested")
              : operationStatusLabel(event.payload.kind);
          const announcement = `${operationLabel(event.payload.operationKind)}: ${outcome}`;
          if (priority === "assertive") {
            setPoliteAnnouncement("");
            setAssertiveAnnouncement(announcement);
          } else {
            setAssertiveAnnouncement("");
            setPoliteAnnouncement(announcement);
          }
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
    if (!item.retryable || item.operationKind !== "sync" || item.connectionKey !== connectionKey) return;
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
    return t(operationLabelKey(kind));
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

  function itemStatusLabel(status: OperationItemStatus) {
    if (status === "succeeded") return t("operationItemSucceeded");
    if (status === "skipped") return t("operationItemSkipped");
    return t("operationItemFailed");
  }

  function compensationLabel(compensation: OperationCompensationStatus) {
    if (compensation === "succeeded") return t("operationCompensationSucceeded");
    if (compensation === "failed") return t("operationCompensationFailed");
    if (compensation === "unknown") return t("operationCompensationUnknown");
    return t("operationCompensationNotRequired");
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
  return <><div className="sr-only" aria-live="polite" aria-atomic="true">{politeAnnouncement}</div><div className="sr-only" aria-live="assertive" aria-atomic="true">{assertiveAnnouncement}</div><div className={`operations-center${open ? " open" : ""}`} data-focus-pane>
    {open && <section data-agent-id="operations-panel" className="operations-panel" role="region" aria-label={t("operationsCenter")} aria-busy={activeCount > 0 || undefined} tabIndex={-1}>
      <header><div><strong>{t("operationsCenter")}</strong><span>{activeCount} {t("operationsActive")}</span></div><button type="button" onClick={() => setOpen(false)} aria-label={t("close")}><X className="ui-icon" aria-hidden="true" /></button></header>
      <div className="operations-list">
        {retryError && <p className="error-banner" role="alert">{t("operationRetryFailed")}</p>}
        {cancelError && <p className="error-banner" role="alert">{t("operationCancelFailed")}</p>}
        {[...items].reverse().slice(0, 12).map((item) => { const progress = operationProgress(item); const recovery = item.itemResults.find((result) => result.recoveryActionId)?.recoveryActionId; const succeeded = item.itemResults.filter((result) => result.status === "succeeded").length; const failed = item.itemResults.filter((result) => result.status === "failed").length; const skipped = item.itemResults.filter((result) => result.status === "skipped").length; return <article className={`operation-item operation-${item.status}`} key={item.operationId}>
          <div><strong>{operationLabel(item.operationKind)}<span className="operation-state">{cancelling.includes(item.operationId) && isOperationActive(item.status) ? t("operationCancelling") : operationStatusLabel(item.status)}</span></strong><small className="operation-summary">{operationSummary(item)}</small>{item.currentPath && <small className="operation-current-path" title={item.currentPath}>{item.currentPath}</small>}{progress.ratio !== undefined && <span className="operation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}><span style={{ width: `${progress.ratio * 100}%` }} /></span>}{item.message && <span className="operation-message">{item.message}</span>}{item.itemResults.length > 0 && <><small className="operation-summary">{t("operationSucceeded")}: {succeeded} · {t("operationFailedItems")}: {failed} · {t("operationSkipped")}: {skipped}</small><details className="operation-item-outcomes"><summary>{t("operationItemOutcomes")}</summary><ul>{item.itemResults.map((result) => <li key={result.itemId}><strong>{result.path || result.itemId}</strong><span>{itemStatusLabel(result.status)} · {t("operationCompensation")}: {compensationLabel(result.compensation)}</span>{result.reason && <small>{result.reason}</small>}</li>)}</ul></details></>}{item.readBack && item.readBack.status !== "succeeded" && item.readBack.status !== "not_required" && <small className="operation-message">{t("operationReadBack")}: {item.readBack.status}</small>}</div>
          {isOperationActive(item.status) && item.cancellable && <button type="button" className="secondary-button" onClick={() => void cancel(item)} disabled={cancelling.includes(item.operationId)}>{cancelling.includes(item.operationId) ? t("operationCancelling") : t("cancelOperation")}</button>}
          {(item.status === "failed" || item.status === "cancelled" || item.status === "partial") && item.retryable && item.operationKind === "sync" && item.connectionKey === connectionKey && <button type="button" className="secondary-button" onClick={() => setRetryCandidate(item)}>{t("retryOperation")}</button>}
          {recovery && item.connectionKey === connectionKey && <button type="button" className="secondary-button" onClick={() => { onRecover(recovery); setOpen(false); }}>{t("operationRecoveryAction")}</button>}
        </article>; })}
      </div>
    </section>}
    <button data-agent-id="operations-toggle" data-pane-entry className={`operations-toggle${activeCount > 0 ? " active" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={t("operationsCenter")}>
      <Activity className="ui-icon" aria-hidden="true" />{activeCount > 0 ? `${activeCount} ${t("operationsActive")}` : t("operationsCenter")}
    </button>
  </div>{retryCandidate && <ActionDialog title={t("retryOperation")} confirmLabel={t("retryOperation")} busy={retryBusy} onClose={() => setRetryCandidate(undefined)} onConfirm={() => void retry(retryCandidate)}><p>{t("operationRetryConfirm")}</p>{retryCandidate.scope && <strong>{retryCandidate.scope}</strong>}</ActionDialog>}</>;
}
