# Files and history checklist

Current status for Local Files, Depot Files, retrieval, file lifecycle, history, diff, and rollback. The behavior owner is [`../WORKSPACE_FILES.md`](../WORKSPACE_FILES.md); shared safety boundaries are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Lazy Local Files reads with per-directory memory/IndexedDB cache, scoped P4 status, ignored/local-only presentation, and explicit refresh.
- [x] P0 Unified Local/Depot resource layout with search/filter, tree/list behavior, inspector, multi-select, and bounded history.
- [x] P0 Real depot roots/types/metadata, lazy immediate children, deleted toggle, breadcrumbs, and readable unmapped-file preview/history.
- [x] P0 Edit/add/delete/move/lock/unlock/revert and explicit reconcile preview/apply for selected files.
- [x] P0 Shared safe sync for project/selection/depot/label/post-stream-switch with progress, cancellation, writable decisions, and bounded overwrite recovery.
- [x] P0 Submitted/file history, lazy details/diffs, revision preview/export/compare, annotate, and undo preview/apply.

## P0 gaps

- [ ] Complete mapping, P4IGNORE, move-pair, case-only rename, collision, other-open, and lock classification before file mutations.
- [~] Reconcile groups add/edit/delete/move/ignored/unsafe and rejects action/mapping/ignore/move-pair/path/local-metadata races; opened/lock-state classification still needs end-to-end coverage before this is complete.
- [~] Depot/client/local navigation uses bounded server-backed `where` with mapped/excluded/unmapped and partial diagnostics; Depot pagination and broader permission/maxresults coverage remain.
- [~] Date-based retrieval uses the shared Safe Sync preview/overwrite/cancel/read-back workflow with explicit server-timezone context; richer changelist/revision target selection remains.
- [ ] Add server-side history filters and incremental cursors without a hidden global scan.
- [ ] Compare folder/changelist states as added/changed/deleted/type-changed sets.
- [ ] Follow rename and integration records without heuristic path joins.
- [x] Measure exceptional directories/lists and add virtualization only where incremental loading is insufficient; current bounded and lazy paths remain below that threshold and expose partial limits instead.

## P1 content tools

- [ ] Chunk or stream large text with a clear bounded fallback.
- [ ] Add syntax/word highlighting and image/binary metadata preview.
- [ ] Launch configured editor/diff/merge tools without a shell and manage temporary files explicitly.
- [ ] Build Revision Graph only from `filelog`/integration records; never infer edges.
