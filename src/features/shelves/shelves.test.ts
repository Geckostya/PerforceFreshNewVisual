import { describe, expect, it } from "vitest";
import { canApplyUnshelve, nextShelfSelection, splitUnshelvePaths } from "./shelves";

describe("shelf unshelve safety", () => {
  it("does not retain a shelf selection from another workspace", () => {
    const shelves = [
      { id: "20", description: "new", user: "alex", client: "main" },
      { id: "10", description: "old", user: "alex", client: "main" },
    ];
    expect(nextShelfSelection(shelves, "10")).toBe("10");
    expect(nextShelfSelection(shelves, "999")).toBe("20");
    expect(nextShelfSelection([], "999")).toBeUndefined();
  });

  it("keeps conflicts skipped unless each overwrite is explicit", () => {
    const preview = { conflicts: [{ depotPath: "//main/a", localPath: "C:/a" }] };
    expect(canApplyUnshelve(undefined, ["//main/a"])).toBe(false);
    expect(canApplyUnshelve(preview, ["//main/a"])).toBe(false);
    expect(splitUnshelvePaths(["//main/a", "//main/b"], preview, [])).toEqual({ normalPaths: ["//main/b"], forcePaths: [] });
    expect(canApplyUnshelve(preview, ["//main/a", "//main/b"], ["//main/a"])).toBe(true);
    expect(splitUnshelvePaths(["//main/a", "//main/b"], preview, ["//main/a"])).toEqual({ normalPaths: ["//main/b"], forcePaths: ["//main/a"] });
    expect(canApplyUnshelve({ conflicts: [] }, ["//main/b"])).toBe(true);
    expect(canApplyUnshelve({ conflicts: [] }, [])).toBe(false);
  });
});
