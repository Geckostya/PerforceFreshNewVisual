# Files, Local Files, and safe sync

This living contract owns the Files screen, local tree/cache, history inside Files, and shared safe retrieval. General boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md), shared interaction in [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md), and readiness in [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md).

## Files screen

`Local files` and `Depot files` are two sources in one Files screen. A stable subheader reserves status/progress on the left and pins the source switch on the right; changing paths, counters, or labels must not move it.

Depot Files is a read-only lazy tree rooted in real `p4 depots` records. Expanding one node loads its immediate folders and files through bounded `p4 dirs`/`p4 files` requests. Never estimate totals with an unbounded `//...` scan. Selecting a folder loads at most 20 recent submitted changes for that scope; selecting a file loads bounded history and read-only revision preview.

Local and Depot sources share row hierarchy, selection, search/filter, inspector, and history treatment:

- disclosure expands without selecting; row click selects and double-click/Enter expands;
- file type is separate from status, and full path/status/size/change remain accessible;
- ignored entries use the shared muted warning accent without a separate background; depot identity uses its shared accent;
- the inspector scrolls internally and gives description more prominence than revision/user/client/date metadata;
- single-file diff/export requires exactly one printable revision, while sync may target selected files and folders in one batch;
- history is paged without prepending rows and displacing the reader; opening a change shows all affected files;
- exact file, folder-at-change, label, and stream-follow-up downloads enter the same safe-sync flow.

`Update selected` is the visible primary file action. Copy/reveal/edit/add/ignore/mark-delete/rename/lock/unlock/resolve/revert/delete-local live in the inspector or context menu when valid. Local deletion is always confirmed. `Save all revisions` writes exact available revisions to a new directory, preserves depot hierarchy, skips deletions, and reports partial results.

Reconcile preview is a cancellable long operation. While scanning a scope it reports the real candidate count and current path without inventing a percentage. Applying a reviewed selection first revalidates every selected path, then resets to a distinct apply phase and reports opened files against the selected-file total. Cancellation terminates the current `p4` child; opened items become a typed partial result with a Workspace recovery action because cancellation does not revert them.

## Local tree and cache

Local Files contains only disk entries; do not mix in server-only records. The root appears immediately from IndexedDB and rereads one level. A nested folder first shows its cached immediate children, exposes `aria-busy`, and refreshes only that directory. Empty folders are real; an unloaded folder does not claim zero children.

Cache keys include server, user, workspace, and client directory. Each directory stores immediate folders, disk files, Perforce records, and a fingerprint derived from the latest submitted change, pending changes, and opened files. Reread nonrecursive `p4 fstat -Rc -Ol //client/path/*` only when the fingerprint changes; `*` must not cross a directory boundary. Explicit Refresh revisits only directories already loaded.

After `open_workspace`, Rust retains the authorized client root for the active server/user. The local-directory command accepts a client directory, validates the workspace prefix and safe components, canonicalizes it inside that root, and reads one level without traversing symlinks. Narrow mutation commands repeat root/path validation; the frontend receives no general filesystem API.

Ignored state comes from `p4 ignores -i`. When the root has `.p4ignore`, pass its absolute path as `P4IGNORE` so the project file wins over ambient discovery. Probe a directory with a safe nonexistent child so P4 evaluates rules for its contents. Keep file and directory results distinct.

Expected `generic=17 / severity=2` empty results for missing depot/history matches are not CLI warnings. Merge local/client paths case-insensitively on Windows and normalize the `\\?\` prefix. A matching `fstat` record is mapped even when it lacks a separate `path` field.

Keep Local Files mounted for the workspace session so navigation does not duplicate reads. A successful stream change immediately invalidates the hidden tree and its mapping.

## Safe sync

All retrieval entry points use one frontend controller, one array-of-scopes IPC contract, one writable-conflict dialog, and the shared long-operation protocol.

1. Start ordinary retrieval with `p4 sync -s`; it downloads safe files and skips unsafe overwrites. A folder scope is sent as `folder/...` in the same batch as other selections.
2. Before the terminal event, find remaining incoming paths with `p4 sync -n` and compare that exact set through one validated `p4 diff -f -sa` using `p4 -x -` stdin. Here `-f` is read-only comparison, not overwrite.
3. For a mapped local file without `haveRev`, treat the expected “not on client” result as empty diagnostics and repair knowledge through `p4 reconcile -k`. Recover mapped read-only files separately; never overwrite a writable file without a user decision.
4. Present every remaining writable conflict together. Default to Keep local; Overwrite from depot is destructive and explicit per file.

Before force sync, record exact server-backed `depotFile#rev` and verified local paths. An unsuccessful sync may update the have list without replacing content, so every selected item then runs this ordered recovery:

1. `p4 print -o` the exact revision to a temporary sibling file;
2. validate warnings and atomically replace content/attributes, or remove a depot deletion;
3. `p4 flush -f` the exact revision or `#none`.

Independent files may use a bounded pool of at most four workers, but each file's print/replace/flush sequence remains ordered. Always clean temporary files. For `utf8`/`utf8-bom` profiles, use the corresponding unchecked command/content override without changing saved settings. Report failures per file; a flush failure leaves downloaded content for the next `reconcile -k`.

Force sync succeeds only when every snapshot item was applied and final `sync -n` is empty. Starting force closes the dialog. Failure reopens it with the entire selected set and prior decisions for an idempotent retry; the have list alone never proves replacement.

Progress comes from the running tagged sync: total file count/size, accumulated bytes, and current path. Do not run a blocking total preflight. Operations Center owns cancel/retry, preserves the original scopes, prevents a conflicting sync in the same workspace until the first terminal event, and reports workspace/have-list read-back.

## Verification

- Frontend: scope normalization, cache/fingerprint merge, selection, and overwrite decision retention.
- Rust: root/path validation, `fstat`/ignore parsing, sync arguments, exact recovery snapshot, encoding overrides, and partial results.
- Native UI: cache-first/lazy loading, ignored state, history, progress, conflict decisions, keyboard path, long paths, English/Russian, and 100/125/200% scale.
- Never run mutating smoke against the user's server without explicit authorization or a disposable server.
