export type ArchiveKind = "changes" | "streams";

export const ARCHIVE_DRAG_TYPE = "application/x-p4fnv-unactual";

export interface ArchiveDragItem {
  kind: ArchiveKind;
  ids: string[];
  archived: boolean;
}

export function encodeArchiveDrag(item: ArchiveDragItem): string {
  return JSON.stringify(item);
}

export function decodeArchiveDrag(value: string): ArchiveDragItem | undefined {
  try {
    const item = JSON.parse(value) as Partial<ArchiveDragItem>;
    if ((item.kind !== "changes" && item.kind !== "streams")
      || typeof item.archived !== "boolean"
      || !Array.isArray(item.ids)
      || item.ids.length === 0
      || item.ids.some((id) => typeof id !== "string" || !id)) return undefined;
    return { kind: item.kind, ids: [...new Set(item.ids)], archived: item.archived };
  } catch {
    return undefined;
  }
}

export function archiveStorageKey(kind: ArchiveKind, port: string, user: string, client: string | undefined): string {
  return `p4fnv:unactual:${kind}:${encodeURIComponent(port)}:${encodeURIComponent(user)}:${encodeURIComponent(client || "")}`;
}

export function loadArchivedIds(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
  } catch {
    return [];
  }
}

export function saveArchivedIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(ids)]));
  } catch {
    // Presentation-only state must never block Perforce workflows.
  }
}

export function retainArchivedIds(ids: string[], availableIds: string[], snapshotReady = true): string[] {
  if (!snapshotReady) return ids;
  const available = new Set(availableIds);
  return ids.filter((id) => available.has(id));
}

export function partitionArchived<T>(items: T[], archivedIds: string[], getId: (item: T) => string): { current: T[]; archived: T[] } {
  const archived = new Set(archivedIds);
  return {
    current: items.filter((item) => !archived.has(getId(item))),
    archived: items.filter((item) => archived.has(getId(item))),
  };
}
