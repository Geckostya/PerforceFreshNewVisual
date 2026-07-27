# Complete P4FNV feature catalog and user stories

> Research snapshot. The current prioritized backlog is in [`../P4_FEATURE_CHECKLIST.md`](../P4_FEATURE_CHECKLIST.md).

Status: living product contract and implementation queue<br>
Audit date: July 21, 2026<br>
Comparison baseline: P4V 2026.2, P4 CLI 2026.1, and the current P4FNV source state<br>
Local CLI during the audit: P4/NTX64/2025.1/2831954; new capabilities must therefore pass a runtime capability check

## 1. Purpose and scope

This document answers three questions:

1. Which Helix Core capabilities a developer needs to use P4FNV instead of P4V in daily work.
2. Which commands from the installed P4 CLI implement those capabilities.
3. What P4FNV already implements, what is partial, and what is still absent.

This is not a catalog of every P4 Server administration command. Managing protections, groups, licenses, triggers, replication, checkpoints, obliterate, and server configurables belongs to P4 Admin and is outside the required P4FNV core.

In this project, the P4 CLI is the application interface to the server. Commands with stable structured output should use <code>p4 -ztag -Mj</code>. Specification forms (<code>change -o/-i</code>, <code>client -o/-i</code>, <code>stream -o/-i</code>, and <code>label -o/-i</code>) are handled as text forms. Passwords and interactive authentication responses are passed through stdin or the official interactive mechanism, never through process arguments.

## 2. How to read and update the checklist

Legend:

- [x] **Complete** — the workflow exists end to end from UI → Rust → P4 CLI → UI refresh and has been confirmed by a code audit.
- [ ] **Partial** — part of the path exists, but the workflow is not yet dependable for daily use.
- [ ] **Not implemented** — no user workflow exists.
- **P0** — required minimum for daily work.
- **P1** — professional functionality required to replace P4V in stream-based projects.
- **P2** — advanced team workflow.
- **P3** — specialized or rarely used capability.

A “Complete” mark in this snapshot means the implementation and applicable automated tests exist. It does not replace a separate smoke test against a test P4 Server. If behavior depends on topology, permissions, triggers, SSO/MFA, depot type, or a particular server version, the live-server verification must be recorded separately.

### Universal definition of done

Any new item may be marked [x] only when:

- Separate Rust and TypeScript models exist for the workflow data.
- Rust builds allow-listed P4 arguments without shell interpolation and validates changelists, revisions, and paths.
- The Tauri command is narrow and does not accept an arbitrary command line.
- The UI includes loading, empty, permission-denied, offline/stale, and partial-result states.
- After a mutation, data is reread from the server while selection and scroll are preserved if the object still exists.
- A long-running operation has an operation ID, event stream, warnings, final result, and cancellation when the process can be interrupted safely.
- A destructive flow shows the exact workspace, scope, and consequences.
- Mouse, keyboard, and batch operation support exist for multi-select where meaningful.
- All strings are extracted into complete <code>locales/en.json</code> and <code>locales/ru.json</code> files.
- Unit tests cover argument construction, parsing, and nontrivial UI logic.
- Frontend/Rust checks and the relevant smoke test on a disposable P4 Server have run, or the exact unverified portion is recorded.
- This document and the related living contract are updated.

## 3. Current-state snapshot

The marks in this section were checked against the allow-listed Tauri commands in [commands.rs](../../src-tauri/src/commands.rs), actual CLI arguments and tests in [p4.rs](../../src-tauri/src/p4.rs), the typed frontend API in [api.ts](../../src/shared/api.ts), the working [ConnectionScreen.tsx](../../src/features/connection/ConnectionScreen.tsx) and [ChangesView.tsx](../../src/features/changes/ChangesView.tsx) screens, and the [CHANGELIST_REQUIREMENTS.md](../CHANGELIST_REQUIREMENTS.md) contract.

### 3.1 Already implemented

- [x] **P0. Discover the P4 CLI and show its version.** Use an explicit path or find <code>p4.exe</code> in PATH; command: <code>p4 -V</code>.
- [x] **P0. Validate the basic connection.** Accept P4PORT, P4USER, P4CLIENT, and P4CHARSET; run <code>p4 info</code>; classify auth, trust, and permission errors.
- [x] **P0. Select an existing workspace.** Retrieve the user's clients through <code>p4 clients -u ...</code>, support manual input and recent profiles.
- [x] **P0. Restore the last workspace.** Store only non-secret fields; run <code>p4 info</code> and <code>p4 login -s</code> on startup; Exit workspace does not delete the profile.
- [x] **P0. Pending changelists and opened files for the current workspace.** Commands: <code>p4 changes -s pending</code>, <code>p4 changes -s shelved</code>, and <code>p4 opened -C</code>.
- [x] **P0. Separate local opened and shelved files.** The current changelist's shelf loads lazily through <code>p4 files @=change</code>.
- [x] **P0. Create, edit the description, and delete an empty numbered changelist.** Forms: <code>p4 change -i</code>, <code>p4 change -o</code>; deletion: <code>p4 change -d</code>.
- [x] **P0. Move files between changelists.** Single/multi-select, Ctrl/Cmd, Shift range, inspector, and drag-and-drop; batch <code>p4 reopen -c</code>.
- [x] **P0. Basic text diff.** Local ↔ have through <code>p4 diff -du</code>, shelf ↔ head through <code>p4 diff2 -du</code>, and local ↔ shelf; 2 MiB limit and truncation flag.
- [x] **P0. Shelve/update.** Selected files, full shelf replacement, and optional revert after shelving; <code>p4 shelve -f/-r -c ... -Af</code>.
- [x] **P0. Unshelve.** Selected or all files into Default/a numbered changelist; <code>p4 unshelve -s -c -Af</code>.
- [x] **P0. Preflight for shelved-add conflicts.** <code>p4 where</code> plus a local-file check; safe Skip by default and explicit <code>unshelve -f</code> only for selected paths.
- [x] **P0. Delete an entire shelf or selected shelved files.** Confirmed <code>p4 shelve -d</code>.
- [x] **P0. Revert selected or all local files in a changelist.** <code>p4 revert -c</code>; opened-for-add files have a persistent explicit <code>-w</code> setting.
- [x] **P0. Submit local-only, shelf-only, and conflicting local+shelf states.** Four submit modes, a recovery changelist, and compensation for compound failures are implemented.
- [x] **P0. Refresh after mutations and when focus returns.** The shelf cache is cleared and the UI rereads server state.
- [x] **P0. Session log for CLI warnings and errors.** Bounded log with technical details and clearing.
- [x] **P0. External RU/EN language packs.** An additional complete JSON dictionary can be placed next to the executable or in the app config directory.

### 3.2 Partially implemented; do not treat as complete

- [ ] **P0. Complete authentication — partial.** Password login and logout with safe stdin/confirmation are implemented; ticket renewal/expiry, <code>p4 login2</code>, SSO/P4 Authentication Service, and SSL fingerprint confirmation through <code>p4 trust</code> are not complete.
- [ ] **P0. Workspace management — partial.** Listing, opening, safe session-level switching, a read-only inspector, and explicit create/edit/delete/rename client-spec workflows exist; edit preserves unknown form fields/mappings and updates root/stream/description.
- [ ] **P0. Submit review — partial.** A read-only opened/fstat preflight, pending <code>resolve -n</code>, missing/out-of-date/other-open/lock issues, bounded jobs through <code>p4 fixes -c</code>, structured server warnings, stream spec from the client form, and total file size with repeated explicit confirmation are implemented; richer trigger diagnostics remain incomplete.
- [ ] **P0. Diff viewer — partial.** A bounded unified/split viewer, line numbers, hunk navigation, patch export, binary state, and exact/ignore whitespace changes/ignore whitespace/ignore line endings modes exist; syntax highlighting and image diff remain.
- [ ] **P0. Error model — partial.** Separate `conflict`, `offline`, `cancelled`, `stale`, and `partial_result` classifications with localized hints exist; a complete stale/offline mode and partial-success recovery UI remain incomplete.
- [ ] **P0. Operations Center — partial.** The app-level center receives streaming sync/local-submit events, retains bounded history, and shows progress/path/status and cancel; explicit confirmed retry exists for failed/cancelled sync, while shelf-preserving submit operations and mutation-recovery UI remain incomplete.
- [ ] **P0. Changelist UI accessibility — partial.** Multi-select, buttons, and keyboard context menus (`ContextMenu`/`Shift+F10`) exist; complete pane navigation, screen-reader announcements, and visual verification at 200% remain incomplete.
- [ ] **P0. Integration tests — partial.** Rust/TypeScript unit tests exist; there is no recorded smoke-test matrix on a disposable P4 Server for submit/shelf compensation and topology-dependent scenarios.

### 3.3 Major missing areas

- [ ] Workspace/project file browser and status. A scoped list/status slice, client-spec inspector, local search, Tree/List mode, and opened/outdated/unresolved/other-open/unmapped/untracked status filters exist; the untracked filter augments `fstat` with safe `reconcile -n`, while virtualization remains incomplete.
- [ ] Depot browser. A read-only scoped `p4 dirs`/`p4 files` browser exists with directories and head metadata, automatic directory navigation, breadcrumbs/up navigation, an explicit include-deleted/archived toggle, and a file inspector with bounded history/print preview; the lazy server tree remains incomplete.
- [ ] Sync/update with preview, safe apply, refresh, progress, cancellation, and local-modified preflight is implemented; advanced target modes remain incomplete.
- [ ] Edit/add/delete/reconcile from the file browser are implemented with basic batch commands; Workspace also provides explicit single-file rename through `p4 move -n` → `p4 move -c`, and lock/unlock is available in Workspace and Changes for selected/all opened files, while clean and the complete file browser remain incomplete.
- [ ] Submitted changelist history for a selected project, folder, or file. A global submitted-changes list and lazy details exist.
- [ ] File history, revision comparison, content preview, annotate, and Revision Graph. File history, print preview, and revision comparison exist.
- [ ] Get Revision and safe rollback through <code>p4 undo</code>.
- [ ] Streams tree, Stream Graph, stream workspaces, and stream switching.
- [ ] Merge, copy, cherry-pick/integrate, and interchanges.
- [ ] Complete resolve workflow.
- [ ] Jobs/fixes, labels, and global search. A bounded Jobs browser through `p4 jobs -l -m`, a job-fixes inspector through `p4 fixes -j`, and a Labels browser through `p4 labels -t -m` exist, all with bounded server search/metadata; creating and editing jobs/fixes/labels remain future extensions.

## 4. P0 — connection, authentication, and capability detection

### 4.1 Connection profiles

- [x] **Store recent connection profiles without secrets.**
  - Data: executable, port, user, workspace, charset.
  - Do not store a password, MFA code, or ticket contents.
  - Complete in the current project; the list is limited to ten profiles.

- [ ] **Favorite profiles and readable names.**
  - The user assigns an alias, pins profiles, and changes their order.
  - No CLI is required; this is a local setting.
  - Favorite profiles can be selected before opening a workspace and toggled without logout; aliases/manual ordering remain incomplete.

- [x] **Use P4CONFIG/P4ENVIRO as an explicit option.**
  - Commands: <code>p4 set</code>, <code>p4 info</code>; read the effective environment.
  - The UI passes explicitly configured P4CONFIG/P4ENVIRO to every p4 invocation and neither reads nor logs their contents.
  - Empty values are not set, so the user's global configuration is not overwritten.

### 4.2 Login, tickets, trust, and MFA

- [ ] **Interactive login.**
  - CLI: <code>p4 login</code>, password through stdin; status through <code>p4 login -s</code>.
  - UI: the password field is not stored; expiry, Renew session, and Retry are available.
  - A login error must not be labeled as a connection failure.
  - Password input is implemented on the connection screen only after an auth error; Rust passes the password through stdin, rejects newlines, clears the UI after success, and repeats `p4 info`. A manual bounded `p4 login -s` check shows minutes until expiry and offers explicit Renew through an ephemeral password field; MFA/login2, SSO, and trust confirmation remain separate workflows.

