import { describe, expect, it } from "vitest";
import { formatDownloadSize, updateErrorTranslationKey, updateProgressRatio } from "./updates";

describe("application update progress", () => {
  it("clamps known download progress", () => {
    expect(updateProgressRatio({ downloadedBytes: 50, totalBytes: 100 })).toBe(0.5);
    expect(updateProgressRatio({ downloadedBytes: 120, totalBytes: 100 })).toBe(1);
  });

  it("keeps unknown totals indeterminate", () => {
    expect(updateProgressRatio({ downloadedBytes: 50 })).toBeUndefined();
  });

  it("formats byte counts for the UI", () => {
    expect(formatDownloadSize(512)).toBe("512 B");
    expect(formatDownloadSize(1536)).toBe("1.5 KB");
    expect(formatDownloadSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("maps backend update failures to update-specific localized copy", () => {
    expect(updateErrorTranslationKey("offline")).toBe("updateErrorOffline");
    expect(updateErrorTranslationKey("timeout")).toBe("updateErrorOffline");
    expect(updateErrorTranslationKey("unsupported_capability")).toBe("updateErrorUnsupported");
    expect(updateErrorTranslationKey("invalid_output")).toBe("updateErrorInvalid");
    expect(updateErrorTranslationKey("command_failed")).toBe("updateErrorGeneric");
  });
});
