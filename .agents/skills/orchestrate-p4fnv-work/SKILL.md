---
name: orchestrate-p4fnv-work
description: Orchestrate prioritized P4FNV feature development across Codex tasks in isolated Git worktrees, with dependency-aware scheduling, immutable commit handoffs, serialized validation, and mandatory refactor/stabilization checkpoints. Use when the user asks for parallel feature implementation, a worktree worker pool, an orchestrator chat, prioritized sub-tasks, isolated build validation, or recurring code-quality and stabilization gates.
---

# Orchestrate P4FNV Work

Run one coordinator, bounded worker tasks, and one validator queue. Treat [`Docs/PARALLEL_DEVELOPMENT.md`](../../../Docs/PARALLEL_DEVELOPMENT.md) as the protocol owner and read it before starting or resuming a run.

## Prepare

1. Read `$develop-p4fnv` and the contracts routed by each backlog item.
2. Confirm the workflow scripts are present on the base commit used for new worktrees.
3. Initialize or load an absolute shared state path and run `npm run workflow -- doctor`.
4. Enqueue the user-approved backlog. Preserve task priority, dependencies, acceptance criteria, base ref, and validation profile. Set `--quality-every` to the agreed wave size (default `4`). Configure `--p4d-root` only for an explicitly authorized disposable loopback server; stabilization then uses `p4fnv-full-p4d` automatically.
5. Ensure exactly one `validate --watch` process owns the validator lock, or plan to run one-shot validation after each request.

Do not place shared queue state in a worker worktree. Do not start feature work from the orchestrator checkout.

## Schedule

1. Call `npm run workflow -- next --state <path>`.
2. If `next` returns `quality-checkpoint-draining`, assign no new features and wait for the listed active feature workers. If it returns `quality-checkpoint-required`, run `quality-checkpoint --state <path>` before creating more workers. Schedule its refactor task and then its dependent stabilization task; pending, active, or blocked quality work is a hard feature barrier.
3. Run coordinator-only scheduling and status work on Terra/Low when the task surface supports model selection. Read the selected task's derived `agentProfile`, then create its Codex task with that exact model and reasoning effort plus `environment.type: "worktree"`. If the profile is unavailable, leave the task pending and report it; never silently upgrade or substitute. Use the task's `baseRef` as the starting branch only when the thread API requires an explicit existing state.
4. Wait until creation returns a real thread ID. Claim the task with that ID and send the emitted assignment JSON unchanged to the worker.
5. Ask a feature worker to implement only its assignment. Ask a quality worker to integrate every immutable `sourceCommits` range exactly once before its refactor or stabilization audit. All workers commit, leave the worktree clean, submit `HEAD` with `request`, and return the request JSON.
6. Fill free worker slots with the next eligible priorities. Never skip a higher-priority dependency-ready task or assign a feature across a quality barrier.

Workers use focused and debug checks only. They never start, stop, or mutate the shared disposable P4D server; the serialized stabilization validator owns release regression and writable P4D smoke.

Use event-driven `wait_threads` with a bounded timeout after dispatch. Inspect workflow or repository status only when a worker event arrives or the timeout expires; do not poll diffs between events. Do not repeatedly read full task histories and do not mistake commentary for completion.

## Validate and return feedback

Monitor workflow `status`. For each new result:

1. Read the result JSON by request ID.
2. Send it to its exact `workerThreadId`.
3. On `failed`, keep the task with the same worker for a fix and a new commit/request.
4. On `infrastructure-error`, repair or restart validation; do not ask the worker to change code without evidence.
5. On `passed`, verify it is the latest request, run `complete`, and record the validated commit SHA.

Never accept a worker's self-reported build as authoritative. Never validate an uncommitted diff, moving branch name, arbitrary queue command, or another worker's checkout. A rebase, merge, conflict resolution, or follow-up commit invalidates the previous result.

## Finish

Stop assigning new work when the user cancels the run. Otherwise finish only when `status.quality.handoffReady` is `true`; a partial final feature wave still needs refactoring and stabilization. Report completed task IDs and validated SHAs, quality coverage, active/blocked tasks, and failure logs. Do not merge or push worker branches unless the user separately authorizes integration.
