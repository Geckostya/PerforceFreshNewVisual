import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cancelOperation, startSync } from "./api";
import { useLocale } from "./i18n";
import type { ConnectionInput, OperationEvent } from "./models";
import { formatEta, isOperationActive, operationProgress, reduceOperationSnapshots, type OperationSnapshot } from "./operations";
import { ActionDialog } from "./View";

export function OperationsCenter({ connection }: { connection: ConnectionInput }) {
  const { t } = useLocale();
  const [items, setItems] = useState<OperationSnapshot[]>([]);
  const [open, setOpen] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  const [cancelling, setCancelling] = useState<string[]>([]);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryCandidate, setRetryCandidate] = useState<OperationSnapshot>();
  const activeCount = items.filter((item) => isOperationActive(item.status)).length;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<OperationEvent>("operation-event", (event) => {
      if (!disposed) {
        setItems((current) => reduceOperationSnapshots(current, event.payload));
        if (!isOperationActive(event.payload.kind)) setCancelling((current) => current.filter((id) => id !== event.payload.operationId));
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
    return kind === "submit" ? t("operationSubmit") : t("operationSync");
  }

  if (items.length === 0) return null;
  return <><div className={`operations-center${open ? " open" : ""}`}>
    {open && <section className="operations-panel" aria-label={t("operationsCenter")}>
      <header><div><strong>{t("operationsCenter")}</strong><span>{activeCount} {t("operationsActive")}</span></div><button type="button" onClick={() => setOpen(false)} aria-label={t("close")}>×</button></header>
      <div className="operations-list">
        {retryError && <p className="error-banner" role="alert">{t("operationRetryFailed")}</p>}
        {cancelError && <p className="error-banner" role="alert">{t("operationCancelFailed")}</p>}
        {[...items].reverse().slice(0, 12).map((item) => { const progress = operationProgress(item); return <article className={`operation-item operation-${item.status}`} key={item.operationId}>
          <div><strong>{operationLabel(item.operationKind)}{cancelling.includes(item.operationId) ? <span className="operation-state">{t("operationCancelling")}</span> : item.status === "cancelled" ? <span className="operation-state">{t("operationCancelled")}</span> : item.status === "completed" ? <span className="operation-state">{t("operationCompleted")}</span> : null}</strong><small className="operation-summary">{item.totalFiles ? `${item.processed} / ${item.totalFiles}` : `${item.processed} ${t("operationFilesProcessed")}`}{progress.remaining !== undefined ? ` · ${progress.remaining} ${t("operationFilesRemaining")}` : ""}{progress.etaSeconds !== undefined ? ` · ${formatEta(progress.etaSeconds)}` : ""}</small>{item.currentPath && <small className="operation-current-path" title={item.currentPath}>{item.currentPath}</small>}{progress.ratio !== undefined && <span className="operation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}><span style={{ width: `${progress.ratio * 100}%` }} /></span>}{item.message && <span className="operation-message">{item.message}</span>}</div>
          {isOperationActive(item.status) && <button type="button" className="secondary-button" onClick={() => void cancel(item)} disabled={cancelling.includes(item.operationId)}>{cancelling.includes(item.operationId) ? t("operationCancelling") : t("cancelOperation")}</button>}
          {(item.status === "failed" || item.status === "cancelled") && item.retryable && item.operationKind === "sync" && <button type="button" className="secondary-button" onClick={() => setRetryCandidate(item)}>{t("retryOperation")}</button>}
        </article>; })}
      </div>
    </section>}
    <button className={`operations-toggle${activeCount > 0 ? " active" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={t("operationsCenter")}>
      <span aria-hidden="true">◌</span>{activeCount > 0 ? `${activeCount} ${t("operationsActive")}` : t("operationsCenter")}
    </button>
  </div>{retryCandidate && <ActionDialog title={t("retryOperation")} confirmLabel={t("retryOperation")} busy={retryBusy} onClose={() => setRetryCandidate(undefined)} onConfirm={() => void retry(retryCandidate)}><p>{t("operationRetryConfirm")}</p>{retryCandidate.scope && <strong>{retryCandidate.scope}</strong>}</ActionDialog>}</>;
}
