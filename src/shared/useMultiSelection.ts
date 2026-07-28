import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { retainAvailableSelection, selectionMode, updateSelection } from "./selection";

type SelectionModifiers = Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">;

export function useMultiSelection(ordered: string[], initial: string[] = []) {
  const [selected, setSelected] = useState(initial);
  const anchor = useRef<string | undefined>(initial[0]);
  const availabilityKey = ordered.join("\0");

  useEffect(() => {
    setSelected((current) => {
      const retained = retainAvailableSelection(current, ordered);
      if (anchor.current && !ordered.includes(anchor.current)) {
        anchor.current = [...retained].reverse().find((item) => ordered.includes(item));
      }
      return retained;
    });
  }, [availabilityKey]);

  const replace = useCallback((update: SetStateAction<string[]>) => {
    setSelected((current) => {
      const next = typeof update === "function" ? update(current) : update;
      anchor.current = next[0];
      return next;
    });
  }, []);

  const select = useCallback((target: string, modifiers?: SelectionModifiers) => {
    setSelected((current) => {
      const next = updateSelection(ordered, current, target, anchor.current, selectionMode(modifiers));
      anchor.current = next.anchor;
      return next.selected;
    });
  }, [availabilityKey]);

  const clear = useCallback(() => {
    anchor.current = undefined;
    setSelected([]);
  }, []);

  return { selected, select, replace, clear };
}
