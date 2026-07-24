import { describe, expect, it } from "vitest";
import type { StreamSummary } from "../../shared/models";
import { buildStreamForest, flattenStreamForest, layoutStreamGraph, streamDescendantPaths, streamSubtreePaths, updateArchivedStreamPaths, updateStreamVisibility } from "./streams";

const stream = (path: string, parent?: string): StreamSummary => ({
  path,
  name: path.split("/").at(-1) || path,
  parent,
  streamType: parent ? "development" : "mainline",
  description: "",
});

describe("stream hierarchy", () => {
  it("builds parent-child trees and keeps orphaned streams visible", () => {
    const forest = buildStreamForest([
      stream("//Acme/dev", "//Acme/main"),
      stream("//Other/task", "//Other/missing"),
      stream("//Acme/main"),
    ]);
    expect(forest.map((node) => node.stream.path)).toEqual(["//Acme/main", "//Other/task"]);
    expect(forest[0].children[0].stream.path).toBe("//Acme/dev");
  });

  it("lays out enabled streams and creates only visible edges", () => {
    const graph = layoutStreamGraph([stream("//Acme/main"), stream("//Acme/dev", "//Acme/main")]);
    expect(graph.edges).toEqual([{ from: "//Acme/main", to: "//Acme/dev" }]);
    expect(graph.nodes[1].x).toBeGreaterThan(graph.nodes[0].x);
  });

  it("finds a complete subtree for hierarchical visibility", () => {
    const streams = [stream("//Acme/main"), stream("//Acme/dev", "//Acme/main"), stream("//Acme/task", "//Acme/dev")];
    expect(streamSubtreePaths(streams, "//Acme/dev")).toEqual(["//Acme/dev", "//Acme/task"]);
    expect(streamDescendantPaths(streams, "//Acme/dev")).toEqual(["//Acme/task"]);
    expect(flattenStreamForest(buildStreamForest(streams)).map((item) => item.path)).toEqual([
      "//Acme/main", "//Acme/dev", "//Acme/task",
    ]);
    expect(flattenStreamForest(buildStreamForest(streams), new Set(["//Acme/dev"])).map((item) => item.path)).toEqual([
      "//Acme/main", "//Acme/dev",
    ]);
  });

  it("shows selected roots but hides their complete branches as one batch", () => {
    const streams = [stream("//Acme/main"), stream("//Acme/dev", "//Acme/main"), stream("//Acme/task", "//Acme/dev")];
    const visible = new Set(streams.map((item) => item.path));
    expect([...updateStreamVisibility(streams, visible, ["//Acme/dev"], false)]).toEqual(["//Acme/main"]);
    expect([...updateStreamVisibility(streams, new Set(), ["//Acme/dev"], true)]).toEqual(["//Acme/dev"]);
  });

  it("archives complete branches but restores only selected roots", () => {
    const streams = [stream("//Acme/main"), stream("//Acme/dev", "//Acme/main"), stream("//Acme/task", "//Acme/dev")];
    expect(updateArchivedStreamPaths(streams, [], ["//Acme/dev"], true)).toEqual(["//Acme/dev", "//Acme/task"]);
    expect(updateArchivedStreamPaths(streams, ["//Acme/dev", "//Acme/task"], ["//Acme/dev"], false)).toEqual(["//Acme/task"]);
  });
});
