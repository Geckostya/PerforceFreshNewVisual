import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, Inbox, X } from "lucide-react";
import { useLocale } from "./i18n";
import type { AppError } from "./models";
import { formatEta, operationProgress, useActiveOperation } from "./operations";

export function View({ id, eyebrow, title, subtitle, actions, operationLabel, error, notice, onDismissNotice, className = "", children }: {
  id: string;
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  operationLabel?: string;
  error?: AppError;
  notice?: string;
  onDismissNotice?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const activeSync = useActiveOperation("sync");
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!activeSync) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [activeSync?.operationId]);
  const progress = activeSync && operationProgress(activeSync);
  const syncSummary = activeSync && [
    activeSync.totalFiles ? `${activeSync.processed} / ${activeSync.totalFiles}` : `${activeSync.processed} ${t("operationFilesProcessed")}`,
    progress?.remaining !== undefined ? `${progress.remaining} ${t("operationFilesRemaining")}` : undefined,
    progress?.etaSeconds !== undefined ? formatEta(progress.etaSeconds) : undefined,
    activeSync.currentPath?.split("/").at(-1),
  ].filter(Boolean).join(" · ");
  return <section className={`resource-view ${className}`.trim()} aria-labelledby={id}>
    <div className="view-heading">
      <p className="eyebrow"><span>{eyebrow}</span>{activeSync ? <span className="workspace-operation-status" role="status" title={activeSync.scope}><span className="folder-loading-indicator" aria-hidden="true" /><span className="workspace-operation-copy">{t("updatingProject")} · {syncSummary}</span>{progress?.ratio !== undefined && <span className="workspace-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}><span style={{ width: `${progress.ratio * 100}%` }} /></span>}</span> : operationLabel ? <span className="workspace-operation-status" role="status"><span className="folder-loading-indicator" aria-hidden="true" /><span className="workspace-operation-copy">{operationLabel}</span></span> : null}</p>
      <div className="view-title"><h1 id={id}>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="view-actions">{actions}</div>}
    </div>
    {error && <ErrorBanner error={error} />}
    {notice && <Notice text={notice} onDismiss={onDismissNotice} />}
    {children}
  </section>;
}

export function ErrorBanner({ error }: { error: AppError }) {
  const { t } = useLocale();
  return <div className="error-banner" role="alert"><strong>{t("operationFailed")}</strong><span>{error.message}</span>{error.hints.map((hint) => <span key={hint}>{hint}</span>)}</div>;
}

export function Notice({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  const { t } = useLocale();
  return <div className="operation-toast" role="status"><Check className="ui-icon" aria-hidden="true" /><strong>{text}</strong>{onDismiss && <button type="button" onClick={onDismiss} aria-label={t("close")}><X className="ui-icon" aria-hidden="true" /></button>}</div>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><Inbox className="ui-icon empty-state-icon" aria-hidden="true" /><strong>{title}</strong><p>{body}</p></div>;
}

export function CompactEmpty({ text }: { text: string }) {
  return <div className="compact-empty">{text}</div>;
}

export function Modal({ title, busy, wide, onClose, children }: { title: string; busy: boolean; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useLocale();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return <div className="dialog-layer"><section className={`action-dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="action-dialog-title"><div className="dialog-heading"><h2 id="action-dialog-title">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={t("close")}><X className="ui-icon" aria-hidden="true" /></button></div>{children}</section></div>;
}

export function ActionDialog({ title, confirmLabel, busy, confirmDisabled, danger, onClose, onConfirm, children }: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  confirmDisabled?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return <Modal title={title} busy={busy} onClose={onClose}><div className="dialog-body">{children}</div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className={danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</button></div></Modal>;
}

export function ContextMenu({ x, y, onSelect, children }: { x: number; y: number; onSelect: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onSelect);
  dismiss.current = onSelect;
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const closeOnPointerDown = () => dismiss.current();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss.current();
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape, true);
      returnFocus?.focus();
    };
  }, []);

  function navigate(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  return <div ref={menu} className="context-menu" role="menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 280)), top: Math.max(8, Math.min(y, window.innerHeight - 300)) }} onKeyDown={navigate} onPointerDown={(event) => event.stopPropagation()} onClick={onSelect}>{children}</div>;
}

export function MenuButton({ danger, disabled, onClick, children }: { danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="menuitem" className={danger ? "danger" : ""} disabled={disabled} onClick={onClick}>{children}</button>;
}
