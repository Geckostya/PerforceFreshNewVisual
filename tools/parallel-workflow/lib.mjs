import { constants as fsConstants, createWriteStream, promises as fs } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { validationProfiles } from "./profiles.mjs";

export const SCHEMA_VERSION = 1;
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/i;
const TASK_BUCKETS = ["pending", "active", "completed", "blocked"];
const TASK_KINDS = new Set(["feature", "refactor", "stabilization"]);
const QUALITY_TASK_KINDS = new Set(["refactor", "stabilization"]);
const WORK_CLASSES = new Set(["implementation", "mechanical", "quality", "complex"]);
const ALLOWED_REASONING_EFFORTS = Object.freeze({
  implementation: new Set(["medium"]),
  mechanical: new Set(["low", "medium"]),
  quality: new Set(["medium"]),
  complex: new Set(["high"]),
});
const DEFAULT_REASONING_EFFORT = Object.freeze({
  implementation: "medium",
  mechanical: "low",
  quality: "medium",
  complex: "high",
});
const DEFAULT_QUALITY_CHECKPOINT_EVERY = 4;
const RESULT_TAIL_LIMIT = 12_000;

export const ORCHESTRATOR_AGENT_PROFILE = Object.freeze({
  model: "terra",
  reasoningEffort: "low",
  maximumReasoningEffort: "low",
});

const WORKER_AGENT_PROFILES = Object.freeze({
  implementation: Object.freeze({
    model: "terra",
    reasoningEffort: "medium",
    maximumReasoningEffort: "medium",
  }),
  mechanical: Object.freeze({
    model: "luna",
    reasoningEffort: "low",
    maximumReasoningEffort: "medium",
  }),
  quality: Object.freeze({
    model: "sol",
    reasoningEffort: "medium",
    maximumReasoningEffort: "medium",
  }),
  complex: Object.freeze({
    model: "sol",
    reasoningEffort: "high",
    maximumReasoningEffort: "high",
  }),
});

