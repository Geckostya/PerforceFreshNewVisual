# Changelist and shelf requirements

Document status: active product and implementation contract. Updated 2026-07-22.

## 1. Data model and mandatory states

The application must not merge local opened files and shelved files into one list. A shelf is a server snapshot that continues to exist independently of later edits or a workspace revert.

For every pending changelist, the UI must distinguish:

| State | Local opened files | Shelf | Primary action |
|---|---:|---:|---|
| Empty numbered changelist | 0 | 0 | Edit or delete the changelist |
| Local work only | >0 | 0 | Submit local work or create a shelf |
| Shelf only | 0 | >0 | Submit the shelf or unshelve |
| Local work and shelf | >0 | >0 | Explicitly choose the version to submit |
| Default changelist | 0..N | impossible | Submit local work; create a numbered changelist before shelving |
| Foreign or restricted shelf | unknown | 0..N | Only server-permitted actions; do not mask permission errors |

The same depot path in the local list and shelf still represents two versions. They may match or differ.

## 2. Mandatory view structure

- A list of pending changelists for the selected workspace, including Default.
- Explicit indicators: number, description, local-file count, shelf presence, and date.
- Two independent sections inside the selected changelist: `Opened files` and `Shelved files`.
- Lazy shelf loading for the selected changelist, avoiding up to 200 `p4 files` requests on every refresh.
- The selected file shows depot path, action, revision, type, and `LOCAL`/`SHELF` source.
- Focus-return refresh and manual Refresh update the local list, shelves, and contents of the open shelf.
- Frequent actions stay in the primary flow. Rare and destructive actions live in the context menu and always request confirmation.
- The `Opened files` and `Shelved files` headings have context menus for whole-section operations: select all, move/shelve/revert all, or unshelve/delete shelf.
- Empty, loading, permission-denied, resolve-required, and out-of-date states must be distinguishable.
- A numbered changelist can be moved cosmetically into the collapsible `Unactual` section and restored through the context menu or by dragging a row between the actual list and the section. This is local server/user/workspace classification: the changelist remains selectable/editable and is unchanged on the server; Default cannot be dragged or archived, and stale IDs are removed after refresh.
- The changelist list supports single, Ctrl/Cmd-toggle, and Shift-range selection. Drag-and-drop and movement to/from `Unactual` apply to the selected group from one section; Default is excluded from batch movement.

## 3. Complete action catalog

### 3.1 Changelist

| Action | Conditions | UX | Status |
|---|---|---|---|
| Create numbered changelist | Connected with a description | Primary action | Implemented |
| Edit description | Numbered pending change with owner rights | Context menu | Implemented |
| Move to/from Unactual | Numbered pending change | Context menu or DnD between the actual list and local collapsible section | Implemented; server state is unchanged |
| Delete | No opened files, shelf, jobs, or stream spec | Context menu + confirmation | Implemented; the server checks invariants |
| Move one local file | File is opened in the current workspace | Drag-and-drop or inspector | Implemented |
| Move several/all local files | Same | Multi-select / inspector / drag-and-drop | Implemented |
| Shelve selected files | Numbered CL with files opened in it | Drop into Shelf / context | Implemented for multi-select |
| Shelve all / fully update shelf | Local files exist | Context menu + confirmation | Implemented through `p4 shelve -r` |
| Unshelve selected/all | Shelf is accessible and target CL selected | Drag-and-drop / context + target | Implemented |
| Delete selected/all shelved copies | User owns the shelf | Context menu + confirmation | Implemented |
| Submit local / shelf / conflict | See section 5 | Submit dialog | Implemented |
| Revert selected local files | Files are opened | Multi-select + server preview + destructive confirmation | Implemented; `add` has a persistent setting for deleting the disk file |
| Revert unchanged / whole CL | Selection and preview required | Context / selection | Implemented for unchanged and whole CL |
| Resolve | Unresolved files exist | Separate preview/resolve workflow | Basic keep-workspace / accept-server / auto modes implemented in Workspace; full merge editor remains open |
| Lock / unlock | Type/permissions allow | Context menu for selected/all opened | Implemented |
| Attach/detach jobs | Job subsystem is available | Jobs inspector | Implemented through `p4 fix`; direct editing from CL details remains open |
| Change owner/workspace | Permissions allow; important for handoff | Context menu | Next increment |
| Public/restricted | Owner permissions allow | Edit dialog | Next increment |
| Promote shelf | Commit-edge topology | Advanced context | Show only after topology is known |
| Copy/reshelve to another CL | Shelf is available | Shelves inspector + confirmation | Implemented through `p4 reshelve -s -c` for selected files |
| Create/update code review | P4 Code Review configured | Integration action | Do not show without integration |

### 3.2 Local opened file

- View local ↔ have revision diff — implemented.
- Move one or more files to another changelist — implemented through multi-select, inspector, and drag-and-drop.
- Shelve/update one or more selected files — implemented.
- Revert one or more files with a server-backed preview and a warning about losing a version not saved in a shelf — implemented. For opened-for-add, the file-deletion flag maps to `p4 revert -w` and persists in `settings.json`; without it, the file remains on disk.
- Compare local ↔ shelf when the corresponding shelved path exists — implemented.
- History, annotate, time-lapse, and open in file manager/editor belong to the shared file workflow and should reuse future screens instead of being duplicated inside changelists.
- Resolve and accept yours/theirs/merge cannot be reduced to one dangerous button; preview and unresolved state are required.

### 3.3 Shelved file

