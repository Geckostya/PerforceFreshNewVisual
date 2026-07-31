import { describe, expect, it } from "vitest";
import { buildRevisionGraph, REVISION_GRAPH_EDGE_LIMIT, REVISION_GRAPH_NODE_LIMIT } from "./revisionGraph";

describe("buildRevisionGraph", () => {
  it("uses only server integration records as edges", () => {
    const graph = buildRevisionGraph([{ revision: "7", change: "12", action: "edit", user: "alex", integrationRecords: [{ how: "merge", filePath: "//Acme/dev/a.txt", startRevision: "3", endRevision: "6", complete: true, cyclic: false }], labels: [] }]);
    expect(graph.edges).toEqual([{ source: "//Acme/dev/a.txt#3–6", target: "#7", how: "merge" }]);
  });

  it("does not invent an edge when filelog omits its source path", () => {
    const graph = buildRevisionGraph([{ revision: "7", change: "12", action: "edit", user: "alex", integrationRecords: [{ how: "merge", complete: false, cyclic: false }], labels: [] }]);
    expect(graph.edges).toEqual([]);
    expect(graph.partial).toBe(true);
  });

  it("bounds graph records and reports a partial graph", () => {
    const revision = (number: number) => ({ revision: String(number), change: String(number), action: "edit", user: "alex", integrationRecords: Array.from({ length: 3 }, () => ({ how: "merge", filePath: "//Acme/dev/a.txt", complete: false, cyclic: false })), labels: [] });
    const graph = buildRevisionGraph(Array.from({ length: REVISION_GRAPH_NODE_LIMIT + 1 }, (_, index) => revision(index + 1)), true);
    expect(graph.edges).toHaveLength(REVISION_GRAPH_EDGE_LIMIT);
    expect(graph.partial).toBe(true);
  });
});