export class WorkflowError extends Error {
  constructor(message, code = "workflow_error") {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

export async function initializeWorkflow({
  stateRoot,
  repoRoot,
  backlogFile,
  p4dTestServerRoot,
  qualityCheckpointEvery,
}) {
  const resolvedStateRoot = path.resolve(requireString(stateRoot, "stateRoot"));
  const resolvedRepoRoot = await resolveRepositoryRoot(repoRoot ?? process.cwd());
  const configPath = path.join(resolvedStateRoot, "config.json");

  await createStateDirectories(resolvedStateRoot);
  let config;
  if (await pathExists(configPath)) {
    config = await readJson(configPath);
    validateConfig(config, resolvedStateRoot);
    if (!samePath(config.repoRoot, resolvedRepoRoot)) {
      throw new WorkflowError(
        `Workflow already belongs to ${config.repoRoot}, not ${resolvedRepoRoot}.`,
        "config_mismatch",
      );
    }
  } else {
    const workflowId = randomUUID();
    const validationCheckoutRoot = path.join(tmpdir(), "p4fnv-v", workflowId.slice(0, 8));
    const resolvedQualityEvery = normalizeQualityEvery(qualityCheckpointEvery);
    const resolvedP4dRoot = p4dTestServerRoot
      ? await resolveP4dTestServerRoot(p4dTestServerRoot)
      : undefined;
    config = {
      schemaVersion: SCHEMA_VERSION,
      workflowId,
      repoRoot: resolvedRepoRoot,
      stateRoot: resolvedStateRoot,
      toolchainRoot: await resolveToolchainRoot(resolvedRepoRoot),
      validationCheckoutRoot,
      validationWorktreePath: path.join(validationCheckoutRoot, "checkout"),
      validationCargoTargetRoot: path.join(validationCheckoutRoot, "cargo-target"),
      defaultBaseRef: "main",
      defaultValidationProfile: "p4fnv-full",
      orchestratorAgentProfile: ORCHESTRATOR_AGENT_PROFILE,
      qualityCheckpointEvery: resolvedQualityEvery,
      createdAt: now(),
      ...(resolvedP4dRoot ? { p4dTestServerRoot: resolvedP4dRoot } : {}),
    };
    await atomicWriteJson(configPath, config);
  }
  if (p4dTestServerRoot) {
    const requestedP4dRoot = await resolveP4dTestServerRoot(p4dTestServerRoot);
    if (!config.p4dTestServerRoot || !samePath(config.p4dTestServerRoot, requestedP4dRoot)) {
      throw new WorkflowError(
        "Workflow already has a different disposable P4D server root.",
        "config_mismatch",
      );
    }
  }
  if (
    qualityCheckpointEvery !== undefined &&
    qualityEvery(config) !== normalizeQualityEvery(qualityCheckpointEvery)
  ) {
    throw new WorkflowError(
      "Workflow already has a different quality checkpoint interval.",
      "config_mismatch",
    );
  }
  await fs.mkdir(config.validationCheckoutRoot, { recursive: true });
  await fs.mkdir(validationCargoTargetPath(config), { recursive: true });

  let enqueued = [];
  if (backlogFile) {
    enqueued = await enqueueTasks({
      stateRoot: resolvedStateRoot,
      input: await readJson(path.resolve(backlogFile)),
    });
  }
  return { config, enqueued };
}

export async function loadWorkflow(stateRoot) {
  const resolvedStateRoot = path.resolve(requireString(stateRoot, "stateRoot"));
  const config = await readJson(path.join(resolvedStateRoot, "config.json"));
  validateConfig(config, resolvedStateRoot);
  return { stateRoot: resolvedStateRoot, config };
}

export async function enqueueTasks({ stateRoot, input }) {
  const workflow = await loadWorkflow(stateRoot);
  const inputs = Array.isArray(input) ? input : [input];
  if (inputs.length === 0) {
    throw new WorkflowError("A backlog must contain at least one task.", "invalid_task");
  }

  const existing = await loadAllTasks(workflow.stateRoot);
  const existingIds = new Set(existing.map(({ task }) => task.taskId));
  const batchIds = new Set();
  const tasks = inputs.map((value) => {
    const task = normalizeTaskInput(value, workflow.config);
    if (existingIds.has(task.taskId) || batchIds.has(task.taskId)) {
      throw new WorkflowError(`Task ${task.taskId} already exists.`, "duplicate_task");
    }
    batchIds.add(task.taskId);
    return task;
  });

  const knownIds = new Set([...existingIds, ...batchIds]);
  for (const task of tasks) {
    for (const dependency of [...task.dependsOn, ...task.sourceTaskIds]) {
      if (!knownIds.has(dependency)) {
        throw new WorkflowError(
          `Task ${task.taskId} references unknown task ${dependency}.`,
          "invalid_dependency",
        );
      }
      if (dependency === task.taskId) {
        throw new WorkflowError(`Task ${task.taskId} cannot depend on itself.`, "invalid_dependency");
      }
    }
    if (task.sourceTaskIds.some((source) => !task.dependsOn.includes(source))) {
      throw new WorkflowError(
        `Task ${task.taskId} must depend on every source task.`,
        "invalid_dependency",
      );
    }
  }

  for (const task of tasks) {
    await atomicWriteJson(taskPath(workflow.stateRoot, "pending", task.taskId), task);
  }
  return tasks;
}

export function normalizeTaskInput(value, config) {
  assertPlainObject(value, "task");
  if (value.schemaVersion !== undefined && value.schemaVersion !== SCHEMA_VERSION) {
    throw new WorkflowError(`Unsupported task schemaVersion ${value.schemaVersion}.`, "invalid_task");
  }
  const taskId = validateTaskId(value.taskId);
  const priority = value.priority ?? 100;
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) {
    throw new WorkflowError(`Task ${taskId} priority must be an integer from 1 to 999.`, "invalid_task");
  }
  const baseRef = value.baseRef ?? config.defaultBaseRef;
  if (typeof baseRef !== "string" || !REF_PATTERN.test(baseRef)) {
    throw new WorkflowError(`Task ${taskId} has an invalid baseRef.`, "invalid_task");
  }
  const validationProfile = value.validationProfile ?? config.defaultValidationProfile;
  const taskKind = value.taskKind ?? "feature";
  if (!TASK_KINDS.has(taskKind)) {
    throw new WorkflowError(`Task ${taskId} has unknown taskKind ${taskKind}.`, "invalid_task");
  }
  if (!Object.hasOwn(validationProfiles, validationProfile)) {
    throw new WorkflowError(
      `Task ${taskId} requests unknown validation profile ${validationProfile}.`,
      "invalid_task",
    );
  }
  if (validationProfile === "p4fnv-full-p4d" && !config.p4dTestServerRoot) {
    throw new WorkflowError(
      `Task ${taskId} requires a workflow initialized with --p4d-root.`,
      "p4d_not_configured",
    );
  }
  if (value.agentProfile !== undefined) {
    throw new WorkflowError(
      `Task ${taskId} cannot select agentProfile directly; use workClass.`,
      "invalid_task",
    );
  }
  const workClass = normalizeWorkClass(value.workClass, taskKind, taskId);
  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort, workClass, taskId);
  const resourceJustification = value.resourceJustification === undefined
    ? undefined
    : requireString(value.resourceJustification, `task ${taskId} resourceJustification`);
  if ((workClass === "complex" || reasoningEffort !== DEFAULT_REASONING_EFFORT[workClass]) && !resourceJustification) {
    throw new WorkflowError(
      `Task ${taskId} requires resourceJustification for its elevated agent profile.`,
      "resource_justification_required",
    );
  }
  const sourceTaskIds = uniqueTaskIds(value.sourceTaskIds ?? [], `task ${taskId} sourceTaskIds`);
  const coveredFeatureTaskIds = uniqueTaskIds(
    value.coveredFeatureTaskIds ?? [],
    `task ${taskId} coveredFeatureTaskIds`,
  );
  const qualityCheckpointId =
    value.qualityCheckpointId === undefined
      ? undefined
      : validateTaskId(value.qualityCheckpointId);
  if (taskKind === "feature" && (sourceTaskIds.length > 0 || coveredFeatureTaskIds.length > 0)) {
    throw new WorkflowError(
      `Feature task ${taskId} cannot declare quality checkpoint sources or coverage.`,
      "invalid_task",
    );
  }
  if (
    QUALITY_TASK_KINDS.has(taskKind) &&
    (!qualityCheckpointId || sourceTaskIds.length === 0 || coveredFeatureTaskIds.length === 0)
  ) {
    throw new WorkflowError(
      `Quality task ${taskId} requires qualityCheckpointId, sourceTaskIds, and coveredFeatureTaskIds.`,
      "invalid_task",
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    title: requireString(value.title, `task ${taskId} title`),
    description: requireString(value.description, `task ${taskId} description`),
    priority,
    taskKind,
    workClass,
    reasoningEffort,
    agentProfile: agentProfileForWorkClass(workClass, reasoningEffort),
    ...(resourceJustification ? { resourceJustification } : {}),
    dependsOn: uniqueTaskIds(value.dependsOn ?? [], `task ${taskId} dependsOn`),
    sourceTaskIds,
    coveredFeatureTaskIds,
    ...(qualityCheckpointId ? { qualityCheckpointId } : {}),
    acceptanceCriteria: nonEmptyStrings(
      value.acceptanceCriteria,
      `task ${taskId} acceptanceCriteria`,
    ),
    baseRef,
    validationProfile,
    relevantPaths: optionalStrings(value.relevantPaths ?? [], `task ${taskId} relevantPaths`),
    metadata: value.metadata === undefined ? {} : plainObjectCopy(value.metadata, "task metadata"),
    status: "pending",
    attempt: 0,
    createdAt: now(),
  };
}

export async function getNextTask(stateRoot) {
  const workflow = await loadWorkflow(stateRoot);
  const buckets = await loadTaskBuckets(workflow.stateRoot);
  return selectNextWorkflowItem(buckets, workflow.config);
}

export function agentProfileForTask(task) {
  assertPlainObject(task, "task");
  const taskId = task.taskId ?? "unknown";
  const taskKind = task.taskKind ?? "feature";
  const workClass = normalizeWorkClass(task.workClass, taskKind, taskId);
  const reasoningEffort = normalizeReasoningEffort(task.reasoningEffort, workClass, taskId);
  return agentProfileForWorkClass(workClass, reasoningEffort);
}

export function selectNextTask(tasks, completedIds) {
  return (
    [...tasks]
      .filter((task) => task.dependsOn.every((dependency) => completedIds.has(dependency)))
      .sort(compareTasks)[0] ?? null
  );
}

export function computeQualityState(buckets, config) {
  const completedFeatures = buckets.completed.filter((task) => taskKindOf(task) === "feature");
  const completedStabilizations = buckets.completed.filter(
    (task) => taskKindOf(task) === "stabilization",
  );
  const covered = new Set(
    completedStabilizations.flatMap((task) => task.coveredFeatureTaskIds ?? []),
  );
  const qualityBarrierTasks = [...buckets.pending, ...buckets.active, ...buckets.blocked].filter(
    (task) => QUALITY_TASK_KINDS.has(taskKindOf(task)),
  );
  const reserved = new Set(
    qualityBarrierTasks
      .flatMap((task) => task.coveredFeatureTaskIds ?? []),
  );
  const uncovered = completedFeatures
    .filter((task) => !covered.has(task.taskId) && !reserved.has(task.taskId))
    .sort(compareTasks);
  const pendingFeatures = buckets.pending.filter((task) => taskKindOf(task) === "feature");
  const activeFeatures = buckets.active.filter((task) => taskKindOf(task) === "feature");
  const thresholdReached =
    uncovered.length >= qualityEvery(config) ||
    (pendingFeatures.length === 0 && uncovered.length + activeFeatures.length > 0);
  const checkpointDraining =
    qualityBarrierTasks.length === 0 && thresholdReached && activeFeatures.length > 0;
  const checkpointRequired =
    qualityBarrierTasks.length === 0 &&
    thresholdReached &&
    activeFeatures.length === 0 &&
    uncovered.length > 0;
  return {
    checkpointEvery: qualityEvery(config),
    checkpointDraining,
    checkpointRequired,
    drainingFeatureTaskIds: activeFeatures.sort(compareTasks).map((task) => task.taskId),
    uncoveredFeatureTaskIds: uncovered.map((task) => task.taskId),
    inFlightCheckpointIds: [
      ...new Set(qualityBarrierTasks.map((task) => task.qualityCheckpointId).filter(Boolean)),
    ],
    handoffReady:
      buckets.pending.length === 0 &&
      buckets.active.length === 0 &&
      buckets.blocked.length === 0 &&
      uncovered.length === 0 &&
      qualityBarrierTasks.length === 0,
  };
}

export async function createQualityCheckpoint({ stateRoot, checkpointId, sourceTaskIds }) {
  const workflow = await loadWorkflow(stateRoot);
  const buckets = await loadTaskBuckets(workflow.stateRoot);
  const quality = computeQualityState(buckets, workflow.config);
  if (quality.checkpointDraining) {
    throw new WorkflowError(
      `Wait for active feature tasks before creating the checkpoint: ${quality.drainingFeatureTaskIds.join(", ")}.`,
      "quality_checkpoint_draining",
    );
  }
  if (quality.inFlightCheckpointIds.length > 0) {
    throw new WorkflowError(
      `Quality checkpoint ${quality.inFlightCheckpointIds.join(", ")} is already in flight.`,
      "quality_checkpoint_in_flight",
    );
  }

  const sources = sourceTaskIds?.length
    ? uniqueTaskIds(sourceTaskIds, "sourceTaskIds")
    : quality.uncoveredFeatureTaskIds;
  if (sources.length === 0) {
    throw new WorkflowError("No completed uncovered feature tasks need a checkpoint.", "quality_not_required");
  }
  const completedById = new Map(buckets.completed.map((task) => [task.taskId, task]));
  const sourceTasks = sources.map((taskId) => {
    const task = completedById.get(taskId);
    if (!task || taskKindOf(task) !== "feature" || !task.validatedCommitSha || !task.baseSha) {
      throw new WorkflowError(
        `Quality source ${taskId} must be a completed validated feature task.`,
        "invalid_quality_source",
      );
    }
    if (!quality.uncoveredFeatureTaskIds.includes(taskId)) {
      throw new WorkflowError(
        `Feature task ${taskId} is already covered or reserved by a checkpoint.`,
        "quality_source_already_covered",
      );
    }
    return task;
  });

  const id = checkpointId
    ? validateTaskId(checkpointId)
    : nextCheckpointId(buckets);
  const refactorTaskId = validateTaskId(`${id}-refactor`);
  const stabilizationTaskId = validateTaskId(`${id}-stabilization`);
  const baseSha = await mergeBase(
    workflow.config.repoRoot,
    sourceTasks.map((task) => task.baseSha),
  );
  const priority = Math.min(...sourceTasks.map((task) => task.priority));
  const relevantPaths = [
    ...new Set(sourceTasks.flatMap((task) => task.relevantPaths ?? [])),
  ];
  const stabilizationProfile = workflow.config.p4dTestServerRoot
    ? "p4fnv-full-p4d"
    : "p4fnv-full";

  const tasks = await enqueueTasks({
    stateRoot: workflow.stateRoot,
    input: [
      {
        schemaVersion: SCHEMA_VERSION,
        taskId: refactorTaskId,
        taskKind: "refactor",
        qualityCheckpointId: id,
        coveredFeatureTaskIds: sources,
        sourceTaskIds: sources,
        title: `Consolidate and refactor ${id}`,
        description:
          "Integrate the validated source ranges, remove accidental duplication and dead or speculative structure, and preserve behavior. Prefer deletion and existing project boundaries over new layers or dependencies.",
        priority,
        dependsOn: sources,
        acceptanceCriteria: [
          "All validated source ranges are integrated without dropping behavior.",
          "Duplicated logic, dead code, and unjustified abstractions in the touched area are removed or explicitly reported.",
          "Structural changes preserve dependency direction and keep tests and owning contracts current.",
          "The fast debug validation profile passes for the consolidated commit.",
        ],
        baseRef: baseSha,
        validationProfile: "p4fnv-fast",
        relevantPaths,
        metadata: { generatedBy: "quality-checkpoint" },
      },
      {
        schemaVersion: SCHEMA_VERSION,
        taskId: stabilizationTaskId,
        taskKind: "stabilization",
        qualityCheckpointId: id,
        coveredFeatureTaskIds: sources,
        sourceTaskIds: [refactorTaskId],
        title: `Stabilize ${id}`,
        description:
          "Integrate the validated refactor range, audit regression and failure paths, add missing focused tests, and fix defects without expanding feature scope.",
        priority,
        dependsOn: [refactorTaskId],
        acceptanceCriteria: [
          "The validated refactor range is integrated exactly once.",
          "Regression, error, cancellation, retry, and boundary paths affected by the wave are tested or explicitly shown inapplicable.",
          "All discovered defects are fixed without adding unrelated features or duplicate implementations.",
          "The completion validation profile passes, including disposable P4D smoke when configured.",
        ],
        baseRef: baseSha,
        validationProfile: stabilizationProfile,
        relevantPaths,
        metadata: { generatedBy: "quality-checkpoint" },
      },
    ],
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "quality-checkpoint-created",
    checkpointId: id,
    coveredFeatureTaskIds: sources,
    baseSha,
    tasks,
  };
}

function selectNextWorkflowItem(buckets, config) {
  const completedIds = new Set(buckets.completed.map((task) => task.taskId));
  const quality = computeQualityState(buckets, config);
  const qualityBarrier = [...buckets.pending, ...buckets.active, ...buckets.blocked].some((task) =>
    QUALITY_TASK_KINDS.has(taskKindOf(task)),
  );
  if (qualityBarrier) {
    return taskForDispatch(selectNextTask(
      buckets.pending.filter((task) => QUALITY_TASK_KINDS.has(taskKindOf(task))),
      completedIds,
    ));
  }
  if (quality.checkpointDraining) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "quality-checkpoint-draining",
      reason: "The feature wave reached its quality boundary; wait for active feature workers before refactoring.",
      activeFeatureTaskIds: quality.drainingFeatureTaskIds,
    };
  }
  if (quality.checkpointRequired) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "quality-checkpoint-required",
      reason: `Completed feature work requires refactoring and stabilization after at most ${quality.checkpointEvery} features.`,
      recommendedCheckpointId: nextCheckpointId(buckets),
      sourceTaskIds: quality.uncoveredFeatureTaskIds,
    };
  }
  return taskForDispatch(selectNextTask(buckets.pending, completedIds));
}

