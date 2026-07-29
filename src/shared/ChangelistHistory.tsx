import { Clock3 } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useLocale } from "./i18n";
import type { PendingChange } from "./models";
import { isContextMenuShortcut } from "./selection";
import { CompactEmpty } from "./View";
import { ChangelistDescription } from "./ChangelistDescription";
import { SelectableSurface } from "./ItemList";
import { contextMenuPoint } from "./useContextMenu";

type ChangelistMenuPosition = { x: number; y: number };

export interface ChangelistHistoryProps {
  items: PendingChange[];
  busy?: boolean;
  title?: string;
  summary?: ReactNode;
  emptyText?: string;
  loadingText?: string;
  selectedId?: string;
  showStream?: boolean;
  className?: string;
  footer?: ReactNode;
  agentId?: (item: PendingChange) => string;
  onSelect?: (item: PendingChange) => void;
  onOpen?: (item: PendingChange) => void;
  onContextMenu?: (item: PendingChange, position: ChangelistMenuPosition) => void;
}

export function formatChangelistTime(value: string | undefined, language: string): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(seconds * 1000))
    : value;
}

export function ChangelistHistory({ items, busy = false, title, summary, emptyText, loadingText, selectedId, showStream = false, className = "", footer, agentId, onSelect, onOpen, onContextMenu }: ChangelistHistoryProps) {
  const { language, t } = useLocale();
  const interactive = Boolean(onSelect || onOpen || onContextMenu);
  const selectable = Boolean(onSelect || onOpen);

  function openPointerMenu(event: ReactMouseEvent<HTMLElement>, item: PendingChange) {
    if (!onContextMenu) return;
    event.preventDefault();
    onContextMenu(item, contextMenuPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()));
  }

  function handleKey(event: ReactKeyboardEvent<HTMLElement>, item: PendingChange) {
    if (onContextMenu && isContextMenuShortcut(event.key, event.shiftKey)) {
      event.preventDefault();
      onContextMenu(item, contextMenuPoint(undefined, undefined, event.currentTarget.getBoundingClientRect()));
      return;
    }
    if (event.key !== "Enter") return;
    if (onOpen) {
      event.preventDefault();
      onOpen(item);
    } else if (onSelect) {
      event.preventDefault();
      onSelect(item);
    }
  }

  return <section className={`changelist-history${className ? ` ${className}` : ""}`} aria-busy={busy}>
    {title && <div className="changelist-history-heading"><div><Clock3 aria-hidden="true" /><strong>{title}</strong></div>{summary !== undefined && <span>{summary}</span>}</div>}
    <div className="changelist-history-list" role="list">
      {busy && !items.length ? <CompactEmpty text={loadingText || t("loadingHistory")} /> : items.length ? items.map((item) => {
        const selected = selectedId === item.id;
        return <SelectableSurface
          selected={selectable ? selected : undefined}
          data-agent-id={agentId?.(item)}
          className={`changelist-history-row${selectable ? " selectable" : onContextMenu ? " contextual" : ""}`}
          role={interactive ? "button" : "listitem"}
          tabIndex={interactive ? 0 : undefined}
          key={item.id}
          onClick={() => onSelect?.(item)}
          onDoubleClick={() => onOpen?.(item)}
          onContextMenu={(event) => openPointerMenu(event, item)}
          onKeyDown={(event) => handleKey(event, item)}
        >
          <span className="changelist-history-change changelist-number">CL {item.id}</span>
          <span className="changelist-history-copy"><ChangelistDescription value={item.description} fallback={t("noDescription")} compact /><small>{[showStream ? item.stream : undefined, item.user, item.client, formatChangelistTime(item.time, language)].filter(Boolean).join(" · ")}</small></span>
        </SelectableSurface>;
      }) : emptyText ? <CompactEmpty text={emptyText} /> : null}
    </div>
    {footer && <div className="changelist-history-footer">{footer}</div>}
  </section>;
}
