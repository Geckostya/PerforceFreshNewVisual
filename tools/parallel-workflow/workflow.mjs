#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  WorkflowError,
  blockTask,
  claimTask,
  completeTask,
  createQualityCheckpoint,
  doctorWorkflow,
  enqueueTasks,
  getNextTask,
  getValidationResult,
  initializeWorkflow,
  requeueTask,
  runValidator,
  submitValidationRequest,
  workflowStatus,
} from "./lib.mjs";

const { command, options } = parseArguments(process.argv.slice(2));

try {
  let result;
  switch (command) {
    case "init":
      result = await initializeWorkflow({
        stateRoot: required(options, "state"),
        repoRoot: options.repo,
        backlogFile: options.backlog,
        p4dTestServerRoot: options["p4d-root"],
        qualityCheckpointEvery: options["quality-every"],
      });
      break;
    case "enqueue":
      result = await enqueueTasks({
        stateRoot: required(options, "state"),
        input: JSON.parse(await readFile(required(options, "file"), "utf8")),
      });
      break;
    case "next":
      result = (await getNextTask(required(options, "state"))) ?? {
        schemaVersion: 1,
        status: "idle",
        reason: "No dependency-ready pending task.",
      };
      break;
    case "claim":
      result = await claimTask({
        stateRoot: required(options, "state"),
        taskId: required(options, "task"),
        workerId: required(options, "worker"),
      });
      break;
    case "quality-checkpoint":
      result = await createQualityCheckpoint({
        stateRoot: required(options, "state"),
        checkpointId: options.id,
        sourceTaskIds: options.sources
          ? options.sources.split(",").map((value) => value.trim()).filter(Boolean)
          : undefined,
      });
      break;
    case "request":
      result = await submitValidationRequest({
        stateRoot: required(options, "state"),
        taskId: required(options, "task"),
        assignmentId: required(options, "assignment"),
        commitSha: required(options, "commit"),
        baseSha: required(options, "base"),
        worktreePath: required(options, "worktree"),
        summary: options.summary ?? "",
      });
      break;
    case "validate":
      if (
        options["poll-ms"] !== undefined &&
        (!Number.isInteger(Number(options["poll-ms"])) || Number(options["poll-ms"]) < 250)
      ) {
        throw new WorkflowError("--poll-ms must be an integer of at least 250.", "invalid_arguments");
      }
      result = await runValidator({
        stateRoot: required(options, "state"),
        watch: Boolean(options.watch),
        pollIntervalMs: options["poll-ms"] ? Number(options["poll-ms"]) : undefined,
      });
      break;
    case "result":
      result = await getValidationResult(
        required(options, "state"),
        required(options, "request"),
      );
      break;
    case "complete":
      result = await completeTask({
        stateRoot: required(options, "state"),
        taskId: required(options, "task"),
        requestId: required(options, "request"),
      });
      break;
    case "block":
      result = await blockTask({
        stateRoot: required(options, "state"),
        taskId: required(options, "task"),
        reason: required(options, "reason"),
      });
      break;
    case "requeue":
      result = await requeueTask({
        stateRoot: required(options, "state"),
        taskId: required(options, "task"),
        reason: required(options, "reason"),
      });
      break;
    case "status":
      result = await workflowStatus(required(options, "state"));
      break;
    case "doctor":
      result = await doctorWorkflow(required(options, "state"));
      if (result.status !== "passed") process.exitCode = 1;
      break;
    case "help":
    case undefined:
      process.stdout.write(helpText());
      process.exit(0);
      break;
    default:
      throw new WorkflowError(`Unknown command ${command}.`, "unknown_command");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const payload = {
    schemaVersion: 1,
    status: "error",
    code: error instanceof WorkflowError ? error.code : "unexpected_error",
    message: error instanceof Error ? error.message : String(error),
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const command = args[0];
  const options = {};
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new WorkflowError(`Unexpected argument ${token}.`, "invalid_arguments");
    }
    const name = token.slice(2);
    if (name === "watch") {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new WorkflowError(`Option --${name} needs a value.`, "invalid_arguments");
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value) {
    throw new WorkflowError(`Missing required option --${name}.`, "invalid_arguments");
  }
  return value;
}

function helpText() {
  return `P4FNV parallel feature workflow

Usage:
  npm run workflow -- init --state <absolute-path> [--repo <path>] [--backlog <json>] \\
    [--p4d-root <disposable-server-root>] [--quality-every <1-20>]
  npm run workflow -- doctor --state <path>
  npm run workflow -- enqueue --state <path> --file <backlog.json>
  npm run workflow -- next --state <path>
  npm run workflow -- quality-checkpoint --state <path> [--id <id>] \\
    [--sources <task-id,task-id>]
  npm run workflow -- claim --state <path> --task <id> --worker <thread-id>
  npm run workflow -- request --state <path> --task <id> --assignment <id> \\
    --commit <sha> --base <sha> --worktree <path> [--summary <text>]
  npm run workflow -- validate --state <path> [--watch] [--poll-ms <milliseconds>]
  npm run workflow -- result --state <path> --request <id>
  npm run workflow -- complete --state <path> --task <id> --request <id>
  npm run workflow -- block --state <path> --task <id> --reason <text>
  npm run workflow -- requeue --state <path> --task <id> --reason <text>
  npm run workflow -- status --state <path>

Priority 1 is highest. Quality checkpoints pause new feature assignment and run refactoring
before stabilization. The validator accepts only immutable commits and allow-listed profiles;
it never executes commands from queue JSON.
`;
}