export async function claimTask({ stateRoot, taskId, workerId }) {
  const workflow = await loadWorkflow(stateRoot);
  const id = validateTaskId(taskId);
  const worker = requireString(workerId, "workerId");
  const pendingPath = taskPath(workflow.stateRoot, "pending", id);
  const task = taskForDispatch(await readJson(pendingPath));

  const buckets = await loadTaskBuckets(workflow.stateRoot);
  const quality = computeQualityState(buckets, workflow.config);
  if (
    taskKindOf(task) === "feature" &&
    (quality.checkpointDraining ||
      quality.checkpointRequired ||
      quality.inFlightCheckpointIds.length > 0)
  ) {
    throw new WorkflowError(
      `Feature task ${id} cannot be claimed while a quality checkpoint is required or in flight.`,
      "quality_barrier",
    );
  }

  const completedTasks = buckets.completed;
  const completedById = new Map(completedTasks.map((item) => [item.taskId, item]));
  const missing = task.dependsOn.filter((dependency) => !completedById.has(dependency));
  if (missing.length > 0) {
    throw new WorkflowError(
      `Task ${id} is waiting for: ${missing.join(", ")}.`,
      "dependency_not_completed",
    );
  }

  const baseSha = await resolveCommit(workflow.config.repoRoot, task.baseRef);
  const sourceCommits = (task.sourceTaskIds ?? []).map((sourceTaskId) => {
    const source = completedById.get(sourceTaskId);
    if (!source?.baseSha || !source?.validatedCommitSha) {
      throw new WorkflowError(
        `Source task ${sourceTaskId} does not have a validated commit range.`,
        "invalid_quality_source",
      );
    }
    return {
      taskId: sourceTaskId,
      taskKind: taskKindOf(source),
      baseSha: source.baseSha,
      commitSha: source.validatedCommitSha,
    };
  });
  const assignment = {
    schemaVersion: SCHEMA_VERSION,
    assignmentId: randomUUID(),
    workflowId: workflow.config.workflowId,
    taskId: id,
    taskKind: taskKindOf(task),
    ...(task.qualityCheckpointId ? { qualityCheckpointId: task.qualityCheckpointId } : {}),
    workerThreadId: worker,
    stateRoot: workflow.stateRoot,
    repoRoot: workflow.config.repoRoot,
    baseRef: task.baseRef,
    baseSha,
    sourceCommits,
    validationProfile: task.validationProfile,
    agentProfile: task.agentProfile,
    claimedAt: now(),
    task,
  };
  const activePath = taskPath(workflow.stateRoot, "active", id);
  await fs.rename(pendingPath, activePath).catch((error) => {
    throw new WorkflowError(`Could not claim task ${id}: ${error.message}`, "claim_conflict");
  });

  const activeTask = {
    ...task,
    status: "active",
    workerThreadId: worker,
    assignmentId: assignment.assignmentId,
    baseSha,
    claimedAt: assignment.claimedAt,
  };
  await atomicWriteJson(activePath, activeTask);
  await atomicWriteJson(
    path.join(workflow.stateRoot, "assignments", `${assignment.assignmentId}.json`),
    assignment,
  );
  return assignment;
}