- [ ] **Log out the current user.**
  - CLI: <code>p4 logout</code>; separate confirmation because this may affect other P4 applications using the same ticket file.
  - Exit workspace remains a separate action and does not invoke logout.
  - A separate Logout button with localized confirmation is implemented; on error the current workspace session is retained, and Exit workspace still does not revoke the ticket.

- [ ] **MFA/login2.**
  - CLI: <code>p4 login2</code> and the server-supported challenge flow.
  - The UI does not assume one fixed OTP field; methods and stages come from the server.

- [ ] **SSO and P4 Authentication Service.**
  - Support the installed CLI's auth-check-sso/P4 AS behavior, a visible browser/IdP handoff, and return to ticket validation.
  - URLs, tokens, and credentials from the auth flow must not be logged.

- [ ] **SSL trust.**
  - CLI: <code>p4 trust</code>, retrieve the fingerprint and request explicit confirmation.
  - Show a new or changed fingerprint in full; for a change, default to Cancel and recommend contacting an administrator.
  - Never apply trust automatically without user involvement.
  - Read-only display of local records through `p4 trust -l` is implemented; installation, removal, and explicit fingerprint confirmation remain separate actions.

### 4.3 Capability detection

- [ ] **Detect client/server versions and available capabilities.**
  - CLI: <code>p4 -V</code>, <code>p4 info</code>, and <code>p4 help command</code> when needed.
  - Store client version, server version, Unicode, case handling, server services, serverID, and security/auth hints.
  - The UI hides only features known to be unavailable; permission errors remain server-authoritative.
  - `p4 info` already shows server services, server ID, security, client address, and user email in the connection result; capability-gated actions and `p4 help` probing remain incomplete.

- [ ] **Detect topology.**
  - CLI: fields from <code>p4 info</code>, and <code>p4 topology</code> when available.
  - Standard/commit/edge/replica/proxy/broker indicators are required for correct handling of global locks, promoted shelves, and server-bound workspaces.

## 5. P0 — workspace and mapping

### 5.1 Browse and select

- [x] **List the current user's workspaces.**
  - CLI: <code>p4 clients -u user</code>.
  - Currently limited to the first 200 records; a pagination/search strategy is required before the scaling item can be closed.

- [ ] **Complete workspace inspector.**
  - CLI: <code>p4 client -o name</code>, <code>p4 info</code>.
  - Show Owner, Host, Root/active AltRoot, Stream, StreamAtChange, View, ChangeView, Options, SubmitOptions, LineEnd, Type, ServerID, and Access/Update.
  - Depot/client/local path spaces must be separate fields.

- [ ] **Filter workspaces.**
  - CLI: <code>p4 clients -u</code>, <code>-e</code>, <code>-E</code>, <code>-S</code>, and <code>-m</code> according to version capabilities.
  - Filters: owner, host/current computer, stream, root, name, recent/favorite.

### 5.2 Create and edit

- [ ] **Create a classic workspace.**
  - CLI: <code>p4 client -o</code> plus a validated form passed to <code>p4 client -i</code>.
  - UI: name, root, host, template, view builder, and safe defaults.
  - Preview shows the resulting mapping and local root; folders on disk are created only after confirmation.

- [ ] **Create a stream workspace.**
  - CLI: <code>p4 client -S stream -o name</code> + <code>p4 client -i</code>.
  - Generated View is read-only; the user edits stream association and workspace options instead of replacing server mapping.

- [ ] **Edit mapping.**
  - Support regular, exclusion, overlay, and ditto mappings without losing line order.
  - The main mapping parser must not try to replace server semantics; path availability is checked through <code>p4 where</code>.

- [ ] **Edit workspace options.**
  - Clearly explain clobber/noclobber, allwrite/noallwrite, modtime/nomodtime, rmdir/normdir, locked/unlocked, and submit options in the UI.
  - Dangerous changes are not applied without a consequence summary.

- [ ] **Rename, delete, or unload a workspace.**
  - CLI: <code>p4 renameclient</code>, <code>p4 client -d</code>, and <code>p4 unload/reload</code> when needed.
  - Preflight: opened files, shelves, pending changes, and host/server binding.
  - Deleting the server spec must not delete local files.

### 5.3 Switch workspace/stream

- [ ] **Switch workspaces safely.**
  - Before switching: <code>p4 opened</code>, <code>p4 reconcile -n</code>/<code>p4 status</code>, and active operations.
  - Options: Shelve and switch, Revert and switch, Cancel; never silently lose local changes.

- [ ] **Switch the stream in the current workspace.**
  - CLI: <code>p4 switch</code> where its semantics apply, or <code>p4 client -s -S</code> plus preview sync.
  - The UI must explain whether work is preserved automatically, whether a shelf is created, and when the view changes.

## 6. P0 — browse project files (Workspace)

### 6.1 Tree and list

- [ ] **Lazy local-workspace tree.**
  - A scoped list slice `WorkspaceView` → `p4 fstat -Ro -Ol` and client-side Tree/List mode grouped by depot folders are implemented; a separate untracked filter combines the result with `p4 reconcile -n`, while virtualization is not yet implemented.
  - CLI: <code>p4 fstat</code>, <code>p4 dirs</code>, <code>p4 files</code>, and <code>p4 where</code>; use the local filesystem only for an already mapped scope.
  - Show mapped depot files, local untracked files, and folders without loading everything recursively.
  - Expanding a folder loads only the selected scope; large lists are virtualized.

- [ ] **Tree/List switching and breadcrumbs.** Tree/List switching is implemented for the loaded scoped list; breadcrumbs and a lazy server tree remain separate extensions.
  - Preserve the selected view, scroll, expanded nodes, and selection per workspace.
  - Breadcrumbs support navigation to the local root, client path, and depot path.

- [ ] **Status columns.**
  - Depot/local/client path, action, change, have/head, type, mapped, other-open, and unresolved fields are implemented for the loaded scope; the UI shows derived status badges and filters.
  - Minimum: name/path, action, changelist, have/head, mapped, locally modified, otherOpen, lock owner, resolve state, file type, size, and last change.
  - Primary source: <code>p4 fstat -T ...</code>; do not assemble status from dozens of per-file commands.

### 6.2 Statuses and filters

- [ ] **Opened filter.**
  - CLI: <code>p4 opened</code> or fstat fields.
  - The add/edit/delete/move/branch/integrate/import/purge states must have an icon and label.

- [ ] **Modified outside P4 filter.**
  - CLI: <code>p4 reconcile -n</code> or <code>p4 status</code>.
  - Distinguish modified, missing, untracked, move candidate, and ignored.

- [ ] **Outdated / Have < Head filter.**
  - CLI: <code>p4 fstat</code>, <code>p4 cstat</code>, and <code>p4 sync -n</code> for scoped preview.
  - Show have revision, head revision, head change, and an actionable Update.

- [ ] **Not in depot and ignored filter.**
  - Respect P4IGNORE; ignored files are hidden by default but available through a separate toggle.
  - Do not offer Add for a file outside mapping or disallowed by protections without explaining why.

- [ ] **Conflicts, locked, shelved-counterpart, and changed-by-others filters.** A server-backed locked filter through `otherLock` is implemented; conflicts and shelved counterpart remain separate extensions.
  - Source: fstat resolve/otherOpen/otherLock fields, opened, and resolved.
  - The filter must scale to the current folder scope.

### 6.3 File/folder inspector

- [ ] **Separate paths and mapping.**
  - CLI: <code>p4 where</code>.
  - Show the depot path, client path, local path, and mapping exclusion.

- [ ] **Revision and ownership metadata.**
  - CLI: <code>p4 fstat</code>.
  - Head/have, head action/change/time/type, opened action/change, lock/other users, movedFile/movedRev, and unresolved records.

- [ ] **Quick actions.**
  - Diff, History, Check out, Add, Delete, Move/Rename, Revert, Lock/Unlock, Reveal in Explorer, Open in editor, Copy each path.
  - Primary actions are available outside the context menu too.

## 7. P0 — browse the Depot

- [ ] **List depot roots.** A read-only scoped directory/file browser exists; a dedicated depot-roots endpoint does not yet.
  - CLI: <code>p4 depots</code>.
  - Display local, stream, spec, remote, archive, unload, and graph types with clear limitations.

- [ ] **Lazy Depot Tree.**
  - CLI: <code>p4 dirs</code>, <code>p4 files</code>, scoped <code>p4 fstat</code>.
  - Support a deleted-at-head toggle, permission-denied branches, and server maxresults.

- [ ] **Depot file inspector.**
  - CLI: <code>p4 fstat</code>, <code>p4 filelog</code>, <code>p4 print</code>.
  - Head revision/type/change, size/digest, workspace mapping, have status, open/lock users, and last submit.

- [ ] **Depot ↔ Workspace navigation.**
  - CLI: <code>p4 where</code>.
  - If the path is not mapped, show the reason and an Edit workspace mapping action instead of a false local path.

- [ ] **Work with unmapped depot files.**
  - Preview/print/history are available without mapping when permissions allow.
  - Sync/edit requires a mapped target; the UI offers an intentional workspace edit or another workspace.

- [ ] **Search for a file in the depot.**
  - CLI: <code>p4 files</code> and scoped patterns; <code>p4 fstat -F</code> for metadata filters.
  - Do not launch an unbounded <code>//...</code> query without user scope, debounce, cancellation, and a limit.

## 8. P0 — daily file operations

### 8.1 Retrieve files

- [ ] **Sync latest for selected files/folders/workspace.**
  - A server-backed `p4 sync -n` preview, `p4 diff -sa/-se` local-modified preflight, explicit acknowledgement before safe apply, list refresh, and a separate cancellable sync operation with progress/failure diagnostics are implemented; parallel transfer and advanced target modes are not yet implemented.
  - CLI: preview with <code>p4 sync -n</code>, apply with <code>p4 sync</code>, safe mode <code>-s</code>, and optional parallel transfer.
  - Preview shows add/update/delete, bytes, locally modified files, and possible resolves.
  - Force sync is never the default.

- [ ] **Sync to a changelist/date/label/revision.**
  - CLI: revision specifiers in <code>p4 sync</code>.
  - The UI distinguishes “retrieve historical content” from “create a rollback.”

- [ ] **Get Revision for a file or folder.** Preview/apply through `sync -n`/`sync` with depot scope and a numeric revision is implemented; server-backed safety checks and a complete target picker remain extensions.
  - CLI: <code>p4 sync path#rev</code> or another selected revSpec.
  - Before execution, show affected files and local changes; after sync, refresh have/head.

- [ ] **Network estimate and parallel settings.**
  - CLI: <code>p4 sync -N</code>, <code>--parallel=threads=N,...</code>.
  - Use parallel only with server support and within user/admin limits; do not fabricate speed/ETA without data.

### 8.2 Open and modify

- [ ] **Open for edit / Check out.**
  - Batch `p4 edit -c` from WorkspaceView is implemented for selected depot paths; mapping/lock preflight and a complete destination picker remain.
  - CLI: batch <code>p4 edit -c change</code>, optional file type.
  - Select the destination changelist and check mapped/have/otherOpen/lock state.

- [ ] **Mark for add.**
  - Batch `p4 add -c` for selected mapped paths is implemented; P4IGNORE/untracked discovery remains incomplete.
  - CLI: batch <code>p4 add -c change</code>, P4IGNORE-aware preview.
  - Support special characters through a correct file argument, not shell escaping.

- [ ] **Mark for delete.**
  - Batch `p4 delete -c` for selected mapped paths is implemented; a separate missing-file preview remains.
  - CLI: <code>p4 delete -c change</code>.
  - Preview explains deletion of the workspace file and the future depot revision; a locally missing file is handled separately.

- [ ] **Move/Rename a file or folder.**
  - CLI: <code>p4 move -c change</code>; preview an offline rename through <code>p4 reconcile -n -M</code>.
  - Check mapping, case-only rename, target collision, and partial directory results.

- [ ] **Change file type/modifiers.**
  - CLI: <code>p4 reopen -t type</code>.
  - The UI validates text/binary/unicode/symlink and modifiers +l, +w, +x, +S; destructive storage changes are marked advanced.

### 8.3 Reconcile and clean

