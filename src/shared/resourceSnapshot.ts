import type { AppError, ResourceFreshness, ResourceSnapshot } from "./models";

export function resourceFailureFreshness(hasSnapshot: boolean, error: AppError): ResourceFreshness {
  if (error.kind === "permission") return "permission";
  if (error.kind === "partial_result" || error.kind === "server_limit") return "partial";
  if (error.kind === "offline" || error.kind === "timeout") return hasSnapshot ? "stale" : "offline";
  return hasSnapshot ? "stale" : "error";
}

export function mutationBlockReason<T>(snapshot: ResourceSnapshot<T>): string | undefined {
  if (snapshot.freshness === "fresh") return undefined;
  if (snapshot.freshness === "loading" && snapshot.data === undefined) return "loading";
  return snapshot.error?.kind ?? snapshot.freshness;
}