export async function submitValidationRequest({
  stateRoot,
  taskId,
  assignmentId,
  commitSha,
  baseSha,
  worktreePath,
  summary = "",
}) {
  const workflow = await loadWorkflow(stateRoot);
  const id = validateTaskId(taskId);
  const taskFile = taskPath(workflow.stateRoot, "active", id);
  const task = await readJson(taskFile);

  if (task.assignmentId !== requireString(assignmentId, "assignmentId")) {
    throw new WorkflowError(`Assignment does not own active task ${id}.`, "assignment_mismatch");
  }
  const commit = validateCommit(commitSha, "commitSha");
  const base = validateCommit(baseSha, "baseSha");
  if (base !== task.baseSha) {
    throw new WorkflowError(
      `Request baseSha ${base} does not match assignment baseSha ${task.baseSha}.`,
      "base_mismatch",
    );
  }

  const resolvedWorktree = path.resolve(requireString(worktreePath, "worktreePath"));
  await verifyWorkerWorktree(workflow.config.repoRoot, resolvedWorktree, commit);
  await assertCommitExists(workflow.config.repoRoot, commit);
  if (!(await isAncestor(workflow.config.repoRoot, base, commit))) {
    throw new WorkflowError(`${commit} is not based on ${base}.`, "invalid_commit_range");
  }

  const changedFiles = await changedPaths(workflow.config.repoRoot, base, commit);
  const request = {
    schemaVersion: SCHEMA_VERSION,
    requestId: randomUUID(),
    workflowId: workflow.config.workflowId,
    taskId: id,
    taskKind: taskKindOf(task),
    ...(task.qualityCheckpointId ? { qualityCheckpointId: task.qualityCheckpointId } : {}),
    taskPriority: task.priority,
    assignmentId: task.assignmentId,
    workerThreadId: task.workerThreadId,
    worktreePath: resolvedWorktree,
    commitSha: commit,
    baseSha: base,
    validationProfile: task.validationProfile,
    changedFiles,
    summary: String(summary),
    requestedAt: now(),
  };

  await atomicWriteJson(
    path.join(workflow.stateRoot, "validation", "pending", `${request.requestId}.json`),
    request,
  );
  await atomicWriteJson(taskFile, {
    ...task,
    latestValidationRequestId: request.requestId,
    latestValidationState: "pending",
  });
  return request;
}

export async function runValidator({ stateRoot, watch = false, pollIntervalMs = 2_000 }) {
  const workflow = await loadWorkflow(stateRoot);
  const lock = await acquireValidatorLock(workflow);
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    await recoverRunningRequests(workflow);
    const results = [];
    do {
      const result = await processNextValidation(workflow);
      if (result) {
        results.push(result);
      } else if (watch && !interrupted) {
        await delay(Math.max(250, pollIntervalMs));
      }
      if (!watch) break;
    } while (!interrupted);
    return results;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await releaseValidatorLock(lock);
  }
}

export async function processNextValidation(workflowOrStateRoot) {
  const workflow =
    typeof workflowOrStateRoot === "string"
      ? await loadWorkflow(workflowOrStateRoot)
      : workflowOrStateRoot;
  const pendingDirectory = path.join(workflow.stateRoot, "validation", "pending");
  const requests = await readJsonDirectory(pendingDirectory);
  const request =
    requests.sort(
      (left, right) =>
        left.taskPriority - right.taskPriority ||
        left.requestedAt.localeCompare(right.requestedAt) ||
        left.requestId.localeCompare(right.requestId),
    )[0] ?? null;
  if (!request) return null;

  const pendingPath = path.join(pendingDirectory, `${request.requestId}.json`);
  const runningPath = path.join(
    workflow.stateRoot,
    "validation",
    "running",
    `${request.requestId}.json`,
  );
  await fs.rename(pendingPath, runningPath).catch((error) => {
    throw new WorkflowError(
      `Could not claim validation ${request.requestId}: ${error.message}`,
      "validation_claim_conflict",
    );
  });

  const result = await validateRequest(workflow, request);
  await atomicWriteJson(
    path.join(workflow.stateRoot, "validation", "results", `${request.requestId}.json`),
    result,
  );
  await fs.unlink(runningPath).catch(() => {});
  await updateTaskAfterValidation(workflow, result);
  return result;
}

async function validateRequest(workflow, request) {
  const startedAt = now();
  const checkoutPath = managedCheckoutPath(workflow.config, request.requestId);
  const cargoTargetPath = validationCargoTargetPath(workflow.config);
  const logDirectory = path.join(
    workflow.stateRoot,
    "validation",
    "logs",
    request.requestId,
  );
  const commands = [];
  const warnings = [];
  let status = "infrastructure-error";
  let retryable = true;
  let failureMessage = "";

  try {
    validateStoredRequest(request, workflow.config);
    await assertCommitExists(workflow.config.repoRoot, request.commitSha);
    await fs.mkdir(logDirectory, { recursive: true });
    await fs.mkdir(cargoTargetPath, { recursive: true });
    await removeManagedCheckout(workflow, checkoutPath, warnings);
    await runGit(
      workflow.config.repoRoot,
      ["worktree", "add", "--detach", checkoutPath, request.commitSha],
      120_000,
    );
    await attachSharedToolchain(workflow, checkoutPath);

    const profile = validationProfiles[request.validationProfile];
    for (const command of profile) {
      const result = await runValidationCommand(
        workflow.config,
        checkoutPath,
        logDirectory,
        command,
      );
      commands.push(result);
      if (result.status !== "passed") {
        status = "failed";
        retryable = false;
        failureMessage = `${command.name} failed with exit code ${result.exitCode}.`;
        break;
      }
    }
    if (commands.length === profile.length && commands.every((command) => command.status === "passed")) {
      status = "passed";
      retryable = false;
    }
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await removeManagedCheckout(workflow, checkoutPath, warnings);
  }

  const completedAt = now();
  const summary =
    status === "passed"
      ? `Validation passed for ${request.commitSha}.`
      : `${status === "failed" ? "Validation failed" : "Validator infrastructure failed"} for ${request.commitSha}: ${failureMessage}`;
  return {
    schemaVersion: SCHEMA_VERSION,
    resultId: randomUUID(),
    requestId: request.requestId,
    workflowId: workflow.config.workflowId,
    taskId: request.taskId,
    taskKind: request.taskKind ?? "feature",
    ...(request.qualityCheckpointId
      ? { qualityCheckpointId: request.qualityCheckpointId }
      : {}),
    assignmentId: request.assignmentId,
    workerThreadId: request.workerThreadId,
    commitSha: request.commitSha,
    baseSha: request.baseSha,
    validationProfile: request.validationProfile,
    changedFiles: request.changedFiles,
    status,
    retryable,
    summary,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    logDirectory,
    commands,
    warnings,
  };
}

