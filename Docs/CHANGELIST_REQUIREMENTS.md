# Changelist, submitted history, and shelf requirements

This living contract owns pending and submitted changelists, shelves, submit, unshelve, revert, and related drag-and-drop semantics. Shared UI rules are in [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md), process and error boundaries in [`ARCHITECTURE.md`](ARCHITECTURE.md), and readiness in [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md).

## State model

Local opened files and shelved files are independent. A shelf is a server snapshot that survives later local edits or a workspace revert; the same depot path may therefore have different local and shelved content.

| Changelist state | Local files | Shelf | Submit choice |
|---|---:|---:|---|
| Empty numbered | 0 | 0 | edit or delete |
| Local only | >0 | 0 | submit local work or shelve |
| Shelf only | 0 | >0 | submit shelf or unshelve |
| Local and shelf | >0 | >0 | explicitly choose which content wins |
| Default | 0..N | none | submit local work; create a numbered change before shelving |
| Foreign/restricted | unknown | 0..N | expose only locally plausible actions; preserve server permission errors |

The selected changelist shows separate `Opened files` and `Shelved files` sections. The list includes Default and exposes number, description, local-file count, shelf presence, and date. Shelf content loads only for the selected changelist.

Descriptions use the shared safe Markdown renderer/editor. Raw HTML and non-HTTP(S) links are inert; web links open outside the WebView. Empty, loading, denied, unresolved, out-of-date, partial, and stale states remain distinguishable.

Numbered changes may be placed in local `Unactual` presentation per server/user/workspace. This never changes the server object; Default is excluded, stale IDs are cleaned only after a successful refresh, and archived changes remain selectable and usable.

The Shelves screen is a bounded catalog of every shelved changelist visible to the connected user, not a second view of only the current user's current-workspace shelves. It groups the returned page by owner and supports local search plus owner, workspace, stream, and age filters. Stream is derived from the first visible shelved path and the server stream catalog; an unknown mapping remains explicit. Selecting a shelf loads only that shelf's files into the persistent inspector, and restricted shelves continue to follow server permissions.

## Actions

All actions below are subject to server permission and race checks. Hide an action only when local state proves it impossible; otherwise let the server return the authoritative error.

| Object | Supported intent | Required behavior |
|---|---|---|
| Numbered changelist | create, edit description, change owner/workspace/access, delete empty | preserve unknown form fields; confirm deletion; preflight ownership/access changes against server capability, effective permission, linked shelf/jobs/files, and target-workspace topology |
| Opened files | move, shelve/update, revert, lock/unlock | apply to the exact selection in a batch |
| Shelf | unshelve, delete, reshelve, submit | identify source and target changes; confirm destructive removal |
| Local and shelf copies | compare or choose submit source | never merge the two states implicitly |
| Jobs | attach/detach | use the Jobs workflow rather than duplicating an editor |
| Resolve | yours, theirs, safe auto, merge | preview unresolved state; specialized merge UI must name the content chosen |

Resolve preview is a typed contract, not display text parsing. Each item keeps depot/client/local identity, classifies text, binary, move/name, filetype/attribute, stream-spec, or unknown conflicts, and exposes only actions valid for that class. Text conflicts may enter the three-way editor: base, source, and workspace are immutable references, result is editable, and unresolved marker navigation is keyboard reachable. Saving is restricted to the server-returned file under the workspace root, uses an atomic replacement, marks the result with `resolve -ae`, and rereads server state. Binary, oversized, invalid UTF-8, and specialized conflicts never enter the generic text editor. Batch auto-safe may finish partially; every requested file is returned as `resolved`, `pending`, or `unknown` instead of treating process exit as proof.

Revert always uses a server preview and warns when work is not protected by a shelf. For files opened for add, disk deletion is a separate persistent choice mapped to `p4 revert -w`; otherwise the local file remains.

Unshelve preserves the source shelf. When the shelf belongs to another stream, derive a server-backed stream mapping to the current workspace and use `p4 unshelve -S/-P`; the same mapping applies to selected files and the whole shelf. If a shelved add collides with an untracked local file, preview all collisions together in the mapped target paths, default every item to Skip, and apply `-f` only to paths explicitly set to Overwrite. A partial normal/force batch reports what already succeeded.

Text diff and content preview use the shared bounded viewer. Binary content receives an explicit non-text state. Export uses an exact revision and a new destination without implicit overwrite; batch shelf export preserves validated depot-relative paths, rejects destination collisions before writing, and reports partial results honestly. Native-picker support must extend the shared export workflow.

## Drag-and-drop

| Source | Target | Meaning |
|---|---|---|
| Opened files | another changelist | batch `reopen` move |
| Opened files | shelf of same numbered change | shelve/update copies |
| Opened files | shelf of another numbered change | batch reopen then shelve; compensate the reopen if shelving fails |
| Shelved files | Default or numbered change | unshelve copy after collision preview |
| Shelved file | another shelf | no implicit drop; use explicit reshelve |
| Numbered changes | Actual/Unactual | local presentation move only |

