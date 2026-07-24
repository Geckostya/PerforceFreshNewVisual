import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import type { OperationEvent, OperationEventKind } from "./models";

export interface OperationSnapshot {
  operationId: string;
  operationKind: string;
  status: OperationEventKind;
  processed: number;
  totalFiles?: number;
  processedBytes: number;
  totalBytes?: number;
  startedAt: number;
  currentPath?: string;
  message?: string;
  scope?: string;
  scopes?: string[];
  retryable: boolean;
}

export function reduceOperationSnapshots(current: OperationSnapshot[], event: OperationEvent): OperationSnapshot[] {
  const next = [...current];
  const index = next.findIndex((item) => item.operationId === event.operationId);
  const snapshot: OperationSnapshot = {
    operationId: event.operationId,
    operationKind: event.operationKind,
    status: event.kind,
    processed: event.processed,
    totalFiles: event.totalFiles,
    processedBytes: event.processedBytes,
    totalBytes: event.totalBytes,
    startedAt: index < 0 ? Date.now() : next[index].startedAt,
    currentPath: event.currentPath,
    message: event.message,
    scope: event.scope,
    scopes: event.scopes,
    retryable: event.retryable,
  };
  if (index < 0) next.push(snapshot);
  else next[index] = { ...next[index], ...snapshot };
  return next.slice(-30);
}

export function operationProgress(item: OperationSnapshot, now = Date.now()): { ratio?: number; remaining?: number; etaSeconds?: number } {
  const remaining = item.totalFiles === undefined ? undefined : Math.max(0, item.totalFiles - item.processed);
  const useBytes = Boolean(item.totalBytes && item.processedBytes > 0);
  const completed = useBytes ? item.processedBytes : item.processed;
  const total = useBytes ? item.totalBytes : item.totalFiles;
  const ratio = total && completed > 0 ? Math.min(1, completed / total) : undefined;
  const elapsedSeconds = Math.max(0, now - item.startedAt) / 1000;
  const etaSeconds = total && completed > 0 && completed < total && elapsedSeconds >= 2
    ? Math.round(elapsedSeconds * (total - completed) / completed)
    : undefined;
  return { ratio, remaining, etaSeconds };
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)}m`;
  return `~${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
}

export function isOperationActive(status: OperationEventKind): boolean {
  return status === "started" || status === "progress";
}

export function isOperationTerminal(status: OperationEventKind): boolean {
  return !isOperationActive(status);
}

export function useActiveOperation(operationKind: string): OperationSnapshot | undefined {
  const [items, setItems] = useState<OperationSnapshot[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<OperationEvent>("operation-event", ({ payload }) => {
      if (!disposed && payload.operationKind === operationKind) {
        setItems((current) => reduceOperationSnapshots(current, payload));
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [operationKind]);
  return useMemo(() => [...items].reverse().find((item) => isOperationActive(item.status)), [items]);
}

export async function startObservedOperation(operationKind: string, start: () => Promise<string>, onEvent: (event: OperationEvent) => void): Promise<string> {
  let operationId = "";
  let unlisten: () => void = () => undefined;
  unlisten = await listen<OperationEvent>("operation-event", ({ payload }) => {
    if (payload.operationKind !== operationKind) return;
    if (!operationId) operationId = payload.operationId;
    if (payload.operationId !== operationId) return;
    onEvent(payload);
    if (isOperationTerminal(payload.kind)) void unlisten();
  });
  try {
    operationId = await start();
    return operationId;
  } catch (error) {
    await unlisten();
    throw error;
  }
}
