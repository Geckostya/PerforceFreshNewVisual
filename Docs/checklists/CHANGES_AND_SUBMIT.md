# Changes, shelves, submit, and resolve checklist

Current status for pending changelists, shelves, submit, revert, jobs in submit, and resolve. Detailed semantics are owned by [`../CHANGELIST_REQUIREMENTS.md`](../CHANGELIST_REQUIREMENTS.md).

## Available

- [x] P0 Default/numbered changelists with separate local and shelf sections, filtering, multi-select, context menus, and DnD equivalents.
- [x] P0 Create/edit/delete empty changes and batch move opened files.
- [x] P0 Shelve selected/all, unshelve selected/all with safe add-collision choices, delete shelf/files, reshelve selected files, and single-file shelf export.
- [x] P0 Bounded all-user Shelves catalog grouped by owner, with search, owner/workspace/stream/age filters, and lazy selected-shelf details.
- [x] P0 Revert selected, unchanged, or a whole changelist from a server preview; opened-for-add disk deletion is explicit.
- [x] P0 Submit local-only, shelf-only, and all local+shelf strategies with recovery/compensation.
- [x] P0 Submit preflight shows missing, unresolved, out-of-date, other-open/lock, jobs, stream spec, size, and server warnings.
- [x] P0 Submitted screen defaults to the current user's changes across all streams, shows mapped streams, supports server-backed stream/user/workspace/job filters, details, exact safe retrieval, undo, and safe foreign-stream cherry-pick.
- [~] P0 Basic resolve preview and keep-workspace/use-server/auto-safe/auto-merge actions exist; specialized resolve remains.

## P0 gaps

- [ ] Provide a three-way text resolve editor with base/source/workspace/result, conflict navigation, save, and server read-back.
- [ ] Separate binary, move/name, filetype/attribute, and stream-spec resolve flows.
- [ ] After submit cancellation/network loss, present `submitted`, `pending`, or `unknown` with a concrete recovery action.
- [ ] Publish shelf-preserving submit modes through the same operation protocol as local submit.
- [ ] Show succeeded/failed/skipped items and compensation results consistently for every compound mutation.
- [ ] Improve trigger diagnostics without assuming client preflight can replace server validation.

## P1/P2 extensions

- [ ] P1 Complete shelf conflict taxonomy, batch export, native picker, and topology-aware reshelve/promote.
- [ ] P1 Change owner/workspace and public/restricted type with shelf/jobs/topology preflight.
- [ ] P2 Handle shelved stream specs and P4 Code Review only when the server/integration supports them.
