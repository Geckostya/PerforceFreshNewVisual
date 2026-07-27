# Application architecture snapshot

> Research snapshot. The current concise contract is in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. Architecture goal

The application should feel like a modern work tool rather than a graphical shell over a list of commands. The user works with files and changes, sees an operation's effects before it runs, receives progress updates, and can cancel a long-running task.

Helix Core remains the source of truth. The client does not reproduce the server model locally or hide important Perforce concepts to the point that an action becomes ambiguous.

## 2. Selected stack

| Area | Decision | Rationale |
|---|---|---|
| Desktop | Tauri 2 | Compact cross-platform shell and a strict IPC boundary |
| Backend | Rust stable (MSVC on Windows) | Safe process handling, streaming I/O, and a single local binary |
| UI | React + TypeScript + Vite | Mature ecosystem for complex trees, tables, and desktop workflows |
| Styling | Plain CSS, CSS variables, component-local styles | Minimal magic, simple theming, and no runtime dependency |
| Perforce | Installed `p4` CLI | Official, complete Helix Core interface without C++ FFI |
| `p4` format | `-ztag -Mj` | Structured line-delimited JSON records |
| Settings | JSON in the app config directory | Small data volume; a database is not yet justified |
| JS packages | npm + lockfile | Ships with Node.js; no separate package manager is needed |

The Tauri CLI is installed in the project's `devDependencies`. A global version is not used.

## 3. System boundaries

```text
┌──────────────────────────────────────────────────────────────┐
│ React UI                                                    │
│ views, selection, forms, optimistic interaction, progress   │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed invoke + events
┌──────────────────────────────▼───────────────────────────────┐
│ Tauri / Rust                                                │
│ allow-listed commands, validation, settings, operations     │
└──────────────────────────────┬───────────────────────────────┘
                               │ Command::args, no shell
┌──────────────────────────────▼───────────────────────────────┐
│ p4 CLI                                                      │
│ -ztag -Mj, one child process per operation                  │
└──────────────────────────────┬───────────────────────────────┘
                               │ Helix protocols
┌──────────────────────────────▼───────────────────────────────┐
│ Helix Core Server                                           │
│ source of truth, permissions, streams, revisions, locks     │
└──────────────────────────────────────────────────────────────┘
```

### Frontend responsibilities

- Data presentation and navigation.
- Selecting files/revisions and confirming dangerous actions.
- Local form and selection state.
- Displaying progress, warnings, and errors.
- Refreshing affected views after a successful operation.

The frontend does not know `p4` arguments, store passwords, or interpret raw stderr.

### Rust backend responsibilities

- Locating `p4` and validating its version.
- Building arguments only for allow-listed operations.
- Applying `P4PORT`, `P4USER`, `P4CLIENT`, and `P4CHARSET` to a specific process.
- Reading JSON Lines, stderr, and the exit code.
- Normalizing responses and errors into stable application DTOs.
- Managing long-running operation lifecycles and child-process cancellation.
- Reading and atomically writing non-secret settings.

### `p4` and server responsibilities

- Authentication, tickets, SSO/MFA, and SSL trust.
- Access permissions and server-side validation.
- Actual file, changelist, stream, and integration operations.
- Revision history and content.

## 4. Backend model

### P4 runner

`src-tauri/src/p4/runner.rs` is the only low-level process-launch boundary. Domain functions in `p4.rs` validate a specific operation, construct arguments as separate values, and pass a configured `Command` to the runner. There is no universal `P4Request` or arbitrary command string; such an envelope is introduced only together with a real protocol for long-running cancellable operations.

Runner:

1. Launches the configured executable directly through `std::process::Command`.
2. Adds the global `-ztag -Mj` flags where the command supports them.
3. Passes arguments as separate values.
4. Reads stdout line by line as a sequence of JSON objects.
5. Captures stderr and the exit code separately.
6. Classifies process/CLI errors and stores warnings/errors in a bounded session log.
7. Does not write secrets or the full environment to logs.

The runner exposes no public `run(command: string)`-style method to the frontend. Each Tauri command builds one specific allow-listed request.

### Response models

Rust converts Perforce fields into small application models. External `p4` fields must not leak across React components because the CLI format may differ between commands and server versions.

Common error envelope:

```text
AppError {
  kind: executable_not_found | auth | trust | permission | conflict |
        offline | cancelled | stale | partial_result |
        invalid_output | command_failed,
  message,
  hints[],
  diagnostics?       # safe technical details without secrets
}
```

