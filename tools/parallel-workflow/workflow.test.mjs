import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_AGENT_PROFILE,
  WorkflowError,
  assertManagedPath,
  claimTask,
  createQualityCheckpoint,
  enqueueTasks,
  getNextTask,
  initializeWorkflow,
  normalizeTaskInput,
  selectNextTask,
  validationCargoTargetPath,
  validationWorktreePath,
  workflowStatus,
} from "./lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parallel workflow queue", () => {
  it("selects the smallest eligible priority and honors dependencies", () => {
    const tasks = [
      task("later", 30, []),
      task("blocked-high", 1, ["foundation"]),
      task("ready-high", 10, []),
    ];

    expect(selectNextTask(tasks, new Set()).taskId).toBe("ready-high");
    expect(selectNextTask(tasks, new Set(["foundation"])).taskId).toBe("blocked-high");
  });

  it("initializes, enqueues, claims, and reports state", async () => {
    const stateRoot = await temporaryStateRoot();
    await initializeWorkflow({ stateRoot, repoRoot: repositoryRoot });
    await enqueueTasks({
      stateRoot,
      input: [
        task("second", 20, ["first"]),
        task("first", 10, []),
      ],
    });

    expect(await getNextTask(stateRoot)).toMatchObject({
      taskId: "first",
      agentProfile: {
        model: "terra",
        reasoningEffort: "medium",
        maximumReasoningEffort: "medium",
      },
    });
    const assignment = await claimTask({
      stateRoot,
      taskId: "first",
      workerId: "thread-1",
    });
    expect(assignment.taskId).toBe("first");
    expect(assignment.taskKind).toBe("feature");
    expect(assignment.sourceCommits).toEqual([]);
    expect(assignment.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(assignment.agentProfile).toEqual({
      model: "terra",
      reasoningEffort: "medium",
      maximumReasoningEffort: "medium",
    });

    const status = await workflowStatus(stateRoot);
    expect(status.tasks).toMatchObject({
      pending: 1,
      active: 1,
      completed: 0,
      blocked: 0,
      next: null,
    });
    expect(status.validationCargoTargetRoot).toBe(
      path.join(status.validationCheckoutRoot, "cargo-target"),
    );
    expect(validationCargoTargetPath({
      validationCheckoutRoot: status.validationCheckoutRoot,
    })).toBe(status.validationCargoTargetRoot);
    expect(status.validationWorktreePath).toBe(
      path.join(status.validationCheckoutRoot, "checkout"),
    );
    expect(status.orchestratorAgentProfile).toEqual(ORCHESTRATOR_AGENT_PROFILE);
    expect(validationWorktreePath({
      validationCheckoutRoot: status.validationCheckoutRoot,
    })).toBe(status.validationWorktreePath);
  });

  it("pauses feature scheduling for refactoring and stabilization checkpoints", async () => {
    const stateRoot = await temporaryStateRoot();
    await initializeWorkflow({
      stateRoot,
      repoRoot: repositoryRoot,
      qualityCheckpointEvery: 2,
    });
    const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await seedCompletedFeature(stateRoot, "feature-one", 10, head);
    await seedCompletedFeature(stateRoot, "feature-two", 20, head);
    await enqueueTasks({ stateRoot, input: task("feature-three", 30, []) });

    expect(await getNextTask(stateRoot)).toMatchObject({
      status: "quality-checkpoint-required",
      sourceTaskIds: ["feature-one", "feature-two"],
    });

    const checkpoint = await createQualityCheckpoint({ stateRoot });
    expect(checkpoint).toMatchObject({
      status: "quality-checkpoint-created",
      coveredFeatureTaskIds: ["feature-one", "feature-two"],
    });
    expect((await getNextTask(stateRoot)).taskKind).toBe("refactor");

    const assignment = await claimTask({
      stateRoot,
      taskId: checkpoint.tasks[0].taskId,
      workerId: "quality-worker",
    });
    expect(assignment.taskKind).toBe("refactor");
    expect(assignment.validationProfile).toBe("p4fnv-fast");
    expect(assignment.agentProfile).toEqual({
      model: "sol",
      reasoningEffort: "medium",
      maximumReasoningEffort: "medium",
    });
    expect(assignment.sourceCommits.map((source) => source.taskId)).toEqual([
      "feature-one",
      "feature-two",
    ]);
    expect(await getNextTask(stateRoot)).toBeNull();

    const status = await workflowStatus(stateRoot);
    expect(status.quality).toMatchObject({
      checkpointEvery: 2,
      checkpointRequired: false,
      handoffReady: false,
    });
    expect(status.quality.inFlightCheckpointIds).toEqual([checkpoint.checkpointId]);

    await finishActiveTask(stateRoot, checkpoint.tasks[0].taskId, head);
    const stabilization = await getNextTask(stateRoot);
    expect(stabilization.taskKind).toBe("stabilization");
    const stabilizationAssignment = await claimTask({
      stateRoot,
      taskId: stabilization.taskId,
      workerId: "stabilization-worker",
    });
    expect(stabilizationAssignment.sourceCommits).toEqual([
      expect.objectContaining({ taskId: checkpoint.tasks[0].taskId, commitSha: head }),
    ]);
    expect(stabilizationAssignment.validationProfile).toBe("p4fnv-full");
    expect(stabilizationAssignment.agentProfile).toEqual({
      model: "sol",
      reasoningEffort: "medium",
      maximumReasoningEffort: "medium",
    });

    await finishActiveTask(stateRoot, stabilization.taskId, head);
    expect((await getNextTask(stateRoot)).taskId).toBe("feature-three");

    await fs.rm(path.join(stateRoot, "tasks", "pending", "feature-three.json"));
    await seedCompletedFeature(stateRoot, "feature-three", 30, head);
    expect(await getNextTask(stateRoot)).toMatchObject({
      status: "quality-checkpoint-required",
      sourceTaskIds: ["feature-three"],
    });
  });

  it("starts a checkpoint before sequential feature ranges", async () => {
    const stateRoot = await temporaryStateRoot();
    await initializeWorkflow({ stateRoot, repoRoot: repositoryRoot });
    const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const parent = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD^"], {
      encoding: "utf8",
    }).trim();
    await seedCompletedFeature(stateRoot, "sequential-one", 10, head, parent);
    await seedCompletedFeature(stateRoot, "sequential-two", 20, head, head);

    const checkpoint = await createQualityCheckpoint({ stateRoot });
    expect(checkpoint.baseSha).toBe(parent);
    expect(checkpoint.tasks[0].baseRef).toBe(parent);
  });

  it("drains active feature workers and enforces the quality barrier on claims", async () => {
    const stateRoot = await temporaryStateRoot();
    await initializeWorkflow({
      stateRoot,
      repoRoot: repositoryRoot,
      qualityCheckpointEvery: 1,
    });
    await enqueueTasks({
      stateRoot,
      input: [task("active-feature", 10, []), task("waiting-feature", 20, [])],
    });
    await claimTask({
      stateRoot,
      taskId: "active-feature",
      workerId: "active-worker",
    });
    const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await seedCompletedFeature(stateRoot, "completed-feature", 5, head);

    expect(await getNextTask(stateRoot)).toMatchObject({
      status: "quality-checkpoint-draining",
      activeFeatureTaskIds: ["active-feature"],
    });
    await expect(createQualityCheckpoint({ stateRoot })).rejects.toMatchObject({
      code: "quality_checkpoint_draining",
    });
    await expect(
      claimTask({
        stateRoot,
        taskId: "waiting-feature",
        workerId: "waiting-worker",
      }),
    ).rejects.toMatchObject({ code: "quality_barrier" });
  });

  it("rejects unknown validation profiles", () => {
    expect(() =>
      normalizeTaskInput(
        { ...task("bad-profile", 10, []), validationProfile: "run-anything" },
        { defaultBaseRef: "main", defaultValidationProfile: "p4fnv-full" },
      ),
    ).toThrowError(WorkflowError);
  });

  it("enforces resource profiles by work class", () => {
    const config = { defaultBaseRef: "main", defaultValidationProfile: "p4fnv-fast" };

    expect(normalizeTaskInput(task("implementation", 10, []), config)).toMatchObject({
      workClass: "implementation",
      agentProfile: {
        model: "terra",
        reasoningEffort: "medium",
        maximumReasoningEffort: "medium",
      },
    });
    expect(
      normalizeTaskInput({ ...task("mechanical", 10, []), workClass: "mechanical" }, config),
    ).toMatchObject({
      workClass: "mechanical",
      agentProfile: {
        model: "luna",
        reasoningEffort: "low",
        maximumReasoningEffort: "medium",
      },
    });
    expect(() =>
      normalizeTaskInput(
        {
          ...task("mechanical-medium", 10, []),
          workClass: "mechanical",
          reasoningEffort: "medium",
        },
        config,
      ),
    ).toThrowError(expect.objectContaining({ code: "resource_justification_required" }));
    expect(
      normalizeTaskInput(
        {
          ...task("mechanical-medium", 10, []),
          workClass: "mechanical",
          reasoningEffort: "medium",
          resourceJustification: "The documentation change requires cross-contract judgment.",
        },
        config,
      ).agentProfile,
    ).toEqual({ model: "luna", reasoningEffort: "medium", maximumReasoningEffort: "medium" });
    expect(() =>
      normalizeTaskInput({ ...task("complex", 10, []), workClass: "complex" }, config),
    ).toThrowError(expect.objectContaining({ code: "resource_justification_required" }));
    expect(
      normalizeTaskInput(
        {
          ...task("complex", 10, []),
          workClass: "complex",
          resourceJustification: "The task resolves an architectural conflict.",
        },
        config,
      ).agentProfile,
    ).toEqual({ model: "sol", reasoningEffort: "high", maximumReasoningEffort: "high" });
    expect(() =>
      normalizeTaskInput(
        {
          ...task("bypass", 10, []),
          agentProfile: { model: "sol", reasoningEffort: "high" },
        },
        config,
      ),
    ).toThrowError(WorkflowError);
  });

  it("requires explicit disposable P4D configuration for writable validation", () => {
    expect(() =>
      normalizeTaskInput(
        { ...task("p4d-task", 10, []), validationProfile: "p4fnv-full-p4d" },
        { defaultBaseRef: "main", defaultValidationProfile: "p4fnv-full" },
      ),
    ).toThrowError(WorkflowError);

    expect(
      normalizeTaskInput(
        { ...task("p4d-task", 10, []), validationProfile: "p4fnv-full-p4d" },
        {
          defaultBaseRef: "main",
          defaultValidationProfile: "p4fnv-full",
          p4dTestServerRoot: "C:\\disposable-p4d",
        },
      ).validationProfile,
    ).toBe("p4fnv-full-p4d");
  });

  it("keeps destructive cleanup inside the managed checkout root", () => {
    const root = path.join(repositoryRoot, ".tmp", "parallel-workflow", "checkouts");
    expect(assertManagedPath(root, path.join(root, "request-1"))).toBe(
      path.join(root, "request-1"),
    );
    expect(() => assertManagedPath(root, repositoryRoot)).toThrowError(WorkflowError);
    expect(() => assertManagedPath(root, root)).toThrowError(WorkflowError);
  });

  it("ships parseable JSON schemas and backlog example", async () => {
    const files = [
      "schemas/task.schema.json",
      "schemas/assignment.schema.json",
      "schemas/validation-request.schema.json",
      "schemas/validation-result.schema.json",
      "examples/backlog.example.json",
    ];
    const parsed = await Promise.all(
      files.map(async (relativePath) =>
        JSON.parse(
          await fs.readFile(path.join(repositoryRoot, "tools", "parallel-workflow", relativePath), "utf8"),
        ),
      ),
    );
    expect(parsed).toHaveLength(files.length);
  });
});

