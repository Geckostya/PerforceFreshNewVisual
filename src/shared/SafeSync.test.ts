import { describe, expect, it } from "vitest";
import { overwritePathsAfterForce, updateOverwritePaths } from "./SafeSync";

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
});