- [ ] **Reconcile preview.**
  - Typed `preview_reconcile` and an apply command using `p4 reconcile -c` exist; the UI shows candidates and lets users select a subset.
  - CLI: <code>p4 reconcile -n</code> or <code>p4 status</code>.
  - Groups: add, edit, delete, move pair, ignored, and unsafe/unknown.
  - The user selects a subset and destination changelist.
  - The UI now shows the full preview, lets users deselect a subset, and applies only selected paths; ignored/move/unsafe grouping and repeated stale validation remain incomplete.

- [ ] **Apply reconcile.**
  - CLI: <code>p4 reconcile -c</code> with selected <code>-a/-e/-d/-M/-t</code> flags.
  - Applying selected paths through `reconcile -c` is implemented; before apply, `reconcile -n` repeats for every selected path, a stale preview is classified as a conflict, and the mutation does not launch.
  - Before apply, the preview must be revalidated or explicitly considered stale.

- [ ] **Clean workspace.**
  - CLI: <code>p4 clean</code> or destructive <code>p4 reconcile -w</code>.
  - P2 for discoverability despite a P0 backend requirement: the action is destructive and requires a complete preview and typed scope.
  - Do not conflate it with ordinary Revert.

### 8.4 Revert

- [x] **Revert selected opened files from a changelist.**
  - Current implementation: batch <code>p4 revert -c</code>, confirmation, and optional <code>-w</code>.

- [ ] **Revert unchanged.**
  - CLI: <code>p4 revert -a</code> in the selected changelist/scope.
  - Preview shows only unchanged files and does not affect real edits.
  - A `p4 revert -n -a -c` preview and explicit `p4 revert -a -c` apply for the selected changelist are implemented; an empty preview blocks apply.

- [ ] **Revert an entire changelist with a server-backed preview.** A `revert -n -c` preview with the complete file list and confirmation before apply is implemented; partial selection and compensation remain separate extensions.
  - Obtain the complete affected list, unresolved/locks/adds, and local consequences before launch.
  - The shelf is not deleted and is shown as a retained server copy.

- [ ] **Revert after another user's submit / admin workflow.**
  - Not part of the ordinary P0 UI; do not use <code>-C</code>/<code>-f</code> without a separate P2 feature and permission check.

## 9. P0 — changelists and submit

### 9.1 List and details

- [x] **Default and numbered pending changelists for the current workspace.**
- [x] **Opened and shelved sections remain separate.**
- [x] **Create/edit description/delete an empty changelist.**
- [x] **Move one, several, or all opened files.**

- [ ] **Show the complete changelist spec.**
  - CLI: <code>p4 change -o</code>, <code>p4 fixes -c</code>, <code>p4 opened -c</code>.
  - Fields: owner, client, status, public/restricted type, date, jobs, stream spec, files, and shelf access time.

- [ ] **Pending-change filters.** The local Changes filter supports ID/description/user/client and keeps the currently selected CL visible during filtering.
  - Own/current workspace by default; optionally all accessible by user/workspace/path/status.
  - Restricted-changelist limitations are displayed correctly.

- [ ] **Change owner/workspace handoff.**
  - CLI: <code>p4 change -o/-i</code> form and permitted <code>-U</code> variants.
  - Preflight accounts for opened files, shelf, permissions, and commit-edge location.

- [ ] **Public/restricted.**
  - CLI: <code>p4 change -t public|restricted</code>.
  - The UI explains who can see the description and shelf; it does not promise confidentiality beyond protections.

### 9.2 Submit review

- [ ] **Server-backed submit preflight.**
  - Check the opened list, <code>p4 resolved</code>/<code>p4 resolve -n</code>, have/head through fstat, locks/otherOpen, missing files, jobs, and stream spec.
  - Server validation remains final; a race after preview is handled with a precise error.
  - Preflight through opened + fstat + scoped `resolve -n` + bounded `fixes -c` + client spec is implemented: complete lists of missing, unresolved/pending-resolve, out-of-date, and active other-open/lock issues, plus jobs, stream, and total size are shown in SubmitDialog; repeated explicit confirmation is required before submit.

- [ ] **Submit review screen.**
  - Description, workspace, stream, grouped files, total size, jobs, unresolved, out-of-date, locks, warnings.
  - The primary button names the file count and does not hide the local/shelf mode.

- [x] **Submit a default or numbered local changelist.**
  - CLI: <code>p4 submit -d</code> or <code>p4 submit -c</code>.

- [x] **Submit a shelf.**
  - CLI: <code>p4 submit -e</code>; local files are retained in a recovery changelist.

- [x] **Explicit local+shelf strategies.**
  - Submit the shelf while retaining local work; delete the shelf and submit local work; update the shelf and submit local work.

- [ ] **Progress/cancel/unknown-result handling.**
  - Submit runs through the Operations Center.
  - After cancellation/network loss, do not assume rollback: reread change/describe/opened and report submitted, pending, or unknown.
  - An operation slice exists for Sync and ordinary local submit: operation ID, started/progress/completed/failed/cancelled events, cancellation of its own child process, and mandatory refresh after every terminal outcome. Submit failures additionally perform a best-effort pending/submitted/unknown read-back and refresh Changes; shelf-preserving submit modes and a unified Operations Center remain ahead.

- [ ] **Parallel submit capability.**
  - Use server-supported parallel submit/shelve only after a capability check; expose an advanced setting rather than a hard-coded flag.

- [ ] **Edit submitted description/type/jobs.**
  - CLI: user-permitted <code>p4 change -u</code> / form.
  - A separate action with an audit-friendly summary; do not change files or owner without admin rights.

## 10. P0/P1 — shelves

- [x] **List own shelves in the current workspace and lazily load files.**
- [x] **Shelve selected, update all, optionally revert local work.**
- [x] **Unshelve selected/all into the selected changelist.**
- [x] **Safe collision preview for shelved add.**
- [x] **Delete selected/all shelved files.**
- [x] **Diff shelf ↔ head and shelf ↔ local.**

- [ ] **Shared Shelves screen.** **P1** — partial: a dedicated screen shows server shelves, files, target changelist, and preview/apply unshelve; conflicting files default to Skip, explicit per-file Overwrite uses `-f`, and shelf export remains.
  - CLI: <code>p4 changes -s shelved</code>, filters owner/user/client/path/date; <code>p4 describe -S</code>.
  - Show accessible shelves owned by others, restricted/permission states, and origin server.

- [ ] **Unshelve preview for every conflict type.** **P0** — partial: shelved-add/local collisions return as a complete list with per-file Skip/Overwrite; conflict types beyond add and richer server diagnostics remain.
  - Cover more than an untracked collision for add: opened target, already shelved/opened revisions, resolve requirement, mapping, and write permissions.

- [ ] **Export shelved content without unshelving.** **P1** — partial: the shared Shelves screen exports one selected file through `p4 print -q path@=change` to a new output path without overwrite; batch export and a native picker remain.
  - CLI: <code>p4 print path@=change</code> and safe Save As.
  - Do not write outside the file/folder selected by the user.

- [ ] **Reshelve/copy shelf.** **P1** — partial: selected files can be copied explicitly to an existing target shelf through `p4 reshelve -s -c`; the source shelf is unchanged, while promoted/force variants remain.
  - CLI: <code>p4 reshelve -s source -c target</code>; retain the source shelf.
  - Use collision overwrite <code>-f</code> only for explicitly selected paths.

- [ ] **Promoted shelves and edge topology.** **P2**
  - CLI: <code>p4 shelve -p</code> or <code>p4 reshelve -p</code> according to supported semantics.
  - Show local/promoted origin; the action appears only on edge/commit topology.

- [ ] **Shelf stream spec.** **P2**
  - Show, diff, shelve/unshelve/submit an opened stream spec separately from the file shelf.

- [ ] **P4 Code Review action.** **P2**
  - Show Create/Update Review only when the integration is configured; the core shelf workflow does not depend on Swarm/P4 Code Review.

## 11. P0 — changelist history for a project, folder, and file

### 11.1 Submitted history

- [ ] **History for the selected project/folder/file path.**
  - CLI: <code>p4 changes -s submitted -l -t path/...</code>.
  - Scope is always visible: selected folder, depot/client/local path, and include subfolders.
  - This is a required workflow separate from global server history.
  - A submitted-history mode with visible depot scope, explicit `Load more`, and an increasing `-m` limit up to 5000 is implemented; local search by number/user/client/description and user/client filters exist, while complete cursor/server filters and a folder tree remain incomplete.

- [ ] **Global submitted history.**
  - CLI: <code>p4 changes -s submitted</code> with <code>-m</code> and user/client/time/path/revision filters.
  - Incremental loading/pagination, not a fixed invisible limit of 200.

- [ ] **History filters.**
  - Changelist number/range, user, workspace, description text, path, date range, stream, jobs, has integrations.
  - Saved recent filters and a clear server-side/client-side distinction.

- [ ] **Submitted changelist details.**
  - CLI: <code>p4 describe -s change</code>, optional diffs through <code>p4 describe -du</code>, and jobs/fixes.
  - Show author, client, time, description, type, files/actions/revisions, stream spec, jobs, and integrations.
  - Lazy `describe -s` for the selected CL is implemented with user/client/time/description, jobs, and affected files/actions/revisions; stream spec/integrations remain incomplete.

- [ ] **Inline diff for changelist files.**
  - CLI: <code>p4 describe</code> or per-file <code>p4 diff2 path#rev-1 path#rev</code>.
  - Lazily load the selected file's diff instead of the entire large change.
  - A lazy per-file `diff2` button for numeric revisions exists in submitted-change details; special revision forms and binary presentation remain separate tasks.

- [ ] **Compare two changelists or folder states.**
  - CLI: <code>p4 diff2 path@changeA path@changeB</code> or a file-pair list.
  - Summarize added/changed/deleted/type-changed; a folder diff does not pretend to be one text diff.

### 11.2 Actions from history

- [ ] **Get revisions for files in a changelist.**
  - CLI: scoped <code>p4 sync file@change</code>.
  - Unlike P4V, P4FNV must always show Preview and Cancel before force/sync.

- [ ] **Create a rollback for a submitted change.**
  - CLI: preview <code>p4 undo -n @change</code>, apply <code>p4 undo -c target @change</code>.
  - The result is new opened changes; the original change remains in history.
  - Preview/apply from HistoryView with a required target changelist and explicit confirmation is implemented; a live-server smoke test has not yet run.

- [ ] **Roll back a range.**
  - CLI: <code>p4 undo -n/apply path@from,@to</code>.
  - Direction and included revisions must be shown explicitly.

- [ ] **Transfer a change to another stream/changelist.**
  - Navigate to the cherry-pick/integrate workflow; do not execute it immediately from a context menu.

## 12. P0/P1 — file history, compare, preview, and Revision Graph

### 12.1 File history

- [ ] **List file revisions.** **P0**
  - CLI: <code>p4 filelog -l -t</code>, optionally <code>-i</code> and <code>-s</code>.
  - Fields: rev, action, change, author, client, time, type, size, description, integrations, and labels.
  - Have/head use separate badges.
  - A read-only `HistoryView` is implemented with `filelog -i -l -t -m`, a limit up to 5000, explicit Load more, rev/action/change/user/time/type/description/client/size/labels, and integration records.

- [ ] **History for a deleted/moved file.** **P0**
  - Follow rename/integration records and show file-name history and content history as separate modes.

- [ ] **Preview an arbitrary revision.** **P0**
  - CLI: <code>p4 print -q path#rev</code>, with a size limit and streaming.
  - Text/image/binary fallback; preview does not change the have list or workspace.
  - A read-only text preview through `p4 print -q path#rev` with the shared 2 MiB diff limit is implemented; binary/image fallback and streaming remain.

- [ ] **Save revision as/export.** **P1** Saving `p4 print -q path#rev` to an explicitly specified new path without implicit overwrite is implemented; a native file picker and file-metadata preservation remain extensions.
  - CLI: <code>p4 print -o</code> or stdout safely written to the selected path.
  - Preserve file type/permissions where supported and warn about symlink/charset behavior.

### 12.2 Compare

- [ ] **Revision ↔ previous.** **P0** A separate History action compares the selected numeric revision with its predecessor through `diff2`.
  - CLI: <code>p4 diff2 -du path#N-1 path#N</code>.