async function runValidationCommand(workflowConfig, checkoutPath, logDirectory, command) {
  const startedAt = now();
  const logPath = path.join(logDirectory, `${command.id}.log`);
  const commandArguments = command.args.map((argument) => {
    if (argument !== "{p4dTestServerRoot}") return argument;
    if (!workflowConfig.p4dTestServerRoot) {
      throw new WorkflowError("The P4D validation profile is not configured.", "p4d_not_configured");
    }
    return workflowConfig.p4dTestServerRoot;
  });
  const powershell = [
    "$ErrorActionPreference = 'Stop'",
    ". .\\scripts\\toolchain.ps1",
    `& '${escapePowerShell(command.executable)}' ${commandArguments
      .map((argument) => `'${escapePowerShell(argument)}'`)
      .join(" ")}`,
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
  ].join("; ");
  const validationEnvironment = {
    ...process.env,
    CARGO_TARGET_DIR: validationCargoTargetPath(workflowConfig),
  };
  let result;
  try {
    result = await runProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        powershell,
      ],
      {
        cwd: checkoutPath,
        timeoutMs: command.timeoutMs,
        captureLimit: RESULT_TAIL_LIMIT,
        logPath,
        env: validationEnvironment,
      },
    );
  } catch (error) {
    if (!error.result) throw error;
    result = error.result;
  }
  const completedAt = now();
  return {
    id: command.id,
    name: command.name,
    command: [command.executable, ...commandArguments],
    status: result.exitCode === 0 && !result.timedOut ? "passed" : "failed",
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    logPath,
    outputTail: result.outputTail,
  };
}

export async function completeTask({ stateRoot, taskId, requestId }) {
  const workflow = await loadWorkflow(stateRoot);
  const id = validateTaskId(taskId);
  const activePath = taskPath(workflow.stateRoot, "active", id);
  const task = await readJson(activePath);
  const result = await getValidationResult(workflow.stateRoot, requestId);
  if (result.taskId !== id || result.requestId !== task.latestValidationRequestId) {
    throw new WorkflowError(`Validation result is not the latest result for ${id}.`, "stale_result");
  }
  if (result.status !== "passed") {
    throw new WorkflowError(`Task ${id} cannot complete with result ${result.status}.`, "not_validated");
  }

  const completedPath = taskPath(workflow.stateRoot, "completed", id);
  await fs.rename(activePath, completedPath).catch((error) => {
    throw new WorkflowError(`Could not complete task ${id}: ${error.message}`, "complete_conflict");
  });
  const completed = {
    ...task,
    status: "completed",
    validatedCommitSha: result.commitSha,
    validationResultId: result.resultId,
    completedAt: now(),
  };
  await atomicWriteJson(completedPath, completed);
  return completed;
}

export async function blockTask({ stateRoot, taskId, reason }) {
  const workflow = await loadWorkflow(stateRoot);
  const id = validateTaskId(taskId);
  const activePath = taskPath(workflow.stateRoot, "active", id);
  const blockedPath = taskPath(workflow.stateRoot, "blocked", id);
  const task = await readJson(activePath);
  await fs.rename(activePath, blockedPath).catch((error) => {
    throw new WorkflowError(`Could not block task ${id}: ${error.message}`, "block_conflict");
  });
  const blocked = { ...task, status: "blocked", blockedReason: requireString(reason, "reason"), blockedAt: now() };
  await atomicWriteJson(blockedPath, blocked);
  return blocked;
}

export async function requeueTask({ stateRoot, taskId, reason }) {
  const workflow = await loadWorkflow(stateRoot);
  const id = validateTaskId(taskId);
  const located = await findTask(workflow.stateRoot, id);
  if (!located || !["active", "blocked"].includes(located.bucket)) {
    throw new WorkflowError(`Task ${id} is not active or blocked.`, "task_not_requeueable");
  }
  const pendingPath = taskPath(workflow.stateRoot, "pending", id);
  await fs.rename(located.filePath, pendingPath).catch((error) => {
    throw new WorkflowError(`Could not requeue task ${id}: ${error.message}`, "requeue_conflict");
  });
  const requeued = {
    ...located.task,
    status: "pending",
    attempt: (located.task.attempt ?? 0) + 1,
    requeueReason: requireString(reason, "reason"),
    requeuedAt: now(),
  };
  delete requeued.assignmentId;
  delete requeued.workerThreadId;
  delete requeued.claimedAt;
  delete requeued.latestValidationRequestId;
  delete requeued.latestValidationState;
  await atomicWriteJson(pendingPath, requeued);
  return requeued;
}

export async function getValidationResult(stateRoot, requestId) {
  const workflow = await loadWorkflow(stateRoot);
  const id = requireIdentifier(requestId, "requestId");
  return readJson(path.join(workflow.stateRoot, "validation", "results", `${id}.json`));
}

export async function workflowStatus(stateRoot) {
  const workflow = await loadWorkflow(stateRoot);
  const buckets = await loadTaskBuckets(workflow.stateRoot);
  const validationPending = await readJsonDirectory(
    path.join(workflow.stateRoot, "validation", "pending"),
  );
  const validationRunning = await readJsonDirectory(
    path.join(workflow.stateRoot, "validation", "running"),
  );
  const results = await readJsonDirectory(path.join(workflow.stateRoot, "validation", "results"));
  const lock = await readValidatorLock(workflow.stateRoot);
  const quality = computeQualityState(buckets, workflow.config);
  return {
    schemaVersion: SCHEMA_VERSION,
    workflowId: workflow.config.workflowId,
    stateRoot: workflow.stateRoot,
    orchestratorAgentProfile: structuredClone(
      workflow.config.orchestratorAgentProfile ?? ORCHESTRATOR_AGENT_PROFILE,
    ),
    validationCheckoutRoot: workflow.config.validationCheckoutRoot,
    validationWorktreePath: validationWorktreePath(workflow.config),
    validationCargoTargetRoot: validationCargoTargetPath(workflow.config),
    tasks: {
      pending: buckets.pending.length,
      active: buckets.active.length,
      completed: buckets.completed.length,
      blocked: buckets.blocked.length,
      next: selectNextWorkflowItem(buckets, workflow.config),
    },
    quality,
    validation: {
      pending: validationPending,
      running: validationRunning,
      recentResults: results
        .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
        .slice(0, 10),
      validatorLock: lock,
    },
  };
}

export async function doctorWorkflow(stateRoot) {
  const workflow = await loadWorkflow(stateRoot);
  const checks = [];
  checks.push(await diagnostic("git", () => runProcess("git", ["--version"], { timeoutMs: 10_000 })));
  checks.push(
    await diagnostic("repository", () =>
      runGit(workflow.config.repoRoot, ["rev-parse", "--is-inside-work-tree"], 10_000),
    ),
  );
  checks.push(
    await diagnostic("toolchain", () =>
      runProcess(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          ". .\\scripts\\toolchain.ps1; node --version; rustc --version; cargo clippy --version",
        ],
        { cwd: workflow.config.repoRoot, timeoutMs: 30_000 },
      ),
    ),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
  };
}

