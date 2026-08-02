import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, Inbox, X } from "lucide-react";
import { useLocale } from "./i18n";
import type { AppError } from "./models";
import { formatEta, operationProgress, useActiveOperation } from "./operations";

export function View({ id, title, subtitle, actions, statusBarActions, operationLabel, operationDetail, operationRatio, error, notice, busy = false, onDismissNotice, className = "", children }: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  statusBarActions?: ReactNode;
  operationLabel?: string;
  operationDetail?: string;
  operationRatio?: number;
  error?: AppError;
  notice?: string;
  busy?: boolean;
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
    activeSync.currentPath?.split("/").at(-1),
    activeSync.totalFiles ? `${activeSync.processed} / ${activeSync.totalFiles}` : `${activeSync.processed} ${t("operationFilesProcessed")}`,
    progress?.remaining !== undefined ? `${progress.remaining} ${t("operationFilesRemaining")}` : undefined,
    progress?.etaSeconds !== undefined ? formatEta(progress.etaSeconds) : undefined,
  ].filter(Boolean).join(" · ");
  const operationStatus = activeSync ? <WorkspaceOperationStatus
    label={t("updatingProject")}
    detail={syncSummary}
    ratio={progress?.ratio}
    title={activeSync.scope}
  /> : operationLabel ? <WorkspaceOperationStatus
    label={operationLabel}
    detail={operationDetail}
    ratio={operationRatio}
  /> : null;
  return <section className={`resource-view ${className}`.trim()} aria-labelledby={id} aria-busy={busy || undefined}>
    <span className="sr-only" role="status" aria-live="polite">{title}</span>
    <header className="view-header">
      <div className="view-heading">
        <div className="view-title"><h1 id={id} data-pane-entry tabIndex={-1}>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {actions && <div className="view-actions">{actions}</div>}
      </div>
      {statusBarActions ? <div className="view-status-bar" data-agent-id="files-status-bar">
        <div className="view-status-slot">{operationStatus}</div>
        <div className="view-status-actions">{statusBarActions}</div>
      </div> : operationStatus && <div className="view-operation-strip">{operationStatus}</div>}
    </header>
    {error && <ErrorBanner error={error} />}
    {notice && <Notice text={notice} onDismiss={onDismissNotice} />}
    {children}
  </section>;
}

export function WorkspaceOperationStatus({ label, detail, ratio, title }: {
  label: string;
  detail?: string;
  ratio?: number;
  title?: string;
}) {
  const showProgress = ratio !== undefined;
  const percentage = ratio === undefined ? undefined : Math.round(ratio * 100);
  return <span className={`workspace-operation-status${showProgress ? " has-progress" : ""}`} role="status" title={title} aria-label={[detail, label].filter(Boolean).join(" · ")}>
    <span className="workspace-operation-copy">{detail}</span>
    {showProgress
      ? <span data-agent-id="workspace-operation-progress" className="workspace-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span style={{ width: `${percentage}%` }} /></span>
      : <span className="workspace-operation-action">{label}</span>}
    <span className="folder-loading-indicator" aria-hidden="true" />
  </span>;
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

export function BoundedListNotice({ count }: { count: number }) {
  const { t } = useLocale();
  return <p className="bounded-list-notice" role="status">{t("boundedListNotice")} {count}. {t("boundedListHint")}</p>;
}

export function Modal({ title, busy, wide, onClose, children }: { title: ReactNode; busy: boolean; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useLocale();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const isBusy = useRef(busy);
  close.current = onClose;
  isBusy.current = busy;

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") || [])];
    if (!dialog.current?.contains(document.activeElement)) (focusable()[0] || dialog.current)?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy.current) {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const target = returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : document.querySelector<HTMLElement>("[data-focus-fallback]");
      target?.focus();
    };
  }, []);

  return <div className="dialog-layer"><section ref={dialog} className={`action-dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={t("close")}><X className="ui-icon" aria-hidden="true" /></button></div>
    <div className="dialog-content">{children}</div>
  </section></div>;
}

export function ActionDialog({ title, confirmLabel, busy, confirmDisabled, danger, wide, onClose, onConfirm, children }: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  confirmDisabled?: boolean;
  danger?: boolean;
  wide?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return <Modal title={title} busy={busy} wide={wide} onClose={onClose}><div className="dialog-body">{children}</div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className={danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</button></div></Modal>;
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
      const target = returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : document.querySelector<HTMLElement>("[data-focus-fallback]");
      target?.focus();
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

export function MenuButton({ danger, disabled, icon, onClick, children }: { danger?: boolean; disabled?: boolean; icon?: ReactNode; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="menuitem" className={danger ? "danger" : ""} disabled={disabled} onClick={onClick}>{icon && <span className="context-menu-icon" aria-hidden="true">{icon}</span>}<span className="context-menu-label">{children}</span></button>;
}

export function MenuSeparator() {
  return <div className="context-menu-separator" role="separator" />;
}
