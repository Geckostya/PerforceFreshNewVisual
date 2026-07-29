# P4FNV architecture

This document records stable technical boundaries. Current feature readiness is tracked in [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md), and the UI contract is in [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md).

## Stack and call flow

- Windows desktop: Tauri 2.
- Frontend: React, TypeScript, Vite, and plain CSS.
- Backend: Rust stable MSVC.
- Helix Core: the user-installed `p4` CLI.
- Settings: a small JSON file in the app config directory; secrets are not stored.

The current shipping target is Windows. Rules that preserve the possibility of a deferred macOS/Linux port without prematurely implementing those platforms are in [`PORTABILITY.md`](PORTABILITY.md).

```text
React feature
  -> typed wrapper in src/shared/api.ts
  -> allow-listed Tauri command
  -> validated Rust domain operation
  -> src-tauri/src/p4/runner.rs
  -> p4 CLI
  -> Helix Core Server
```

Helix Core Server remains the source of truth. The application does not reproduce permissions, client mapping, integration history, or changelist state in its own local index.

## Layer responsibilities

Frontend:

- displays server DTOs, selection, forms, previews, progress, and errors;
- stores only the current screen's state;
- rereads affected data after a mutation and when focus returns;
- does not build `p4` arguments, store the password, or interpret raw stderr;
- may store cosmetic Unactual lists in `localStorage` and large read-only data in memory/IndexedDB; the detailed Files cache contract is in [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md).

Rust backend:

- validates changelist IDs, revision specs, and paths;
- builds arguments for a specific allowed operation;
- applies the connection environment only to the child process;
- converts CLI records into stable DTOs and `AppError`;
- owns child processes, cancellation, settings, and safe file writing.

`p4` and the server:

- perform authentication, trust, permission checks, and mutations;
- resolve the client view, streams, topology, and server-side race conditions;
- are the final check after any preview.

## Process boundary

`src-tauri/src/p4/runner.rs` is the only low-level `p4` launch point.

- The process starts directly through `Command`; no shell is used.
- Arguments are passed as separate values.
- Stable structured output uses `-ztag -Mj`; stdout is read as JSON Lines, not one array.
- Safe sync remains a narrow validated domain operation with shared frontend orchestration for every retrieval entry point; recovery, overwrite, and cache invariants belong to [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md).
- Form workflows (`change/client/stream/label -o/-i`) are handled as text forms and need not return JSON.
- stdout, stderr, exit code, and warning/error records are handled separately.
- The password is passed only through stdin; tickets, passwords, and the full environment are not logged.
- The frontend receives no universal command such as `run_p4(command)` and does not select the executable for an individual operation.

`AppError.kind` must distinguish at least auth, trust, permission, conflict, offline, cancelled, stale, partial result, invalid output, and command failure. An ordinary rejected operation is not labeled a connection failure.

`p4 filelog -Mj` returns revisions as indexed fields (`rev0`, `change0`, `how0,0`), so the history parser expands each index into a separate `FileRevision`; flat records are also supported for compatibility and unit fixtures.

Submitted filtering sends validated user/workspace values to bounded `p4 changes` queries. The Submitted screen enriches that page through `p4 describe -s -m 1` and longest stream-prefix matching; other consumers skip it. Selection uses `describe -s -m limit+1`, reporting truncation without an unbounded read; only explicit choice requests complete detail. Get This Revision streams exact `depotFile#rev` scopes through `p4 -x -` and shared safe sync. Cherry-pick rereads the change, verifies one source stream and the current target, then previews or applies `p4 integrate -S source -P target -Af source/...@=change` into an explicit pending changelist. Resolve, review, and submit remain separate decisions.

## Short and long-running operations

Short read requests return a DTO from an ordinary Tauri command. Long-running sync, submit, reconcile, and future integrate/large-transfer operations use one protocol:

1. The frontend subscribes to operation events before starting the command.
2. `start_*` creates a separate child process and returns `operation_id`.
3. The backend publishes `started`, `progress`, `warning`, `completed`, `failed`, or `cancelled`; sync progress additionally carries `totalFileCount`, `totalFileSize`, and accumulated `fileSize` from tagged output of the running sync, without a separate blocking preflight. Reconcile streams candidates during preview, then reports separate validation and apply phases against the selected-file total.
4. The app-level Operations Center is the only progress/cancel/retry surface; sync retry preserves the original array of file/folder scopes without merging them into one filespec. The backend does not start a second sync before the first terminal event.
5. `cancel_operation(id)` signals the dedicated waiter channel for the operation. The waiter polls `Child::try_wait`, calls `Child::kill` and `wait` on the signal, then publishes terminal `cancelled`; blocking `Child::wait` does not hold the mutex needed for cancellation.
6. After the terminal event, the handle is removed and the feature rereads server state.

