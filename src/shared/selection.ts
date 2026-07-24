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
