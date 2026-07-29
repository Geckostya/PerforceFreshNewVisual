# Parallel feature development

This contract owns prioritized Codex task orchestration, worker worktree isolation, and commit-based validation. Application build commands remain in [`TOOLCHAIN.md`](TOOLCHAIN.md); native UI verification remains in [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).

## Invariants

- One orchestrator owns scheduling and sends dependency-ready tasks in ascending numeric priority; priority `1` is highest.
- Each worker runs in a Codex Git worktree and changes only its assigned feature. A worker never edits or tests another worker's checkout.
- A validation request names a clean, committed, full commit SHA. Uncommitted work and a branch that moves after submission are never part of that result.
- One validator process serializes authoritative builds. Each request is checked in a fresh detached worktree, so `node_modules`, Cargo `target`, and `p4fnv.exe` are not shared with workers or other validation jobs.
- Queue JSON selects an allow-listed validation profile; it cannot provide an executable, arguments, environment, cleanup path, or shell text.
- A task completes only when the latest result is `passed`. The validated commit SHA, not the worker's branch name, is the integration candidate.
- Feature work runs in bounded waves. After the configured number of completed features, or before final handoff, scheduling stops for a generated `refactor` task followed by a generated `stabilization` task.
- A blocked, pending, or active quality task is a hard barrier: no new feature is assigned until that checkpoint passes.
- Native UI smoke remains a separate visible operation through `p4fnv_agent_plugin`. Never run mutating Perforce smoke against the user's server without explicit authorization.

## Shared state and protocol

`tools/parallel-workflow/workflow.mjs` keeps ignored runtime state outside worker worktrees, normally under the primary checkout's `.tmp/parallel-workflow/<run>`. Pass its absolute path to every worker and validator.

```text
config.json
tasks/{pending,active,completed,blocked}/
assignments/
validation/{pending,running,results,logs}/
locks/validator.lock
```

Queue transitions use same-volume renames and the validator uses an exclusive PID/host lock. A new validator recovers an interrupted `running` request before accepting more work. Detached build checkouts live under the short OS temporary path recorded as `config.validationCheckoutRoot`; cleanup is constrained to that root and removes the temporary shared-toolchain junction before `git worktree remove`.

The normative JSON formats are:

- [`task.schema.json`](../tools/parallel-workflow/schemas/task.schema.json) for backlog and stored task data;
- [`assignment.schema.json`](../tools/parallel-workflow/schemas/assignment.schema.json) for the prompt sent to a worker;
- [`validation-request.schema.json`](../tools/parallel-workflow/schemas/validation-request.schema.json) for an immutable handoff;
- [`validation-result.schema.json`](../tools/parallel-workflow/schemas/validation-result.schema.json) for the report returned to the worker.

`p4fnv-full` is the completion profile and runs the complete gate from `TOOLCHAIN.md`. `p4fnv-fast` builds the debug application after frontend tests and Rust formatting; use it for intermediate feedback, not final readiness. `p4fnv-full-p4d` adds a serialized writable smoke against an explicitly configured disposable loopback P4D server: it creates, reads back, and deletes an empty changelist. The server root is coordinator configuration, never queue data.

## Start a run

Copy and edit [`backlog.example.json`](../tools/parallel-workflow/examples/backlog.example.json), then initialize from the primary checkout:

```powershell
. .\scripts\toolchain.ps1
$state = Join-Path (git rev-parse --show-toplevel) ".tmp\parallel-workflow\feature-run"
npm run workflow -- init --state $state --backlog C:\absolute\path\to\backlog.json --quality-every 4
npm run workflow -- doctor --state $state
```

Initialization is idempotent for the same repository and state directory. `enqueue` adds another backlog without overwriting existing task IDs. Start one validator in a separate terminal:

When tasks require writable Helix Core verification, initialize a new run with a disposable server that contains `bin/p4.exe`, `bin/p4d.exe`, a valid test ticket, and the repository-supported start/stop scripts:

```powershell
npm run workflow -- init --state $state --backlog C:\absolute\path\to\backlog.json `
  --p4d-root C:\absolute\path\to\P4D_TestServer
