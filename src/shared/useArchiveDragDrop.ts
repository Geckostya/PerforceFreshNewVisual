import { useRef, useState, type DragEvent } from "react";
import {
  ARCHIVE_DRAG_TYPE,
  decodeArchiveDrag,
  encodeArchiveDrag,
  type ArchiveDragItem,
  type ArchiveKind,
} from "./localArchive";

export type ArchiveDropTarget = "current" | "archived";

export function useArchiveDragDrop(kind: ArchiveKind) {
  const activeDrag = useRef<ArchiveDragItem | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<ArchiveDropTarget>();

  function beginDrag(event: DragEvent, ids: string[], archived: boolean) {
    const item = { kind, ids, archived };
    activeDrag.current = item;
    event.dataTransfer.effectAllowed = "move";
    const payload = encodeArchiveDrag(item);
    event.dataTransfer.setData(ARCHIVE_DRAG_TYPE, payload);
    event.dataTransfer.setData("text/plain", payload);
  }

  function readDrag(event: DragEvent): ArchiveDragItem | undefined {
    const encoded = event.dataTransfer.getData(ARCHIVE_DRAG_TYPE)
      || event.dataTransfer.getData("text/plain");
    const item = activeDrag.current ?? decodeArchiveDrag(encoded);
    return item?.kind === kind ? item : undefined;
  }

  function allowDrop(event: DragEvent, target: ArchiveDropTarget) {
    const item = activeDrag.current;
    if (!item || item.kind !== kind || item.archived === (target === "archived")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  }

  function takeDrop(event: DragEvent, target: ArchiveDropTarget): string[] | undefined {
    const item = readDrag(event);
    if (!item || item.archived === (target === "archived")) return undefined;
    event.preventDefault();
    event.stopPropagation();
    activeDrag.current = undefined;
    setDropTarget(undefined);
    return item.ids;
  }

  function endDrag() {
    activeDrag.current = undefined;
    setDropTarget(undefined);
  }

  return { dropTarget, beginDrag, endDrag, allowDrop, takeDrop };
}