- [ ] **Two selected revisions.** **P0**
  - CLI: <code>p4 diff2</code>; select two rows without drag-only UX.
  - Selecting two rows and comparing them through `p4 diff2 -du` is implemented; the inline viewer remains the basic text viewer.

- [ ] **Revision ↔ workspace.** **P0** — partial: a History action compares the selected revision with the current workspace through <code>p4 diff -du path#rev</code>; a richer three-pane viewer remains.
  - CLI: <code>p4 diff</code> with a revision spec, or temporary print plus an internal viewer where CLI semantics require it.

- [ ] **Revision ↔ shelf/head/another path.** **P1**
  - CLI: <code>p4 diff2</code> and shelf revision <code>@=change</code>.

### 12.3 Annotate and graph

- [ ] **Blame/Annotate.** **P1** — partial: History runs bounded, text-first <code>p4 annotate -c -u</code> and shows changelist/user/date per line; click-through to a changelist, binary handling, and a richer large-file fallback remain.
  - CLI: <code>p4 annotate -c -u</code>, optional <code>-i</code>, whitespace modes.
  - Clicking a line opens the changelist/revision; large files and server maxsize produce an explicit fallback.

- [ ] **Time-lapse style view.** **P2**
  - Synchronize content, annotate, and the revision slider; do not launch N separate print calls without caching/limits.

- [ ] **Revision Graph.** **P1**
  - Data: <code>p4 filelog -i</code>, integration records through filelog/integrated.
  - Show add/edit/branch/merge/copy/move/delete/undo and contributing ranges.
  - Zoom/pan/filter/focus, navigation to a changelist, and compare; the graph must not fabricate relationships.

## 13. P1 — streams and Stream Graph

### 13.1 Streams catalog

- [ ] **List/tree streams.**
  - CLI: <code>p4 streams</code> with filter/max/fields.
  - Fields: Stream, Parent, Type, ParentView, Owner, Description, Options, firmerThanParent, and deleted/unloaded.

- [ ] **Stream details/spec.**
  - CLI: <code>p4 stream -o</code>, <code>p4 streamlog</code>.
  - Show Paths, Remapped, Ignored, View, change history, and associated workspaces.

- [ ] **Search/filter streams.**
  - Name, owner, type, parent, depot, path view match.
  - Required ancestors remain muted instead of disappearing from the hierarchy.

### 13.2 Stream Graph

- [ ] **Hierarchical parent/child graph.**
  - Mainline/development/release/task/virtual/sparse types use shape plus label, not color alone.
  - Tree and graph synchronize selection; the current-workspace marker is visible in both.

- [ ] **Merge/copy hints.**
  - CLI: <code>p4 istat</code> for the parent relationship, <code>p4 interchanges</code> for changes/files.
  - Separate Files Only, Stream Spec Only, and Both where server configuration supports them.

- [ ] **Graph navigation.**
  - Zoom/pan, focus selected stream, minimap when needed, and saved filters.
  - Do not draw the Stream Graph as a Git commit DAG.

### 13.3 Stream lifecycle

- [ ] **Create a stream.**
  - CLI: <code>p4 stream -o/-i</code>.
  - Templates/default flow rules; validate depot depth and parent/type constraints.

- [ ] **Edit/open stream spec.**
  - Support private edit/opened stream spec, changelist association, revert, resolve, and submit.

- [ ] **Reparent/delete a stream.**
  - Preview the effect on views, child streams, open workspaces, and pending integration.
  - Delete and obliterate are distinct actions; obliterate does not belong in the ordinary user UI.

- [ ] **Create/switch workspace for stream.**
  - Explicitly offer an existing compatible workspace or creation of a new one.
  - Do not promise Git-like branch checkout when a server client spec is required.

## 14. P1 — merge, copy, and cherry-pick

### 14.1 Shared integration preflight

- [ ] **Explicit source and target.**
  - Source on the left, target workspace/stream on the right, a directional arrow, and complete paths.
  - The target must be mapped in the current workspace.

- [ ] **Server-generated preview.**
  - CLI: <code>p4 integrate -n</code>, <code>p4 copy -n</code>, or the corresponding stream syntax.
  - Summary: branch/integrate/delete/move, already integrated, needs resolve, permissions.

- [ ] **Pending interchanges.**
  - CLI: <code>p4 interchanges</code>, with <code>-S</code> for streams.
  - Show fully/partially integrated changelists and affected files.

- [ ] **Apply into a separate changelist.**
  - CLI: <code>p4 integrate -c</code>/<code>p4 copy -c</code>.
  - Never submit automatically; the result passes through Resolve → Review → Submit.

### 14.2 Merge down / copy up

- [ ] **Merge down parent → child.**
  - Respect stream flow rules and <code>p4 istat</code>.
  - The UI explains why merge down is required before copy up.

- [ ] **Copy up child → parent.**
  - Use copy semantics instead of hiding them under the generic word merge.
  - Preview shows that source content replaces the target for selected revisions.

- [ ] **Merge/copy stream spec separately from files.**
  - CLI: <code>-As</code>/<code>-Af</code> variants according to the command and server configuration.
  - If both are needed, they are two explicitly tracked operations.

### 14.3 Cherry-pick

- [ ] **Transfer one submitted changelist.**
  - CLI: integration constrained to a source revision range/change.
  - Already integrated revisions are excluded by default.

- [ ] **Transfer selected files/revisions.**
  - The user sees that a partial transfer can alter integration history.
  - Source/target mapping is validated by a server preview.

- [ ] **Transfer a sequence of changelists.**
  - Preserve an understandable order and show conflicts at each stage or in a combined preview.
  - Report partial success as separate results, not one green toast.

### 14.4 Classic branch maps

- [ ] **List/view branch specs.** **P2**
  - CLI: <code>p4 branches</code>, <code>p4 branch -o</code>.

- [ ] **Integrate through a branch map.** **P2**
  - CLI: <code>p4 integrate -b</code>, <code>p4 interchanges -b</code>.
  - Free-form manual mapping is edited as a form workflow with preview.

## 15. P0/P1 — resolve conflicts

### 15.1 Detection

- [ ] **List unresolved files.** **P0**
  - CLI: <code>p4 resolve -n</code>, <code>p4 resolved</code>, fstat resolve fields.
  - Distinguish content, filetype, filename/move, attribute, branch, and stream-spec resolve.
  - Workspace shows unresolved status, first runs a preview through `p4 resolve -n`, then offers confirmed batch actions Keep workspace (`-ay`) / Accept server (`-at`) / Auto-safe (`-as`) / Auto-merge (`-am`); three-way detail and other resolve types remain incomplete.

- [ ] **Resolve gate before submit.** **P0** — submit is blocked by unresolved files after preflight; shelving remains available to preserve work.
  - Submit is disabled with the exact unresolved count and navigation to the list.

### 15.2 Text resolve

- [ ] **Three-way merge UI.** **P0**
  - Base, theirs/source, yours/workspace, and editable result.
  - Linked scroll, syntax highlighting, hunks, previous/next conflict, save/validate.

- [ ] **Safe accept actions.** **P0**
  - CLI: preview with <code>p4 resolve -n</code>, then <code>p4 resolve -ay/-at/-as/-am</code> only after explicit selection; <code>-ae</code> remains incomplete.
  - Buttons name the content: “Keep workspace” / “Use //source,” not bare yours/theirs.

- [ ] **Auto resolve non-conflicting.** **P1** — partial: Workspace offers explicit preview/confirmation actions for <code>p4 resolve -as/-am</code> over the selected scope; granular result classification and richer conflict details remain.
  - Conflicting files remain unresolved and are all listed.

### 15.3 Binary, move, and stream-spec resolve

- [ ] **Binary resolve.** **P0**
  - Metadata, size, author, revision, and an available image preview; choose one side or an external tool.
  - Do not show an empty text editor.

- [ ] **Move/filename resolve.** **P1**
  - Show source/target names, mapping, and collision; semantics are distinct from content merge.

- [ ] **File type/attribute resolve.** **P1**
  - Fully describe applied modifiers/attributes.

- [ ] **Stream spec resolve.** **P1**
  - CLI: <code>p4 stream resolve</code> / supported <code>p4 resolve -So</code> form.
  - Diff Paths/Remapped/Ignored and the inherited view.

- [ ] **External merge tools.** **P1**
  - P4MERGE/P4DIFF settings or an explicitly configured tool with safe separate arguments.
  - After the tool returns, the application checks server resolve state.

## 16. P1 — locks and collaboration

- [ ] **Show otherOpen and otherLock.**
  - CLI: <code>p4 fstat</code> fields and <code>p4 opened -a</code> in scoped requests.
  - User, workspace, changelist, and server origin.

- [ ] **Lock selected opened files.**
  - CLI: <code>p4 lock -c change files</code>.
  - Do not conflate an explicit lock with exclusive file type <code>+l</code>.
  - A basic batch command for selected opened files is implemented; explicit `+l` distinction and topology-aware global locks remain incomplete.

- [ ] **Unlock own files.**
  - CLI: <code>p4 unlock -c</code>, with shelf unlock in a valid state.
  - Force/admin flags do not appear in the ordinary UI.
  - A basic batch command for selected opened files is implemented; shelf unlock and topology details remain incomplete.

- [ ] **Global locks in commit-edge.**
  - CLI: <code>p4 lock -g -c</code>; capability/topology check.
  - Show local/global status and a precise error when the commit server is unavailable.

- [ ] **Contact/open user details.**
  - CLI: <code>p4 user -o</code> for available public information.
  - Do not expose more data than the server returns or policy allows.

## 17. P1/P2 — jobs and fixes

- [ ] **List/search jobs.** **P1** — partial: a bounded Jobs browser uses <code>p4 jobs -l -m</code> with server-side text search and local filters.
  - CLI: <code>p4 jobs</code>, server-defined job fields.
  - Do not hard-code only the standard jobspec; the schema may be custom.

- [ ] **Job details and create/edit.** **P2**
  - CLI: <code>p4 job -o/-i</code>, jobspec-aware form.

- [ ] **Attach/detach jobs to a numbered changelist.** **P1** — partial: the Jobs inspector supports explicit attach/detach through <code>p4 fix -c</code>/<code>p4 fix -d -c</code> and read-back through <code>p4 fixes -c</code>.
  - CLI: <code>p4 fix -c</code>, <code>p4 fix -d -c</code>, <code>p4 fixes -c</code>.
  - Default-changelist jobs are added through the submit form, not a false <code>p4 fix</code>.

- [ ] **Submit job status.** **P1** — partial: submit preflight shows up to 100 linked jobs with available status/user/date and a backward-safe ID fallback; a dedicated jobs browser and richer metadata remain shared tasks.
  - Support server-defined statuses and the special same value; show the future status before submit.

- [ ] **History by job/path.** **P2** — path-scoped submitted history and an exact job filter through `p4 fixes -j` are available; richer cross-scope search remains an extension.
  - CLI: <code>p4 fixes</code> with job/change/path filters.

## 18. P1/P2 — labels

- [ ] **List/filter labels.** **P1** — partial: a bounded Labels browser uses <code>p4 labels -t -m</code>, server search, and local name/owner/date/description filters.
  - CLI: <code>p4 labels</code>; owner/name/date/path filters and pagination.

- [ ] **Label details.** **P1** — partial: the inspector shows owner/update/description and bounded files through <code>p4 files //...@label</code>.
  - CLI: <code>p4 label -o</code>, files via <code>p4 files @label</code>.
  - Distinguish automatic and static labels, locked/unlocked, and autoreload.

- [ ] **Sync workspace to a label.** **P1** — partial: preview/apply uses <code>p4 sync -n/-s //...@label</code>, modified acknowledgement, progress, and cancellation.
  - CLI: preview/execution <code>p4 sync @label</code>.
  - Use the same safe sync preflight as for a changelist/revision.

- [ ] **Create/edit/delete label.** **P2**
  - CLI: <code>p4 label -o/-i/-d</code>.
  - View/Revision validation and permissions.

- [ ] **Tag/untag revisions.** **P2**
  - CLI: <code>p4 tag</code> or <code>p4 labelsync</code>.
  - Complete preview, especially for operations that remove old tags.