Perforce warnings are not automatically treated as errors. Partial success in a long-running operation should return completed items and diagnostic records.

### Process state

Global managed state is minimal:

- Current non-secret connection settings.
- Explicit optional `P4CONFIG`/`P4ENVIRO` values passed only to the selected `p4` process.
- A registry of running long operations: `operation_id -> child/cancel handle`.

File lists, changelists, and history are not copied into a Rust cache without cause. They are owned by a frontend feature hook and refreshed after mutations. Data is considered potentially stale while the window is inactive; when focus returns, the hook repeats short read requests. Selection is retained only for files that still exist in the new server snapshot; removed or moved items are dropped automatically. Focus events are throttled, and this scenario does not require a separate filesystem watcher.

## 5. Short and long-running operations

Short reads (`info`, `opened`, or a small `changes` request) return through a regular Tauri command.

Long-running operations (`sync`, `submit`, `integrate`, or large `fstat` requests) use this protocol:

1. The UI calls `start_*` and receives an `operation_id`.
2. The backend launches a separate child process.
3. The backend emits typed `started`, `progress`, `warning`, `completed`, `failed`, and `cancelled` events with that ID.
4. The UI shows the task in the unified Operations Center.
5. `cancel_operation(id)` terminates only the corresponding process.
6. On completion, the backend always removes the handle from the registry.

Progress is never fabricated. If the server does not report a total, the UI shows the number of processed files and an indeterminate progress indicator.

## 6. Data model and paths

Do not conflate:

- `depot_path` — `//depot/...`;
- `client_path` — `//workspace/...`;
- `local_path` — filesystem path;
- `revision` — revision number/specification.

They must be separate model fields, not one universal `path`.

Before any file operation, the backend uses the path form expected by that command. Client-view mapping, including exclusions and overlays, is left to the server/`p4` instead of being reproduced by a custom parser without a demonstrated need.

`-Mj` can replace invalid UTF-8 with `U+FFFD`. Therefore, an operation on a local path must not blindly use the displayed string as an identifier. Problematic paths require a dedicated round-trip test on every supported OS; until that exists, the UI must warn the user and refuse a potentially incorrect mutation.

## 7. User-facing areas

### Connection

Stores the `p4` path, server address, user, workspace, and charset. Performs `p4 info`, trust/login, and workspace selection. `P4Info` retains server services, server ID, security, client address, and user email for a capability-aware UI. On an authentication error, the connection screen keeps the password only in memory, passes it via stdin to `p4 login`, clears it after success, and never stores it in settings or logs.

After a successful `p4 info`, the application stores up to ten recent and twenty favorite non-secret connection profiles in `settings.json` within the app config directory. A profile contains only the `p4` path, server, user, workspace, and charset. Favorite and recent profiles are offered before opening a workspace; passwords and tickets never enter this file.

### Workspace

Combines the file tree and status so users do not switch between technical screens. Actions include refresh, open for edit, add, delete, move, and revert local changes. A read-only inspector for the current client spec shows mapping, options, root/AltRoots, host, and stream before file operations; writing the spec is not part of this slice yet.

### My Changes

Shows default and numbered pending changelists, opened files, the description, shelved files, and submit validation. Dragging between lists invokes `reopen`; it does not change only UI state.

### History

Shows submitted changes and filelog, a diff between two revisions, retrieval of an older revision, and separate rollback creation through `p4 undo`. Before rollback, the UI shows the planned changes and the new pending changelist.

### Integration

Merge and cherry-pick are two modes of one user workflow, but not one implicit command. The backend builds a preview (`integrate -n` where applicable), the UI shows the source, target, and affected files, and then runs integrate and resolve.

### Branches (Streams)

Stream remains the official term in secondary labels. Switching a stream accounts for the associated workspace; the UI does not promise to "switch branches" as in Git when the operation requires creating or modifying a client spec.

## 8. UI architecture

The detailed screen structure, interaction flows, visual language, and UX acceptance criteria are defined in the current [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md). This section records only the UI architecture boundaries.

User-facing strings are loaded from external `locales/<code>.json` files; their format and lookup order are described in the current [`../LOCALIZATION.md`](../LOCALIZATION.md). `shared/i18n.tsx` contains only context, typed keys, and the English fallback. The backend validates language-pack completeness and returns a stable `ErrorKind`; the frontend selects the user-facing error text in the active language. Technical diagnostics are not localized.

