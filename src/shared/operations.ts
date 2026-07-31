import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import type {
  ConnectionInput,
  OperationDiagnostic,
  OperationEvent,
  OperationEventKind,
  OperationItemResult,
  OperationReadBack,
} from "./models";

export interface OperationSnapshot {
  operationId: string;
  operationKind: string;
  status: OperationEventKind;
  processed: number;
  totalFiles?: number;
  processedBytes: number;
  totalBytes?: number;
  startedAt: number;
  phaseStartedAt: number;
  currentPath?: string;
  message?: string;
  scope?: string;
  scopes?: string[];
  phase?: string;
  diagnostics: OperationDiagnostic[];
  itemResults: OperationItemResult[];
  readBack?: OperationReadBack;
  retryable: boolean;
  cancellable: boolean;
  connectionKey?: string;
}

export function operationConnectionKey(connection: ConnectionInput): string {
  return JSON.stringify([
    connection.p4Path || "",
    connection.port,
    connection.user,
    connection.client || "",
    connection.charset || "",
    connection.p4Config || "",
    connection.p4Enviro || "",
  ]);
}

export function reduceOperationSnapshots(current: OperationSnapshot[], event: OperationEvent, connectionKey?: string): OperationSnapshot[] {
  const next = [...current];
  const index = next.findIndex((item) => item.operationId === event.operationId);
  const previous = index < 0 ? undefined : next[index];
  if (previous && isOperationTerminal(previous.status) && !isOperationTerminal(event.kind)) {
    return current;
  }
  const now = Date.now();
  const retryable = event.retryable
    && event.operationKind === "sync"
    && event.kind !== "unknown";
  const snapshot: OperationSnapshot = {
    operationId: event.operationId,
    operationKind: event.operationKind,
    status: event.kind,
    processed: event.processed,
    totalFiles: event.totalFiles,
    processedBytes: event.processedBytes,
    totalBytes: event.totalBytes,
    startedAt: event.startedAtMs || previous?.startedAt || now,
    phaseStartedAt: previous && previous.phase === event.phase ? previous.phaseStartedAt : now,
    currentPath: event.currentPath ?? previous?.currentPath,
    message: event.message ?? previous?.message,
    scope: event.scope ?? previous?.scope,
    scopes: event.scopes ?? previous?.scopes,
    phase: event.phase ?? previous?.phase,
    diagnostics: event.diagnostics ?? previous?.diagnostics ?? [],
    itemResults: event.itemResults ?? previous?.itemResults ?? [],
    readBack: event.readBack ?? previous?.readBack,
    retryable,
    cancellable: event.cancellable ?? previous?.cancellable ?? true,
    connectionKey: previous?.connectionKey ?? connectionKey,
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
  const ratio = total ? Math.min(1, completed / total) : undefined;
  const elapsedSeconds = Math.max(0, now - item.phaseStartedAt) / 1000;
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
  return status === "started" || status === "progress" || status === "cancel_requested";
}

export function isOperationTerminal(status: OperationEventKind): boolean {
  return !isOperationActive(status);
}

export function operationAnnouncementPriority(status: OperationEventKind): "none" | "polite" | "assertive" {
  if (status === "progress") return "none";
  if (status === "failed" || status === "partial" || status === "unknown") return "assertive";
  return "polite";
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
  let pendingEvents: OperationEvent[] = [];
  let unlisten: () => void = () => undefined;
  unlisten = await listen<OperationEvent>("operation-event", ({ payload }) => {
    if (payload.operationKind !== operationKind) return;
    if (!operationId) {
      pendingEvents.push(payload);
      return;
    }
    if (payload.operationId !== operationId) return;
    onEvent(payload);
    if (isOperationTerminal(payload.kind)) void unlisten();
  });
  try {
    operationId = await start();
    for (const event of pendingEvents) {
      if (event.operationId !== operationId) continue;
      onEvent(event);
      if (isOperationTerminal(event.kind)) {
        void unlisten();
        break;
      }
    }
    pendingEvents = [];
    return operationId;
  } catch (error) {
    pendingEvents = [];
    await unlisten();
    throw error;
  }
}
