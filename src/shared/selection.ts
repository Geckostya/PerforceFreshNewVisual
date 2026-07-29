export type SelectionMode = "single" | "toggle" | "range";

type SelectionModifiers = Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">;

export function selectionMode(modifiers?: SelectionModifiers): SelectionMode {
  if (modifiers?.shiftKey) return "range";
  if (modifiers?.ctrlKey || modifiers?.metaKey) return "toggle";
  return "single";
}

export function updateSelection(
  ordered: string[],
  selected: string[],
  target: string,
  anchor: string | undefined,
  mode: SelectionMode,
): { selected: string[]; anchor: string } {
  if (mode === "range" && anchor) {
    const from = ordered.indexOf(anchor);
    const to = ordered.indexOf(target);
    if (from >= 0 && to >= 0) {
      return { selected: ordered.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
    }
  }
  if (mode === "toggle") {
    return {
      selected: selected.includes(target) ? selected.filter((item) => item !== target) : [...selected, target],
      anchor: target,
    };
  }
  return { selected: [target], anchor: target };
}

export function retainAvailableSelection(selected: string[], available: string[]): string[] {
  const availableSet = new Set(available);
  const retained = selected.filter((item) => availableSet.has(item));
  return retained.length === selected.length ? selected : retained;
}

export function isContextMenuShortcut(key: string, shiftKey = false): boolean {
  return key === "ContextMenu" || (shiftKey && key === "F10");
}

export type CollectionNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp";

export function collectionTargetIndex(current: number, total: number, key: CollectionNavigationKey, pageSize = 10): number {
  if (total <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  const delta = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : key === "PageDown" ? pageSize : -pageSize;
  return Math.max(0, Math.min(total - 1, Math.max(0, current) + delta));
}

export function focusCollectionItem(current: HTMLElement, key: string): boolean {
  if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(key)) return false;
  const container = current.closest<HTMLElement>("[data-keyboard-collection], [role='listbox'], [role='tree'], [role='list']") || current.parentElement;
  if (!container) return false;
  const items = [...container.querySelectorAll<HTMLElement>("[data-keyboard-item]:not([disabled]):not([aria-disabled='true'])")]
    .filter((item) => !item.closest("[hidden], [aria-hidden='true']"));
  const index = items.indexOf(current);
  if (index < 0) return false;
  const next = collectionTargetIndex(index, items.length, key as CollectionNavigationKey);
  if (next < 0 || next === index) return true;
  items[next].focus({ preventScroll: true });
  items[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
