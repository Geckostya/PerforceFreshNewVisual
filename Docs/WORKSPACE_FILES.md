# Files, Local Files, and safe sync

This end-to-end living contract owns the Files screen behavior, local tree and cache, history in Files, and shared safe file retrieval. General technical boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md), and shared UI rules are in [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md).

## Files screen

- The `Local files` / `Depot files` switch changes the source within one screen instead of creating a separate navigation item. The heading title identifies the current source as `Files` or `Depot`; a stable unboxed subheader immediately below it reserves the left side for sync/loading status and pins the source switch to the right. Changing counters, paths, progress text, or button labels must not move the source switch.
- Depot Files is one read-only lazy tree backed by `p4 depots`: depot roots expose their real type, description, creation date, server map, and optional stream depth. Expanding a depot or directory loads its immediate folders and files together through bounded `p4 dirs` and `p4 files` requests; there is no separate Open Files action or second browser surface. The overview never derives file counts or storage size through an unbounded `//...` scan.
- Selecting a depot/folder loads at most 20 submitted changes for that exact scope; selecting a file loads bounded file history and allows read-only revision preview in the same inspector. Global Go To progressively expands only the requested depot path. An ordinary empty-match response is treated as an empty list.
- Scope, search, status filter, and tree/list switching live in a collapsible Search and Filters block. When collapsed, the block says whether the whole project or a configured view is shown; apply scope explicitly with the button or Enter.
- The file-type icon is separate from status markers; the hover/focus title contains the full path, status, size, and changelist.
- Ignored files and directories receive muted orange text according to `p4 ignores -i`, but no separate orange background. A branch receives the same text accent when all displayed files inside it are ignored. Depot files use a blue accent; local-only entries remain in Local Files instead of being mixed into the server browser.
- The right inspector occupies roughly half the workbench; bounded history fills its remaining height and scrolls internally. The changelist description is the bold primary line, while number, revision, action, user, client, and time are gray metadata.
- The context menu on a depot/folder/file row offers safe download to the current workspace and full history. A historical file row downloads the exact `file#revision`; a folder changelist row downloads `folder/...@change`. Every download opens the normal sync preview before mutation. Full history uses 100-row pages backed by cumulative bounded reads (up to 5000 records), so paging replaces the visible rows instead of prepending/appending and moving the reader unexpectedly.
- Double-clicking or pressing Enter on a history row opens changelist details with all affected files. Files support multi-select, but single-file diff/export through the context menu is available only when exactly one printable revision is selected.
- `Save all revisions` writes available exact revisions to a new directory while preserving depot hierarchy, skips deleted revisions, and reports partial results honestly.
- `Update selected` remains the only visible file action in the inspector; copy/reveal/edit/add/ignore/mark-delete/rename/lock/unlock/resolve/revert/delete-local live in the context menu and appear only for a valid selection/state. Local deletion always requires destructive confirmation.

## Local Files and cache

- The local tree immediately shows the IndexedDB snapshot of the root directory and rereads only that level.
- Every nested folder remains expandable and, on first expansion, receives its cached snapshot, a compact `aria-busy` spinner, and a background read of immediate children only. Empty folders are displayed; an unloaded folder shows an ellipsis instead of a false zero count.
- Local Files uses the same workbench, row hierarchy, disclosure control, icon scale, inspector cards, and history treatment as Depot Files. The disclosure control expands a folder without changing selection; clicking the rest of the row selects it, and double-clicking the row also expands or collapses it.
- Local Files contains only files that exist on disk; server-only records are not mixed in.
- Disk/status snapshots are indexed by server/user/workspace/directory and are not serialized into `localStorage`. Before a nonrecursive read-only `fstat //client/path/*`, the application obtains a fingerprint from the latest submitted changelist, pending changelists, and opened workspace files. Cached directory status is not reread while the fingerprint is unchanged.
- The expensive reconcile preview for untracked/ignored files runs only on explicit user intent.

After a successful `open_workspace`, the backend remembers the authorized client root for the active server/user. The narrow Local Files command accepts a client directory, verifies the current workspace prefix, builds the local path only from safe components, canonicalizes it within the root, and reads exactly one level. Symlinks are not traversed; an inaccessible nested folder is treated as empty for the current read.

Ignored state is determined with a single-path-compatible `p4 ignores -i` call for each immediate file. When the workspace root contains `.p4ignore`, Files explicitly passes its absolute path as `P4IGNORE` so the root project file takes priority over implicit default discovery; `p4` still interprets syntax and exclusions. A directory is checked with a nonexistent safe child path: the directory itself is not treated as a file path, while the probe child reflects rules applied to its contents. Results are returned separately for files and directories.

