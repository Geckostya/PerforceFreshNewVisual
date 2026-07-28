# Changelist and shelf requirements

This living contract owns pending changelists, shelves, submit, unshelve, revert, and related drag-and-drop semantics. Shared UI rules are in [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md), process and error boundaries in [`ARCHITECTURE.md`](ARCHITECTURE.md), and readiness in [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md).

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

## Actions

All actions below are subject to server permission and race checks. Hide an action only when local state proves it impossible; otherwise let the server return the authoritative error.

| Object | Supported intent | Required behavior |
|---|---|---|
| Numbered changelist | create, edit description, delete empty | preserve unknown form fields; confirm deletion |
| Opened files | move, shelve/update, revert, lock/unlock | apply to the exact selection in a batch |
| Shelf | unshelve, delete, reshelve, submit | identify source and target changes; confirm destructive removal |
| Local and shelf copies | compare or choose submit source | never merge the two states implicitly |
| Jobs | attach/detach | use the Jobs workflow rather than duplicating an editor |
| Resolve | yours, theirs, safe auto, merge | preview unresolved state; specialized merge UI must name the content chosen |

Revert always uses a server preview and warns when work is not protected by a shelf. For files opened for add, disk deletion is a separate persistent choice mapped to `p4 revert -w`; otherwise the local file remains.

Unshelve preserves the source shelf. If a shelved add collides with an untracked local file, preview all collisions together, default every item to Skip, and apply `-f` only to paths explicitly set to Overwrite. A partial normal/force batch reports what already succeeded.

Text diff and content preview use the shared bounded viewer. Binary content receives an explicit non-text state. Export uses an exact revision and a new destination without implicit overwrite; batch/native-picker support must extend the shared export workflow.

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

Default and local-only submit use their direct server paths. All modes reread pending, submitted, opened, and shelf state after success, failure, cancellation, or connection loss. Report `submitted`, `pending`, or `unknown`; never retry an unknown mutation automatically. Preparatory steps, compensation, and server diagnostics are reported separately from the submit result.

Do not promise shelf submit from a task stream or the wrong distributed-server origin. Capability checks improve the explanation but never replace the server decision.

## Interaction and verification

- Selection uses click, Ctrl/Cmd-toggle, and Shift-range; batch commands receive arrays of validated paths without shell interpolation.
- Section headings provide whole-section selection and applicable batch operations.
- Destructive work uses the shared confirmation dialog; repeated submit and unsafe Escape closing are blocked while running.
- Context menus work from pointer, `ContextMenu`, and `Shift+F10`, and every item is a native button.
- Text diff is bounded to 2 MiB with a visible truncation state.
- Refresh selected shelf content, opened files, and changelists together after mutations and on focus return.

Unit coverage includes state grouping, selection, drag payloads, drop intent, IDs/paths, form preservation, revert flags, and submit-mode compensation. Disposable-server coverage includes partial shelf deletion, selected-force unshelve, every submit mode, interruption/read-back, and injected compensation failure. Native QA covers English/Russian, keyboard-only use, long paths, narrow windows, and supported scale factors.

Reusable CLI constraints and server scenarios are in [`research/P4_CAPABILITY_REFERENCE.md`](research/P4_CAPABILITY_REFERENCE.md) and [`research/P4_VERIFICATION_SCENARIOS.md`](research/P4_VERIFICATION_SCENARIOS.md).
