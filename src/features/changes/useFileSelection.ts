import { useEffect, useRef, useState } from "react";
import type { OpenedFile, ShelvedFile } from "../../shared/models";
import { retainAvailableSelection, selectionMode, updateSelection } from "../../shared/selection";

type FileSelection = { kind: "opened" | "shelved"; depotPath: string };
type SelectionModifiers = Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">;

export function useFileSelection(openedFiles: OpenedFile[], shelvedFiles: ShelvedFile[]) {
  const [selection, setSelection] = useState<FileSelection>();
  const [openedSelection, setOpenedSelection] = useState<string[]>([]);
  const [shelvedSelection, setShelvedSelection] = useState<string[]>([]);
  const openedAnchor = useRef<string | undefined>(undefined);
  const shelvedAnchor = useRef<string | undefined>(undefined);

  useEffect(() => {
    const available = openedFiles.map((file) => file.depotPath);
    setOpenedSelection((current) => retainAvailableSelection(current, available));
    setSelection((current) => current?.kind === "opened" && !available.includes(current.depotPath)
      ? undefined
      : current);
    if (openedAnchor.current && !available.includes(openedAnchor.current)) openedAnchor.current = undefined;
  }, [openedFiles]);

  useEffect(() => {
    const available = shelvedFiles.map((file) => file.depotPath);
    setShelvedSelection((current) => retainAvailableSelection(current, available));
    setSelection((current) => current?.kind === "shelved" && !available.includes(current.depotPath)
      ? undefined
      : current);
    if (shelvedAnchor.current && !available.includes(shelvedAnchor.current)) shelvedAnchor.current = undefined;
  }, [shelvedFiles]);

  const currentOpened = selection?.kind === "opened"
    ? openedFiles.find((file) => file.depotPath === selection.depotPath)
    : undefined;
  const currentShelved = selection?.kind === "shelved"
    ? shelvedFiles.find((file) => file.depotPath === selection.depotPath)
    : undefined;

  function selectOpened(file: OpenedFile, modifiers?: SelectionModifiers) {
    const next = updateSelection(
      openedFiles.map((item) => item.depotPath),
      openedSelection,
      file.depotPath,
      openedAnchor.current,
      selectionMode(modifiers),
    );
    openedAnchor.current = next.anchor;
    setOpenedSelection(next.selected);
    setShelvedSelection([]);
    setSelection({ kind: "opened", depotPath: file.depotPath });
  }

  function selectShelved(file: ShelvedFile, modifiers?: SelectionModifiers) {
    const next = updateSelection(
      shelvedFiles.map((item) => item.depotPath),
      shelvedSelection,
      file.depotPath,
      shelvedAnchor.current,
      selectionMode(modifiers),
    );
    shelvedAnchor.current = next.anchor;
    setShelvedSelection(next.selected);
    setOpenedSelection([]);
    setSelection({ kind: "shelved", depotPath: file.depotPath });
  }

  function setOpened(paths: string[], primary = paths[0]) {
    setOpenedSelection(paths);
    setShelvedSelection([]);
    setSelection(primary ? { kind: "opened", depotPath: primary } : undefined);
    openedAnchor.current = primary;
  }

  function setShelved(paths: string[], primary = paths[0]) {
    setShelvedSelection(paths);
    setOpenedSelection([]);
    setSelection(primary ? { kind: "shelved", depotPath: primary } : undefined);
    shelvedAnchor.current = primary;
  }

  function clear() {
    setSelection(undefined);
    setOpenedSelection([]);
    setShelvedSelection([]);
    openedAnchor.current = undefined;
    shelvedAnchor.current = undefined;
  }

  return {
    selection,
    openedSelection,
    shelvedSelection,
    currentOpened,
    currentShelved,
    selectOpened,
    selectShelved,
    setOpened,
    setShelved,
    clear,
  };
}
