# P4 verification scenarios

This research note is a reusable test inventory for behavior that unit tests cannot prove. It does not record current pass/fail status. Each actual run should name the tested workflow and record its environment and unverified variants.

Never run mutating scenarios against the user's connected server without explicit authorization. Use a disposable P4 Server.

## Verification layers

| Layer | What it proves |
|---|---|
| Unit | Validation, argument construction, parsers, reducers, and pure UI state. |
| Fake P4 | Process boundary, stdin/stdout/stderr, structured warnings, cancellation, malformed output, and command sequencing. |
| Live P4 | Server semantics, permissions, mappings, topology, triggers, file types, and races. |
| Native UI | WebView behavior, focus, keyboard, DnD, localization, scaling, clipping, and progress visibility. |
| Recovery | State after failure between steps of a composite mutation. |

## Environment matrix

Record the exact P4 CLI and Server versions for every live run. Cover these axes only when they affect the workflow:

- plain TCP; SSL with trusted, new, and changed fingerprints;
- valid and expired ticket; password; available MFA/login2 or SSO setup;
- classic and stream workspaces; include, exclude, overlay, and ditto mappings;
- standard server and available commit-edge/proxy topology;
- Unicode and non-Unicode server; case-sensitive and case-insensitive server;
- ASCII, non-ASCII, spaces, special characters, long paths, and case-only rename;
- text, executable, symlink, binary, image, `+l`, and large files;
- unrestricted, restricted, permission-denied, trigger-rejected, maxresults, and truncated output.

## High-value live scenarios

### Connection and workspace

- Connect with valid credentials, expired credentials, unavailable server, new fingerprint, and changed fingerprint.
- Create/edit/rename/delete classic and stream clients while preserving unknown fields and mapping order.
- Switch workspace or stream with clean state, numbered/default opened work, offline changes, shelves, and an interrupted follow-up sync.

### Files and retrieval

- Browse a large mapped tree and a readable unmapped depot subtree without recursive global scans.
- Reconcile add/edit/delete/move/ignored files; change a candidate between preview and apply.
- Safe-sync an ordinary update, a writable unopened file, an opened file, a missing-have file, a deletion, and a cancelled transfer.
- Force-overwrite several files with one injected print/replace/flush failure; verify each recovered file and final have state independently.
- Retrieve an exact file revision, folder changelist, and label through the same preview and recovery path.

### Changes, shelves, and submit

- Exercise empty, local-only, shelf-only, and local+shelf changelists.
- Shelve selected/all; inject failure after shelving but before optional revert.
- Unshelve without collision and with several add collisions; overwrite only one selected path and inject failure in the force batch.
- Submit Default, numbered local-only, shelf-only, and each local+shelf strategy.
- Reject submit for unresolved, out-of-date, other-open/lock, permission, trigger, task-stream, and distributed-server conditions.
- Interrupt submit at an unknown point and verify pending/submitted/opened/shelf read-back before any retry.

### History, resolve, and integration

- Inspect file history through edit/branch/move/delete/undo records and compare real revisions.
- Preview and apply `undo` for one change and a range; resolve resulting conflicts without rewriting history.
- Resolve clean text merge, text conflict, binary, move/name, filetype, and stream-spec cases.
- Preview/apply merge down, copy up, and a partially integrated cherry-pick; verify that apply opens target files and never submits.

### Collaboration and scale

- Lock/unlock ordinary and `+l` files; test competing submit and available global-lock topology.
- Use a custom jobspec through search, attach/detach, submit, and resulting fix status.
- Inspect static/automatic and locked labels; delete or change a label between sync preview and apply.
- Trigger server limits and partial records in Files, Depot, History, Streams, Jobs, and Labels.

## Failure injection points

For every composite mutation, enumerate steps before writing the test. Inject failure before the first step, between each pair, and after the server mutation but before UI acknowledgement. Verify:

- what succeeded, failed, and was skipped;
- whether compensation ran and whether it succeeded;
- whether current server/workspace state was reread;
- whether retry is safe, requires confirmation, or must be blocked as unknown;
- whether selection, scope, and diagnostics still identify the affected objects.

## Native UI matrix

- English and Russian; representative long external-pack strings.
- Keyboard-only primary and context-menu paths; no drag-only action.
- 100%, 125%, and 200% Windows scaling at minimum supported window size.
- Empty, loading, stale, permission, partial, cancelled, and unknown-result states.
- Long descriptions and paths, large selections, context menus near viewport edges, and focus restoration after dialogs/refresh.

## Run record

Store live-run evidence with:

- date, commit, tested workflow, operator, and disposable dataset;
- P4 CLI/Server versions, topology, Unicode/case mode, depot/workspace types;
- commands or automated test names that ran;
- pass/fail and captured diagnostics;
- explicitly unverified axes from the matrices above.
