# Streams and collaboration checklist

Current status for streams, integration, shared shelves, jobs, labels, and locks. Cross-feature mutation rules are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P1 Bounded stream catalog/tree/graph with hierarchy, filtering, multi-select, persisted visibility, current-workspace context, selected spec details, bounded history, and integration hints.
- [x] P1 Child stream creation provides graph-context parent selection, server-backed form preview, bounded Paths editing, confirmation, and final server read-back without changing the workspace.
- [~] P1 Confirmed workspace/stream switching with local/content strategies exists; live standard/commit-edge coverage is not recorded.
- [x] P1 Basic lock/unlock is available for selected opened files.
- [~] P1 Shared Shelves can browse, inspect, unshelve, reshelve selected files, and export one file; advanced topology and batch export remain.
- [x] P1 Exact submitted-changelist cherry-pick previews and opens files from one foreign source stream into the current stream without automatic resolve or submit.
- [x] P1 Adjacent stream merge-down/copy-up has an unmistakable bounded server preview, target changelist, stale-context gate, common operation/read-back, and explicit Resolve → Review/Submit handoff without automatic resolve or submit.
- [~] P1 Jobs can search, inspect fixes, attach/detach, and filter history; create/edit/status workflows remain.
- [~] P1 Labels can search, inspect files, and use safe sync; create/edit/delete/tag operations remain.

## P1 gaps

- [~] Add compatible-workspace discovery; selected stream specs/history, Paths/Remapped/Ignored, and server-backed `istat` hints are available.
- [~] Add specialized file-move, filetype, and stream-spec conflict actions; partial outcomes and exact affected items already route through shared read-back and Resolve.
- [ ] Distinguish explicit, exclusive-filetype, local, and global locks using detected topology.
- [ ] Create/edit jobs from custom jobspecs and show the server-defined post-submit status.
- [ ] Create/edit/delete labels and preview tag/untag safely.

## P2 only on demand

- [ ] Promoted shelves and commit-edge-specific actions.
- [ ] Classic branch maps and advanced integration ranges.
- [ ] P4 Code Review integration with a configured endpoint.
- [ ] Graph/hybrid depot, DVCS/remotes, spec depot, archive/unload, and P4 Search as explicit product modes.
