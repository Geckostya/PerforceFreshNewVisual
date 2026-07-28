# P4FNV feature checklist

Status: living backlog and implementation snapshot. Updated July 23, 2026.

The full original catalog of CLI capabilities, personas, and narrative user stories is preserved in [`research/P4_FEATURE_CATALOG_AND_STORIES.md`](research/P4_FEATURE_CATALOG_AND_STORIES.md). This document contains only the data needed to select and complete the next development work.

## Statuses and Definition of Done

- `[x]` — the user flow is implemented UI → Rust → `p4` → refresh and covered by relevant automated verification.
- `[~]` — the flow is useful, but listed limitations prevent the area from being complete.
- `[ ]` — no user flow exists.
- P0 — daily work; P1 — professional stream/team work; P2 — rare/advanced workflow.

An item becomes `[x]` when:

- the Tauri command is narrow, Rust validates IDs/paths/revisions, and no shell is used;
- the mutation has exact scope, risk-appropriate preview/confirmation, and server refresh;
- a partial/unknown result is not masked as success;
- loading/empty/error/permission states and a keyboard path exist;
- new strings are added to complete English/Russian packs;
- a minimal regression test covers parser/arguments/state logic;
- the full gate from [`TOOLCHAIN.md`](TOOLCHAIN.md) passes;
- a live-server/WebView dependency is either verified on a disposable setup or explicitly marked unverified.

## Current product

| Area | Status | Implemented | Remaining |
|---|---|---|---|
| Connection/auth | `[~]` P0 | detect `p4`, profiles/favorites, info, password login/status/logout, read-only trust list, restore last workspace | trust confirmation/write, MFA/login2, SSO/P4 AS, capability matrix |
| Workspace spec | `[~]` P0 | list/open/switch/create/edit/rename/delete, stream switch dialog, unknown form fields/mappings preserved | visual mapping editor, AltRoots/options validation, live-server stream-switch matrix |
| Workspace files | `[~]` P0 | lazy authorized-root directory reads, per-directory memory/IndexedDB disk and P4 cache, per-folder loading state, changelist-fingerprint-gated non-recursive `fstat -Rc`, explicit reconcile preview, optional disclosed scope/search/filter, status icons/tooltips, full-height file/folder history inspector, ignored text/local-only presentation, edit/add/ignore/delete-local/delete/move/lock/unlock/revert/reconcile | virtualization of a single exceptionally large directory, full mapping/ignore/move classification, external editor |
| Sync/Get revision | `[~]` P0 | shared safe-sync controller for project/selection/depot/label/post-stream-switch, history-row exact file revision/folder changelist target, per-file writable keep/force resolution, batch force apply, file/byte progress with ETA and cancel | date picker, parallel transfer controls, richer recovery |
| My Changes | `[x]` P0 | pending/default CL, local/shelf sections, cosmetic persistent Unactual with context/DnD transfer, create/edit/delete, batch reopen, filtering, DnD equivalents | advanced owner/type/jobs editing belongs to later scopes |
| Shelve/unshelve | `[x]` P0 | selected/full shelf, safe add-collision preview, per-file force, partial result, delete shelf/files | broader conflict taxonomy tracked below |
| Submit | `[~]` P0 | local, shelf and local+shelf strategies; preflight; recovery/compensation; local submit events | richer trigger diagnostics, shelf-preserving operations in common operation protocol, unknown-result recovery UI |
| Revert | `[x]` P0 | selected, unchanged and full CL with server preview; explicit delete-added-files setting | partial-selection compensation is optional expansion |
| Resolve | `[~]` P0 | unresolved detection, submit gate, preview, keep workspace/accept server/auto-safe/auto-merge | three-way editor, binary/move/filetype/stream-spec resolve |
| Depot | `[~]` P0 | source switch, real depot roots/types/metadata, lazy recursive directory overview, scoped dirs/files, deleted toggle, breadcrumbs, blue depot/local-only disabled presentation, bounded folder/file history and sync preview | mapping navigation, server pagination |
| History | `[~]` P0 | scoped submitted list/details/jobs/files, filelog, preview/single export, safe exact-revision changelist export, compare, workspace diff, annotate, undo preview/apply | cursor/server filters, range/folder compare, rename history, Revision Graph |
| Diff | `[~]` P0 | shared bounded unified/split viewer, line numbers, hunk navigation, whitespace modes, binary state, patch export | chunked large text, syntax/word highlight, image/binary preview, external tools |
| Operations/errors | `[~]` P0 | app-level sync/submit events, cancel, bounded history/log, explicit sync retry, core error kinds | all long operations, generic partial recovery, stale/offline mode, timeout/capability errors |
| Jobs | `[~]` P1 | bounded search/details/fixes, attach/detach, submit preflight metadata, history job filter | custom jobspec-aware create/edit and status workflow |
| Labels | `[~]` P1 | bounded search/details/files and safe sync preview/apply | static/automatic details, create/edit/delete, tag/untag |
| Search/keyboard | `[~]` P0 | Global Go To, screen command palette, screen shortcuts, keyboard context menus | action commands, stream/user targets, pane navigation, shortcut help |
| Streams/integration | `[~]` P1 | bounded stream catalog/tree/graph, multi-select with top-panel batch show/hide, collapsible branches, asymmetric hierarchical visibility, subtree-aware cosmetic Unactual with batch DnD, confirmed switch with local/content strategies | disposable-server switch verification, stream spec/history, integrate/copy/cherry-pick/interchanges |
| Settings/accessibility | `[~]` P0 | language, connection/revert settings, semantic controls and core keyboard flows | themes/density/preferences, full screen-reader contract, verified 200% layout |