## 19. P0/P1 — diff, preview, and external tools

- [x] **Basic unified text diff for local/head/shelf.**

- [ ] **Built-in production diff viewer.** **P0** — partial: the shared `DiffViewer` is used by Changes/History/Depot; richer syntax/image/binary support remains.
  - Unified/split, line/word highlighting, collapse unchanged, expandable context, file/hunk navigation, sticky header.

- [ ] **Whitespace and line-ending modes.** **P0**
  - CLI options <code>-db/-dw/-dl</code> or consistent internal rendering.
  - The active non-default mode is always visible.
  - `-db`, `-dw`, and `-dl` selectors are implemented in Changes/History diff actions; a split viewer and persistent mode remain separate extensions.

- [ ] **Large text diff.** **P0**
  - Streaming/chunking, cancellation, and a clear fallback instead of silent truncation.
  - The current 2 MiB limit remains a safeguard, but the user must be able to open an external diff.

- [ ] **Image diff.** **P1**
  - Side-by-side, overlay opacity, blink, actual size/fit, alpha checkerboard, and dimensions/format/size.

- [ ] **Binary metadata/preview.** **P0** — partial: the backend recognizes binary markers/null bytes and the viewer shows a safe state; complete binary metadata/preview remains.
  - Never decode binary as text; show type, size, digest/revision, and Open externally.

- [ ] **3D/asset preview.** **P3**
  - Only after a stable image/binary contract; the renderer is size-bounded and does not block the UI.

- [ ] **External editor/diff/merge configuration.** **P1**
  - Executable and argument templates are validated and launched without a shell.
  - Workspace/depot temporary files have an explicit lifecycle and cleanup.

## 20. P0/P1 — search, navigation, and productivity

- [ ] **Global Go To.** **P0** — partial: the header accepts a depot path, `ws://` workspace scope, changelist number, `job:`, and `label:` and routes them to the appropriate screen; stream/user targets and entity-specific server lookup remain incomplete.
  - CLI/navigation uses entity-specific screens, not one unbounded global query.

- [ ] **Command palette.** **P1** — partial: `Ctrl/Cmd+K` opens a searchable palette for primary screens and Global Go To; action commands and configurable shortcuts remain.
  - Commands are filtered by current selection/capability; a destructive action opens a preview instead of executing immediately.

- [ ] **Search changelist descriptions.** **P1**
  - Use available server/P4 Search capabilities; otherwise provide an honest bounded client-side search.

- [ ] **Saved filters and recent destinations.** **P1**
  - Per workspace/server; an invalid destination is marked unavailable instead of being silently removed.

- [ ] **Keyboard model.** **P0** — partial: `Ctrl/Cmd+1..6` switches primary screens and `Ctrl/Cmd+L` focuses Global Go To; pane-level navigation and complete shortcut help remain.
  - F5 refresh, Ctrl+F local filter, Enter details, Esc close, F6 panes, Shift+F10 context menu, Ctrl+N changelist, and Ctrl+Enter after submit review.

- [ ] **Reveal/Open/Copy path.** **P0** — partial: workspace, depot inspector, and file history show Copy depot path; workspace also offers Copy local path/Reveal in Explorer through a safe Tauri command, while native Open/editor actions remain.
  - Reveal in Explorer, Open in configured editor, Open terminal in current P4 environment, copy depot/client/local path separately.

## 21. P0 — Operations Center, reliability, and safety

- [ ] **Unified registry for long-running operations.**
  - Sync, submit, fstat/history, print/export, reconcile, integrate, and resolve receive an operation ID.

- [ ] **Event stream.**
  - Started, progress, warning, completed, failed, cancelled; current file and processed count without credentials.
  - Use real CLI progress (<code>p4 -I</code>) or records; do not fabricate percentages.

- [ ] **Cancel.**
  - Terminate only the specific child process.
  - After cancellation, reread server/workspace state; process cancellation does not mean already transferred files were rolled back.

- [ ] **Retry.**
  - Retry repeats only an idempotent read or a newly confirmed mutation flow.
  - Submit/integrate are not repeated automatically after an unknown result.

- [ ] **Partial success.** — the unshelve normal/force partition already classifies a force-batch failure after a successful normal batch as `partial_result`; shared recovery UI and read-back for all mutations remain.
  - The result contains succeeded/failed/skipped items and the compensation outcome.
  - The UI does not hide successfully changed files because of one error record.

- [ ] **Stale/offline mode.**
  - Last-known data remains visible with a Stale badge; mutations are disabled with a reason.
  - Connection recovery triggers a controlled refresh instead of resetting the entire UI.

- [x] **Session CLI log.**
  - Warnings/errors, timestamps, details, and clear already exist.

- [ ] **Extended error taxonomy.**
  - Add conflict, cancelled, timeout/offline, unsupported, partial_result, and validation.
  - Technical diagnostics are separate from localized user-facing text.

- [ ] **Unicode and non-UTF-8 paths.**
  - <code>-Mj</code> may replace invalid UTF-8 with U+FFFD; such a display path cannot be used as a mutation ID.
  - Until a safe round trip exists, a suspicious path is read-only with a warning.

- [ ] **Case-sensitive/case-insensitive correctness.**
  - Stable IDs and selection respect server case handling and filesystem semantics.
  - Case-only rename has a separate tested flow.

- [ ] **Permission-aware UI.**
  - Do not try to fully compute protections on the client; the server is the source of truth.
  - Known-disallowed actions are hidden/disabled, and race/trigger refusal is reported precisely.

## 22. P0 — settings, accessibility, and scale

- [x] **RU/EN and external language packs.**

- [ ] **Settings sections.**
  - Connections, Language, Perforce executable/environment, Appearance/density, Diff/Merge, External tools, Notifications, Shortcuts, and Diagnostics/privacy.

- [ ] **Light/Dark/System and compact/comfortable.**
  - Tokens are tested on real trees/tables/diffs and for WCAG contrast.

- [ ] **Persistent view preferences.**
  - Pane sizes, collapsed state, column visibility/order/width, sort, tree/list, diff mode, and filters per view/workspace.

- [ ] **Complete keyboard accessibility.**
  - Logical tab/arrow model, focus restoration, visible focus, no drag-only action.

- [ ] **Screen reader contract.**
  - Roles/selected/expanded/busy, operation/error announcements, and accessible diff additions/deletions.

- [ ] **200% scale and minimum window size.**
  - The inspector becomes a drawer, actions do not disappear, and context menus stay in the viewport.

- [ ] **Virtualization and incremental data.**
  - Large changelists/history/file lists/streams; selection and screen-reader semantics remain intact.

- [ ] **Server limits.**
  - Maxresults/maxscan/maxlocktime and truncated output are recognized as partial results with an option to narrow the filter.

- [ ] **Focus refresh without polling.**
  - Implemented for Changes; extend to Workspace, History, Streams, and Shelves with throttling and selection preservation.

## 23. P2/P3 — advanced but nonessential daily capabilities

- [ ] **P4 Code Review integration.** Review create/update/open status/comments only when an endpoint is configured.
- [ ] **File attributes.** View and permitted editing through <code>p4 attribute</code>; binary attributes require a size-safe path.
- [ ] **Graph/hybrid depot read-only browsing.** Account for the limited Git Connector metadata model and workspace type.
- [ ] **Remote/DVCS workflows.** <code>p4 clone/fetch/push/pull/remotes</code> are a separate product mode, not part of the classic-server MVP.
- [ ] **Personal server stream switching.** <code>p4 switch</code> with automatic shelves requires a separate capability contract.
- [ ] **Spec depot browsing.** Read-only access to versioned specs; editing remains entity-specific.
- [ ] **Archive/unload visibility.** Clear placeholders and a reload request; ordinary users do not launch admin archive commands.
- [ ] **Custom tools.** Configurable allow-listed commands with explicit arguments; no general shell console from the frontend.
- [ ] **P4 Search integration.** Optional acceleration of description/content search with graceful fallback.

## 24. P4 CLI command matrix

### Already invoked by the current code

| Area | Commands |
|---|---|
| Tool/connection | <code>p4 -V</code>, <code>p4 info</code>, <code>p4 login -s</code> |
| Workspaces | <code>p4 clients</code> |
| Pending changes | <code>p4 changes</code>, <code>p4 opened</code>, <code>p4 change -o/-i/-d</code>, <code>p4 reopen</code> |
| Shelves | <code>p4 files @=change</code>, <code>p4 shelve</code>, <code>p4 unshelve</code>, <code>p4 where</code> |
| Diff | <code>p4 diff</code>, <code>p4 diff2</code> |
| Revert/submit | <code>p4 revert</code>, <code>p4 submit</code> |

### Required for P0

| Area | Commands |
|---|---|
| Auth/trust | <code>login</code>, <code>login2</code>, <code>logout</code>, <code>trust</code> |
| Workspace | <code>client -o/-i</code>, <code>where</code>, <code>clients</code> |
| Project/depot browser | <code>depots</code>, <code>dirs</code>, <code>files</code>, <code>fstat</code>, <code>have</code>, <code>cstat</code> |
| File lifecycle | <code>sync</code>, <code>edit</code>, <code>add</code>, <code>delete</code>, <code>move</code>, <code>reopen</code>, <code>revert</code>, <code>reconcile</code>, <code>status</code> |
| History/content | <code>changes</code>, <code>describe</code>, <code>filelog</code>, <code>print</code>, <code>diff</code>, <code>diff2</code>, <code>undo</code> |
| Resolve | <code>resolve</code>, <code>resolved</code> |

### Required for P1/P2

| Area | Commands |
|---|---|
| Streams | <code>streams</code>, <code>stream -o/-i</code>, <code>streamlog</code>, <code>istat</code>, <code>switch</code> |
| Integration | <code>integrate</code>, <code>copy</code>, <code>merge</code> where applicable, <code>interchanges</code>, <code>integrated</code>, <code>branch/branches</code>, <code>populate</code> |
| Shelves/topology | <code>reshelve</code>, promoted shelf flags, <code>topology</code> |
| Collaboration | <code>lock</code>, <code>unlock</code>, <code>user -o</code> |
| Jobs | <code>jobs</code>, <code>job -o/-i</code>, <code>fix</code>, <code>fixes</code>, <code>jobspec -o</code> |
| Labels | <code>labels</code>, <code>label -o/-i</code>, <code>tag</code>, <code>labelsync</code> |
| Analysis | <code>annotate</code>, <code>grep</code> for bounded search |

## 25. Recommended implementation order

### Milestone A — a genuinely usable workspace (P0)

1. Auth/trust/login UI and capability detection.
2. Workspace inspector and safe switching.
3. Workspace tree/list based on <code>p4 fstat</code> with status filters.
4. Depot tree and mapping navigation.
5. Sync preview → progress/cancel → refresh.
6. Edit/add/delete/move and reconcile preview/apply.
7. Operations Center and extended error taxonomy.

Exit criterion: a user can connect on a new machine, retrieve a project, see local state, open/add/delete/move files, update safely, and return to the already implemented changelist-submit workflow.

### Milestone B — history and safe rollback (P0)

1. Path-scoped submitted history.
2. Changelist details and lazy per-file diff.
3. File history, print preview, and revision compare.
4. Get Revision with preview.
5. Undo preview/apply into a new pending changelist.
6. Production diff viewer.

Exit criterion: a user can answer “what changed in this folder/file, by whom, and when,” compare states, and perform get/rollback without ambiguity.

### Milestone C — resolve and reliable submit (P0/P1)

1. Unresolved detection and submit gate.
2. Text/binary resolve.
3. Complete submit preflight.
4. Unknown/partial result recovery.
5. Lock/unlock.

Exit criterion: an ordinary sync conflict and submit race can be resolved within P4FNV without returning to P4V/CLI.

### Milestone D — streams, graph, and integrations (P1)

1. Streams tree/details and compatible workspaces.
2. Stream Graph and istat/interchanges hints.
3. Safe stream switching.
4. Merge down/copy up preview/apply.
5. Cherry-pick submitted changelist/revisions.
6. Resolve filename/stream spec conflicts.

Exit criterion: a stream-based team can complete its primary propagation workflow entirely in P4FNV.

