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
- [`validation-result-summary.schema.json`](../tools/parallel-workflow/schemas/validation-result-summary.schema.json) for the compact event envelope.

`status`, `result`, and validator events are compact by default; successful envelopes contain IDs, status, duration, counts, and paths, not command output. Use `--verbose` for full stored JSON. Failed envelopes include only the failing command's bounded tail and log path.

Use `p4fnv-auto` for feature and refactor tasks. The immutable changed-path list selects the smallest safe profile: `p4fnv-docs` runs repository tests, `p4fnv-frontend` adds the web build, `p4fnv-rust` runs fmt/tests/Clippy, and mixed or unknown paths use `p4fnv-fast` with a debug desktop build. Stabilization alone uses `p4fnv-full`, or `p4fnv-full-p4d` with an authorized disposable server. Queue JSON still cannot provide commands.

## Agent resource limits

Classify a task by its primary purpose. Tests or documentation that are part of a normal feature remain with that feature worker; use `mechanical` when the whole assignment is primarily tests, documentation, formatting, generated updates, or another bounded mechanical change.

| Work | Class | Model/reasoning | Monitor timeout | Quality units |
|---|---|---|---|---|
| Orchestration and status | coordinator | Terra/Low | event-driven | — |
| Ordinary implementation | `implementation` | Terra/Medium | 20→40 min | 1 |
| Tests, docs, mechanical edits | `mechanical` | Luna/Low–Medium | 10→20 min | 0 |
| Refactoring and stabilization | `quality` | Sol/Medium | 30→60 min | 0 |
| Complex bugs, architecture, conflicts | `complex` | Sol/High | 30→60 min | 2 |

Backlog tasks select only `workClass`; `agentProfile` is derived and cannot be supplied directly. Mechanical work defaults to Low. Selecting Medium for it requires `reasoningEffort: "medium"` and a non-empty `resourceJustification`. Complex work always requires `resourceJustification`. Generated refactor and stabilization tasks are forced to `quality`, regardless of source feature classes.

`doctor --available-models` and `next --available-models` expose missing families before dispatch. `claim` requires the actual model, effort, and `maxChildAgents=0`; a mismatch is rejected. Workers may not delegate. Monitor with the assignment timeout, then double once up to its maximum; a timeout triggers one liveness check, not polling. If a family is unavailable, leave the task pending. The validator is a script and consumes no agent slot.

## Start a run

Copy and edit [`backlog.example.json`](../tools/parallel-workflow/examples/backlog.example.json), then initialize from the primary checkout:

```powershell
. .\scripts\toolchain.ps1
$state = Join-Path (git rev-parse --show-toplevel) ".tmp\parallel-workflow\feature-run"
npm run workflow -- init --state $state --backlog C:\absolute\path\to\backlog.json --quality-units 4
npm run workflow -- doctor --state $state --available-models terra,luna,sol
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
npm run --silent workflow -- validate --state $state --watch
```

The validator is quiet while idle, logs by request, and rejects a second instance. Alternatively, run one-shot `validate --state <path>` after each request.

## Orchestrator loop

Use the project skill `$orchestrate-p4fnv-work` in the orchestrator task.

1. Read `next --available-models <list>`. Drain active features at a quality boundary; when required, create the checkpoint before scheduling its refactor. On idle, wait or report blocked dependencies.
2. Create a worktree task with the selected `baseRef` and exact derived `agentProfile`. If unavailable, leave it pending; never substitute a costlier agent.
3. Claim with the real thread ID plus `--model`, `--effort`, and `--max-child-agents 0`. Send the assignment unchanged.
4. Keep workers bounded and fill slots by eligible priority; quality always takes precedence.
5. On a result event, load it by request ID and return it to `workerThreadId`. Failures stay with the worker; infrastructure errors stay with the validator owner.
6. Run `complete` only for the latest passing request. Use `block` or `requeue` with a reason.

Wait for a real thread ID before claiming; never store a temporary client ID.

Worker monitoring is event-driven. Wait using `agentBudget.monitorTimeoutMs`; after a timeout perform one liveness check and double the wait up to `maximumMonitorTimeoutMs`. Read queue or repository state only after an event or timeout.

## Quality checkpoints

The threshold defaults to four risk units and accepts `1` to `20`. Implementation contributes one, complex work two, and mechanical work zero. Thus docs/test-only work does not buy a Sol checkpoint. At the threshold, or after the final partial non-mechanical wave, the scheduler drains all active features. `status.quality` exposes units, coverage, and `handoffReady`.

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

The command verifies repository, clean `HEAD`, base ancestry, and changed paths. It resolves `p4fnv-auto` from those paths. The worker returns the request ID, then waits for the compact validator event; load full JSON only for failure diagnosis.

## Handoff and integration

Report completed task IDs, validated SHAs, profiles, quality coverage, and blocked work. Integration is ready only at `handoffReady`; rebases or new commits require validation again.

Run `cleanup --state <path>` first: it is always a dry-run. `--apply` removes only completed, registered worktrees owned by that state, preserving branches, the final candidate, and Cargo cache. `--remove-final` and `--remove-cargo` are separate explicit choices. Registered paths under the managed root that are not state-owned are reported for manual review and never deleted automatically.
