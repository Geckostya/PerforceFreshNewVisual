import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listOpenedFiles,
  listPendingChanges,
  listShelvedChanges,
  listShelvedFiles,
  normalizeAppError,
} from "../../shared/api";
import type { AppError, ConnectionInput, OpenedFile, PendingChange, ShelvedFile } from "../../shared/models";
import { groupChanges, shouldRefreshOnFocus, visibleShelfFiles } from "./changes";

export type ChangesLoadState = "loading" | "ready" | "error";

export function useChangesData(
  connection: ConnectionInput,
  selectedChange: string,
  onFileCountChange: (count: number) => void,
) {
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [shelvedChanges, setShelvedChanges] = useState<PendingChange[]>([]);
  const [files, setFiles] = useState<OpenedFile[]>([]);
  const [shelfFiles, setShelfFiles] = useState<Record<string, ShelvedFile[]>>({});
  const [state, setState] = useState<ChangesLoadState>("loading");
  const [shelfLoading, setShelfLoading] = useState(false);
  const [error, setError] = useState<AppError>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastFocusRefresh = useRef(0);

  const refreshData = useCallback(() => {
    setShelfFiles({});
    setRefreshVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState("loading");
    setError(undefined);
    void Promise.all([
      listPendingChanges(connection),
      listShelvedChanges(connection),
      listOpenedFiles(connection),
    ])
      .then(([nextChanges, nextShelves, nextFiles]) => {
        if (!active) return;
        setChanges(nextChanges);
        setShelvedChanges(nextShelves);
        setFiles(nextFiles);
        onFileCountChange(nextFiles.length);
        setState("ready");
      })
      .catch((reason) => {
        if (!active) return;
        setError(normalizeAppError(reason));
        setState("error");
      });
    return () => { active = false; };
  }, [connection, onFileCountChange, refreshVersion]);

  const groups = useMemo(
    () => groupChanges(changes, files, shelvedChanges),
    [changes, files, shelvedChanges],
  );
  const currentGroup = groups.find((group) => group.id === selectedChange) ?? groups[0];
  const currentShelfFiles = useMemo(
    () => visibleShelfFiles(currentGroup.isShelved, shelfFiles[currentGroup.id] ?? []),
    [currentGroup.id, currentGroup.isShelved, shelfFiles],
  );

  useEffect(() => {
    if (!currentGroup.isShelved) {
      setShelfLoading(false);
      return;
    }
    let active = true;
    setShelfLoading(true);
    void listShelvedFiles(connection, currentGroup.id)
      .then((next) => {
        if (active) setShelfFiles((current) => ({ ...current, [currentGroup.id]: next }));
      })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); })
      .finally(() => { if (active) setShelfLoading(false); });
    return () => { active = false; };
  }, [connection, currentGroup.id, currentGroup.isShelved, refreshVersion]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const now = Date.now();
      if (shouldRefreshOnFocus(focused, lastFocusRefresh.current, now)) {
        lastFocusRefresh.current = now;
        refreshData();
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [connection, refreshData]);

  return {
    changes,
    files,
    groups,
    currentGroup,
    currentShelfFiles,
    state,
    shelfLoading,
    error,
    setError,
    refreshData,
  };
}
