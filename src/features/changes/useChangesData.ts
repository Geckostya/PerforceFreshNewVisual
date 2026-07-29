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
import { resourceFailureFreshness } from "../../shared/resourceSnapshot";
import { groupChanges, shouldRefreshOnFocus, visibleShelfFiles } from "./changes";

export type ChangesLoadState = "loading" | "fresh" | "stale" | "offline" | "permission" | "partial" | "error";
export type ShelfLoadState = "idle" | "loading" | "fresh" | "error";

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
  const [shelfState, setShelfState] = useState<ShelfLoadState>("idle");
  const [shelfFreshChange, setShelfFreshChange] = useState<string>();
  const [error, setError] = useState<AppError>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastFocusRefresh = useRef(0);
  const hasSuccessfulSnapshot = useRef(false);

  const refreshData = useCallback(() => {
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
        hasSuccessfulSnapshot.current = true;
        setState("fresh");
      })
      .catch((reason) => {
        if (!active) return;
        const nextError = normalizeAppError(reason);
        setError(nextError);
        setState(resourceFailureFreshness(hasSuccessfulSnapshot.current, nextError));
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
      setShelfState("idle");
      setShelfFreshChange(undefined);
      return;
    }
    let active = true;
    setShelfLoading(true);
    setShelfState("loading");
    setShelfFreshChange(undefined);
    void listShelvedFiles(connection, currentGroup.id)
      .then((next) => {
        if (active) {
          setShelfFiles((current) => ({ ...current, [currentGroup.id]: next }));
          setShelfState("fresh");
          setShelfFreshChange(currentGroup.id);
        }
      })
      .catch((reason) => {
        if (active) {
          setShelfState("error");
          setError(normalizeAppError(reason));
        }
      })
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
    shelfState,
    shelfFreshChange,
    error,
    setError,
    refreshData,
  };
}
