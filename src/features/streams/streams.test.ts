import { describe, expect, it } from "vitest";
import type { CapabilitySnapshot, OperationEvent, StreamSummary } from "../../shared/models";
import { buildStreamForest, childStreamPath, flattenStreamForest, isValidStreamName, layoutStreamGraph, mergeSelectedStreamViewPaths, streamDescendantPaths, streamIntegrationAllowed, streamIntegrationCandidates, streamIntegrationCandidatesForSelection, streamIntegrationHandoff, streamSubtreePaths, updateArchivedStreamPaths, updateStreamVisibility } from "./streams";

const stream = (path: string, parent?: string): StreamSummary => ({
  path,
  name: path.split("/").at(-1) || path,
  parent,
  streamType: parent ? "development" : "mainline",
  description: "",
});

describe("stream hierarchy", () => {
  it("gates integration on its command and every required flag without blocking unknown probes", () => {
    const supported = { state: "supported", reason: "verified_help", evidence: "client" } as const;
    const unsupported = { state: "unsupported", reason: "flag_missing", evidence: "client" } as const;
    const capabilities = {
      commands: { integrate: supported, copy: supported },
      flags: {
        integrateStream: supported,
        integrateReverse: supported,
        integrateForceBranch: unsupported,
        copyStream: supported,
        copyForceBranch: supported,
      },
    } as CapabilitySnapshot;

    expect(streamIntegrationAllowed(capabilities, "mergeDown")).toBe(false);
    expect(streamIntegrationAllowed(capabilities, "copyUp")).toBe(true);
    expect(streamIntegrationAllowed(undefined, "mergeDown")).toBe(true);
  });

  it("derives the child path and validates the conservative stream name subset", () => {
    expect(childStreamPath("//Acme/main", "feature-login")).toBe("//Acme/feature-login");
    expect(isValidStreamName("release-1.0_rc")).toBe(true);
    expect(isValidStreamName("feature/login")).toBe(false);
    expect(isValidStreamName("-feature")).toBe(false);
  });

  it("replaces the catch-all default with selected workspace folders", () => {
    expect(mergeSelectedStreamViewPaths(
      [{ kind: "share", viewPath: "..." }],
      ["Source/...", "Content/..."],
    )).toEqual([
      { kind: "share", viewPath: "Source/..." },
      { kind: "share", viewPath: "Content/..." },
    ]);
    expect(mergeSelectedStreamViewPaths(
      [{ kind: "exclude", viewPath: "Build/..." }],
      ["Build/...", "Source/...", "Source/..."],
    )).toEqual([
      { kind: "exclude", viewPath: "Build/..." },
      { kind: "share", viewPath: "Source/..." },
    ]);
  });

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

  it("derives only parent/child integrations whose target is the current workspace stream", () => {
    const streams = [stream("//Acme/main"), stream("//Acme/dev", "//Acme/main"), stream("//Acme/task", "//Acme/dev")];
    expect(streamIntegrationCandidates(streams, "//Acme/dev")).toEqual([
      { direction: "mergeDown", sourceStream: "//Acme/main", targetStream: "//Acme/dev" },
      { direction: "copyUp", sourceStream: "//Acme/task", targetStream: "//Acme/dev" },
    ]);
    expect(streamIntegrationCandidates(streams, "//Acme/missing")).toEqual([]);
  });

  it("offers only integration routes related to the selected stream", () => {
    const candidates = streamIntegrationCandidates(
      [stream("//Acme/main"), stream("//Acme/dev", "//Acme/main"), stream("//Acme/task", "//Acme/dev"), stream("//Acme/other")],
      "//Acme/dev",
    );
    expect(streamIntegrationCandidatesForSelection(candidates, "//Acme/main")).toEqual([candidates[0]]);
    expect(streamIntegrationCandidatesForSelection(candidates, "//Acme/dev")).toEqual(candidates);
    expect(streamIntegrationCandidatesForSelection(candidates, "//Acme/other")).toEqual([]);
  });

  it("offers terminal handoffs only for server-confirmed integration results", () => {
    const operation = {
      kind: "completed",
      readBack: { status: "succeeded", affectedState: ["opened_files"] },
      itemResults: [
        { itemId: "1", path: "//Acme/dev/a.txt", status: "succeeded", compensation: "not_required" },
        { itemId: "2", path: "//Acme/dev/a.txt", status: "succeeded", compensation: "not_required" },
        { itemId: "3", path: "//Acme/dev/b.txt", status: "failed", compensation: "not_required" },
      ],
    } as OperationEvent;

    expect(streamIntegrationHandoff(operation)).toEqual({
      succeededPaths: ["//Acme/dev/a.txt"],
      canResolve: true,
      canReview: true,
      canOpenSubmit: true,
    });
    expect(streamIntegrationHandoff({ ...operation, kind: "unknown", readBack: { status: "unknown", affectedState: [] } })).toEqual({
      succeededPaths: ["//Acme/dev/a.txt"],
      canResolve: false,
      canReview: false,
      canOpenSubmit: false,
    });
  });

  it("keeps partial integration available for resolve and review but not submit", () => {
    const operation = {
      kind: "partial",
      readBack: { status: "succeeded", affectedState: ["opened_files"] },
      itemResults: [
        { itemId: "1", path: "//Acme/dev/a.txt", status: "succeeded", compensation: "not_required" },
        { itemId: "2", path: "//Acme/dev/b.txt", status: "skipped", compensation: "not_required" },
      ],
    } as OperationEvent;

    expect(streamIntegrationHandoff(operation)).toEqual({
      succeededPaths: ["//Acme/dev/a.txt"],
      canResolve: true,
      canReview: true,
      canOpenSubmit: false,
    });
  });

  it("blocks handoffs after cancellation, failure, or missing read-back", () => {
    const operation = {
      kind: "completed",
      readBack: { status: "succeeded", affectedState: ["opened_files"] },
      itemResults: [
        { itemId: "1", path: "//Acme/dev/a.txt", status: "succeeded", compensation: "not_required" },
      ],
    } as OperationEvent;

    for (const kind of ["cancelled", "failed"] as const) {
      expect(streamIntegrationHandoff({ ...operation, kind })).toMatchObject({
        canResolve: false,
        canReview: false,
        canOpenSubmit: false,
      });
    }
    expect(streamIntegrationHandoff({ ...operation, readBack: undefined })).toMatchObject({
      canResolve: false,
      canReview: false,
      canOpenSubmit: false,
    });
  });
});
