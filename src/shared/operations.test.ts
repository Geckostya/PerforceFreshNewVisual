import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationEvent } from "./models";
import { isOperationActive, isOperationTerminal, operationAnnouncementPriority, operationConnectionKey, operationProgress, reduceOperationSnapshots, startObservedOperation } from "./operations";

const eventApi = vi.hoisted(() => ({ listen: vi.fn(), unlisten: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({ listen: eventApi.listen }));

const event = (operationId: string, kind: OperationEvent["kind"], processed = 0): OperationEvent => ({
  operationId,
  operationKind: "sync",
  kind,
  processed,
  processedBytes: 0,
  retryable: true,
});

describe("operation snapshots", () => {
  it("announces terminal problems assertively without repeating progress", () => {
    expect(operationAnnouncementPriority("progress")).toBe("none");
    expect(operationAnnouncementPriority("started")).toBe("polite");
    expect(operationAnnouncementPriority("completed")).toBe("polite");
    expect(operationAnnouncementPriority("failed")).toBe("assertive");
    expect(operationAnnouncementPriority("partial")).toBe("assertive");
    expect(operationAnnouncementPriority("unknown")).toBe("assertive");
  });

  beforeEach(() => {
    eventApi.listen.mockReset();
    eventApi.unlisten.mockReset();
  });

  it("calculates progress and ETA from bytes without a preview pass", () => {
    const startedAt = 1_000;
    const snapshot = { ...reduceOperationSnapshots([], { ...event("op-sync", "progress", 2), totalFiles: 10, processedBytes: 200, totalBytes: 1_000 })[0], startedAt, phaseStartedAt: startedAt };
    expect(operationProgress(snapshot, 3_000)).toEqual({ ratio: 0.2, remaining: 8, etaSeconds: 8 });
  });

  it("upserts progress and terminal state for one operation", () => {
    let state = reduceOperationSnapshots([], event("op-1", "started"));
    state = reduceOperationSnapshots(state, { ...event("op-1", "progress", 4), currentPath: "//main/a" });
    state = reduceOperationSnapshots(state, { ...event("op-1", "completed", 4), message: "done" });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ operationId: "op-1", status: "completed", processed: 4, message: "done" });
    expect(isOperationActive(state[0].status)).toBe(false);
  });

  it("keeps separate operation ids", () => {
    const state = reduceOperationSnapshots(reduceOperationSnapshots([], event("op-1", "started")), event("op-2", "started"));
    expect(state.map((item) => item.operationId)).toEqual(["op-1", "op-2"]);
    expect(isOperationActive("progress")).toBe(true);
    expect(isOperationActive("failed")).toBe(false);
    expect(isOperationTerminal("completed")).toBe(true);
    expect(isOperationTerminal("progress")).toBe(false);
  });

  it("does not regress a terminal result when late progress arrives", () => {
    let state = reduceOperationSnapshots([], event("op-1", "started"));
    state = reduceOperationSnapshots(state, event("op-1", "unknown", 2));
    state = reduceOperationSnapshots(state, event("op-1", "progress", 3));

    expect(state[0]).toMatchObject({ status: "unknown", processed: 2, retryable: false });
  });

  it("never exposes retry for an unknown submit", () => {
    const state = reduceOperationSnapshots([], {
      ...event("op-submit", "unknown"),
      operationKind: "submit",
      retryable: true,
      submitOutcome: {
        terminal: "unknown",
        recoveryActions: ["refresh Changes and rerun preflight"],
        steps: [{ step: "submit", status: "failed" }],
      },
    });

    expect(state[0]).toMatchObject({ operationKind: "submit", status: "unknown", retryable: false });
  });

  it("keeps cancel requested active until a terminal event arrives", () => {
    let state = reduceOperationSnapshots([], event("op-1", "started"));
    state = reduceOperationSnapshots(state, event("op-1", "cancel_requested"));
    expect(isOperationActive(state[0].status)).toBe(true);
    state = reduceOperationSnapshots(state, event("op-1", "cancelled"));
    expect(isOperationTerminal(state[0].status)).toBe(true);
  });

  it("preserves a non-cancellable composite operation across progress events", () => {
    let state = reduceOperationSnapshots([], { ...event("op-submit", "started"), operationKind: "submit", cancellable: false });
    state = reduceOperationSnapshots(state, { ...event("op-submit", "progress"), operationKind: "submit" });

    expect(state[0].cancellable).toBe(false);
  });

  it("preserves bounded session history", () => {
    let state = [] as ReturnType<typeof reduceOperationSnapshots>;
    for (let index = 0; index < 35; index += 1) {
      state = reduceOperationSnapshots(state, event(`op-${index}`, "completed"));
    }
    expect(state).toHaveLength(30);
    expect(state[0].operationId).toBe("op-5");
  });

  it("carries item diagnostics, compensation, and read-back metadata", () => {
    const state = reduceOperationSnapshots([], {
      ...event("op-1", "partial"),
      diagnostics: [{ code: "apply_failed", message: "bounded" }],
      itemResults: [{
        itemId: "//main/a",
        path: "//main/a",
        status: "failed",
        reason: "locked",
        compensation: "unknown",
        recoveryActionId: "refresh_workspace",
      }],
      readBack: { status: "failed", affectedState: ["workspace_files"] },
    });
    expect(state[0].itemResults[0]).toMatchObject({ status: "failed", compensation: "unknown" });
    expect(state[0].readBack?.status).toBe("failed");
  });

  it("preserves bounded retry metadata", () => {
    let snapshots = reduceOperationSnapshots([], { ...event("op-sync", "started"), scope: "2 paths", scopes: ["//main/a", "//main/b"] });
    snapshots = reduceOperationSnapshots(snapshots, event("op-sync", "progress", 1));
    const snapshot = reduceOperationSnapshots(snapshots, event("op-sync", "failed", 1))[0];
    expect(snapshot.scope).toBe("2 paths");
    expect(snapshot.scopes).toEqual(["//main/a", "//main/b"]);
    expect(snapshot.retryable).toBe(true);
  });

  it("keeps the originating connection identity through a later terminal event", () => {
    const connection = { port: "p4-a:1666", user: "alex", client: "main" };
    const origin = operationConnectionKey(connection);
    let snapshots = reduceOperationSnapshots([], event("op-sync", "started"), origin);
    snapshots = reduceOperationSnapshots(snapshots, event("op-sync", "failed"), operationConnectionKey({ ...connection, client: "other" }));

    expect(snapshots[0].connectionKey).toBe(origin);
    expect(snapshots[0].connectionKey).not.toBe(operationConnectionKey({ ...connection, client: "other" }));
  });

  it("resets progress timing when reconcile changes phase", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(4_000);
    let snapshots = reduceOperationSnapshots([], { ...event("op-reconcile", "started"), operationKind: "reconcile", phase: "validate", totalFiles: 4 });
    snapshots = reduceOperationSnapshots(snapshots, { ...event("op-reconcile", "progress"), operationKind: "reconcile", phase: "apply", totalFiles: 4 });

    expect(snapshots[0]).toMatchObject({ phase: "apply", phaseStartedAt: 4_000 });
    expect(operationProgress(snapshots[0], 4_000).ratio).toBe(0);
    vi.restoreAllMocks();
  });

  it("captures events emitted before the start command returns", async () => {
    let emit: ((event: { payload: OperationEvent }) => void) | undefined;
    eventApi.listen.mockImplementation(async (_name, callback) => {
      emit = callback;
      return eventApi.unlisten;
    });
    const onEvent = vi.fn();

    const operationId = await startObservedOperation("sync", async () => {
      emit?.({ payload: event("op-early", "started") });
      emit?.({ payload: event("op-early", "completed", 2) });
      return "op-early";
    }, onEvent);

    expect(operationId).toBe("op-early");
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(eventApi.unlisten).toHaveBeenCalledOnce();
  });

  it("ignores early events from another operation of the same kind", async () => {
    let emit: ((event: { payload: OperationEvent }) => void) | undefined;
    eventApi.listen.mockImplementation(async (_name, callback) => {
      emit = callback;
      return eventApi.unlisten;
    });
    const onEvent = vi.fn();

    const operationId = await startObservedOperation("sync", async () => {
      emit?.({ payload: event("op-other", "started") });
      emit?.({ payload: event("op-other", "completed", 1) });
      emit?.({ payload: event("op-owned", "started") });
      emit?.({ payload: event("op-owned", "completed", 2) });
      return "op-owned";
    }, onEvent);

    expect(operationId).toBe("op-owned");
    expect(onEvent.mock.calls.map(([payload]) => [payload.operationId, payload.kind])).toEqual([
      ["op-owned", "started"],
      ["op-owned", "completed"],
    ]);
    expect(eventApi.unlisten).toHaveBeenCalledOnce();
  });

  it("stops listening when the start command fails", async () => {
    eventApi.listen.mockResolvedValue(eventApi.unlisten);

    await expect(startObservedOperation("sync", async () => { throw new Error("start failed"); }, vi.fn())).rejects.toThrow("start failed");

    expect(eventApi.unlisten).toHaveBeenCalledOnce();
  });
});