### Milestone E — team extensions (P1/P2)

1. Shared Shelves screen/reshelve/promote.
2. Jobs/fixes.
3. Labels.
4. Annotate/Revision Graph.
5. Global search/command palette.
6. P4 Code Review and optional integrations.

## 26. Required smoke scenarios before marking major milestones

1. Plain and SSL servers; a new fingerprint and a changed fingerprint.
2. Password login, expired ticket, and logout; an available test MFA/SSO setup where possible.
3. Classic workspace with include/exclude/overlay mapping.
4. Stream workspace on a standard server and commit-edge topology.
5. Case-sensitive and case-insensitive servers; Unicode server and non-ASCII paths.
6. Large workspace/changelist with server limits and partial output.
7. Safe sync with a locally modified unopened file; cancel midway.
8. Reconcile add/edit/delete/move with P4IGNORE.
9. Submit success, unresolved, out-of-date, lock conflict, trigger rejection, and network interruption.
10. Shelf-only, local-only, and local+shelf; forced unshelve only for selected collision paths.
11. Undo one change and a range, followed by resolve.
12. Merge down, copy up, and a partially integrated cherry-pick.
13. Text, binary, move, and stream-spec resolve.
14. Restricted changelist/shelf and permission denied for part of the tree.
15. RU/EN, 100/125/200% scale, keyboard-only, and Windows Narrator.

## 27. User stories and scenario test checklists

### 27.1 Purpose of the story catalog

The feature checklist states which capabilities must exist. A user story states which complete task a person can perform and which observable result proves that the task is truly complete.

Every story has a stable identifier. Use that identifier in integration/E2E test names, test plans, bug reports, and release notes. Changing UI text or an internal command must not change the identifier while the user goal remains the same.

Statuses:

- **Available now** — the user path exists in the current UI and backend.
- **Partially available** — part of the path exists, but the user must finish the task in P4V/CLI or does not receive the required guarantee.
- **Target story** — the product needs this workflow, but it is not yet available.

Test labels:

- **UNIT** — pure frontend/Rust logic, parser, validation, or argument builder.
- **FAKE-P4** — process-boundary integration test with a controlled fake executable.
- **LIVE-P4** — disposable P4 Server with real server semantics.
- **UI** — component/E2E or manual desktop test, including keyboard, localization, and visual state.
- **RECOVERY** — failure in the middle of a compound operation, refresh, and verification of actual server state.

A story is not fully verified merely because its individual features are marked [x]. Every applicable test item must link to test code or a recorded test run. LIVE-P4 items are intentionally unchecked in this snapshot because the repository contains no verified live-server matrix.

### 27.2 Personas and primary goals

| Persona | What they need to do | Primary stories |
|---|---|---|
| Developer | Connect, organize changes, inspect diffs, and shelve/revert/submit | US-CON-01…02, US-CHG-01…03, US-DIFF-01, US-SHELF-01…03, US-REVERT-01, US-SUBMIT-01…03 |
| New project member | Select a workspace, retrieve files, and understand status and history | US-CON-01, US-WORKSPACE-01, US-DEPOT-01, US-SYNC-01, US-HISTORY-01 |
| Technical artist | Work with large binary assets, locks, shelves, and safe sync | US-SYNC-01, US-LOCK-01, US-RESOLVE-01, US-DIFF-02 |
| Release/build engineer | Retrieve a state by change/label, transfer a fix, and perform rollback | US-HISTORY-01…02, US-INTEGRATE-01, US-LABEL-01 |
| Stream owner/lead | See the Stream Graph and control merge down/copy up and handoff | US-STREAM-01, US-INTEGRATE-01, US-CHG-04 |
| Edge-server user | Understand shelf/lock origin and partial/unknown results | US-SHELF-04, US-LOCK-01, US-OPS-01 |

### 27.3 Stories available to users now

#### US-CON-01 — open an existing workspace with a valid ticket

**Availability:** available now with limitations: the P4 CLI is installed, the SSL fingerprint is already trusted, and the login ticket is valid.

> As a developer, I want to specify the server, user, and workspace so that I can open my working session and see changes in that workspace.

**Preconditions:**

- The P4 CLI is available in PATH or a full path is specified.
- The workspace exists and is accessible to the user.
- Authentication/trust is already configured by an external P4 tool.

**Main scenario:**

1. The user opens P4FNV.
2. The application finds the P4 CLI and shows its path and version.
3. The user enters P4PORT, P4USER, P4CLIENT, and P4CHARSET when needed.
4. The user can run Test connection and retrieve their workspaces.
5. The user clicks Open workspace.
6. The application runs <code>p4 info</code>, validates the ticket through <code>p4 login -s</code>, and opens My Changes.

**Observable result:** the header shows user/workspace, the sidebar shows the workspace root or stream, and My Changes loads Default, numbered changelists, and opened files.

**Alternatives and errors:** invalid port/user/workspace, a missing executable, and auth, trust, or permission errors remain on the connection screen with technical details; the current UI cannot accept a password.

**Test checklist:**

- [x] UNIT: plain/SSL address, port range, user, and required workspace validation.
- [x] UNIT: executable resolution, info JSON parsing, and non-empty environment fields.
- [ ] FAKE-P4: complete detect → info → login status → workspace open.
- [ ] LIVE-P4: plain server and already trusted SSL server with a valid ticket.
- [ ] UI: RU/EN, keyboard-only form, loading/error/success, and 100/125/200% scale.

#### US-CON-02 — automatically return to the last successfully opened workspace

**Availability:** available now.

> As a regular user, I want to return to my last workspace immediately after launch so that I do not enter the parameters every day.

**Main scenario:**

1. After a successful Open workspace, the application stores a non-secret recent profile.
2. On the next launch, it selects the first complete profile with a workspace.
3. The application revalidates the server and ticket.
4. On success, My Changes opens automatically.
5. Exit workspace returns to the connection form without deleting the profile or logging out.

**Observable result:** no secrets are written to settings; an invalid/expired session does not open the workspace and instead shows the connection screen with an error.

**Test checklist:**

- [x] UNIT: the latest complete profile is selected and an incomplete profile is skipped.
- [x] UNIT: recent profiles are deduplicated, bounded, and pass an atomic settings round trip.
- [ ] FAKE-P4: successful and unsuccessful auto-open after restart.
- [ ] UI: startup state does not flash between connection/workspace or lose the initial error.
- [ ] LIVE-P4: valid and expired tickets.

#### US-CHG-01 — see and understand current local work

**Availability:** available now.

> As a developer, I want to see Default and numbered changelists with separate local and shelved files so that I understand what exists only in the workspace and what is stored on the server.

**Main scenario:**

1. The user opens My Changes.
2. The application loads pending changes, shelved changes, and opened files in parallel.
3. Default always appears first.
4. After selecting a numbered changelist, its shelf loads lazily.
5. Local opened files and the shelf appear in separate sections even for the same depot path.

**Observable result:** action, available revision/type, and LOCAL/SHELF source are not conflated; a shelf-only changelist does not disappear; manual Refresh rereads server state.

**Test checklist:**

- [x] UNIT: Default is always present; unlisted and shelf-only changelists are preserved.
- [x] UNIT: a stale shelf cache is hidden after the shelf disappears from the server.
- [x] UNIT: parser pending/opened/shelved records.
- [ ] FAKE-P4: partial failure of one parallel request.
- [ ] LIVE-P4: empty, local-only, shelf-only, and local+shelf.
- [ ] UI: long paths, empty/loading/permission error, and multi-select visibility.

#### US-CHG-02 — create, rename, and delete an empty changelist

**Availability:** available now for a numbered pending changelist owned by the current user/workspace.

> As a developer, I want to create changelists for separate tasks and maintain clear descriptions.

**Main scenario:**

1. The user clicks New changelist.
2. They enter a non-empty description.
3. The application creates a numbered changelist and selects it.
4. The user edits the description through a context action.
5. An empty changelist without a shelf can be deleted after confirmation.

**Observable result:** the created ID comes from P4 Server; editing preserves the other form fields; the list refreshes after mutation.

**Alternatives and errors:** Default cannot be edited/deleted through this flow; a non-empty changelist or one with a shelf is not offered for empty deletion; the server enforces final invariants.

**Test checklist:**

- [x] UNIT: safe changelist form and created-ID extraction.
- [x] UNIT: replace only Description without losing other form fields.
- [ ] FAKE-P4: create/edit/delete text-form success and malformed response.
- [ ] LIVE-P4: create → edit → delete; server rejection for a non-empty changelist.
- [ ] UI: validation, confirmation, refresh, and selection after deletion.

#### US-CHG-03 — move one or more opened files to another changelist

**Availability:** available now through inspector/context actions and drag-and-drop.

> As a developer, I want to group files by task so that each submit contains only related changes.

**Main scenario:**

1. The user selects one file, toggles a set with Ctrl/Cmd, or selects a Shift range.
2. They select a destination changelist or drag the selection.
3. The application runs one batch <code>p4 reopen -c target paths...</code>.
4. After success, a server refresh shows the files only in the destination.

**Observable result:** the drag cursor shows move; source and target changelists do not duplicate the file; external/corrupted drag payload is ignored.

**Test checklist:**

- [x] UNIT: single/toggle/range selection and removal of IDs that disappear after refresh.
- [x] UNIT: encode/decode internal drag payload, copyMove, and drop intent.
- [x] UNIT: validation of changelist IDs and depot paths.
- [ ] FAKE-P4: one batch reopen with the exact argument set.
- [ ] LIVE-P4: move one/many/all between Default and a numbered CL.
- [ ] UI: mouse, keyboard alternative, drop highlight, and failure without optimistic drift.

#### US-DIFF-01 — inspect a basic local or shelf diff

**Availability:** available now for one selected text file; the viewer is basic.

> As a developer, I want to inspect a file's differences before shelve/revert/submit so that I can review the change's content.

**Available comparisons:**

- Local workspace ↔ have revision through <code>p4 diff -du</code>.
- Shelf ↔ depot head through <code>p4 diff2 -du</code>.
- Shelf ↔ local when the same depot path is open in the workspace.

**Observable result:** text appears in the inspector; a truncation indicator appears above 2 MiB; external P4DIFF does not intercept the built-in request.

**Limitations:** no split view, syntax highlighting, hunk navigation, whitespace modes, image diff, or complete binary fallback.

**Test checklist:**

- [ ] UNIT: truncation boundary, empty/identical diff, and invalid UTF-8 replacement behavior.
- [ ] FAKE-P4: exact diff/diff2 arguments, stdout/stderr, and non-zero exit.
- [ ] LIVE-P4: edit/add/delete, shelf/head, and shelf/local text cases.
- [ ] UI: large/truncated, binary, loading, error, and selection changes while the request runs.

#### US-SHELF-01 — save selected or all local work to a shelf

**Availability:** available now for a numbered changelist.

> As a developer, I want to store a server copy of unfinished work so that I can share it or protect against losing local files.

**Main scenario:**

1. The user selects opened files and starts Shelve, or selects Shelve/Update all.
2. The application runs <code>p4 shelve</code> for the selected set or performs a full replacement.
3. After a successful shelf, local files either remain opened or are reverted, according to the user's choice.
4. Refresh shows a separate shelf section.

**Observable result:** the shelf is a copy and does not replace local state; if revert fails, the user sees that the shelf was updated but local cleanup was not completed.

**Test checklist:**

- [ ] UNIT: selected/replace-all/revert-after argument matrix.
- [ ] FAKE-P4: shelf succeeds and revert fails with the exact partial-result message.
- [ ] LIVE-P4: create shelf, update subset, replace all, shelf then revert.
- [ ] RECOVERY: the shelf is retained after an unsuccessful post-shelf revert.
- [ ] UI: no shelf action exists for Default; confirmation clearly describes what happens to local files.

#### US-SHELF-02 — apply a shelf to a selected changelist without losing conflicting local files

**Availability:** available now; the advanced preflight primarily covers a shelved-add collision with an existing untracked local file.

> As a developer, I want to unshelve selected files into Default or a numbered changelist and decide which local files may be overwritten.

**Main scenario:**