async function diagnostic(name, action) {
  try {
    const result = await action();
    return { name, status: "passed", output: result.outputTail.trim() };
  } catch (error) {
    return { name, status: "failed", output: error instanceof Error ? error.message : String(error) };
  }
}

async function verifyWorkerWorktree(repoRoot, worktreePath, expectedCommit) {
  const workerRoot = await resolveRepositoryRoot(worktreePath);
  if (!samePath(workerRoot, worktreePath)) {
    throw new WorkflowError(`${worktreePath} is not a worktree root.`, "invalid_worktree");
  }
  const [repoCommon, workerCommon] = await Promise.all([
    commonGitDirectory(repoRoot),
    commonGitDirectory(worktreePath),
  ]);
  if (!samePath(repoCommon, workerCommon)) {
    throw new WorkflowError(`${worktreePath} belongs to another repository.`, "invalid_worktree");
  }
  const head = await resolveCommit(worktreePath, "HEAD");
  if (head !== expectedCommit) {
    throw new WorkflowError(
      `Worktree HEAD ${head} does not match requested commit ${expectedCommit}.`,
      "worktree_head_mismatch",
    );
  }
  const status = await runGit(worktreePath, ["status", "--porcelain"], 30_000);
  if (status.outputTail.trim()) {
    throw new WorkflowError(
      "Worker worktree must be clean before validation is requested.",
      "dirty_worktree",
    );
  }
}

async function updateTaskAfterValidation(workflow, result) {
  const filePath = taskPath(workflow.stateRoot, "active", result.taskId);
  if (!(await pathExists(filePath))) return;
  const task = await readJson(filePath);
  if (task.assignmentId !== result.assignmentId) return;
  await atomicWriteJson(filePath, {
    ...task,
    latestValidationRequestId: result.requestId,
    latestValidationState: result.status,
    latestValidationResultId: result.resultId,
    latestValidatedCommitSha: result.commitSha,
  });
}

async function recoverRunningRequests(workflow) {
  const runningDirectory = path.join(workflow.stateRoot, "validation", "running");
  for (const request of await readJsonDirectory(runningDirectory)) {
    validateStoredRequest(request, workflow.config);
    const resultPath = path.join(
      workflow.stateRoot,
      "validation",
      "results",
      `${request.requestId}.json`,
    );
    const runningPath = path.join(runningDirectory, `${request.requestId}.json`);
    if (await pathExists(resultPath)) {
      await fs.unlink(runningPath);
      continue;
    }
    const warnings = [];
    await removeManagedCheckout(
      workflow,
      managedCheckoutPath(workflow.config, request.requestId),
      warnings,
    );
    await fs.rename(
      runningPath,
      path.join(workflow.stateRoot, "validation", "pending", `${request.requestId}.json`),
    );
  }
}

async function removeManagedCheckout(workflow, checkoutPath, warnings) {
  assertManagedPath(workflow.config.validationCheckoutRoot, checkoutPath);
  if (!(await pathExists(checkoutPath))) return;
  try {
    await detachSharedToolchain(workflow, checkoutPath);
  } catch (error) {
    warnings.push(`Shared toolchain detach failed: ${error.message}`);
    return;
  }

  let worktreeRemoveError = null;
  try {
    await runGit(
      workflow.config.repoRoot,
      ["worktree", "remove", "--force", checkoutPath],
      120_000,
    );
  } catch (error) {
    worktreeRemoveError = error;
  }

  if (await pathExists(checkoutPath)) {
    if (await isRegisteredWorktree(workflow.config.repoRoot, checkoutPath)) {
      warnings.push(`Checkout cleanup failed: ${worktreeRemoveError?.message ?? "path is still registered"}`);
      return;
    }
    try {
      assertManagedPath(workflow.config.validationCheckoutRoot, checkoutPath);
      await fs.rm(checkoutPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch (error) {
      warnings.push(`Unregistered checkout cleanup failed: ${error.message}`);
      return;
    }
  }
  if (worktreeRemoveError) {
    warnings.push(`Git worktree cleanup required a filesystem fallback: ${worktreeRemoveError.message}`);
  }
}

export function assertManagedPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new WorkflowError(`${resolvedTarget} is outside managed root ${resolvedRoot}.`, "unsafe_path");
  }
  return resolvedTarget;
}

function managedCheckoutPath(config, requestId) {
  requireIdentifier(requestId, "requestId");
  return validationWorktreePath(config);
}

export function validationWorktreePath(config) {
  const checkout = config.validationWorktreePath
    ?? path.join(config.validationCheckoutRoot, "checkout");
  return assertManagedPath(config.validationCheckoutRoot, checkout);
}

export function validationCargoTargetPath(config) {
  const target = config.validationCargoTargetRoot
    ?? path.join(config.validationCheckoutRoot, "cargo-target");
  return assertManagedPath(config.validationCheckoutRoot, target);
}

async function acquireValidatorLock(workflow) {
  const lockPath = path.join(workflow.stateRoot, "locks", "validator.lock");
  const existing = await readValidatorLock(workflow.stateRoot);
  if (existing) {
    if (existing.hostname === hostname() && !isProcessAlive(existing.pid)) {
      await fs.unlink(lockPath).catch(() => {});
    } else {
      throw new WorkflowError(
        `Validator is already running as PID ${existing.pid} on ${existing.hostname}.`,
        "validator_locked",
      );
    }
  }
  const value = {
    schemaVersion: SCHEMA_VERSION,
    workflowId: workflow.config.workflowId,
    pid: process.pid,
    hostname: hostname(),
    startedAt: now(),
  };
  const handle = await fs.open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
  await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await handle.close();
  return { lockPath, pid: process.pid };
}

async function releaseValidatorLock(lock) {
  try {
    const value = await readJson(lock.lockPath);
    if (value.pid === lock.pid) await fs.unlink(lock.lockPath);
  } catch {
    // A missing lock is already released.
  }
}

