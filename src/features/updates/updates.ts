import type { TranslationKey } from "../../shared/i18n";
import type { ErrorKind, UpdateDownloadProgress } from "../../shared/models";

export function updateErrorTranslationKey(kind: ErrorKind): TranslationKey {
  if (kind === "offline" || kind === "timeout") return "updateErrorOffline";
  if (kind === "permission") return "updateErrorPermission";
  if (kind === "unsupported_capability") return "updateErrorUnsupported";
  if (kind === "invalid_output") return "updateErrorInvalid";
  if (kind === "conflict") return "updateErrorConflict";
  if (kind === "stale") return "updateErrorStale";
  return "updateErrorGeneric";
}

export function updateProgressRatio(progress?: UpdateDownloadProgress): number | undefined {
  if (!progress?.totalBytes || progress.totalBytes <= 0) return undefined;
  return Math.max(0, Math.min(1, progress.downloadedBytes / progress.totalBytes));
}

export function formatDownloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
