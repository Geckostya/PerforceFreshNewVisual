# Streams and collaboration checklist

Current status for streams, integration, shared shelves, jobs, labels, and locks. Cross-feature mutation rules are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P1 Bounded stream catalog/tree/graph with hierarchy, filtering, selection, selected spec details, bounded history, and integration hints.
- [x] P1 Child stream creation with server-backed form preview, bounded Paths editing, confirmation, and final read-back.
- [~] P1 Workspace/stream switching with local/content strategies; live standard/commit-edge coverage remains.
- [x] P1 Basic lock/unlock for selected opened files and detected lock topology in mutation preflight.
- [x] P1 Shared Shelves browse/inspect/unshelve/reshelve/export with explicit topology and conflict states.
- [x] P1 Exact foreign-stream cherry-pick preview without automatic resolve or submit.
- [x] P1 Merge-down/copy-up preview with explicit source/target, target changelist, stale gate, operation/read-back, and Resolve → Review/Submit handoff.
- [x] P1 Stream specs/history, compatible workspaces, Paths/Remapped/Ignored, and bounded server hints.
- [x] P1 Specialized file-move, filetype, and stream-spec conflict actions with partial outcomes and exact affected items.
- [x] P1 Jobs search/inspect/create/edit/status from server jobspec and Labels search/inspect/create/edit/delete/tag with safe preview.

## Remaining reliability work

- [~] Complete topology matrix coverage for explicit, exclusive-filetype, local, and global locks.

## Only on demand

- [ ] Promoted shelves, commit-edge-only actions, classic branch maps, advanced integration ranges, P4 Code Review, DVCS/remotes, spec/archive depots, and P4 Search are separate product modes, not current milestones.
