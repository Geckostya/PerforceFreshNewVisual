import { describe, expect, it } from "vitest";
import { autoResolvableSyncPaths, exactOverwriteScopes, overwritePathsAfterForce, serverDateInputValue, shouldShowSyncConflictDialog, updateOverwritePaths } from "./SafeSync";

describe("safe sync writable choices", () => {
  it("keeps overwrite choices unique and removable per file", () => {
    expect(updateOverwritePaths(["//depot/a"], "//depot/a", true)).toEqual(["//depot/a"]);
    expect(updateOverwritePaths(["//depot/a"], "//depot/b", true)).toEqual(["//depot/a", "//depot/b"]);
    expect(updateOverwritePaths(["//depot/a", "//depot/b"], "//depot/a", false)).toEqual(["//depot/b"]);
  });

  it("keeps the full overwrite selection until backend completion", () => {
    const paths = ["//depot/a", "//depot/b"];
    expect(overwritePathsAfterForce("failed", paths)).toBe(paths);
    expect(overwritePathsAfterForce("cancelled", paths)).toBe(paths);
    expect(overwritePathsAfterForce("completed", paths)).toEqual([]);
  });

  it("closes the conflict dialog while the selected update runs", () => {
    const paths = ["//depot/a"];
    expect(shouldShowSyncConflictDialog(paths, "idle")).toBe(true);
    expect(shouldShowSyncConflictDialog(paths, "forcing")).toBe(false);
    expect(shouldShowSyncConflictDialog(paths, "checking")).toBe(false);
  });

  it("keeps requested revisions when a writable conflict is force-synced", () => {
    expect(exactOverwriteScopes(["//Acme/main/a.txt", "//Acme/main/b.txt"], [
      { depotPath: "//Acme/main/a.txt", action: "updated", revision: "7" },
      { depotPath: "//Acme/main/b.txt", action: "updated" },
    ])).toEqual(["//Acme/main/a.txt#7", "//Acme/main/b.txt"]);
    expect(exactOverwriteScopes(["//Acme/main/deleted.txt"], [
      { depotPath: "//Acme/main/deleted.txt", action: "deleted" },
    ], ["//Acme/main/...@2026/07/01:12:00:00"])).toEqual([
      "//Acme/main/deleted.txt@2026/07/01:12:00:00",
    ]);
  });

  it("auto-resolves only files unchanged from the recorded depot revision", () => {
    expect(autoResolvableSyncPaths({
      items: [
        { depotPath: "//Acme/main/metadata-only.txt", action: "updated", revision: "7" },
        { depotPath: "//Acme/main/local-edit.txt", action: "updated", revision: "8" },
      ],
      totalBytes: 0,
      modifiedFiles: ["//acme/main/local-edit.txt"],
      writableFiles: ["//Acme/main/local-edit.txt"],
      missingHaveFiles: [],
    })).toEqual(["//Acme/main/metadata-only.txt"]);
  });

  it("uses the server wall clock as the date-input default without dropping seconds", () => {
    expect(serverDateInputValue("2026/07/30 13:15:42 +0200 CEST")).toBe("2026-07-30T13:15:42");
    expect(serverDateInputValue("not a server date")).toBe("");
  });
});