1. The user selects one, several, or all shelved files.
2. They select a target changelist.
3. The application retrieves shelved adds, opened files, and mappings through <code>p4 where</code>.
4. All discovered local collisions appear in one list.
5. Conflicting paths default to Skip.
6. The user can select a subset and assign Overwrite from shelf.
7. Normal paths use regular unshelve; force applies only to the explicitly selected subset.

**Observable result:** the source shelf is retained; the drag cursor shows copy; after refresh, applied files are in the target changelist.

**Test checklist:**

- [x] UNIT: depot → local mapping parser for preflight.
- [x] UNIT: multi-select and drag shelf → changelist use copy semantics.
- [ ] UNIT: normal/force partition does not duplicate paths.
- [ ] FAKE-P4: all collisions returned, Skip default, exact per-subset <code>-f</code>.
- [ ] LIVE-P4: no collision, one/many untracked add collisions, target Default/numbered.
- [ ] RECOVERY: normal batch succeeds, force batch fails; the UI shows the actual partial state.

#### US-SHELF-03 — delete a shelf or selected shelved copies

**Availability:** available now with confirmation.

> As a shelf owner, I want to delete outdated server copies without affecting local opened files.

**Main scenario:** the user selects shelved files or the entire shelf, sees a destructive confirmation, and starts deletion.

**Observable result:** <code>p4 shelve -d</code> receives either the whole change or <code>-Af</code> plus selected paths; the local opened section does not change; after refresh, the shelf disappears only if the server no longer reports it.

**Test checklist:**

- [x] UNIT: distinct syntax for whole/partial shelf deletion.
- [ ] FAKE-P4: warning/error records and permission failure.
- [ ] LIVE-P4: delete selected, delete all, and another user's/restricted shelf.
- [ ] UI: complete affected list and no dangerous action for Default.

#### US-REVERT-01 — revert selected local changes

**Availability:** available now.

> As a developer, I want to revert local opened changes after reviewing their scope so that I can return the workspace to the have revision.

**Main scenario:**

1. The user selects one, several, or all opened files in the changelist.
2. Confirmation lists affected paths and warns about losing local work.
3. For opened-for-add files, the user chooses whether to keep the file on disk or delete it through <code>p4 revert -w</code>.
4. After revert, a server refresh removes the files from the opened section.

**Observable result:** the shelf for the same changelist is not deleted; the delete-added-files setting persists; the operation is not labeled rollback submitted change.

**Test checklist:**

- [x] UNIT: <code>-w</code> is added only by explicit preference.
- [x] UNIT: empty selection and unsafe paths are rejected.
- [ ] FAKE-P4: one/many paths, warnings, permission, and partial output.
- [ ] LIVE-P4: edit/add/delete and shelf preservation.
- [ ] UI: destructive copy, affected list, persisted preference, and keyboard path.

#### US-SUBMIT-01 — submit a local-only changelist

**Availability:** available now; complete preflight is still absent.

> As a developer, I want to submit reviewed local changes to the depot and see current state after submit.

**Main scenario:**

1. The user selects Default or a numbered changelist with local files and no shelf.
2. For Default, they enter a description; a numbered CL uses its own description.
3. The user confirms Submit.
4. The application runs <code>p4 submit -d</code> or <code>p4 submit -c</code>.
5. After success/failure, pending changes, shelves, and opened files are reread.

**Observable result:** a successful change disappears from pending state; a server error is not disguised as a connection failure.

**Limitation:** the UI does not yet show unresolved, out-of-date, locks, jobs, sizes, and trigger warnings in advance.

**Test checklist:**

- [ ] UNIT: Default/numbered mode selection and description validation.
- [ ] FAKE-P4: success, structured rejection, and unknown/non-JSON output.
- [ ] LIVE-P4: Default/numbered success; unresolved/out-of-date/lock/trigger rejection.
- [ ] RECOVERY: network/process interruption followed by checking pending/submitted state.
- [ ] UI: correct disabled reason, busy state, and no duplicate submit.

#### US-SUBMIT-02 — submit a shelf-only changelist

**Availability:** available now.

> As a developer or build engineer, I want to submit a ready shelf without first unshelving it when the server permits direct shelf submit.

**Main scenario:** the user selects a shelf-only changelist and runs Submit shelf; the application performs <code>p4 submit -e change</code> and refreshes.

**Observable result:** on success, the shelf/pending change disappears; task-stream, edge-origin, and permission restrictions arrive as precise server errors.

**Test checklist:**

- [ ] UNIT: shelf-only mode and numbered-change validation.
- [ ] FAKE-P4: exact <code>submit -e</code> and warning/error classification.
- [ ] LIVE-P4: supported direct submit; restricted/task-stream/edge limitations.
- [ ] RECOVERY: unknown result after interruption.
- [ ] UI: copy clearly states that the shelf, not the local workspace, is being submitted.

#### US-SUBMIT-03 — choose the correct version when local files and a shelf both exist

**Availability:** available now through three explicit strategies.

> As a developer, I want to deliberately choose the local or shelved version during submit so that newer local work or a server checkpoint is never lost silently.

**Option A — Submit shelf, preserve local:**

1. Create a recovery changelist.
2. Move local opened files there.
3. Run <code>submit -e</code> for the original shelf.
4. Show the recovery CL number.

**Option B — Submit local, delete the old shelf:**

1. Explicitly warn about irreversible shelf deletion.
2. Delete the shelf.
3. Submit local changelist.

**Option C — update the shelf from local and Submit local:**

1. Fully replace the shelf with the current local files.
2. Delete the shelf before the regular submit.
3. Submit local.
4. If submit fails, attempt to restore the updated shelf.

**Observable result:** the UI names the selected version and what happens to the other version; the compensation result is reported separately.

**Test checklist:**

- [ ] UNIT: state matrix local/shelf/both → permitted modes.
- [ ] FAKE-P4: exact sequence for each strategy.
- [ ] LIVE-P4: success for A/B/C.
- [ ] RECOVERY: create/reopen/submit/restore failure at every step and verification of surviving data.
- [ ] UI: destructive emphasis only for B, visible recovery CL, and repeated click blocked.

#### US-SESSION-01 — obtain fresh data and diagnostics after external changes

**Availability:** available now for My Changes.

> As a user of multiple P4 tools, I want P4FNV to refresh when focus returns and show CLI warnings/errors so that I do not work with stale state.

**Main scenario:**

1. The user changes a changelist/shelf outside P4FNV.
2. When focus returns, a throttled refresh rereads data.
3. Selection is preserved if the object/path still exists; otherwise it is cleared.
4. Warning/error records are available in the session log at the lower right.

**Test checklist:**

- [x] UNIT: focus-only throttling.
- [x] UNIT: stale shelf cache and disappeared selection.
- [ ] FAKE-P4: warning records enter the bounded session log.
- [ ] LIVE-P4: external P4V/CLI mutation while P4FNV unfocused.
- [ ] UI: log placement, clear, focus/scroll preservation, and no polling.

#### US-LOCALE-01 — use Russian/English and install an external language

**Availability:** available now.

> As a user, I want to select the application language and add a complete language pack without rebuilding.

**Main scenario:** the user switches RU/EN and the application saves the choice. A complete external JSON pack from the shipping/config directory appears after restart, while an incomplete/corrupt pack is skipped with a warning.

**Test checklist:**

- [x] UNIT: built-in locale contracts are complete and have identical keys.
- [x] UNIT: an incomplete external pack is skipped and a complete pack is discovered.
- [x] UNIT: one typed key returns the selected language's translation.
- [ ] UI: complete pass through available screens in RU/EN and with long strings.
- [ ] SHIPPING: locale files are located beside the release executable.

### 27.4 Partially available stories and exact capability boundaries

#### US-AUTH-01 — recover an expired or untrusted session

**Availability:** partially available.

The user already receives an auth/trust error and remains on the connection screen, but cannot enter a password, complete login2/SSO/MFA, confirm a fingerprint, or log out inside P4FNV. The story closes only after section 4.2 is implemented.

**Test checklist:**

- [x] UNIT: auth/trust message classification.
- [ ] FAKE-P4: expired ticket → login flow → successful retry.
- [ ] LIVE-P4: password, new/changed SSL fingerprint, MFA, and available SSO setup.
- [ ] SECURITY: password, MFA data, ticket, and auth URL/token are absent from logs/settings.

#### US-DIFF-02 — inspect a large or binary asset

**Availability:** partially available.

The user can request a diff, but the current viewer is limited to 2 MiB of text output and does not provide a production-grade image/binary/large-file flow. The story closes after section 19.

**Test checklist:**

- [ ] UNIT: type/size routing and truncation.
- [ ] FAKE-P4: large streaming output and cancellation.
- [ ] LIVE-P4: text >2 MiB, binary, image, Unicode, and symlink.
- [ ] UI: deliberate fallback, external tool, and no frozen blank pane.

#### US-SUBMIT-04 — fix problems before starting submit

**Availability:** partially available.

The user can start submit and receive a server rejection, but does not yet see a complete preflight for unresolved/out-of-date/locks/missing/jobs/stream spec. The story closes after sections 9.2 and 15.

**Test checklist:**

- [ ] UNIT: aggregation of all preflight issue groups.
- [ ] FAKE-P4: several simultaneous problems rather than stop-on-first.
- [ ] LIVE-P4: unresolved + out-of-date + lock combinations.
- [ ] UI: navigation from an issue to affected files and the disabled reason.

#### US-CHG-04 — hand off a changelist to another user/workspace

**Availability:** partially available only through external P4V/CLI.

P4FNV already shows owner/client in the pending-change model, but does not provide handoff, public/restricted, or promoted-shelf workflows. The story closes after sections 9.1 and 10.

### 27.5 Target stories for upcoming milestones

#### US-WORKSPACE-01 — browse project files and their real status

**Availability:** target story, Milestone A.

> As a developer, I want to open my workspace tree/list, filter opened/modified/outdated/untracked files, and see depot/client/local paths so that I can understand project state without the CLI.

**Acceptance checklist:**

- [ ] Lazy tree/list does not require a recursive full-workspace request.
- [ ] Status is built by scoped batch <code>p4 fstat</code>/<code>status</code>, not per-file N+1.
- [ ] Have/head, changelist, locks, resolve, mapping, and file type are visible.
- [ ] Expand/filter preserve selection/scroll after refresh.
- [ ] The file inspector provides Diff, History, and daily actions.

**Test checklist:** UNIT parser/status grouping; FAKE-P4 large/partial output; LIVE-P4 classic/stream mappings; UI keyboard/virtualization/200%.

#### US-DEPOT-01 — browse the depot independently of workspace mapping

**Availability:** target story, Milestone A.

> As a developer, I want to find a file in the depot, see head metadata/history, and navigate to its workspace mapping even when the file is not currently mapped.

**Acceptance checklist:**

- [ ] Depot roots/types, lazy dirs/files, and deleted-at-head toggle.
- [x] Preview/history are available for a readable unmapped file.
- [ ] Sync/edit does not launch for an unmapped file; editing mapping/workspace is offered.
- [ ] Permission/maxresults appear as a scoped partial state.

**Test checklist:** fake large tree; live local/stream/spec/graph-readable depots; restricted subtree; depot ↔ local navigation.

#### US-SYNC-01 — update the workspace safely

**Availability:** target story, Milestone A.

> As a user, I want to see a server-generated update preview, start sync with progress, and cancel it without losing local changes.

**Acceptance checklist:**

- [ ] <code>p4 sync -n</code> shows add/update/delete/bytes and affected local/open files.
- [ ] Safe mode is the default; force is a separate advanced action.
- [ ] Progress reflects real processed files; the operation supports cancellation.
- [ ] After success/cancel/error, have/head are reread.
- [ ] Sync to change/date/label/revision uses the same safety contract.

**Test checklist:** fake streaming/cancel; live safe overwrite protection, open-file resolve, parallel capability, interrupted network; UI Operation Center.

#### US-FILES-01 — perform daily edit/add/delete/move/reconcile operations

**Availability:** target story, Milestone A.

> As a developer, I want to open, add, delete, or rename selected files and reconcile offline changes into the appropriate changelist.

**Acceptance checklist:**

