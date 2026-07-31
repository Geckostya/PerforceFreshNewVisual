# Changes, shelves, submit, and resolve checklist

Current status for pending changelists, shelves, submit, revert, jobs in submit, and resolve. Detailed semantics are owned by [`../CHANGELIST_REQUIREMENTS.md`](../CHANGELIST_REQUIREMENTS.md).

## Available

- [x] P0 Default/numbered changelists with local and shelf sections, filtering, multi-select, context menus, and DnD equivalents.
- [x] P0 Create/edit/delete empty changes and batch move opened files.
- [x] P0 Shelve/unshelve, safe add-collision choices, delete shelf/files, reshelve, and single-file shelf export.
- [x] P0 Bounded all-user Shelves catalog with owner/workspace/stream/age filters and lazy details.
- [x] P0 Revert selected, unchanged, or a whole changelist from a server preview; opened-for-add disk deletion is explicit.
- [x] P0 Submit local-only, shelf-only, and all local+shelf strategies with recovery, compensation, and read-back.
- [x] P0 Submit preflight shows missing, unresolved, out-of-date, other-open/lock, jobs, stream spec, size, and server warnings.
- [x] P0 Submitted screen supports server-backed stream/user/workspace/job filters, details, safe retrieval, undo, and foreign-stream cherry-pick.
- [x] P0 Typed resolve preview, three-way text editor, bounded content, atomic save, specialized conflict classification, and server read-back.
- [x] P0 After submit cancellation/network loss, the UI presents `submitted`, `pending`, or `unknown` with a concrete recovery action.
- [x] P0 Shelf-preserving submit modes use the shared operation protocol and preserve compensation behavior.
- [x] P1 Stream integration hands exact succeeded paths to Resolve and its pending changelist to Review/Submit; resolve and submit are never automatic.

## Remaining reliability work

- [~] Add specialized action dialogs for binary, move/name, filetype/attribute, and stream-spec conflicts; the text editor already excludes them safely.
- [~] Show succeeded/failed/skipped items and compensation results uniformly for every compound mutation.
- [ ] Improve trigger diagnostics without assuming client preflight can replace server validation.

## Only on demand

- [ ] Promoted shelves, commit-edge-specific actions, shelved stream specs, and P4 Code Review are not current product milestones.
