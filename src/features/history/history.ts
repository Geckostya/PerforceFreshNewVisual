import type { PendingChange, StreamSummary, SubmittedFile } from "../../shared/models";

export const SUBMITTED_DETAIL_PREVIEW_LIMIT = 200;

export function isLargeSubmittedChange(fileCount: number, truncated: boolean): boolean {
  return truncated || fileCount > SUBMITTED_DETAIL_PREVIEW_LIMIT;
}

export function nextSubmittedFileRenderLimit(current: number, total: number): number {
  return Math.min(total, Math.max(SUBMITTED_DETAIL_PREVIEW_LIMIT, current + SUBMITTED_DETAIL_PREVIEW_LIMIT));
}

export function filterSubmittedChanges(changes: PendingChange[], query: string, user: string, client: string): PendingChange[] {
  const needle = query.trim().toLowerCase();
  return changes.filter((change) => {
    const matchesQuery = !needle || [change.id, change.description, change.user, change.client]
      .some((value) => value.toLowerCase().includes(needle));
    return matchesQuery
      && (!user || change.user.toLowerCase() === user.toLowerCase())
      && (!client || change.client.toLowerCase() === client.toLowerCase());
  });
}

export function previousRevision(revision?: string): string | undefined {
  if (!revision || !/^\d+$/.test(revision)) return undefined;
  const number = Number(revision);
  return number > 1 ? String(number - 1) : undefined;
}

export function submittedScope(currentStream: string | undefined, streamFilter: "all" | "current"): string {
  return streamFilter === "current" && currentStream ? `${currentStream.replace(/\/+$/, "")}/...` : "//...";
}

export function submittedChangeStream(files: SubmittedFile[], streams: StreamSummary[]): string | undefined {
  if (files.length === 0) return undefined;
  const candidates = streams
    .map((stream) => ({ path: stream.path, prefix: `${stream.path.replace(/\/+$/, "")}/` }))
    .sort((left, right) => right.prefix.length - left.prefix.length);
  let source: string | undefined;
  for (const file of files) {
    const match = candidates.find((candidate) => file.depotPath.startsWith(candidate.prefix))?.path;
    if (!match || (source && match !== source)) return undefined;
    source = match;
  }
  return source;
}

export function submittedRevisionScopes(files: SubmittedFile[]): string[] {
  return files
    .filter((file): file is SubmittedFile & { revision: string } => Boolean(file.revision && /^\d+$/.test(file.revision)))
    .map((file) => `${file.depotPath}#${file.revision}`);
}
