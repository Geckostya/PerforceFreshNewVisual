import type { ConnectionInput } from "./models";
import { useSyncExternalStore } from "react";

type Entry<T> = { data?: T; updatedAt?: number; pending?: Promise<T> };

const entries = new Map<string, Entry<unknown>>();
const listeners = new Set<() => void>();
let revision = 0;
const REVALIDATE_AFTER_MS = 15_000;

function connectionScope(connection: ConnectionInput) {
  return [connection.port, connection.user, connection.client, connection.charset || "auto", connection.p4Path || "default"].join("|");
}

export function perforceResourceKey(connection: ConnectionInput, resource: string, parameters = "") {
  return `${connectionScope(connection)}:${resource}:${parameters}`;
}

export function readPerforceResource<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const entry = entries.get(key) as Entry<T> | undefined;
  const needsRefresh = entry?.updatedAt === undefined || now - entry.updatedAt >= REVALIDATE_AFTER_MS;
  if (entry?.data !== undefined) {
    if (needsRefresh && !entry.pending) refreshPerforceResource(key, load, now);
    return Promise.resolve(entry.data);
  }
  return refreshPerforceResource(key, load, now);
}

export function refreshPerforceResource<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const current = entries.get(key) as Entry<T> | undefined;
  if (current?.pending) return current.pending;
  const entry: Entry<T> = current || {};
  const pending = load().then((data) => {
    entries.set(key, { data, updatedAt: now });
    revision += 1;
    listeners.forEach((listener) => listener());
    return data;
  }).catch((error) => {
    entries.set(key, { data: entry.data, updatedAt: entry.updatedAt });
    throw error;
  });
  entry.pending = pending;
  entries.set(key, entry);
  return pending;
}

export function invalidatePerforceResources(connection: ConnectionInput) {
  const prefix = `${connectionScope(connection)}:`;
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function usePerforceResourceVersion() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => revision,
    () => revision,
  );
}
