# Files and history checklist

Current status for Local Files, Depot Files, retrieval, file lifecycle, history, diff, reconcile, and rollback. The behavior owner is [`../WORKSPACE_FILES.md`](../WORKSPACE_FILES.md); shared safety boundaries are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Lazy Local Files reads with per-directory cache, scoped P4 status, ignored/local-only presentation, and explicit refresh.
- [x] P0 Unified Local/Depot layout with search/filter, tree/list behavior, inspector, multi-select, and bounded history.
- [x] P0 Real depot roots/types/metadata, lazy children, deleted toggle, breadcrumbs, and unmapped-file preview/history.
- [x] P0 Edit/add/delete/move/lock/unlock/revert and explicit reconcile preview/apply for selected files.
- [x] P0 Manual reconcile preview/apply for any mapped folder selected inside the current workspace, with folder-boundary validation and stale protection.
- [x] P0 Background unopened-change discovery for configured roots: read-only scan, P4IGNORE, exclusions, coverage, pause/backoff, and a virtual My Changes group.
- [x] P0 Shared safe sync for project/selection/depot/label/post-stream-switch with progress, cancellation, writable decisions, and bounded overwrite recovery.
- [x] P0 Submitted/file history, lazy details/diffs, revision preview/export/compare, annotate, and undo preview/apply.
- [x] P0 Date-based retrieval, opaque history cursors, folder/changelist state comparison, and exact rename/integration history records.
- [x] P0 Bounded lists and incremental loading; virtualization is used only where measurement shows it is needed.
- [x] P1 Chunked large-text preview, configured external editor/diff tools, binary metadata preview, and server-backed Revision Graph.

## Remaining reliability work

- [~] Complete the live matrix for P4IGNORE, move pairs, case-only rename, collisions, other-open, locks, and stream-specific mappings before file mutations.
- [~] Extend stale/partial classification and native coverage for unusually large or permission-limited directories.

## Only on demand

- [ ] New content viewers or specialized history visualizations only when a concrete workflow is blocked; they are not a release milestone.
