import { useRef, type DragEvent } from "react";
import {
  CHANGE_DRAG_TYPE,
  decodeChangeDrag,
  dragEffectAllowed,
  dropEffect,
  encodeChangeDrag,
  resolveChangeDrop,
  type ChangeDropTarget,
  type ChangeDragItem,
} from "./changes";

export function useChangeDragDrop() {
  const activeDrag = useRef<ChangeDragItem | undefined>(undefined);

  function beginDrag(event: DragEvent, item: ChangeDragItem) {
    activeDrag.current = item;
    event.dataTransfer.effectAllowed = dragEffectAllowed(item.kind);
    const payload = encodeChangeDrag(item);
    event.dataTransfer.setData(CHANGE_DRAG_TYPE, payload);
    event.dataTransfer.setData("text/plain", payload);
  }

  function endDrag() {
    activeDrag.current = undefined;
  }

  function allowDrop(event: DragEvent, target: ChangeDropTarget) {
    const action = activeDrag.current && resolveChangeDrop(activeDrag.current, target);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = dropEffect(action);
  }

  function takeDrop(event: DragEvent, target: ChangeDropTarget) {
    const encoded = event.dataTransfer.getData(CHANGE_DRAG_TYPE)
      || event.dataTransfer.getData("text/plain");
    const item = activeDrag.current ?? decodeChangeDrag(encoded);
    const action = item ? resolveChangeDrop(item, target) : undefined;
    if (!action) return undefined;
    event.preventDefault();
    event.stopPropagation();
    activeDrag.current = undefined;
    return action;
  }

  return { beginDrag, endDrag, allowDrop, takeDrop };
}