function task(taskId, priority, dependsOn) {
  return {
    schemaVersion: 1,
    taskId,
    taskKind: "feature",
    title: `Task ${taskId}`,
    description: `Implement ${taskId}.`,
    priority,
    dependsOn,
    acceptanceCriteria: ["The task is complete."],
    baseRef: "HEAD",
    validationProfile: "p4fnv-full",
  };
}

async function seedCompletedFeature(stateRoot, taskId, priority, commitSha, baseSha = commitSha) {
  const timestamp = new Date().toISOString();
  await fs.writeFile(
    path.join(stateRoot, "tasks", "completed", `${taskId}.json`),
    `${JSON.stringify(
      {
        ...task(taskId, priority, []),
        sourceTaskIds: [],
        coveredFeatureTaskIds: [],
        relevantPaths: ["src/"],
        metadata: {},
        status: "completed",
        attempt: 1,
        createdAt: timestamp,
        baseSha,
        validatedCommitSha: commitSha,
        completedAt: timestamp,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function finishActiveTask(stateRoot, taskId, commitSha) {
  const activePath = path.join(stateRoot, "tasks", "active", `${taskId}.json`);
  const taskValue = JSON.parse(await fs.readFile(activePath, "utf8"));
  await fs.rm(activePath);
  await fs.writeFile(
    path.join(stateRoot, "tasks", "completed", `${taskId}.json`),
    `${JSON.stringify(
      {
        ...taskValue,
        status: "completed",
        validatedCommitSha: commitSha,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function temporaryStateRoot() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "p4fnv-workflow-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