Primary desktop layout:

```text
┌ sidebar ─────┬ main workspace ─────────────────┬ details ────┐
│ Workspace    │ tree / changes / history        │ selection   │
│ Changes      │                                  │ preview     │
│ History      │                                  │ actions     │
│ Streams      │                                  │             │
├──────────────┴──────────────────────────────────┴─────────────┤
│ operations: progress, warnings, cancel                       │
└──────────────────────────────────────────────────────────────┘
```

- One primary context per screen; details for the selected object appear on the right.
- Primary actions are available next to the object and through the command palette; destructive actions require a clear preview/confirmation.
- Loading, empty, permission-denied, offline, and partial-result states are designed together with the happy path.
- Keyboard navigation, focus states, semantic elements, and contrast are baseline requirements.
- `CommandPalette` provides `Ctrl/Cmd+K` navigation between primary screens and focus for Global Go To; feature actions remain in their domain contexts.
- Color is not the only indicator of file status.

`shared/View.tsx` defines the common vocabulary for resource screens: page heading, error/notice, empty state, and modal/action dialog. Workspace, Changes, History, Depot, Shelves, Jobs, and Labels follow one flow: select a row → see a persistent inspector → launch a preview/action. Primary commands live in the page header or inspector; alternative context menus remain only where they accelerate dense list work. Browser-native `prompt` and `confirm` are not used: confirmations behave consistently, block repeated launches during a mutation, and close on Escape only when safe.

Long-running submit/sync operations do not have feature-local progress/cancel UI. The feature registers a listener before launching the Tauri command and refreshes the server snapshot after a terminal event, while display, cancellation, and permitted retry belong exclusively to the app-level Operations Center. This prevents two competing state sources for one operation.

React state and small feature hooks are sufficient initially. A global state manager and query library are added only when manual synchronization among multiple live screens becomes a real problem. Virtualization for large trees is introduced after measurement, but list APIs are designed to support incremental delivery.

For `changes`, responsibilities are divided as follows:

- `ChangesView.tsx` connects user workflows to domain commands but does not own loading, selection, or browser DnD mechanics.
- `useChangesData.ts` owns the server snapshot, lazy shelf loading, refresh after mutations, and refresh-on-focus.
- `useFileSelection.ts` provides unified single/toggle/range selection for opened and shelved files and removes stale selections after refresh.
- `ChangesView.tsx` can also open a context menu from the focused row via the system `ContextMenu` key or `Shift+F10`, using element bounds instead of pointer coordinates.
- `useChangeDragDrop.ts` is the browser DnD boundary; `changes.ts` contains a pure matrix of permitted drop actions.
- `ChangeComponents.tsx` contains only changes-specific submit dialogs and context menus; the common page/dialog/empty/error vocabulary lives in `shared/View.tsx`.
- Every mutation ends with one `refreshData`, so changelist, opened-file, and shelf lists receive a consistent server snapshot.

`ShelvesView` is a dedicated read/unshelve slice for server-side shelves. It loads a bounded shelf list, files from the selected shelf, and pending targets, and requires `preview_unshelve` before apply. Local conflicts default to Skip; the user may explicitly select Overwrite per conflicting file, after which the backend separates the normal batch from the `-f` batch. Unselected conflicting paths are excluded from apply. If the normal batch succeeds and the force batch fails, the backend returns `partial_result` with an explicit description of the already applied portion. One selected shelved file can be exported without unshelving through `p4 print path@=change`; the destination must be new.

A dedicated vertical slice exists for `workspace`: `WorkspaceView` requests scoped `fstat`, keeps only local selection, performs batch edit/add/delete/lock/unlock through narrow Tauri commands, and supports local search/status filters plus Tree/List grouping by depot folders for server-backed DTOs. The user-requested `untracked` filter combines `fstat` with read-only `reconcile -n` and adds only `add` candidates that have local paths, without changing workspace state. Sync is split into `preview_sync` and `sync_workspace`; the preview additionally checks `p4 diff -sa/-se`, shows locally modified files, and requires explicit acknowledgement before launch. Get Revision uses the same preview/apply contract with the safe depot scope `path#revision`. A separate child process reports progress/cancel events. Reconcile is split into `preview_reconcile` (`p4 reconcile -n`) and guarded apply of the selected subset through `reconcile -c`: every selected path is revalidated before mutation, and a disappeared candidate returns `Stale` without launching apply. A single selected workspace file now offers Copy depot/local path and Windows-only Reveal in Explorer through the narrow `reveal_path` command, which validates the path and launches only `explorer.exe` without a shell. At this stage, virtualization and a lazy server tree remain future extensions.