```

Only tasks that explicitly choose `p4fnv-full-p4d` mutate that server. The validator starts it only when needed, deletes its smoke changelist in `finally`, and stops only a process that the smoke started.

```powershell
. .\scripts\toolchain.ps1
npm run workflow -- validate --state $state --watch
```

The process remains quiet while idle and writes command output to per-request logs. A second validator is rejected by the lock. Without a resident process, the orchestrator may run `validate --state <path>` after each request to process one job.

## Orchestrator loop

Use the project skill `$orchestrate-p4fnv-work` in the orchestrator task.

1. Read `next --state <path>`. If it returns `quality-checkpoint-draining`, assign no new features and wait for the listed active feature workers. If it returns `quality-checkpoint-required`, run `quality-checkpoint --state <path>` and schedule the generated refactor task. If it returns `idle`, wait for active workers or report that dependencies are blocked.
2. Create a Codex task in a Git worktree from the requested base state. Do not use a same-directory task for a worker.
3. Claim the selected task with the ready task ID and real worker thread ID. Send the returned assignment JSON unchanged to that task.
4. Keep a bounded number of workers active. Fill a free slot with the next dependency-ready priority; do not start a lower-priority task when a higher-priority eligible task is waiting. Quality tasks always take precedence and form a barrier.
5. Inspect `status --state <path>` and worker task progress. When a result arrives, load it with `result --request <id>` and send the JSON report to `workerThreadId`.
6. On `failed`, let the same worker fix, commit, and submit a new request. On `infrastructure-error`, repair or restart validation before asking for code changes.
7. Mark a task complete only with `complete --task <id> --request <id>`. Its dependants then become eligible. Use `block` or `requeue` with an explicit reason for abandoned work.

Thread creation is asynchronous. Wait for a real thread ID before claiming; never store a temporary client ID as `workerThreadId`.

## Quality checkpoints

The default wave size is four completed feature tasks and can be set from `1` to `20` with `init --quality-every`. Once the boundary is reached, the scheduler stops new claims, drains feature workers already in flight, and includes their completed commits in the checkpoint. A partially filled final wave also requires a checkpoint before handoff. `status.quality` reports draining workers, uncovered features, checkpoint IDs in flight, and `handoffReady`.

`quality-checkpoint` creates two dependent tasks. Their assignments contain immutable `sourceCommits` ranges (`baseSha..commitSha`) from earlier validated tasks:

1. The refactor worker materializes every feature range exactly once, reviews the combined touched area, and removes duplicate logic, dead code, unnecessary layers, and speculative extensibility. It must preserve behavior and may not add feature scope.
2. The stabilization worker materializes the validated refactor range, audits regression and failure paths, adds focused boundary/error/cancellation/retry tests where applicable, and fixes defects without unrelated redesign. It uses `p4fnv-full-p4d` when a disposable P4D root is configured.

Source integration is intentionally agent-owned rather than an automatic cherry-pick: overlapping feature commits require semantic conflict resolution and inspection of the combined diff. Every resulting refactor and stabilization commit still goes through the serialized validator.

## Worker handoff

The worker reads the assignment, repository instructions, relevant living contracts, and existing code before editing. A quality worker first integrates the exact `sourceCommits` ranges recorded in its assignment and confirms none were omitted or applied twice. It then activates the toolchain and installs dependencies in its own worktree:

```powershell
. .\scripts\toolchain.ps1
npm ci
```

After implementation and focused checks, the worker commits all task-owned changes and leaves the worktree clean. It then queues the exact `HEAD`:

```powershell
$head = git rev-parse HEAD
$worktree = git rev-parse --show-toplevel
npm run workflow -- request --state <absolute-state> --task <task-id> `
  --assignment <assignment-id> --commit $head --base <assignment-base-sha> `
  --worktree $worktree --summary "Implemented and focused checks passed."
```

The command verifies that the path belongs to the same Git repository, `HEAD` equals the submitted SHA, the worktree is clean, the base matches the assignment, and the commit descends from that base. It computes changed paths itself. The worker includes the returned request JSON in its final message, then waits for the validator report instead of running another worker's build.

## Handoff and integration

Report completed task IDs, validated commit SHAs, validation profiles, quality coverage, and remaining blocked or active work. Final integration is ready only when `status.quality.handoffReady` is `true`. This workflow does not merge branches automatically: integration order and conflict resolution remain an explicit orchestrator or maintainer action. After rebasing, conflict resolution, or any new commit, request validation again because the previous result no longer covers the candidate.