async function readValidatorLock(stateRoot) {
  const lockPath = path.join(stateRoot, "locks", "validator.lock");
  if (!(await pathExists(lockPath))) return null;
  try {
    const value = await readJson(lockPath);
    return { ...value, alive: value.hostname === hostname() ? isProcessAlive(value.pid) : null };
  } catch (error) {
    return { status: "invalid", error: error.message };
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function validateStoredRequest(request, config) {
  assertPlainObject(request, "validation request");
  if (request.schemaVersion !== SCHEMA_VERSION || request.workflowId !== config.workflowId) {
    throw new WorkflowError("Validation request belongs to another workflow.", "invalid_request");
  }
  validateTaskId(request.taskId);
  requireIdentifier(request.requestId, "requestId");
  requireIdentifier(request.assignmentId, "assignmentId");
  validateCommit(request.commitSha, "commitSha");
  validateCommit(request.baseSha, "baseSha");
  if (!Object.hasOwn(validationProfiles, request.validationProfile)) {
    throw new WorkflowError("Validation request uses an unknown profile.", "invalid_request");
  }
}

async function createStateDirectories(stateRoot) {
  const directories = [
    ...TASK_BUCKETS.map((bucket) => path.join(stateRoot, "tasks", bucket)),
    path.join(stateRoot, "assignments"),
    path.join(stateRoot, "validation", "pending"),
    path.join(stateRoot, "validation", "running"),
    path.join(stateRoot, "validation", "results"),
    path.join(stateRoot, "validation", "logs"),
    path.join(stateRoot, "locks"),
  ];
  await Promise.all(directories.map((directory) => fs.mkdir(directory, { recursive: true })));
}

async function loadAllTasks(stateRoot) {
  return (
    await Promise.all(
      TASK_BUCKETS.map(async (bucket) =>
        (await loadBucket(stateRoot, bucket)).map((task) => ({
          bucket,
          task,
          filePath: taskPath(stateRoot, bucket, task.taskId),
        })),
      ),
    )
  ).flat();
}

async function loadTaskBuckets(stateRoot) {
  return Object.fromEntries(
    await Promise.all(
      TASK_BUCKETS.map(async (bucket) => [bucket, await loadBucket(stateRoot, bucket)]),
    ),
  );
}

async function findTask(stateRoot, taskId) {
  return (await loadAllTasks(stateRoot)).find(({ task }) => task.taskId === taskId) ?? null;
}

async function loadBucket(stateRoot, bucket) {
  return readJsonDirectory(path.join(stateRoot, "tasks", bucket));
}

async function readJsonDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  return Promise.all(files.map(readJson));
}

function taskPath(stateRoot, bucket, taskId) {
  if (!TASK_BUCKETS.includes(bucket)) {
    throw new WorkflowError(`Unknown task bucket ${bucket}.`, "invalid_bucket");
  }
  return path.join(stateRoot, "tasks", bucket, `${validateTaskId(taskId)}.json`);
}

async function resolveRepositoryRoot(candidate) {
  const result = await runGit(path.resolve(candidate), ["rev-parse", "--show-toplevel"], 10_000);
  return path.resolve(result.outputTail.trim());
}

async function commonGitDirectory(repoRoot) {
  const result = await runGit(
    repoRoot,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    10_000,
  );
  return path.resolve(result.outputTail.trim());
}

async function resolveToolchainRoot(repoRoot) {
  const localToolchain = path.join(repoRoot, ".toolchain");
  if (await pathExists(path.join(localToolchain, "node", "node.exe"))) {
    return localToolchain;
  }
  const commonDirectory = await commonGitDirectory(repoRoot);
  const sharedToolchain = path.join(path.dirname(commonDirectory), ".toolchain");
  if (await pathExists(path.join(sharedToolchain, "node", "node.exe"))) {
    return sharedToolchain;
  }
  throw new WorkflowError(
    `Pinned toolchain was not found for ${repoRoot}. Prepare the primary checkout first.`,
    "toolchain_missing",
  );
}

async function resolveP4dTestServerRoot(candidate) {
  const serverRoot = path.resolve(requireString(candidate, "p4dTestServerRoot"));
  const requiredFiles = [
    path.join(serverRoot, "bin", "p4.exe"),
    path.join(serverRoot, "bin", "p4d.exe"),
    path.join(serverRoot, "config", ".p4tickets"),
    path.join(serverRoot, "start-server.ps1"),
    path.join(serverRoot, "stop-server.ps1"),
  ];
  for (const requiredFile of requiredFiles) {
    if (!(await pathExists(requiredFile))) {
      throw new WorkflowError(
        `Disposable P4D root is missing ${requiredFile}.`,
        "invalid_p4d_root",
      );
    }
  }
  return serverRoot;
}

async function attachSharedToolchain(workflow, checkoutPath) {
  const linkPath = path.join(checkoutPath, ".toolchain");
  if (await pathExists(linkPath)) {
    throw new WorkflowError(`Validation checkout already contains ${linkPath}.`, "toolchain_link_conflict");
  }
  await fs.symlink(workflow.config.toolchainRoot, linkPath, "junction");
}

async function detachSharedToolchain(workflow, checkoutPath) {
  const linkPath = path.join(checkoutPath, ".toolchain");
  if (!(await pathExists(linkPath))) return;
  const stats = await fs.lstat(linkPath);
  if (!stats.isSymbolicLink()) {
    throw new WorkflowError(`Refusing to remove non-link toolchain path ${linkPath}.`, "unsafe_path");
  }
  const target = await fs.readlink(linkPath);
  if (!samePath(target, workflow.config.toolchainRoot)) {
    throw new WorkflowError(`Toolchain link ${linkPath} has an unexpected target.`, "unsafe_path");
  }
  await fs.unlink(linkPath);
}

async function isRegisteredWorktree(repoRoot, checkoutPath) {
  const result = await runGit(repoRoot, ["worktree", "list", "--porcelain"], 30_000);
  return result.outputTail
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .some((registeredPath) => samePath(registeredPath, checkoutPath));
}

async function resolveCommit(repoRoot, ref) {
  const result = await runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], 10_000);
  return validateCommit(result.outputTail.trim(), "resolved commit");
}

async function mergeBase(repoRoot, commits) {
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new WorkflowError("At least one validated commit is required.", "invalid_quality_source");
  }
  let current = validateCommit(commits[0], "quality source commit");
  for (const commit of commits.slice(1)) {
    const result = await runGit(
      repoRoot,
      ["merge-base", current, validateCommit(commit, "quality source commit")],
      30_000,
    );
    current = validateCommit(result.outputTail.trim(), "quality merge base");
  }
  return current;
}

async function assertCommitExists(repoRoot, commitSha) {
  await runGit(repoRoot, ["cat-file", "-e", `${validateCommit(commitSha, "commitSha")}^{commit}`], 10_000);
}