A read-only scoped browser exists for `depot`: separate `p4 dirs` and `p4 files -m` calls return directories and head metadata without reading content or performing mutations. The UI converts user scope into safe patterns for directories (`*`) and files (`...`), automatically loads the selected directory, shows breadcrumbs/up navigation, and adds `p4 files -e` by default; an explicit include-deleted/archived toggle removes that filter. Clicking a file opens a bounded `filelog` inspector with a safe `print -q path#rev` preview, without mapping or mutations. A lazy server tree remains a future extension.

A read-only slice exists for `history`: `HistoryView` requests `filelog` with a bounded limit up to 5000 and Load more, shows server revisions, provides text preview or safe Save revision as through `print -q path#rev`, runs `diff2` for selected revisions, or compares a revision with its predecessor. Submitted change details also use lazy `describe -s` with jobs and per-file `diff2` for numeric revision pairs; submitted history supports an exact job filter through bounded `fixes -j` plus scoped `changes`, with local user/client/description filters applied over the result. Changes/History can pass `-db`, `-dw`, or `-dl` for an explicit comparison mode. Preview does not change have/workspace state. Rollback and annotate remain separate actions with their own preview contracts.
Binary diff/print responses are marked by the backend and are not rendered as corrupted text: the viewer shows a safe state, while saving the revision remains a separate way to retrieve the payload.

History also has a submitted-changes mode: scoped `p4 changes -s submitted -l -t -m N` returns a changelist list, the UI explicitly loads further batches up to the safe limit of 5000, and `describe -s` is called only for the selected CL. The UI supports local search by number/user/client/description and user/client filters. An explicit `p4 undo -n @change` preview and `p4 undo -c target @change` apply are available for the selected submitted CL; cursor/server filters and rollback ranges are not part of this slice yet.

Before mutation, Submit performs a separate `submit_preflight`: the changelist's opened files are reread through `fstat`, and missing local paths, unresolved files, pending resolves, out-of-date files, and active other-open/lock records are shown in full. A scoped `p4 resolve -n` is additionally called for pending resolves; automatic resolve is not performed. Preflight also obtains up to 100 linked jobs through `p4 fixes -c`, including available status/user/date values, with an ID fallback for older responses. Ordinary issues require a second explicit submit confirmation; unresolved files block submit and local shelf+submit variants, while regular shelving remains available. Preflight itself does not change server/workspace state.
A preview/apply contract exists for unresolved workspace files: selected paths first pass through `resolve -n`, the UI shows server candidates, and only after a second confirmation invokes the safe batch action `resolve -ay` (keep workspace content) or `resolve -at` (accept incoming server content). A full three-way editor and auto-resolve remain separate scope.

Logout is a separate confirmed `p4 logout` command; `Exit workspace` only leaves the UI session and does not revoke the ticket. The connection screen also shows local SSL fingerprints through read-only `p4 trust -l`; the application never installs or removes trust automatically.

Revert selected, unchanged, and full changelist use a server-backed two-step contract: `preview_revert_selected` calls `p4 revert -n -c change paths`, `preview_revert_unchanged` calls `p4 revert -n -a -c`, and `preview_revert_all` calls `p4 revert -n -c`; the UI shows the paths and then applies only the confirmed preview paths. An empty preview cannot be confirmed as a mutation.

## 9. Security and data safety

- No shell concatenation or arbitrary command execution from the frontend.
- Tauri capabilities grant the window only the minimum required permissions.
- Passwords, tickets, and the environment never enter application logs or telemetry.
- Mutations show the exact scope before launch: workspace, changelist, files, source, and target.
- Submit, revert, undo, integrate, and resolve have tests for errors and partial results.
- When state is unknown after interruption, the UI rereads data from the server instead of assuming rollback.
- Settings are written through a temporary file and atomic replace; corrupted JSON is never silently overwritten.

## 10. Testing

Minimum pyramid:

