# P4FNV feature checklist

This is the index and priority queue for current product work. Detailed status is split by area below; stable behavior belongs to the linked living contracts, while background research lives in [`research`](research/README.md).

## Status and completion

- `[x]` — usable end to end and covered by relevant automated checks.
- `[~]` — useful today, but the listed gap prevents completion.
- `[ ]` — no dependable user workflow yet.
- P0 — required for daily work; P1 — required for strong stream/team workflows; P2 — optional or specialized.

A feature is complete only when its narrow Rust/Tauri path validates inputs, risky work has preview and a safe default, terminal state is reread, partial/unknown results are explicit, English/Russian and keyboard paths work, focused tests pass, and live/WebView-dependent behavior is verified or marked unverified. Full build gates remain in [`TOOLCHAIN.md`](TOOLCHAIN.md).

## Area checklists

| Area | Current posture | Checklist |
|---|---|---|
| Connection and workspaces | Daily connection, auth, capability, client-spec, and mapping workflows are available; only live environment coverage remains. | [`checklists/CONNECTION_AND_WORKSPACES.md`](checklists/CONNECTION_AND_WORKSPACES.md) |
| Files, Depot, sync, and history | Main file workflows, manual/focused reconcile, unopened-change discovery, sync, and history are available; edge matrices remain. | [`checklists/FILES_AND_HISTORY.md`](checklists/FILES_AND_HISTORY.md) |
| Changes, shelves, submit, and resolve | Core submit, recovery, three-way resolve, shelf preservation, and stream handoff are available; compound-result polish remains. | [`checklists/CHANGES_AND_SUBMIT.md`](checklists/CHANGES_AND_SUBMIT.md) |
| Streams and collaboration | Browse, switch, integration, jobs, labels, and lock workflows are available; only topology evidence remains. | [`checklists/STREAMS_AND_COLLABORATION.md`](checklists/STREAMS_AND_COLLABORATION.md) |
| Operations, errors, settings, and accessibility | Shared operations and bounded discovery are available; stale coverage, compound-result consistency, and targeted native QA remain. | [`checklists/OPERATIONS_AND_UX.md`](checklists/OPERATIONS_AND_UX.md) |

## Development order

1. Close the remaining daily reliability gaps: stale gating on every screen, compound-operation outcomes, and the live mapping/lock/environment matrix.
2. Use the product with real workspaces and fix measured friction in Files, Changes, and My Changes; do not start a broad scale/accessibility project without a reproduced problem.
3. Verify stream switching and integration on disposable servers; extend only when a real team workflow exposes a gap.
4. Keep advanced Perforce modes, broad preferences, and specialized content views on demand rather than in the default roadmap.

For reusable CLI constraints and live-server cases, see [`P4_CAPABILITY_REFERENCE.md`](research/P4_CAPABILITY_REFERENCE.md) and [`P4_VERIFICATION_SCENARIOS.md`](research/P4_VERIFICATION_SCENARIOS.md). These research files do not own current status.
