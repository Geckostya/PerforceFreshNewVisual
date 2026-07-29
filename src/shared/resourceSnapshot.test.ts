import { describe, expect, it } from "vitest";
import type { AppError, ResourceSnapshot } from "./models";
import {
  acceptResourceSnapshot,
  beginResourceRefresh,
  canMutateResource,
  rejectResourceRefresh,
  resourceFailureFreshness,
} from "./resourceSnapshot";

const appError = (kind: AppError["kind"]): AppError => ({ kind, message: kind, hints: [] });

describe("resource snapshots", () => {
  it("keeps the last successful DTO and timestamp when refresh fails", () => {
    const fresh = acceptResourceSnapshot(["//main/a"], 1_000);
    const stale = rejectResourceRefresh(beginResourceRefresh(fresh), appError("offline"));

    expect(stale).toMatchObject({
      freshness: "stale",
      data: ["//main/a"],
      lastSuccessfulAt: 1_000,
      error: { kind: "offline" },
    });
    expect(canMutateResource(stale)).toBe(false);
  });

  it("requires an authoritative success before mutations are enabled again", () => {
    const snapshot: ResourceSnapshot<string[]> = {
      freshness: "stale",
      data: ["cached"],
      error: appError("timeout"),
      lastSuccessfulAt: 1,
    };

    expect(canMutateResource(beginResourceRefresh(snapshot))).toBe(false);
    expect(canMutateResource(acceptResourceSnapshot(["current"], 2))).toBe(true);
  });

  it("does not collapse permission, server limit, and disconnected initial load", () => {
    expect(resourceFailureFreshness(true, appError("permission"))).toBe("permission");
    expect(resourceFailureFreshness(true, appError("server_limit"))).toBe("partial");
    expect(resourceFailureFreshness(false, appError("offline"))).toBe("offline");
  });
});