1. Rust unit tests for JSON Lines, process errors, and argument construction.
2. Frontend tests only for nontrivial transformations/behavior; static visuals are checked manually in a story/demo screen until a dedicated Storybook is justified.
3. Integration tests through a fake executable that emits controlled stdout/stderr and exit codes. This verifies the process boundary without a live server.
4. A small set of manual smoke scenarios against a test Helix Core: login, opened, reopen, sync, submit, and cancel.

A real server must not be required for ordinary `cargo test`/`npm test` runs.

## 11. Implementation order

The current prioritized backlog is in [`../P4_FEATURE_CHECKLIST.md`](../P4_FEATURE_CHECKLIST.md).

Current state: the connection and primary pending-changelist workflow slices are implemented end to end. The last successfully opened workspace is restored automatically on the next launch after connection and ticket validation; manual opening does not require a separate preliminary Test, and Exit workspace returns to the form without deleting the profile. In the workspace, users see Default and numbered changelists, with independent local-opened and shelved-file lists inside the selected CL. Available actions include local/shelf diff, edit/delete for an empty CL, reopen, selective and complete shelve/unshelve/delete shelf, lock/unlock, revert of a selected local file, full changelist revert with server preview, and drag-and-drop backed by real commands. Submit explicitly resolves a local+shelf conflict through three recovery/compensation strategies; ordinary local submit runs as a separate cancellable child-process operation with progress events, and on failure the backend performs a best-effort pending/submitted/unknown read-back while the frontend refreshes Changes. Shelf-preserving submit modes retain an awaited compensation workflow. The screen refreshes on focus return and after every mutation. The detailed contract and remaining advanced actions are in `CHANGELIST_REQUIREMENTS.md`. Sync and local submit use an operation slice: a separate child process, operation ID, operation kind, started/progress/completed/failed/cancelled events, and cancellation scoped to that process. The feature watches the terminal event for refresh, while the app-level Operations Center is the only progress/cancel surface and aggregates up to 30 events.

The Operations Center also retains bounded retry metadata for sync: a failed/cancelled sync can be retried only after explicit user confirmation through the current connection. Submit events are not retryable because repeating the mutation requires a new submit review.

`ShelvesView` also supports an explicit server-to-server copy of selected shelved files into an existing target changelist through `p4 reshelve -s -c`; the source shelf and workspace remain unchanged.

The Changes sidebar has a local bounded filter by ID, description, user, and client/workspace. The currently selected changelist is forced to remain in the filtered list, so entering a query neither changes context nor triggers a server request.

### Slice 1 — connection and opened files

Discover `p4`, validate its version, configure the connection, and support `info`, `opened`, pending changes, and `reopen`. This verifies the full architecture path and error handling.

### Slice 2 — workspace

Tree and status, sync with progress/cancellation, edit/add/delete/revert.

### Slice 3 — changelist workflow

Create/edit, drag-and-drop through reopen, diff, submit preview, and submit.

### Slice 4 — history and rollback

Submitted changes, filelog, diff2, get revision, and `undo` as a separate safe operation.

### Slice 5 — integrations and streams

Streams/workspace mapping, integrate preview, merge/cherry-pick, resolve workflow.

Reconcile, a full resolve/merge editor, jobs, labels, and advanced search are added after the foundational slices are stable. Basic selected-file locks and explicit `resolve -ay/-at` are already part of the Workspace slice; the basic shelf workflow is already part of the changelist slice.

## 12. Deliberately deferred

- C++ P4API/FFI and REST transport.
- A local database and background indexing.
- Redux/Zustand and a universal event bus.
- A plugin system and public SDK.
- Multiple Rust crates and a DI container.
- A custom client-view parser.
- Bundling `p4` with the installer before legal review.

These decisions are revisited only in response to a specific workflow constraint or performance measurement.

Workspace single-file rename accepts an explicit depot destination and performs read-only `p4 move -n` before `p4 move -c`; an invalid target does not launch a mutation. The header also has a bounded Global Go To classifier: `//...` opens the scoped Depot Browser, `ws://...` opens Workspace, numeric/`#N` opens the selected pending changelist, `job:...` opens Jobs, and `label:...` opens Labels; unknown targets do not invoke the CLI.

The Jobs browser uses bounded `p4 jobs -l -m` and passes a non-empty search as one `-e` argument; the selected job requests a bounded `p4 fixes -j` inspector. The Labels browser similarly uses `p4 labels -t -m` with case-insensitive `-E`. The UI shows only server metadata and locally filters already loaded bounded results; creation and editing remain separate slices.
