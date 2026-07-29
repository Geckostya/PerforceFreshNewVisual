# Parallel feature development

This contract owns prioritized Codex task orchestration, worker worktree isolation, and commit-based validation. Application build commands remain in [`TOOLCHAIN.md`](TOOLCHAIN.md); native UI verification remains in [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).

## Invariants

- One orchestrator owns scheduling and sends dependency-ready tasks in ascending numeric priority; priority `1` is highest.
- Each worker changes only its assignment in a Codex Git worktree; it never edits or tests another checkout.
- Validation accepts only a clean committed SHA. One validator serializes builds in a fresh detached checkout at a stable workflow path, with request-local `node_modules` and a reusable workflow-scoped Cargo target.
- Queue JSON selects an allow-listed validation profile; it cannot provide an executable, arguments, environment, cleanup path, or shell text.
- A task completes only when its latest result passes; its validated SHA, not its branch, is the integration candidate.
- Features run in bounded waves. Each boundary and final partial wave require generated `refactor` then `stabilization` tasks. Any unfinished quality task blocks new features.
- Agent model and reasoning limits are derived from task class before dispatch. Queue data cannot request an arbitrary model, exceed its class ceiling, or silently fall back to a more expensive profile.
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

Queue transitions use same-volume renames; an exclusive PID/host lock serializes validation and recovers interrupted requests. `config.validationWorktreePath` is recreated under `config.validationCheckoutRoot`, while the sibling `config.validationCargoTargetRoot` persists. Queue JSON cannot select either path, and cleanup stays inside the managed root.

The normative JSON formats are:

- [`task.schema.json`](../tools/parallel-workflow/schemas/task.schema.json) for backlog and stored task data;
- [`assignment.schema.json`](../tools/parallel-workflow/schemas/assignment.schema.json) for the prompt sent to a worker;
- [`validation-request.schema.json`](../tools/parallel-workflow/schemas/validation-request.schema.json) for an immutable handoff;
- [`validation-result.schema.json`](../tools/parallel-workflow/schemas/validation-result.schema.json) for the report returned to the worker.

`p4fnv-fast` is the normal feature and refactor profile: it runs frontend tests, Rust formatting, and a debug application build. `p4fnv-full` is reserved for stabilization and final regression coverage and runs the complete gate from `TOOLCHAIN.md`, including the release build. `p4fnv-full-p4d` adds a serialized writable smoke against an explicitly configured disposable loopback P4D server: it creates, reads back, and deletes an empty changelist. The server root is coordinator configuration, never queue data.

## Agent resource limits

Classify a task by its primary purpose. Tests or documentation that are part of a normal feature remain with that feature worker; use `mechanical` when the whole assignment is primarily tests, documentation, formatting, generated updates, or another bounded mechanical change.

| Work | Queue class | Model | Initial reasoning | Hard ceiling |
|---|---|---|---|---|
| Orchestration, queue, and status handling | coordinator | Terra | Low | Low |
| Ordinary feature implementation | `implementation` | Terra | Medium | Medium |
| Tests, documentation, and mechanical edits | `mechanical` | Luna | Low | Medium |
| Generated refactoring and stabilization | `quality` | Sol | Medium | Medium |
| Complex bugs, architecture, and conflict resolution | `complex` | Sol | High | High |

Backlog tasks select only `workClass`; `agentProfile` is derived and cannot be supplied directly. Mechanical work defaults to Low. Selecting Medium for it requires `reasoningEffort: "medium"` and a non-empty `resourceJustification`. Complex work always requires `resourceJustification`. Generated refactor and stabilization tasks are forced to `quality`, regardless of source feature classes.

`next` exposes the derived profile before worker creation, and the immutable assignment repeats it. Create the worker with that exact model and effort. These are cost ceilings, not hints: do not silently upgrade, substitute another family, or increase reasoning. If the requested family is unavailable in the current runtime, leave the task pending and report `agentProfile` as unavailable; a user-approved reclassification is required. The validator remains a script and consumes no agent model slot.

## Start a run

Copy and edit [`backlog.example.json`](../tools/parallel-workflow/examples/backlog.example.json), then initialize from the primary checkout:

```powershell
. .\scripts\toolchain.ps1
$state = Join-Path (git rev-parse --show-toplevel) ".tmp\parallel-workflow\feature-run"
npm run workflow -- init --state $state --backlog C:\absolute\path\to\backlog.json --quality-every 4
npm run workflow -- doctor --state $state
```

Initialization is idempotent; `enqueue` adds tasks without overwriting IDs.

For writable verification, initialize with an authorized disposable server containing the repository-supported binaries, ticket, and start/stop scripts:

```powershell
npm run workflow -- init --state $state --backlog C:\absolute\path\to\backlog.json `
  --p4d-root C:\absolute\path\to\P4D_TestServer
```

Only a serialized `p4fnv-full-p4d` validator may mutate this server. It cleans its smoke changelist and stops only a process it started.

```powershell
. .\scripts\toolchain.ps1
npm run workflow -- validate --state $state --watch
```

The validator is quiet while idle, logs by request, and rejects a second instance. Alternatively, run one-shot `validate --state <path>` after each request.

## Orchestrator loop

Use the project skill `$orchestrate-p4fnv-work` in the orchestrator task.

1. Read `next`. Drain active features at a quality boundary; when required, create the checkpoint before scheduling its refactor. On idle, wait or report blocked dependencies.
2. Create a worktree task with the selected `baseRef` and exact derived `agentProfile`. If unavailable, leave it pending; never substitute a costlier agent.
3. Claim the selected task with the ready task ID and real worker thread ID. Send the returned assignment JSON unchanged to that task.
4. Keep workers bounded and fill slots by eligible priority; quality always takes precedence.
5. On a result event, load it by request ID and return it to `workerThreadId`. Failures stay with the worker; infrastructure errors stay with the validator owner.
6. Run `complete` only for the latest passing request. Use `block` or `requeue` with a reason.

Wait for a real thread ID before claiming; never store a temporary client ID.

Worker monitoring is event-driven. After dispatch, wait on worker task events with a bounded timeout; read queue/repository status only after an event or timeout. Do not poll worktree diffs for progress. A timeout is a health-check trigger, not evidence that the task failed.

## Quality checkpoints

The wave size defaults to four and accepts `1` to `20`. At a boundary the scheduler drains active features before creating a checkpoint; a final partial wave also requires one. `status.quality` exposes coverage and `handoffReady`.

`quality-checkpoint` creates two dependent tasks with immutable `sourceCommits` ranges. Its base is the merge base of source-task base SHAs, preventing sequential ranges from being applied twice:

1. Refactor integrates each feature range once, removes duplication, dead code, and unjustified layers without changing scope, then uses fast validation.
2. Stabilization integrates the refactor, audits failure paths, adds focused boundary/error/cancellation/retry tests, fixes defects, and alone runs release regression (`p4fnv-full-p4d` when configured).

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