The cursor distinguishes copy from move. Reject malformed/external payloads and any drop onto a Default shelf. Every DnD action has an inspector or context-menu equivalent. Refresh from the server after a successful domain drop; never rely on an optimistic list mutation.

## Submit semantics

An ordinary `submit -c` cannot proceed while shelved files remain, while direct `submit -e` requires no local nonshelved opened files. When local work and a shelf coexist, present exactly these outcomes:

1. **Submit shelf, preserve local work.** Move local files to a recovery changelist, submit the shelf, and report the recovery ID. On failure, attempt to move files back and remove an empty recovery change.
2. **Submit local work, delete shelf.** Warn that the old shelf is lost, delete it, then submit the local changelist.
3. **Checkpoint and submit local work.** Replace the shelf with the complete local set, delete it, submit local work, and recreate that updated shelf if submit fails while files remain open.

All submit modes use the shared long-operation transport, and a same-workspace submit conflict is rejected before process launch. Submit terminal state is the typed `submitted`, `pending`, or `unknown` read-back result, never a substring parsed from diagnostics; `unknown` is not retryable and provides refresh/preflight recovery actions. Shelf-preserving modes keep their ordered compensation-safe command workflow inside that transport and return the same typed outcome plus completed steps and recovery IDs. All modes reread pending and submitted state after the command; refresh also reconciles opened and shelf state.

Do not promise shelf submit from a task stream or the wrong distributed-server origin. Capability checks improve the explanation but never replace the server decision.

Ownership and access changes use a distinct two-stage server contract. The preview returns only identity fields, booleans for linked opened files/shelves/jobs, effective permission, topology classification, blockers, and a snapshot token; it never returns descriptions, job IDs, or file paths. Editing the draft invalidates the token. Apply repeats the full preflight, preserves the complete server form in memory, uses the server's ownership-transfer form mode with force only when verified admin permission is required, and succeeds only after `User`, `Client`, and `Type` read back exactly. Unknown capability, permission, or topology blocks mutation rather than being guessed locally.

## Submitted history

Submitted opens with the current user's changes across all streams and workspaces. The server query can be narrowed to the current stream, another listed user, a workspace, and/or a job; `Current User` remains the first user choice so returning to the default owner never requires finding that user's login in the catalog. Search within the returned page is local, while user, workspace, stream, and job filters are server-backed and remain visible with the result limit. Each standard changelist row includes its mapped stream when the first affected depot path belongs to a listed stream.

Selecting a changelist first loads a bounded `describe -s -m` preview. If the safe file limit is exceeded, the inspector identifies the changelist as large and requires explicit confirmation before reading the complete file list. The read remains asynchronous, and even a complete result renders in bounded pages so a large changelist cannot monopolize the WebView. Exact-scope actions remain disabled until the complete list is available.

The inspector supports lazy file diffs, Get This Revision through the shared preview-first safe-sync flow for exact `depotFile#rev` scopes, preview-first `p4 undo`, and cherry-pick from one identifiable foreign source stream into the current stream. Rollback targets Default or a selected pending changelist; creating a new described changelist is an explicit option. When the submitted file count exceeds the safe preview limit, disable and explain only rollback preview; the explicit rollback action remains available without preview. Cherry-pick uses the stream-generated mapping and exact `@=change` revisions, opens results in Default or a selected pending changelist, and never resolves or submits automatically. Disable it when the workspace has no current stream, the source is the current stream, or all files cannot be mapped safely to one source stream.

## Interaction and verification

- Selection uses click, Ctrl/Cmd-toggle, and Shift-range; batch commands receive arrays of validated paths without shell interpolation.
- Section headings provide whole-section selection and applicable batch operations.
- Destructive work uses the shared confirmation dialog; repeated submit and unsafe Escape closing are blocked while running.
- Context menus work from pointer, `ContextMenu`, and `Shift+F10`, and every item is a native button.
- Text diff is bounded to 2 MiB with a visible truncation state.
- Refresh selected shelf content, opened files, and changelists together after mutations and on focus return.

Unit coverage includes state grouping, selection, drag payloads, drop intent, IDs/paths, form preservation, revert flags, and submit-mode compensation. Disposable-server coverage includes partial shelf deletion, selected-force unshelve, every submit mode, interruption/read-back, and injected compensation failure. Native QA covers English/Russian, keyboard-only use, long paths, narrow windows, and supported scale factors.

Reusable CLI constraints and server scenarios are in [`research/P4_CAPABILITY_REFERENCE.md`](research/P4_CAPABILITY_REFERENCE.md) and [`research/P4_VERIFICATION_SCENARIOS.md`](research/P4_VERIFICATION_SCENARIOS.md).
