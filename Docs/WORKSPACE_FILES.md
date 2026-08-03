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

Depot/client/local identity is resolved only through a bounded batch `p4 where` command. Its DTO keeps the caller's order, distinguishes mapped, excluded, and unmapped results, and carries server diagnostics/partial state. Copy and cross-source navigation actions appear only for identities returned by the server; an unmapped or excluded depot path never receives an invented local path.

`Update selected` is the visible primary file action. Copy/reveal/edit/add/ignore/mark-delete/rename/lock/unlock/resolve/revert/delete-local live in the inspector or context menu when valid. Local deletion is always confirmed. `Save all revisions` writes exact available revisions to a new directory, preserves depot hierarchy, skips deletions, and reports partial results.

Reconcile preview is a cancellable long operation. While scanning a scope it reports the real candidate count and current path without inventing a percentage. The result groups add, edit, delete, move, ignored, and unsafe candidates from server records; ignored and unsafe items are not selected and cannot be applied. Each item carries a stable identity, mapping state, reasons, local size/mtime, and one token for the complete scoped preview.

Apply accepts an explicit selected item set, scope, and token. Before starting the mutation, Rust repeats the complete scoped preview (including ignored candidates), mapping lookup, and local metadata read. Any action, mapping, ignore, move-pair, path, or disk-metadata difference rejects the whole request as stale with zero reconcile mutations. Applying never falls back to an unpreviewed `//...`. The apply phase reports opened files against the selected-file total. After a successful, failed, or cancelled terminal event, Files refreshes affected state. Cancellation terminates the current `p4` child; files opened before termination become a typed partial result with a Workspace recovery action because cancellation does not revert them.

## Local tree and cache

Local Files contains only disk entries; do not mix in server-only records. The root appears immediately from IndexedDB and rereads one level. A nested folder first shows its cached immediate children, exposes `aria-busy`, and refreshes only that directory. Empty folders are real; an unloaded folder does not claim zero children.

Cache keys include server, user, workspace, and client directory. Each directory stores immediate folders, disk files, Perforce records, and a fingerprint derived from the latest submitted change, pending changes, and opened files. Reread nonrecursive `p4 fstat -Rc -Ol //client/path/*` only when the fingerprint changes; `*` must not cross a directory boundary. Normal cache validation revisits only directories already loaded.

Background workspace discovery has a separate bounded backend cache because it can run without the Files screen. Rust stores up to eight workspace scopes in a gzip-compressed, atomically replaced file under the application config directory. Each scope keeps validation timestamps, last candidates, and any incomplete cursor; file contents and server state are never cached. Discovery checks only the direct files of each configured root with `p4 status -a root\\*`; it never recursively scans a large root such as Source or Content. Configure, Refresh, startup, and periodic validation all use that bounded check. A timed-out or failed command produces a terminal Partial result, persists its cursor, and retries only that root after 5 seconds with bounded exponential backoff up to 5 minutes; restart or Refresh resumes it immediately. A missing, corrupt, or scope-mismatched cache is treated as a miss, never as authority; cached candidates remain presentation-only until revalidated.

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