Complex changelist, shelf, DnD, and submit semantics are defined in [`CHANGELIST_REQUIREMENTS.md`](CHANGELIST_REQUIREMENTS.md).

## P0 — next mandatory layer

### Authentication and capability

- [ ] Trust flow: show the full new/changed fingerprint, default to Cancel, and run explicit `p4 trust` only after confirmation.
- [ ] MFA/login2 and SSO/P4 Authentication Service without logging URL/token/credentials.
- [ ] Capability snapshot from client/server version, services/topology, Unicode/case handling, and availability of required command flags.

### Workspace/Depot correctness

- [x] Depot roots/types and a lazy bounded tree with permission/maxresults states.
- [ ] Depot ↔ client ↔ local mapping navigation through server `where`; an unmapped path receives no false local path.
- [ ] Reconcile classifies add/edit/delete/move/ignored/unsafe and rechecks stale previews.
- [ ] Edit/add/delete/move preflight shows mapping, have/head, collisions, other-open/lock, and destination changelist.
- [ ] Large file lists/history use incremental loading; virtualization is added only after measurement.

### Resolve and submit reliability

- [ ] Three-way text resolve: base/source/workspace/result, conflict navigation, save, and server read-back.
- [ ] Binary, move/name, filetype/attribute, and stream-spec resolve have separate understandable flows.
- [ ] Trigger rejection, cancellation/network loss, and unknown submit result provide `submitted/pending/unknown` read-back and a recovery action.
- [ ] Shelf-preserving submit modes publish the same operation events as local submit.
- [ ] Partial-result UI shows succeeded/failed/skipped and compensation outcome.

### History and recovery

- [ ] Server-side path/user/client/date/job filters and incremental cursor/limit without a hidden global scan.
- [ ] Folder/changelist compare shows an added/changed/deleted/type-changed summary.
- [ ] File rename/integration history follows records without heuristically joining names.
- [ ] Rollback range has a direction/revision preview and creates opened changes without rewriting history.

### UX, errors, and scale

- [ ] Stale/offline mode preserves a read-only snapshot, disables mutations with a reason, and performs controlled refresh.
- [ ] Timeout/unsupported/server-limit errors are separated from connection failure; truncated records count as partial results.
- [ ] Pane keyboard navigation, focus restoration, operation announcements, and Windows Narrator smoke.
- [ ] Verified layout in English/Russian at 100/125/200% and the minimum window size.

## P1 — replace P4V for stream/team workflows

### Streams and integration

- [ ] Bounded streams tree is implemented; details/spec/history and compatible workspaces require the next increment and live-server smoke.
- [ ] Stream Graph parent/child/type is implemented and visually verified; the accessibility/scale matrix does not yet complete the full DoD.
- [ ] Safe workspace/stream switch and strategies are implemented; mutating smoke on disposable Helix Core is required.
- [ ] `integrate/copy -n` preview with explicit source/target, interchanges, and target changelist.
- [ ] Merge down, copy up, and cherry-pick never submit automatically; the result proceeds Resolve → Review → Submit.
- [ ] Filename/stream-spec conflicts pass through the corresponding resolve flow.

### Content tools

- [ ] External editor/diff/merge starts without a shell, using explicit arguments and lifecycle-managed temporary files.
- [ ] Image diff and binary metadata preview have size limits and a safe fallback.
- [ ] Revision Graph uses filelog/integration records, supports focus/filter/compare, and does not invent edges.

### Collaboration and productivity

- [ ] Jobs create/edit honors custom jobspec; submit shows the future server-defined status.
- [ ] Labels create/edit/delete and tag/untag have preview and permission handling.
- [ ] Saved filters/recent destinations are stored per server/workspace.
- [ ] Settings: appearance/density, pane sizes, columns, diff mode, external tools, shortcuts, and diagnostics/privacy.

## P2 — after P0/P1

- [ ] Promoted shelves and commit-edge topology actions.
- [ ] P4 Code Review integration only with a configured endpoint.
- [ ] Classic branch maps and advanced integration ranges.
- [ ] File attributes, spec depot read-only browsing, archive/unload visibility.
- [ ] Graph/hybrid depot and DVCS/remotes as a separate product mode.
- [ ] P4 Search integration with a bounded fallback.
- [ ] Custom tools only as a validated executable plus explicit arguments; there will be no general shell console.

## Implementation order

1. Complete P0 reliability: auth/trust, mapping/reconcile, resolve, submit recovery, and stale/partial states.
2. Complete P0 scale/history: bounded Depot/History, incremental lists, accessibility, and visual scale.
3. Verify Stream switch on a disposable server and continue Streams → Integration → Resolve → Submit as a P1 vertical workflow.
4. Add production content tools, Jobs/Labels CRUD, and persistent preferences.
5. Take P2 only for a specific user request or server topology.

## Mandatory smoke before a major `[x]`

- Plain and SSL server; new/changed fingerprint.
- Valid/expired ticket, password login/logout, and an available test MFA/SSO setup.
- Classic and stream workspace; include/exclude/overlay mapping.
- Case-sensitive/case-insensitive and Unicode paths.
- Server limit/permission/trigger failure and partial output.
- Sync with a locally modified unopened file and cancellation midway.
- Reconcile add/edit/delete/move with P4IGNORE.
- Submit success, unresolved, out-of-date, lock conflict, and network interruption.
- Shelf-only/local-only/local+shelf; force unshelve only for selected collision paths.
- Undo/resolve and, after integration exists, merge down/copy up/cherry-pick.
- English/Russian, keyboard-only, 100/125/200%, and Windows Narrator.

Do not run mutating smoke against the user's server without explicit authorization; use a disposable Helix Core setup.
