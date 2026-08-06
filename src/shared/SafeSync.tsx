import { useState } from "react";
import { loadSyncMergeContent, normalizeAppError, previewSync, previewSyncAtDate, repairSyncHaveList, saveSyncMergeResult, startSync } from "./api";
import { ResolveDialog } from "../features/workspace/ResolveDialog";
import { useLocale } from "./i18n";
import type { AppError, ConnectionInput, DateSyncPreview, OperationEvent, SyncPreview, SyncPreviewItem } from "./models";
import { isOperationTerminal, startObservedOperation, useActiveOperation } from "./operations";
import { Modal } from "./View";

type SyncPhase = "idle" | "syncing" | "checking" | "forcing";

export function shouldShowSyncConflictDialog(conflicts: string[], phase: SyncPhase): boolean {
  return conflicts.length > 0 && phase === "idle";
}

export function updateOverwritePaths(current: string[], path: string, overwrite: boolean): string[] {
  return overwrite ? [...new Set([...current, path])] : current.filter((item) => item !== path);
}

export function overwritePathsAfterForce(kind: OperationEvent["kind"], paths: string[]): string[] {
  return kind === "completed" ? [] : paths;
}

export function autoResolvableSyncPaths(preview: SyncPreview): string[] {
  const modified = new Set(preview.modifiedFiles.map((path) => path.toLowerCase()));
  return preview.items.map((item) => item.depotPath).filter((path) => !modified.has(path.toLowerCase()));
}

