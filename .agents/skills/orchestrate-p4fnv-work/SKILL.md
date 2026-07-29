---
name: orchestrate-p4fnv-work
description: Orchestrate prioritized P4FNV feature development across Codex tasks in isolated Git worktrees, with dependency-aware scheduling, immutable commit handoffs, serialized validation, and mandatory refactor/stabilization checkpoints. Use when the user asks for parallel feature implementation, a worktree worker pool, an orchestrator chat, prioritized sub-tasks, isolated build validation, or recurring code-quality and stabilization gates.
---

# Orchestrate P4FNV Work

Run one coordinator, bounded worker tasks, and one validator queue. Treat [`Docs/PARALLEL_DEVELOPMENT.md`](../../../Docs/PARALLEL_DEVELOPMENT.md) as the protocol owner and read it before starting or resuming a run.

## Prepare

1. Read `$develop-p4fnv` and the contracts routed by each backlog item.
2. Confirm the workflow scripts are present on the base commit used for new worktrees.
3. Initialize or load an absolute shared state path and run `doctor --available-models` with the currently callable families.
4. Enqueue the user-approved backlog with `p4fnv-auto`. Preserve priority, dependencies, acceptance criteria, base ref, and work class. Set `--quality-units` (default `4`). Configure `--p4d-root` only for an authorized disposable loopback server.
5. Ensure exactly one `validate --watch` process owns the validator lock, or plan to run one-shot validation after each request.

Do not place shared queue state in a worker worktree. Do not start feature work from the orchestrator checkout.

## Schedule

1. Call `next --available-models <list>`.
2. If `next` returns `quality-checkpoint-draining`, assign no new features and wait for the listed active feature workers. If it returns `quality-checkpoint-required`, run `quality-checkpoint --state <path>` before creating more workers. Schedule its refactor task and then its dependent stabilization task; pending, active, or blocked quality work is a hard feature barrier.
3. Run coordinator-only scheduling and status work on Terra/Low when the task surface supports model selection. Read the selected task's derived `agentProfile`, then create its Codex task with that exact model and reasoning effort plus `environment.type: "worktree"`. If the profile is unavailable, leave the task pending and report it; never silently upgrade or substitute. Use the task's `baseRef` as the starting branch only when the thread API requires an explicit existing state.
4. Wait for a real thread ID. Claim with the actual model/effort and `--max-child-agents 0`, then send the assignment unchanged. Workers must not spawn subagents.
5. Ask a feature worker to implement only its assignment. Ask a quality worker to integrate every immutable `sourceCommits` range exactly once before its refactor or stabilization audit. All workers commit, leave the worktree clean, submit `HEAD` with `request`, and return the request JSON.
6. Fill free worker slots with the next eligible priorities. Never skip a higher-priority dependency-ready task or assign a feature across a quality barrier.

Workers use focused and debug checks only. They never start, stop, or mutate the shared disposable P4D server; the serialized stabilization validator owns release regression and writable P4D smoke.

Use event-driven `wait_threads` with `agentBudget.monitorTimeoutMs`. On timeout, perform one liveness check and double the next wait up to `maximumMonitorTimeoutMs`; never poll diffs.

## Validate and return feedback

Monitor workflow `status`. For each new result:

1. Read the compact result by request ID; use `--verbose` only for a failure.
2. Send the compact envelope to its exact `workerThreadId`.
3. On `failed`, keep the task with the same worker for a fix and a new commit/request.
4. On `infrastructure-error`, repair or restart validation; do not ask the worker to change code without evidence.
5. On `passed`, verify it is the latest request, run `complete`, and record the validated commit SHA.

Never accept a worker's self-reported build as authoritative. Never validate an uncommitted diff, moving branch name, arbitrary queue command, or another worker's checkout. A rebase, merge, conflict resolution, or follow-up commit invalidates the previous result.

## Finish

Stop assigning when cancelled. Otherwise finish only at `handoffReady`; weighted non-mechanical partial waves still require quality work. Report validated SHAs and blockers. Run `cleanup` as dry-run and apply it only when authorized; preserve the final candidate and Cargo cache by default. Do not merge or push without separate authorization.