- [ ] Batch edit/add/delete/move with a destination changelist; single-file depot rename is available with an explicit destination path.
- [ ] Reconcile preview groups add/edit/delete/move/ignored.
- [ ] P4IGNORE, mapping, special characters, and case-only rename are handled.
- [ ] Apply uses the selected subset; server refresh confirms the result.
- [ ] Clean is separated as a destructive flow with a complete preview.

**Test checklist:** unit argument builders; fake partial records; live all actions + P4IGNORE + case modes; recovery after partial directory move.

#### US-HISTORY-01 — see the changelist history for a selected project folder

**Availability:** target story, Milestone B.

> As a developer or lead, I want to select a folder and see only submitted changelists that affected it, with author/date/description/files/diff.

**Acceptance checklist:**

- [ ] Scope path and include-subfolders remain visible.
- [ ] Filters for number/user/date/description/stream/jobs and incremental load.
- [ ] The selected change shows details and a lazy file diff without a new window.
- [ ] Restricted/partial/maxresults do not look like empty history.
- [ ] Compare, Get revisions, Create rollback, and Cherry-pick entry points are available.

**Test checklist:** fake pagination/truncation; live folder/file/deleted path, restricted change, large history; UI saved filters/virtualization.

#### US-HISTORY-02 — investigate a file and safely retrieve or undo a revision

**Availability:** target story, Milestone B.

> As a developer, I want to see filelog/integration history, preview a revision, compare two versions, retrieve an old version, or create a new rollback changelist.

**Acceptance checklist:**

- [ ] Revisions contain action/change/author/time/type/integration/labels.
- [ ] Preview through <code>p4 print</code> does not change the workspace.
- [ ] Get Revision and <code>p4 undo</code> have distinct labels and consequences.
- [ ] Undo first runs <code>-n</code>, then opens files in the selected pending CL.
- [ ] Revision Graph displays only real integration records.

**Test checklist:** live edit/branch/move/delete/undo history; compare text/binary; undo conflict requiring resolve; UI graph navigation.

#### US-RESOLVE-01 — resolve a conflict and return to submit

**Availability:** target story, Milestone C.

> As a developer, I want to see all unresolved files, select/edit the result, and complete resolve without confusing source and workspace versions.

**Acceptance checklist:**

- [ ] The submit gate shows the complete unresolved count.
- [ ] Text resolve has base/source/workspace/result and hunk navigation.
- [ ] Accept actions name the content, not only yours/theirs.
- [ ] Binary/move/filetype/stream-spec conflicts have specialized UI.
- [ ] After an external tool, server resolve state is reread.

**Test checklist:** live content conflict/no-conflict, binary, move, filetype, and stream spec; fake tool failure; UI save/next/keyboard.

#### US-STREAM-01 — understand stream structure and switch working context safely

**Availability:** target story, Milestone D.

> As a streams user, I want to see the tree/graph, current workspace, and merge/copy hints, then safely switch to another stream.

**Acceptance checklist:**

- [ ] Tree/graph synchronize selection and show ancestors.
- [ ] Type, parent, flow rules, paths, workspaces, and activity are available in the inspector.
- [ ] <code>p4 istat</code>/<code>interchanges</code> provide server-backed hints.
- [ ] Opened/offline changes and active operations are detected before switching.
- [ ] The user chooses Shelve and switch / supported move / Stay; silent loss is impossible.

**Test checklist:** live mainline/dev/release/task/virtual/sparse, classic vs stream workspace, opened changes, edge server; UI zoom/filter.

#### US-INTEGRATE-01 — perform merge down, copy up, or cherry-pick

**Availability:** target story, Milestone D.

> As a developer or release engineer, I want to select source/target explicitly, see interchanges, and apply changes into a pending changelist for resolve/review.

**Acceptance checklist:**

- [ ] Source is on the left, target workspace/stream on the right, and direction cannot be confused.
- [ ] Preview shows files/actions/already-integrated/conflicts.
- [ ] Merge, copy, and cherry-pick use distinct semantics.
- [ ] Apply never submits automatically.
- [ ] Partial results and compensation are shown across Preview → Apply → Resolve → Review → Submit.

**Test checklist:** live merge down/copy up, partial cherry-pick, moves, already integrated, task stream; fake failure between batches; UI direction comprehension.

#### US-LOCK-01 — protect binary/critical files from a competing submit

**Availability:** target story, Milestone C/E.

> As a technical artist, I want to see who opened/locked an asset, place my own lock, and remove it safely.

**Acceptance checklist:**

- [ ] otherOpen, otherLock, user/workspace/change are visible.
- [ ] Explicit lock is not confused with filetype <code>+l</code>.
- [ ] Local/global lock depends on detected topology.
- [ ] Force admin actions are absent from the ordinary UI.

**Test checklist:** live lock conflict, submit releases lock, edge global lock, orphan/error state; UI binary inspector.

#### US-JOB-01 — link a job to a changelist and submit

**Availability:** target story, Milestone E.

> As a developer, I want to find a server-defined job, link it to a numbered changelist, and see the expected status after submit.

**Acceptance checklist:**

- [ ] Custom jobspec fields are not lost.
- [ ] Attach/detach uses fix/fixes semantics.
- [ ] The Default changelist is handled through the submit form.
- [ ] same/custom status and the resulting fix are visible.

**Test checklist:** custom jobspec, many jobs, permission, pending/submitted fixes, submit failure.

#### US-LABEL-01 — obtain a reproducible state from a label

**Availability:** target story, Milestone E.

> As a build/release engineer, I want to find a label, inspect its revisions, and safely sync the workspace to it.

**Acceptance checklist:**

- [ ] Automatic/static and locked/unlocked labels are distinct.
- [ ] Label view/revision/files are available before sync.
- [ ] Sync to label uses US-SYNC-01 preview/cancel/recovery.
- [ ] Tag/untag remains a separate P2 destructive workflow.

**Test checklist:** live static/automatic/locked labels, partial mapping, label deleted between preview/apply; UI history navigation.

#### US-OPS-01 — control a long-running operation and understand the result after failure

**Availability:** target cross-cutting story required for Milestone A.

> As a user of a large project, I want to keep navigating, see sync/submit/integrate progress, and cancel a specific task while understanding what has already changed.

**Acceptance checklist:**

- [ ] Every operation has an ID, scope, workspace/server, and event stream.
- [ ] Cancel terminates only the selected child.
- [ ] Completed/warning/error remain available in the Operations Center.
- [ ] An unknown result triggers read-back and does not promise rollback.
- [ ] Retry is automatic only for safe reads; a mutation requires new confirmation.

**Test checklist:** fake interleaved operations, cancellation, warnings, malformed records; live partial sync/network loss/submit unknown; UI navigation while running.

### 27.6 Story-to-feature traceability matrix

| Story | Feature sections | Current status |
|---|---|---|
| US-CON-01…02 | 4, 5.1, 21 | Available with valid ticket/trust |
| US-CHG-01…03 | 9.1 | Available |
| US-DIFF-01 | 12.2, 19 | Available with partial viewer quality |
| US-SHELF-01…03 | 10 | Available |
| US-REVERT-01 | 8.4 | Available |
| US-SUBMIT-01…03 | 9.2 | Available without complete preflight |
| US-SESSION-01 | 21, 22 | Available for My Changes |
| US-LOCALE-01 | 22 | Available |
| US-AUTH-01, US-DIFF-02, US-SUBMIT-04, US-CHG-04 | 4.2, 9, 10, 19 | Partial |
| US-WORKSPACE-01, US-DEPOT-01, US-SYNC-01, US-FILES-01 | 5–8, 21 | Target P0 |
| US-HISTORY-01…02 | 11–12 | Target P0/P1 |
| US-RESOLVE-01 | 15 | Target P0/P1 |
| US-STREAM-01, US-INTEGRATE-01 | 13–14 | Target P1 |
| US-LOCK-01, US-JOB-01, US-LABEL-01 | 16–18 | Target P1/P2 |
| US-OPS-01 | 21 | Target P0 |

### 27.7 Rule for turning a story into a test suite

For every implemented story, the agent creates or updates a test plan with these groups:

1. **Happy path:** minimum valid scenario and batch variant.
2. **Empty state:** no files/changes/results; this is not an error.
3. **Validation:** an invalid ID/path/revision/form value never reaches the process.
4. **Permissions/restricted:** server rejection preserves diagnostics and current data.
5. **Concurrency/race:** the object changed after preview but before apply.
6. **Partial/unknown:** part of the subprocess sequence completed; server state was reread.
7. **Cancel:** verify exactly what already changed.
8. **Scale:** large list/output, maxresults, long path/description, virtualization.
9. **Environment:** plain/SSL, Unicode/case mode, classic/stream, and standard/edge where applicable.
10. **UX/accessibility:** RU/EN, keyboard-only, focus/selection/scroll, 100/125/200%, screen reader announcements.

Test-name format:

<code>US-&lt;AREA&gt;-NN__&lt;given&gt;__&lt;when&gt;__&lt;then&gt;</code>

Examples:

- <code>US-CHG-03__three_opened_files_selected__move_to_numbered_change__one_batch_reopen_and_refresh</code>
- <code>US-SHELF-02__two_untracked_add_collisions__overwrite_one__other_is_skipped</code>
- <code>US-SUBMIT-03__submit_shelf_fails__rollback_succeeds__local_files_return_to_source_change</code>

A LIVE-P4 test run result must record server/client versions, topology, Unicode/case mode, the disposable dataset used, and unverified variants. Never mark a LIVE-P4 item based on a unit/fake test.

## 28. Official sources

### P4V

- [About P4V and depot/workspace model](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/introduction.about.html)
- [Connect to P4 Server, SSL, MFA and Authentication Service](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.connecting.html)
- [Navigate Depot and Workspace trees](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.navigating.html)
- [Create and manage workspaces](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.workspaces.html)
- [Retrieve files from the depot](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.retrieve.html)
- [Submit files and manage changelists](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.submit.html)
- [Shelve files](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.shelve.html)
- [Display revision history](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.history.html)
- [Revision Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/advanced_files.revgraph.html)
- [Search and filter](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.filters.html)
- [About streams](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.about.html)
- [Stream Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.graph.html)
- [Merge down and copy up](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.merge_copy.html)
- [Manage jobs](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/branches.jobs.html)

### P4 CLI

- [P4 CLI command reference](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands.html)
- [Commands by functional area](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands-by-functional-area.html)
- [Global options and structured output](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/global.options.html)
- [p4 client](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_client.html)
- [p4 fstat](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_fstat.html)
- [p4 sync](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_sync.html)
- [p4 reconcile](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_reconcile.html)
- [p4 changes](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_changes.html)
- [p4 change](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_change.html)
- [p4 describe](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_describe.html)
- [p4 filelog](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_filelog.html)
- [p4 print](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_print.html)
- [p4 diff2](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_diff2.html)
- [p4 undo](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_undo.html)
- [p4 integrate](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_integrate.html)
- [p4 interchanges](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_interchanges.html)
- [p4 istat](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_istat.html)
- [p4 streams](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_streams.html)
- [p4 stream](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_stream.html)
- [Resolve conflicts](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/P4Guide/resolve.howto.html)
- [p4 lock](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_lock.html)
- [p4 reshelve](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_reshelve.html)
- [p4 jobs and p4 fix](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_jobs.html)
- [p4 label](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_label.html)
- [p4 annotate](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_annotate.html)

## 29. Rule for future agents

Before implementation, the agent selects one open item or a compact group sharing a backend command, finds the related story IDs in section 27, and reads the relevant sections of this document, <code>ARCHITECTURE.md</code>, <code>UI_UX_SPECIFICATION.md</code>, and the relevant official documentation. After implementation, the agent:

1. Marks only genuinely completed items.
2. Adds a concise note about actual limitations nearby.
3. Updates the command matrix when a new command/flag appears.
4. Records completed tests and live-server smoke scope.
5. Updates story availability and marks only UNIT/FAKE-P4/LIVE-P4/UI/RECOVERY checks that actually ran.
6. Uses the story ID in names of new integration/E2E tests and bug reports.
7. Does not mark a parent workflow complete until preview, error/partial state, refresh, localization, and keyboard path are covered.