export function exactOverwriteScopes(paths: string[], items: SyncPreviewItem[], originalScopes: string[] = []): string[] {
  const revisionSpecs = [...new Set(originalScopes.map((scope) => scope.match(/([@#][^@#]+)$/)?.[1]).filter((value): value is string => Boolean(value)))];
  const fallbackRevisionSpec = revisionSpecs.length === 1 ? revisionSpecs[0] : "";
  return paths.map((path) => {
    const item = items.find((candidate) => candidate.depotPath.toLowerCase() === path.toLowerCase());
    return item?.revision && /^\d+$/.test(item.revision) ? `${path}#${item.revision}` : `${path}${fallbackRevisionSpec}`;
  });
}

export function serverDateInputValue(serverDate?: string): string {
  const match = serverDate?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\s|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : "";
}

export interface SafeSyncController {
  phase: SyncPhase;
  conflicts: string[];
  overwritePaths: string[];
  connection: ConnectionInput;
  mergeItem?: SyncPreviewItem;
  start: (scopes: string[]) => Promise<void>;
  setOverwrite: (path: string, overwrite: boolean) => void;
  setAllOverwrite: (overwrite: boolean) => void;
  openMerge: (path: string) => void;
  canMerge: (path: string) => boolean;
  closeMerge: () => void;
  completeMerge: (path: string) => void;
  finish: (overwriteOverride?: string[]) => Promise<void>;
}

export function useSafeSync(connection: ConnectionInput, callbacks: {
  refresh: () => void | Promise<void>;
  setNotice: (message: string) => void;
  setError: (error: AppError | undefined) => void;
}): SafeSyncController {
  const { t } = useLocale();
  const activeSync = useActiveOperation("sync");
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [overwritePaths, setOverwritePaths] = useState<string[]>([]);
  const [conflictItems, setConflictItems] = useState<SyncPreviewItem[]>([]);
  const [conflictScopes, setConflictScopes] = useState<string[]>([]);
  const [mergePath, setMergePath] = useState<string>();

  async function refresh() {
    try {
      await callbacks.refresh();
    } catch (reason) {
      callbacks.setError(normalizeAppError(reason));
    }
  }

  async function finishSafeSync(event: OperationEvent, scopes: string[], allowAutoResolve = true) {
    if (event.kind === "cancelled") {
      void refresh();
      setPhase("idle");
      callbacks.setNotice(t("syncCancelled"));
      return;
    }
    setPhase("checking");
    try {
      let remaining = await previewSync(connection, scopes);
      if (remaining.missingHaveFiles.length > 0) {
        try {
          await repairSyncHaveList(connection, remaining.missingHaveFiles);
          remaining = await previewSync(connection, scopes);
        } catch {
          // Repair is opportunistic: unmatched files remain explicit conflicts below.
        }
      }
      const autoResolvablePaths = allowAutoResolve ? autoResolvableSyncPaths(remaining) : [];
      if (autoResolvablePaths.length > 0) {
        setPhase("forcing");
        const autoResolvableScopes = exactOverwriteScopes(autoResolvablePaths, remaining.items, scopes);
        try {
          await startObservedOperation("sync", () => startSync(connection, autoResolvableScopes, true, true), (autoEvent) => {
            if (isOperationTerminal(autoEvent.kind)) void finishSafeSync(autoEvent, scopes, false);
          });
        } catch {
          await finishSafeSync(event, scopes, false);
        }
        return;
      }
      if (remaining.writableFiles.length > 0) {
        void refresh();
        setConflicts(remaining.writableFiles);
        setOverwritePaths([]);
        setConflictItems(remaining.items);
        setConflictScopes(scopes);
        setPhase("idle");
        return;
      }
      void refresh();
      setPhase("idle");
      if (event.kind === "completed" || remaining.items.length === 0) callbacks.setNotice(t("syncSucceeded"));
      else callbacks.setError({ kind: "command_failed", message: event.message || t("operationFailed"), hints: [] });
    } catch (reason) {
      setPhase("idle");
      callbacks.setError(normalizeAppError(reason));
    }
  }

  async function start(scopes: string[]) {
    if (phase !== "idle" || activeSync || scopes.length === 0) return;
    callbacks.setError(undefined);
    callbacks.setNotice("");
    setConflicts([]);
    setOverwritePaths([]);
    setConflictItems([]);
    setConflictScopes([]);
    setMergePath(undefined);
    setPhase("syncing");
    try {
      await startObservedOperation("sync", () => startSync(connection, scopes), (event) => {
        if (isOperationTerminal(event.kind)) void finishSafeSync(event, scopes);
      });
    } catch (reason) {
      setPhase("idle");
      callbacks.setError(normalizeAppError(reason));
    }
  }

  async function finishForcedSync(event: OperationEvent, paths: string[]) {
    setPhase("checking");
    const remaining = overwritePathsAfterForce(event.kind, paths);
    setConflicts(remaining);
    setOverwritePaths(remaining);
    if (remaining.length === 0) {
      setConflictItems([]);
      setConflictScopes([]);
    }
    await refresh();
    setPhase("idle");
    if (event.kind === "cancelled") {
      callbacks.setNotice(t("syncCancelled"));
    } else if (remaining.length > 0) {
      callbacks.setError({ kind: "partial_result", message: t("syncConflictChoicesPartiallyApplied"), hints: [], diagnostics: event.message });
    } else if (event.kind === "completed") {
      callbacks.setNotice(t("syncConflictChoicesApplied"));
    } else {
      callbacks.setNotice(t("syncConflictChoicesAppliedWithWarnings"));
    }
  }

  async function finish(overwriteOverride?: string[]) {
    if (phase !== "idle") return;
    const selectedOverwritePaths = overwriteOverride ?? overwritePaths;
    if (selectedOverwritePaths.length === 0) {
      setConflicts([]);
      setConflictItems([]);
      setConflictScopes([]);
      setMergePath(undefined);
      callbacks.setNotice(t("syncKeptWritableFiles"));
      await refresh();
      return;
    }
    setPhase("forcing");
    callbacks.setError(undefined);
    const selectedOverwriteScopes = exactOverwriteScopes(selectedOverwritePaths, conflictItems, conflictScopes);
    try {
      await startObservedOperation("sync", () => startSync(connection, selectedOverwriteScopes, true), (event) => {
        if (!isOperationTerminal(event.kind)) return;
        void finishForcedSync(event, selectedOverwritePaths);
      });
    } catch (reason) {
      setPhase("idle");
      callbacks.setError(normalizeAppError(reason));
    }
  }

  return {
    phase: phase === "idle" && activeSync ? "syncing" : phase,
    conflicts,
    overwritePaths,
    connection,
    mergeItem: conflictItems.find((item) => item.depotPath === mergePath),
    start,
    setOverwrite: (path, overwrite) => setOverwritePaths((current) => updateOverwritePaths(current, path, overwrite)),
    setAllOverwrite: (overwrite) => setOverwritePaths(overwrite ? conflicts : []),
    openMerge: (path) => {
      if (conflictItems.some((item) => item.depotPath === path && item.revision)) setMergePath(path);
    },
    canMerge: (path) => conflictItems.some((item) => item.depotPath === path && item.revision),
    closeMerge: () => setMergePath(undefined),
    completeMerge: (path) => {
      setMergePath(undefined);
      setConflicts((current) => {
        const next = current.filter((item) => item !== path);
        if (next.length === 0) {
          setConflictItems([]);
          setConflictScopes([]);
          void refresh();
          callbacks.setNotice(t("syncConflictChoicesApplied"));
        }
        return next;
      });
      setOverwritePaths((current) => current.filter((item) => item !== path));
    },
    finish,
  };
}

export function SyncPreviewDetails({ preview, acknowledged, onAcknowledged }: {
  preview: SyncPreview;
  acknowledged: boolean;
  onAcknowledged: (acknowledged: boolean) => void;
}) {
  const { t } = useLocale();
  return <>
    <p>{preview.items.length ? `${preview.items.length} ${t("filesCount")} · ${preview.totalBytes} bytes` : t("noSyncChanges")}</p>
    {preview.modifiedFiles.length > 0 && <div className="warning-banner">
      <strong>{t("syncModifiedTitle")}</strong>
      <p>{t("syncModifiedBody")}</p>
      {preview.modifiedFiles.slice(0, 50).map((path) => <div className="preview-row" key={path}><span>{path}</span></div>)}
      <label className="check-field"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} /><span><strong>{t("syncModifiedAcknowledge")}</strong></span></label>
    </div>}
    <div className="resource-detail-list">{preview.items.slice(0, 100).map((item) => <div className="resource-detail-row" key={`${item.depotPath}-${item.action}`}><span><strong>{item.depotPath}</strong><small>{item.action}{item.bytes ? ` · ${item.bytes} B` : ""}</small></span></div>)}</div>
  </>;
}

export function SyncPreviewDialog({ preview, busy, acknowledged, onAcknowledged, title, confirmLabel, onClose, onConfirm }: {
  preview?: SyncPreview;
  busy: boolean;
  acknowledged: boolean;
  onAcknowledged: (acknowledged: boolean) => void;
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return <Modal title={title || t("syncPreviewTitle")} busy={busy} onClose={onClose}>
    {preview ? <>
      <div className="dialog-body"><SyncPreviewDetails preview={preview} acknowledged={acknowledged} onAcknowledged={onAcknowledged} /></div>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className="primary-button" type="button" onClick={onConfirm} disabled={busy || preview.items.length === 0 || (preview.modifiedFiles.length > 0 && !acknowledged)}>{confirmLabel || t("syncNow")}</button></div>
    </> : <div className="dialog-body sync-preview-loading" role="status"><span className="folder-loading-indicator" aria-hidden="true" /><div><strong>{t("preparingUpdate")}</strong><p>{t("preparingUpdateBody")}</p></div></div>}
  </Modal>;
}

export function DateSyncDialog({ connection, scopes, serverDate, onClose, onConfirm }: {
  connection: ConnectionInput;
  scopes: string[];
  serverDate?: string;
  onClose: () => void;
  onConfirm: (datedScopes: string[]) => void;
}) {
  const { t } = useLocale();
  const [target, setTarget] = useState(() => serverDateInputValue(serverDate));
  const [preview, setPreview] = useState<DateSyncPreview>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();

  async function review() {
    if (!target) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await previewSyncAtDate(connection, scopes, target));
      setAcknowledged(false);
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={t("dateSyncTitle")} busy={busy} onClose={onClose}>
    <div className="dialog-body" data-agent-id="date-sync-dialog">
      {error && <div className="diff-warning" role="alert"><strong>{error.message}</strong>{error.hints.map((hint) => <div key={hint}>{hint}</div>)}</div>}
      {preview ? <>
        <p>{t("dateSyncReviewBody")}</p>
        <dl className="dialog-facts"><dt>{t("dateSyncTarget")}</dt><dd>{preview.targetDateTime} {preview.serverTimeZone}</dd><dt>{t("dateSyncServerNow")}</dt><dd>{preview.serverDate}</dd></dl>
        <SyncPreviewDetails preview={preview.preview} acknowledged={acknowledged} onAcknowledged={setAcknowledged} />
      </> : <>
        <p>{t("dateSyncBody")}</p>
        <label className="field"><span className="field-label">{t("dateSyncServerDateTime")}</span><input data-agent-id="date-sync-target" type="datetime-local" step="1" value={target} max={serverDateInputValue(serverDate) || undefined} onChange={(event) => { setTarget(event.target.value); setPreview(undefined); setError(undefined); }} /></label>
        <dl className="dialog-facts"><dt>{t("dateSyncServerNow")}</dt><dd>{serverDate || t("dateSyncServerUnknown")}</dd><dt>{t("dateSyncScope")}</dt><dd>{scopes.join(" · ")}</dd></dl>
      </>}
    </div>
    <div className="dialog-actions">
      {preview && <button className="secondary-button" type="button" onClick={() => setPreview(undefined)} disabled={busy}>{t("back")}</button>}
      <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button>
      {preview
        ? <button className="primary-button" data-agent-id="date-sync-confirm" type="button" onClick={() => onConfirm(preview.scopes)} disabled={busy || preview.preview.items.length === 0 || (preview.preview.modifiedFiles.length > 0 && !acknowledged)}>{t("dateSyncRetrieve")}</button>
        : <button className="primary-button" data-agent-id="date-sync-preview" type="button" onClick={() => void review()} disabled={busy || !target}>{t("dateSyncPreview")}</button>}
    </div>
  </Modal>;
}

export function SafeSyncConflictDialog({ sync }: { sync: SafeSyncController }) {
  const { t } = useLocale();
  if (sync.mergeItem?.revision) return <ResolveDialog
    connection={sync.connection}
    item={sync.mergeItem}
    loadContent={(connection, depotPath) => loadSyncMergeContent(connection, depotPath, sync.mergeItem!.revision!)}
    saveResult={(connection, depotPath, localPath, previewToken, result) => saveSyncMergeResult(connection, depotPath, sync.mergeItem!.revision!, localPath, previewToken, result)}
    onClose={sync.closeMerge}
    onResolved={() => sync.completeMerge(sync.mergeItem!.depotPath)}
    onError={() => undefined}
  />;
  if (!shouldShowSyncConflictDialog(sync.conflicts, sync.phase)) return null;
  const busy = sync.phase !== "idle";
  return <Modal title={t("syncWritableConflictsTitle")} busy={busy} onClose={() => void sync.finish([])}>
    <div className="dialog-body">
      <p>{t("syncWritableConflictsBody")}</p>
      <div className="sync-conflict-toolbar"><button className="secondary-button" type="button" onClick={() => sync.setAllOverwrite(false)} disabled={busy}>{t("keepAllLocal")}</button><button className="secondary-button" type="button" onClick={() => sync.setAllOverwrite(true)} disabled={busy}>{t("overwriteAllFromDepot")}</button></div>
      <div className="sync-conflict-list">{sync.conflicts.map((path) => {
        const overwrite = sync.overwritePaths.includes(path);
        return <label className="sync-conflict-row" key={path}><span><strong>{path.split("/").at(-1) || path}</strong><small title={path}>{path}</small></span><div><select value={overwrite ? "overwrite" : "keep"} onChange={(event) => sync.setOverwrite(path, event.target.value === "overwrite")} disabled={busy}><option value="keep">{t("keepLocalFile")}</option><option value="overwrite">{t("overwriteFromDepot")}</option></select><button type="button" className="secondary-button" onClick={() => sync.openMerge(path)} disabled={busy || !sync.canMerge(path)}>{t("resolveEditor")}</button></div></label>;
      })}</div>
    </div>
    <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => void sync.finish([])} disabled={busy}>{t("keepAllLocal")}</button><button className={sync.overwritePaths.length ? "danger-button" : "primary-button"} type="button" onClick={() => void sync.finish()} disabled={busy}>{busy ? t("updatingProject") : t("finishUpdate")}</button></div>
  </Modal>;
}
