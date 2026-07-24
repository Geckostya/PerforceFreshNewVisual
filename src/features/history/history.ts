import type { PendingChange } from "../../shared/models";

export function filterSubmittedChanges(changes: PendingChange[], query: string, user: string, client: string): PendingChange[] {
  const needle = query.trim().toLowerCase();
  return changes.filter((change) => {
    const matchesQuery = !needle || [change.id, change.description, change.user, change.client]
      .some((value) => value.toLowerCase().includes(needle));
    return matchesQuery && (!user || change.user === user) && (!client || change.client === client);
  });
}

export function previousRevision(revision?: string): string | undefined {
  if (!revision || !/^\d+$/.test(revision)) return undefined;
  const number = Number(revision);
  return number > 1 ? String(number - 1) : undefined;
}