For each directory, IndexedDB separately stores immediate subfolders, disk files, cached Perforce records, and the changelist fingerprint under a server/user/workspace/directory key. The cache is shown immediately, after which only the selected directory is reread. Perforce status is updated with nonrecursive `p4 fstat -Rc -Ol //client/path/*` only when the fingerprint changes; `*` does not cross a directory boundary.

The expected `generic=17 / severity=2` for a directory without matching depot files or for history of a missing client file is treated as an empty read result and does not enter the warning log; other warning/error records are retained. Explicit Refresh rereads only already-loaded directories. Merge uses case-insensitive local/client paths with normalization of the Windows `\\?\` prefix; a matching `fstat` record is considered mapped even without a separate `path` field. History is requested only after status finishes for a tracked/mapped file.

Local Files remains mounted for the workspace session when navigating to other sections or Depot Files: the loaded tree, in-flight directory request, and in-memory index are preserved, and returning does not create a duplicate request. Changing the stream immediately invalidates the hidden tree so returning cannot show the previous stream's mapping.

Local filesystem mutations are allowed only through narrow backend operations. The backend obtains the client root through `p4 info`, canonicalizes the root and selected file, verifies that the file belongs to the root, and only then deletes the exact file or appends an exact relative rule to the root `.p4ignore`. The frontend receives no general filesystem API.

## Safe sync

All frontend file-retrieval entry points—Update in Files/My Changes, scoped sync from Depot, sync by Label, and `Download now` after changing streams—use one `useSafeSync` post-check and one writable-conflict dialog. IPC accepts only an array of scopes; there is no separate short blocking sync path.

The frequent Update action starts `p4 sync -s` immediately: safe sync downloads ordinary files and skips local files that cannot be overwritten safely. In Files, selecting specific files or one or more folders changes the action to scoped `Update selected`; folders are passed in one batch as `folder/...`.

After the CLI finishes but before the terminal event, the application obtains the remaining incoming set through `p4 sync -n` and checks it with one `p4 diff -f -sa` through validated `p4 -x -` stdin. Here `-f` allows read-only comparison of both opened and unopened client files; it does not mean overwrite. A full `//...` disk diff is never run.

If a mapped file exists locally but has no `haveRev`, the expected `generic=17 / severity=2 / file(s) not on client` response does not enter the warning log; matching files are first recovered through `p4 reconcile -k`. Remaining mapped read-only files are recovered independently of safe sync as exact depot revisions through a verified temporary file. Writable files without explicit Overwrite are excluded from automatic recovery.

For remaining incoming paths, one dialog offers `Keep local` or destructive `Overwrite from depot`; the safe default is Keep. When Overwrite is selected explicitly, the backend records a server-backed snapshot of exact `depotFile#rev` values and local paths before `p4 sync -f`, because an unsuccessful sync may optimistically alter the have list.

After force sync, every selected snapshot item unconditionally passes through `p4 print -o` into a temporary file beside the target, warning-record validation, atomic replacement with the downloaded file's attributes, and `p4 flush -f depotFile#rev`; a depot deletion removes the local file and receives `flush #none`. Independent items run through a bounded pool of at most four workers, capped by available CPU parallelism and item count, while each item's print/replace/flush sequence remains ordered. A new empty `sync -n` alone is not proof of replacement.

For `utf8`/`utf8-bom` profiles, print receives the `utf8unchecked`/`utf8unchecked-bom` content/command-line override, which takes precedence over P4CONFIG/P4ENVIRO; the saved profile is unchanged. Failure of one file does not stop recovery of the others, the temporary file is always cleaned up, and a flush failure leaves already-downloaded content for the next `reconcile -k`.

The force operation succeeds only when the entire snapshot is applied successfully and the final `p4 sync -n` is empty. Starting the force operation closes the dialog immediately so progress and the rest of the application remain visible. A completed result leaves it closed, while any failure reopens it with the entire explicitly selected set and its decisions preserved for a safe idempotent retry; the have list alone is not trustworthy.

Sync progress uses tagged output from the already-running `p4 sync` and publishes `totalFileCount`, `totalFileSize`, accumulated `fileSize`, and the current path without a separate blocking preflight. Operations Center remains the only cancel/retry surface. Retry preserves the original array of file/folder scopes, and a second sync does not start before the first terminal event.

## Verification

- Pure/frontend tests: scope normalization, cache merge/fingerprint, selection, and safe-sync decision state.
- Rust tests: validation, `fstat`/`ignores` parsing, safe-sync argument builders, recovery snapshot, partial results, and encoding profiles.
- Native UI: cache-first loading, lazy folders, ignored state, history selection, safe-sync progress, and the conflict dialog through the project MCP.
- Verify English/Russian, empty/loading/error states, long paths, keyboard-only use, and 100/125/200% scale.
- Do not run mutating smoke against the user's P4 Server without explicit authorization or a disposable server.