- View name, depot path, action, revision, and type — implemented.
- Compare shelf ↔ depot head — implemented.
- Compare local ↔ shelf — implemented when a local version is available in the workspace.
- Unshelve one or more selected files into Default or a numbered changelist — implemented.
- When a shelved `add` conflicts with an existing untracked local file, preflight shows every collision at once. They are skipped by default; a selected subset can explicitly receive overwrite via `p4 unshelve -f` from its context menu.
- Delete one or more selected files from a shelf — implemented with confirmation.
- View binary-file contents — the shared viewer shows a safe binary state; a full metadata/image preview remains a future extension.
- Download shelved content without unshelving — export of one selected file through `p4 print path@=change` to a new output path is implemented; batch/native picker remain open.

## 4. Drag-and-drop

| Source | Target | Command/semantics |
|---|---|---|
| Local file(s) | Another changelist | `p4 reopen -c target files...` — move the entire selected set |
| Local file(s) | Shelf of current numbered CL | `p4 shelve -f -c change -Af files...` — create/update copies |
| Local file(s) | Shelf of another numbered CL | Batch `reopen`, then batch `shelve`; on shelve failure, attempt to return the whole set to its source CL |
| Shelved file(s) | Default/numbered changelist | `p4 unshelve -s source -c target -Af files...` — copy while preserving the shelf; check shelved-add conflicts first |
| Shelved file | Shelf | No implicit action; server-to-server copy requires an explicit `reshelve` workflow |

The cursor must show copy for unshelve and move for reopen. External and malformed drag payloads are ignored. Drop into Default Shelf is prohibited. A successful drop triggers a server refresh, not merely an optimistic UI change. The shelf-content cache is cleared on every refresh and is never displayed when the fresh changelist list no longer reports a shelf.

## 5. Submit with a nonempty shelf

Perforce does not allow an ordinary changelist submit while shelved files remain. Direct shelf submit, in turn, requires that the changelist contain no local nonshelved opened files. When local work and a shelf coexist, the user therefore receives three honest choices:

### 5.1 Submit the shelf

1. Create a recovery changelist.
2. Move all local opened files from the source CL into it.
3. Run `p4 submit -e source`.
4. Leave local work in the recovery CL and show its number.
5. If shelf submit fails, attempt to return files to the source CL and delete the empty recovery CL.

The shelf becomes the submitted version while newer local edits are preserved.

### 5.2 Submit local work and delete the shelf

1. Explicitly warn that the old shelf cannot be recovered.
2. Run `p4 shelve -d -c change`.
3. Run `p4 submit -c change`.

This is exact and fast, but a riskier user action.

### 5.3 Update the shelf and submit local work

1. Replace the shelf with the complete current local set through `p4 shelve -r -c change -Af`.
2. Delete the shelf because ordinary `submit -c` is otherwise prohibited.
3. Run `p4 submit -c change`.
4. If submit fails, automatically recreate the updated shelf from the remaining opened files.

This mode uses the shelf as a server checkpoint during a risky operation. After a successful submit, the shelf disappears together with the pending change as expected.

### 5.4 Shared submit requirements

- Never apply `-f` to unshelve implicitly. It is allowed only for specific conflicting files selected and explicitly assigned to overwrite by the user; the safe initial decision is Skip.
- Always reread state after success and failure: the server may renumber the changelist or leave it pending.
- Show server diagnostics and report compensation/rollback results separately.
- Do not promise shelf submit from a task stream or on another user's edge server; show the server limitation to the user.
- Submit remains atomic on the P4 Server; composite preparatory application operations have an explicit rollback or warning.

## 6. Context menu

Changelist: Edit, Shelve/Update all, Unshelve all, Delete shelf, Delete empty changelist, Submit.

Local file selection: Diff for one file, Shelve/update and Revert for the whole selected set.

Shelved file selection: Diff/Compare for one file, Unshelve selected and Delete selected from shelf for the whole selected set. In the conflict window, a separate context menu assigns Skip or Overwrite from shelf to selected rows.

Items are hidden when the action is impossible from locally known state. The server remains the source of truth for permissions and race conditions.

## 7. Reliability, scale, and accessibility

- Validate every depot path and changelist ID before passing it to the CLI; do not use shell interpolation.
- Limit text diffs to 2 MiB with an explicit truncation indicator.
- Multi-select supports ordinary click, Ctrl/Cmd-toggle, and Shift-range; every batch operation passes arrays of paths without shell interpolation. Virtualization remains a separate task for very large changelists.
- Destructive actions require a separate shared confirmation dialog describing what is retained and deleted; browser-native `confirm` is not used.
- The context menu is available from the focused row through the system `ContextMenu` key and `Shift+F10`; every item is a native button.
- Drag-and-drop has equivalent commands through the inspector/context menu.
- UI strings live in external locale JSON; new languages require no rebuild.
- Warnings and errors actually received from `p4` in the current workspace session are collected in a bounded session log. Its indicator is fixed at bottom-right; the log shows time and technical details and can be cleared by the user.

## 8. Verification

- Unit: default/numbered/shelf-only grouping; single/toggle/range selection; multi-file drag-payload encoding; drop-intent matrix.
- Rust unit: opened/shelved/where JSON records; safe IDs/paths; revert arguments with and without `-w`; editing Description without losing other changelist fields; submit-mode state helpers.
- Integration with a test P4 Server: partial shelf delete, unshelve selected, shelf/local diff, every submit mode, and compensation for an injected submit failure.
- Visual QA: empty/local-only/shelf-only/both, long paths, English/Russian, 100%/125% scale, narrow window, and context menu near right/bottom edges.

Official sources and the original extended catalog are preserved in [`research/P4_FEATURE_CATALOG_AND_STORIES.md`](research/P4_FEATURE_CATALOG_AND_STORIES.md).
