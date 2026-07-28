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
| Connection and workspaces | Daily basics work; trust, modern auth, capability gating, and mapping correctness remain. | [`checklists/CONNECTION_AND_WORKSPACES.md`](checklists/CONNECTION_AND_WORKSPACES.md) |
| Files, Depot, sync, and history | Broad usable implementation; mapping edge cases, scale, richer compare, and content tools remain. | [`checklists/FILES_AND_HISTORY.md`](checklists/FILES_AND_HISTORY.md) |
| Changes, shelves, submit, and resolve | Core changelist/shelf flows are strong; full resolve and unknown-submit recovery remain P0. | [`checklists/CHANGES_AND_SUBMIT.md`](checklists/CHANGES_AND_SUBMIT.md) |
| Streams and collaboration | Browse/graph/switch exists; integration workflows and advanced collaboration remain P1. | [`checklists/STREAMS_AND_COLLABORATION.md`](checklists/STREAMS_AND_COLLABORATION.md) |
| Operations, errors, settings, and accessibility | Shared foundations exist; complete operation coverage, stale mode, preferences, and accessibility verification remain. | [`checklists/OPERATIONS_AND_UX.md`](checklists/OPERATIONS_AND_UX.md) |

## Development order

1. Complete P0 reliability: trust/auth capability detection, mapping/reconcile correctness, three-way resolve, submit read-back, and partial/stale recovery.
2. Complete P0 scale and access: incremental server queries, keyboard/pane navigation, Narrator, and 100/125/200% verification.
3. Verify stream switching on a disposable server, then implement Integration → Resolve → Review → Submit as one P1 workflow.
4. Add external content tools, Jobs/Labels CRUD, and persistent appearance/productivity settings.
5. Take P2 work only for a concrete user or server requirement.

For reusable CLI constraints and live-server cases, see [`P4_CAPABILITY_REFERENCE.md`](research/P4_CAPABILITY_REFERENCE.md) and [`P4_VERIFICATION_SCENARIOS.md`](research/P4_VERIFICATION_SCENARIOS.md). These research files do not own current status.
