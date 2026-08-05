import { describe, expect, it } from "vitest";
import type { AppError } from "./models";
import { resourceFailureFreshness } from "./resourceSnapshot";

const appError = (kind: AppError["kind"]): AppError => ({ kind, message: kind, hints: [] });

describe("resource snapshots", () => {
  it("does not collapse permission, server limit, and disconnected initial load", () => {
    expect(resourceFailureFreshness(true, appError("permission"))).toBe("permission");
    expect(resourceFailureFreshness(true, appError("server_limit"))).toBe("partial");
    expect(resourceFailureFreshness(false, appError("offline"))).toBe("offline");
  });
});
