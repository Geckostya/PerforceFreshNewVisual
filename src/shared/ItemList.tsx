import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { focusCollectionItem } from "./selection";

type SelectionRole = "button" | "option" | "treeitem";

function selectionState(role: SelectionRole, selected: boolean | undefined) {
  if (selected === undefined) return {};
  return role === "option" || role === "treeitem"
    ? { "aria-selected": selected }
    : { "aria-pressed": selected };
}

export interface SelectableRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed" | "aria-selected"> {
  selected: boolean;
  selectionRole?: SelectionRole;
}

export function SelectableRow({ selected, selectionRole = "button", className = "", type = "button", onKeyDown, ...props }: SelectableRowProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (!event.defaultPrevented && focusCollectionItem(event.currentTarget, event.key)) event.preventDefault();
  }
  return <button
    {...props}
    {...selectionState(selectionRole, selected)}
    type={type}
    data-keyboard-item="true"
    role={selectionRole === "button" ? undefined : selectionRole}
    className={`item-row${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
    onKeyDown={handleKeyDown}
  />;
}

export interface SelectableSurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, "aria-pressed" | "aria-selected"> {
  selected?: boolean;
  selectionRole?: SelectionRole;
}

export function isSurfaceActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function SelectableSurface({ selected, selectionRole = "button", className = "", role, tabIndex = 0, onClick, onKeyDown, ...props }: SelectableSurfaceProps) {
  const resolvedRole = role || selectionRole;
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (!event.defaultPrevented && focusCollectionItem(event.currentTarget, event.key)) {
      event.preventDefault();
      return;
    }
    if (!event.defaultPrevented && onClick && isSurfaceActivationKey(event.key)) {
      event.preventDefault();
      event.currentTarget.click();
    }
  }
  return <div
    {...props}
    {...selectionState(selectionRole, selected)}
    role={resolvedRole}
    data-keyboard-item="true"
    tabIndex={tabIndex}
    className={`item-row${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
    onClick={onClick}
    onKeyDown={handleKeyDown}
  />;
}

export function ItemRowCopy({ primary, secondary, className = "" }: { primary: ReactNode; secondary?: ReactNode; className?: string }) {
  return <span className={`item-row-copy${className ? ` ${className}` : ""}`}><strong>{primary}</strong>{secondary !== undefined && <small>{secondary}</small>}</span>;
}

export interface TreeDisclosureProps {
  expanded?: boolean;
  label?: string;
  loading?: boolean;
  agentId?: string;
  onToggle?: () => void;
}

export function TreeDisclosure({ expanded, label, loading = false, agentId, onToggle }: TreeDisclosureProps) {
  if (!onToggle) return <span className="tree-item-disclosure" aria-hidden="true" />;
  return <button
    data-agent-id={agentId}
    className="tree-item-disclosure"
    type="button"
    aria-label={label}
    aria-expanded={expanded}
    onClick={(event) => { event.stopPropagation(); onToggle(); }}
    onDoubleClick={(event) => event.stopPropagation()}
  >
    {loading ? <LoaderCircle className="icon-spin" aria-hidden="true" /> : <ChevronRight className={expanded ? "expanded" : ""} aria-hidden="true" />}
  </button>;
}

export interface TreeItemRowProps {
  depth: number;
  selected: boolean;
  busy?: boolean;
  className?: string;
  selectClassName?: string;
  disclosure?: TreeDisclosureProps;
  icon: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  agentId?: string;
  agentIgnored?: boolean;
  selectProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-selected" | "children" | "className" | "role" | "style" | "type">;
}

export function TreeItemRow({ depth, selected, busy = false, className = "", selectClassName = "", disclosure, icon, primary, secondary, trailing, agentId, agentIgnored, selectProps = {} }: TreeItemRowProps) {
  const style = { "--item-depth": depth } as CSSProperties;
  const { onKeyDown, ...restSelectProps } = selectProps;
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowRight" && disclosure?.onToggle && disclosure.expanded === false) {
      event.preventDefault();
      disclosure.onToggle();
      return;
    }
    if (event.key === "ArrowLeft" && disclosure?.onToggle && disclosure.expanded === true) {
      event.preventDefault();
      disclosure.onToggle();
      return;
    }
    if (focusCollectionItem(event.currentTarget, event.key)) event.preventDefault();
  }
  return <div className={`item-row tree-item-row${selected ? " selected" : ""}${className ? ` ${className}` : ""}`} style={style} aria-busy={busy || undefined}>
    <TreeDisclosure {...disclosure} />
    <button
      {...restSelectProps}
      data-agent-id={agentId}
      data-agent-ignored={agentIgnored}
      className={`tree-item-select${selectClassName ? ` ${selectClassName}` : ""}`}
      type="button"
      data-keyboard-item="true"
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={disclosure?.onToggle ? disclosure.expanded : undefined}
      onKeyDown={handleKeyDown}
    >
      {icon}
      <ItemRowCopy primary={primary} secondary={secondary} />
      {trailing}
    </button>
  </div>;
}
