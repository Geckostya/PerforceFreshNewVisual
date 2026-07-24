import { useCallback, useEffect, useState } from "react";
import type { ConnectionInput } from "./models";
import { archiveStorageKey, loadArchivedIds, retainArchivedIds, saveArchivedIds, type ArchiveKind } from "./localArchive";

export function useLocalArchive(
  kind: ArchiveKind,
  connection: ConnectionInput,
  availableIds: string[],
  snapshotReady: boolean,
) {
  const key = archiveStorageKey(kind, connection.port, connection.user, connection.client);
  const [owner, setOwner] = useState(key);
  const [archivedIds, setArchivedIds] = useState<string[]>(() => loadArchivedIds(key));
  const availableFingerprint = availableIds.join("\0");

  useEffect(() => {
    setArchivedIds(loadArchivedIds(key));
    setOwner(key);
  }, [key]);

  useEffect(() => {
    if (!snapshotReady || owner !== key) return;
    setArchivedIds((current) => {
      const retained = retainArchivedIds(current, availableIds);
      if (retained.length === current.length) return current;
      saveArchivedIds(key, retained);
      return retained;
    });
  }, [availableFingerprint, key, owner, snapshotReady]);

  const updateArchivedIds = useCallback((update: (current: string[]) => string[]) => {
    setArchivedIds((current) => {
      const next = [...new Set(update(owner === key ? current : loadArchivedIds(key)))];
      saveArchivedIds(key, next);
      return next;
    });
  }, [key, owner]);

  const setArchived = useCallback((ids: string[], archived: boolean) => {
    updateArchivedIds((current) => archived
      ? [...current, ...ids]
      : current.filter((id) => !ids.includes(id)));
  }, [updateArchivedIds]);

  return { archivedIds, setArchived, updateArchivedIds };
}