async function isAncestor(repoRoot, baseSha, commitSha) {
  const result = await runProcess(
    "git",
    ["-C", repoRoot, "merge-base", "--is-ancestor", baseSha, commitSha],
    { timeoutMs: 10_000, allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function changedPaths(repoRoot, baseSha, commitSha) {
  const result = await runGit(
    repoRoot,
    ["diff", "--name-only", "--no-renames", baseSha, commitSha],
    30_000,
  );
  return result.outputTail
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function runGit(cwd, args, timeoutMs) {
  return runProcess("git", ["-C", cwd, ...args], { timeoutMs });
}

async function runProcess(executable, args, options = {}) {
  const {
    cwd,
    timeoutMs = 30_000,
    allowExitCodes = [0],
    captureLimit = RESULT_TAIL_LIMIT,
    logPath,
    env = process.env,
  } = options;
  if (logPath) await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logStream = logPath ? createWriteStream(logPath, { encoding: "utf8" }) : null;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputTail = "";
    let settled = false;
    let timedOut = false;
    const append = (chunk) => {
      const text = chunk.toString();
      outputTail = `${outputTail}${text}`.slice(-captureLimit);
      logStream?.write(text);
    };
    child.stdout.on("data", (chunk) => {
      append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      append(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.unref();
      } else {
        child.kill();
      }
    }, timeoutMs);

    const finish = async (error, exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (logStream) {
        await new Promise((resolve) => logStream.end(resolve));
      }
      if (error) {
        reject(error);
        return;
      }
      const normalizedExitCode = exitCode ?? -1;
      const result = { exitCode: normalizedExitCode, timedOut, outputTail };
      if (!allowExitCodes.includes(normalizedExitCode) || timedOut) {
        const suffix = timedOut ? `timed out after ${timeoutMs} ms` : `exited with ${normalizedExitCode}`;
        const processError = new WorkflowError(
          `${executable} ${args.join(" ")} ${suffix}.\n${outputTail}`.trim(),
          timedOut ? "process_timeout" : "process_failed",
        );
        processError.exitCode = normalizedExitCode;
        processError.result = result;
        reject(processError);
        return;
      }
      resolve(result);
    };
    child.on("error", (error) => void finish(error, -1));
    child.on("close", (code) => void finish(null, code));
  });
}

function validateConfig(config, expectedStateRoot) {
  assertPlainObject(config, "workflow config");
  if (config.schemaVersion !== SCHEMA_VERSION) {
    throw new WorkflowError(`Unsupported workflow schemaVersion ${config.schemaVersion}.`, "invalid_config");
  }
  requireIdentifier(config.workflowId, "workflowId");
  if (!path.isAbsolute(config.repoRoot) || !path.isAbsolute(config.stateRoot)) {
    throw new WorkflowError("Workflow paths must be absolute.", "invalid_config");
  }
  if (!path.isAbsolute(config.toolchainRoot) || !path.isAbsolute(config.validationCheckoutRoot)) {
    throw new WorkflowError("Workflow toolchain and checkout paths must be absolute.", "invalid_config");
  }
  validationCargoTargetPath(config);
  validationWorktreePath(config);
  if (config.p4dTestServerRoot !== undefined && !path.isAbsolute(config.p4dTestServerRoot)) {
    throw new WorkflowError("Workflow P4D test server path must be absolute.", "invalid_config");
  }
  if (!samePath(config.stateRoot, expectedStateRoot)) {
    throw new WorkflowError("Workflow stateRoot does not match its location.", "invalid_config");
  }
  if (!Object.hasOwn(validationProfiles, config.defaultValidationProfile)) {
    throw new WorkflowError("Workflow default validation profile is unknown.", "invalid_config");
  }
  if (
    config.orchestratorAgentProfile !== undefined &&
    !sameAgentProfile(config.orchestratorAgentProfile, ORCHESTRATOR_AGENT_PROFILE)
  ) {
    throw new WorkflowError(
      "Workflow orchestrator profile must remain Terra/Low.",
      "invalid_config",
    );
  }
  normalizeQualityEvery(config.qualityCheckpointEvery);
}

function sameAgentProfile(actual, expected) {
  return Boolean(
    actual &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    actual.model === expected.model &&
    actual.reasoningEffort === expected.reasoningEffort &&
    actual.maximumReasoningEffort === expected.maximumReasoningEffort
  );
}

function qualityEvery(config) {
  return normalizeQualityEvery(config.qualityCheckpointEvery);
}

function normalizeQualityEvery(value) {
  const normalized = value === undefined ? DEFAULT_QUALITY_CHECKPOINT_EVERY : Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 20) {
    throw new WorkflowError(
      "qualityCheckpointEvery must be an integer from 1 to 20.",
      "invalid_config",
    );
  }
  return normalized;
}

function taskKindOf(task) {
  return task.taskKind ?? "feature";
}

function normalizeWorkClass(value, taskKind, taskId) {
  const qualityTask = QUALITY_TASK_KINDS.has(taskKind);
  const normalized = value ?? (qualityTask ? "quality" : "implementation");
  if (!WORK_CLASSES.has(normalized)) {
    throw new WorkflowError(`Task ${taskId} has unknown workClass ${normalized}.`, "invalid_task");
  }
  if (qualityTask && normalized !== "quality") {
    throw new WorkflowError(
      `Quality task ${taskId} must use the quality workClass.`,
      "invalid_task",
    );
  }
  if (!qualityTask && normalized === "quality") {
    throw new WorkflowError(
      `Feature task ${taskId} cannot use the quality workClass.`,
      "invalid_task",
    );
  }
  return normalized;
}

function normalizeReasoningEffort(value, workClass, taskId) {
  const normalized = value ?? DEFAULT_REASONING_EFFORT[workClass];
  if (!ALLOWED_REASONING_EFFORTS[workClass]?.has(normalized)) {
    throw new WorkflowError(
      `Task ${taskId} cannot use ${normalized} reasoning for ${workClass} work.`,
      "agent_profile_exceeds_limit",
    );
  }
  return normalized;
}

function agentProfileForWorkClass(workClass, reasoningEffort) {
  const profile = WORKER_AGENT_PROFILES[workClass];
  if (!profile) {
    throw new WorkflowError(`No agent profile exists for ${workClass}.`, "invalid_task");
  }
  return { ...structuredClone(profile), reasoningEffort };
}

function taskForDispatch(task) {
  if (!task) return null;
  const workClass = normalizeWorkClass(task.workClass, taskKindOf(task), task.taskId);
  const reasoningEffort = normalizeReasoningEffort(
    task.reasoningEffort,
    workClass,
    task.taskId,
  );
  if (
    (workClass === "complex" || reasoningEffort !== DEFAULT_REASONING_EFFORT[workClass]) &&
    !task.resourceJustification
  ) {
    throw new WorkflowError(
      `Task ${task.taskId} requires resourceJustification for its elevated agent profile.`,
      "resource_justification_required",
    );
  }
  return {
    ...task,
    workClass,
    reasoningEffort,
    agentProfile: agentProfileForWorkClass(workClass, reasoningEffort),
  };
}

function compareTasks(left, right) {
  return (
    left.priority - right.priority ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.taskId.localeCompare(right.taskId)
  );
}

function nextCheckpointId(buckets) {
  const used = new Set(
    [...buckets.pending, ...buckets.active, ...buckets.completed, ...buckets.blocked]
      .map((task) => task.qualityCheckpointId)
      .filter(Boolean),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `quality-${String(index).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new WorkflowError("Could not allocate a quality checkpoint ID.", "quality_id_exhausted");
}

function validateTaskId(value) {
  if (typeof value !== "string" || !TASK_ID_PATTERN.test(value)) {
    throw new WorkflowError(
      "taskId must contain 1-64 lowercase letters, digits, dots, underscores, or hyphens.",
      "invalid_task_id",
    );
  }
  return value;
}

function validateCommit(value, name) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    throw new WorkflowError(`${name} must be a full hexadecimal commit SHA.`, "invalid_commit");
  }
  return value.toLowerCase();
}

function requireIdentifier(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new WorkflowError(`${name} is invalid.`, "invalid_identifier");
  }
  return value;
}

function uniqueTaskIds(values, name) {
  if (!Array.isArray(values)) throw new WorkflowError(`${name} must be an array.`, "invalid_task");
  return [...new Set(values.map(validateTaskId))];
}

function nonEmptyStrings(values, name) {
  const result = optionalStrings(values, name);
  if (result.length === 0) throw new WorkflowError(`${name} cannot be empty.`, "invalid_task");
  return result;
}

function optionalStrings(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new WorkflowError(`${name} must contain non-empty strings.`, "invalid_task");
  }
  return values.map((value) => value.trim());
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowError(`${name} must be a non-empty string.`, "invalid_value");
  }
  return value.trim();
}

function plainObjectCopy(value, name) {
  assertPlainObject(value, name);
  return structuredClone(value);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowError(`${name} must be a JSON object.`, "invalid_value");
  }
}

function samePath(left, right) {
  return normalizeWindowsPath(left) === normalizeWindowsPath(right);
}

function normalizeWindowsPath(value) {
  return path.resolve(String(value).replace(/^\\\\\?\\/, "")).toLowerCase();
}

function now() {
  return new Date().toISOString();
}

function escapePowerShell(value) {
  return String(value).replaceAll("'", "''");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new WorkflowError(`Could not read ${filePath}: ${error.message}`, "invalid_json");
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