Cancel does not mean rollback. Cancelling reconcile stops the child process and refreshes Files, but files opened before termination remain open. Retrying a mutation is allowed only as a new explicitly confirmed workflow after read-back; submit/integrate are not automatically retried when the result is unknown.

## Data and mutation safety

`depot_path`, `client_path`, `local_path`, and `revision` are distinct model fields. A displayed path containing `U+FFFD` after invalid UTF-8 cannot be used as a mutation identifier without a safe round trip.

Every mutation requires:

- an exact workspace/source/target/scope before launch;
- a server-backed preview for destructive, overwrite, sync-risk, submit, undo, integrate, and resolve flows;
- a safe default: Skip/Cancel without implicit `-f`;
- a batch CLI invocation for the selected set when the command supports it;
- explicit compensation and an honest `partial_result` for a composite operation;
- refresh after success, failure, and cancellation when server state may have changed.

Do not automatically trust an SSL fingerprint, overwrite an untracked/writable file, change protections, or execute administrative force flags from the ordinary UI.

Local filesystem mutations are available only through narrow backend operations inside the authorized client root; the exact Files contract is in [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md). The frontend receives no general filesystem API.

Changing streams is a composite operation with an explicit strategy. The catalog is read with bounded `p4 streams`; Keep uses safely constructed `p4 client -s -f -S` without touching workspace contents, while Shelve first saves and reverts numbered changelists and then uses `p4 switch --no-sync` for Default work. The subsequent sync starts separately through the existing preview/operation protocol, so a sync failure cannot hide an already-completed stream change.

## Frontend and UI state

- Feature code owns loading, selection, and mutation orchestration for its area.
- Shared DTO/API/i18n/operations/UI primitives live in `src/shared` only when used by multiple features.
- List/tree selection uses shared single/Ctrl-toggle/Shift-range rules; the context menu owns its dismissal, safe positioning, and keyboard navigation.
- My Changes and Streams use one scoped hook for storing/cleaning Unactual IDs and one validated DnD transport; domain cascading of a stream subtree remains in Streams.
- Resource screens use `View` and a stable list/inspector layout modeled on MyChanges.
- Browser-native `prompt`/`confirm` are not used; the shared dialog blocks repeated submit and handles Escape safely.
- Add a global state manager, query library, database, filesystem watcher, or virtualization only after measured need.

HTML5 drag-and-drop requires `app.windows[].dragDropEnabled = false` in `src-tauri/tauri.conf.json`; otherwise native Tauri file-drop intercepts WebView2 events. DnD always has a button/context-menu equivalent. Reopen and cosmetic movement to/from Unactual are moves; shelve/unshelve are copies. Both features use a shared validated archive payload and synchronous in-memory fallback for WebView2; the payload causes no Perforce mutation.

## Opt-in UI diagnostics and agent bridge

The bridge is an opt-in, development-only boundary without arbitrary filesystem, shell, Tauri, or P4 APIs. Its transport, security model, schema, and mandatory lifecycle belong to [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).

## Settings and localization

- Settings are written through a temporary file and atomic replace; damaged JSON is not silently overwritten.
- Cosmetic Unactual IDs and scoped Streams view settings are stored in browser `localStorage` separately from settings and are never sent to the server.
- Unactual IDs cannot be cleaned while the corresponding pending/stream snapshot is still loading or in error; stale cleanup is allowed only after a successful server read.
- Local Files and its scoped IndexedDB cache follow [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md).
- A connection profile contains only executable, port, user, client, charset, and explicit config paths.
- Automatic charset remains unset for non-Unicode servers; after `p4 info` reports a Unicode server, the active session uses UTF-8 for metadata, forms, and descriptions while preserving the saved Auto choice.
- Every user-facing string exists in complete `locales/en.json` and `locales/ru.json` packs.
- Additional complete JSON packs load beside the shipping executable or from the app config directory; see [`LOCALIZATION.md`](LOCALIZATION.md).

## Verifying changes

- Rust unit tests: validation, argument builders, JSON/form parsers, error classification, and compensation state.
- Frontend tests: nontrivial pure/state logic only.
- Fake executable or disposable test server: process boundary and integration paths.
- Live-server smoke is not run against the user's server without explicit authorization.
- Verify UI changes in English/Russian, empty/loading/error states, long paths, keyboard-only use, and 100/125/200% scale.

The full local gate and release commands are in [`TOOLCHAIN.md`](TOOLCHAIN.md).

## Do not add without proven need

- a universal Perforce SDK/transport, C++ P4API FFI, or REST layer;
- a shell console from the frontend;
- a local database and background indexing;
- a plugin SDK, DI container, event bus, or multiple crates;
- a custom client-view parser;
- a dependency or abstraction with a single consumer.
