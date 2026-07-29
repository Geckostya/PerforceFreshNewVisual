import { describe, expect, it } from "vitest";
import { canApplyUnshelve, filterShelves, groupShelvesByUser, nextShelfSelection, shelfTimestamp, splitUnshelvePaths } from "./shelves";

const shelves = [
  { id: "30", description: "Camera prototype", user: "maya", client: "maya-main", stream: "//Game/main", time: "1720000000" },
  { id: "20", description: "Release audio", user: "luca", client: "luca-release", stream: "//Game/release", time: "1719500000" },
  { id: "10", description: "Old tools shelf", user: "maya", client: "maya-tools", stream: "//Game/tools", time: "1710000000" },
];

describe("shelf catalog", () => {
  it("searches shelf metadata and combines user, workspace, stream, and age filters", () => {
    const visible = filterShelves(shelves, {
      query: "camera 30",
      user: "maya",
      client: "maya-main",
      stream: "//Game/main",
      age: "week",
    }, 1720000100);
    expect(visible.map((shelf) => shelf.id)).toEqual(["30"]);
    expect(filterShelves(shelves, { query: "audio", user: "all", client: "all", stream: "all", age: "all" })).toHaveLength(1);
    expect(filterShelves(shelves, { query: "", user: "all", client: "all", stream: "all", age: "day" }, 1720000100).map((shelf) => shelf.id)).toEqual(["30"]);
  });

  it("groups shelves by user while preserving server recency order", () => {
    expect(groupShelvesByUser(shelves)).toEqual([
      { user: "maya", clients: ["maya-main", "maya-tools"], shelves: [shelves[0], shelves[2]] },
      { user: "luca", clients: ["luca-release"], shelves: [shelves[1]] },
    ]);
  });

  it("accepts epoch seconds, epoch milliseconds, and ISO timestamps", () => {
    expect(shelfTimestamp("1720000000")).toBe(1720000000);
    expect(shelfTimestamp("1720000000000")).toBe(1720000000);
    expect(shelfTimestamp("1970-01-01T00:01:40Z")).toBe(100);
    expect(shelfTimestamp("unknown")).toBeUndefined();
  });
});

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
