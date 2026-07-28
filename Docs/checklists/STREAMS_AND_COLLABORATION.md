# Streams and collaboration checklist

Current status for streams, integration, shared shelves, jobs, labels, and locks. Cross-feature mutation rules are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [~] P1 Bounded stream catalog/tree/graph with hierarchy, filtering, multi-select, persisted visibility, and current-workspace context; details/spec/history remain incomplete.
- [~] P1 Confirmed workspace/stream switching with local/content strategies exists; live standard/commit-edge coverage is not recorded.
- [x] P1 Basic lock/unlock is available for selected opened files.
- [~] P1 Shared Shelves can browse, inspect, unshelve, reshelve selected files, and export one file; advanced topology and batch export remain.
- [~] P1 Jobs can search, inspect fixes, attach/detach, and filter history; create/edit/status workflows remain.
- [~] P1 Labels can search, inspect files, and use safe sync; create/edit/delete/tag operations remain.

## P1 gaps

- [ ] Show complete stream specs/history, compatible workspaces, Paths/Remapped/Ignored, and server-backed `istat`/interchanges hints.
- [ ] Preview and apply merge down, copy up, and cherry-pick with unmistakable source/target and a selected target changelist.
- [ ] Route integration results through Resolve → Review → Submit and never submit automatically.
- [ ] Handle partially integrated revisions, file moves, filetype conflicts, and stream-spec conflicts.
- [ ] Distinguish explicit, exclusive-filetype, local, and global locks using detected topology.
- [ ] Create/edit jobs from custom jobspecs and show the server-defined post-submit status.
- [ ] Create/edit/delete labels and preview tag/untag safely.

## P2 only on demand

- [ ] Promoted shelves and commit-edge-specific actions.
- [ ] Classic branch maps and advanced integration ranges.
- [ ] P4 Code Review integration with a configured endpoint.
- [ ] Graph/hybrid depot, DVCS/remotes, spec depot, archive/unload, and P4 Search as explicit product modes.
