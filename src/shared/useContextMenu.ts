import {
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type ContextMenuEvent<T extends globalThis.Element = HTMLElement> =
  | ReactMouseEvent<T>
  | ReactKeyboardEvent<T>;

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export interface PositionedContextMenu<T> extends ContextMenuPoint {
  target: T;
}

export function contextMenuPoint(
  clientX: number | undefined,
  clientY: number | undefined,
  bounds: Pick<DOMRect, "left" | "top" | "height">,
): ContextMenuPoint {
  return clientX !== undefined && clientX > 0 && clientY !== undefined && clientY > 0
    ? { x: clientX, y: clientY }
    : { x: bounds.left + 24, y: bounds.top + bounds.height / 2 };
}

export function useContextMenu<T>() {
  const [menu, setMenu] = useState<PositionedContextMenu<T>>();

  const open = useCallback((event: ContextMenuEvent<globalThis.Element>, target: T) => {
    event.preventDefault();
    event.stopPropagation();
    const point = contextMenuPoint(
      "clientX" in event ? event.clientX : undefined,
      "clientY" in event ? event.clientY : undefined,
      event.currentTarget.getBoundingClientRect(),
    );
    setMenu({ target, ...point });
  }, []);

  const openAt = useCallback((target: T, point: ContextMenuPoint) => {
    setMenu({ target, ...point });
  }, []);

  const close = useCallback(() => setMenu(undefined), []);

  return { menu, open, openAt, close };
}
