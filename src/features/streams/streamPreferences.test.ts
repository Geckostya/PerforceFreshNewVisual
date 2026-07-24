import { describe, expect, it } from "vitest";
import { parseStreamPreferences, streamPreferencesStorageKey } from "./streamPreferences";

describe("stream presentation preferences", () => {
  it("scopes preferences by connection and workspace", () => {
    expect(streamPreferencesStorageKey("p4:1666", "alex", "main"))
      .not.toBe(streamPreferencesStorageKey("p4:1666", "alex", "release"));
  });

  it("validates, deduplicates, and restores preferences", () => {
    expect(parseStreamPreferences(JSON.stringify({
      visiblePaths: ["//main", "//main"],
      collapsedPaths: ["//dev", "//dev"],
      archivedOpen: false,
    }))).toEqual({ visiblePaths: ["//main"], collapsedPaths: ["//dev"], archivedOpen: false });
    expect(parseStreamPreferences('{"visiblePaths":[],"collapsedPaths":[]}')).toBeUndefined();
  });
});
