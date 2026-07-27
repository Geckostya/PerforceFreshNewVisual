# Navigation, Files, My Changes, and Streams rework

Status: implemented and verified on July 22, 2026. This document was created before the code change and is retained as the implementation and acceptance contract.

## 1. Goal

Make daily file and changelist operations more visible, reduce persistent navigation width, and add a safe stream workflow. The UI must show real Helix Core data; do not add buttons without a working `UI → Rust → p4 → refresh` path.

## 2. Shell and navigation

The left sidebar has three states:

1. **Compact** — default state: only item icons are visible; names are available through tooltip and accessibility label.
2. **Expanded** — icons and names are visible; the main content area narrows without overlap.
3. **Hidden** — the panel is removed, but a keyboard-accessible restore button remains in the header.

The user cycles states through explicit buttons. The selected item is distinguishable by more than color. Navigation is grouped as follows:

- Files;
- My Changes;
- Streams;
- visual separator;
- Shelves;
- Jobs.

History, Depot, and Labels stop being standalone items, but their working flows remain: history and the depot browser move into Files, while labels remain available through Global Go To/command palette until a separate product decision.

## 3. Files

### 3.1 Shared screen

Files is the single workspace/depot work area. A source switch appears at the top:

- **Local files** — mapped workspace files, local state, and local actions;
- **Depot files** — depot tree and read-only/server actions.

The screen retains the shared `toolbar → tree | inspector` layout. Selecting a file or folder updates the right inspector without navigating to a separate screen or causing a layout jump.

Post-UX-review clarification: the screen does not begin with mandatory or unexplained search fields. On entry, Local files immediately shows the root-directory cache and rereads only one level of the authorized client root. A nested directory loads on first expansion: the cache appears immediately with a spinner, while exact disk contents and nonrecursive Perforce status update in the background. Empty folders are displayed; an unloaded folder shows an ellipsis instead of a false zero file count. Only actual disk files determine Local Files membership; server records missing locally are not added to the tree. Before `p4 fstat //client/path/*`, the application compares a fingerprint of the latest submitted changelist, pending changelists, and opened workspace files; an unchanged fingerprint keeps the directory on cached status. Expensive `p4 reconcile -n` runs only through the explicit Reconcile action. Scope, text search, status filter, and tree/list switching are optional settings in a collapsible block with labels, placeholders, and short hints.

Local Files preserves the current tree and unfinished directory request when navigating elsewhere or to Depot Files. Returning does not create parallel loading. Explicit Refresh updates only directories the user has already expanded in the current session.

### 3.2 Local files

- The primary view is a file tree with expandable directories and files.
- The tree shows folders and every file found in the selected bounded scope: tracked, opened, outdated, unresolved, locked/other-open, unmapped, untracked, and ignored when those states come from the server/preview.
- Every file has an ordinary file-type icon and separate status marker/label. Status cannot be encoded by color alone.
- A hover/focus tooltip shows the full path, status, size, and changelist; missing data is identified explicitly.
- Ignored files and directories use muted orange text without an orange background and remain readable.
- A scrollable bounded history fills the wider right inspector to its bottom edge: changelist description is bold, with gray metadata below. Selecting a history row sets the revision for `Update selected`; there is no separate Target Revision.
- Double-clicking or pressing Enter on a history row opens all affected changelist files. From that window, every available exact revision can be exported into a new directory; a single file's context menu opens diff or saves its revision, while multi-select disables single-file operations.
- Multi-select retains click, Ctrl/Cmd-click, and Shift-click wherever batch actions are available.

Available local-file actions:

- retrieve new revisions of selected files through server-backed sync preview and the existing Operations Center;
- open for edit (`p4 edit`);
- add (`p4 add`);
- add an ignore rule without losing the file;
- mark for delete (`p4 delete`);
- revert local changes (`p4 revert`) with preview and confirmation;
- delete locally only with separate destructive confirmation.

Items are hidden or disabled with a clear reason when file state disallows the action. A mutation uses exact depot/local identifiers and ends by refreshing the tree and inspector.

### 3.3 Depot files

- Depot uses a different calm color accent and explicit source label.
- The tree loads lazily and remains bounded, without a global `//...` scan.
- Selecting a file/folder shows history on the right just as in local mode.
- Actions requiring an existing local path or opened state are hidden for depot-only elements.
- A visible button retrieves a new revision only for mapped/accessible scope through sync preview.
- Local files absent from the current depot view remain gray and inactive in the tree so source switching cannot suggest data loss falsely.

## 4. My Changes: Unactual

The screen retains all current changelist, opened-file, shelf, submit, revert, and drag-and-drop functionality.

A cosmetic local changelist classification is added:

- the context menu moves a numbered pending changelist to **Unactual**;
- dragging a row between the actual list and Unactual provides the same movement in both directions;
- the bottom Unactual section collapses and expands independently;
- an archived changelist remains an ordinary server changelist: it can be selected, edited, populated, shelved, reverted, and submitted without restriction;
- its context menu returns it to the actual list;
- Default changelist cannot be archived;
- the marker is stored locally per server/user/workspace and is automatically cleaned for changelists absent after refresh.

This presentation neither changes Perforce server state nor renames the changelist.

## 5. Streams

### 5.1 Presentation

Streams contains two persistent panes:

- left — bounded stream tree with parent/child relationships;
- right — graph of enabled streams only, showing parent/child relationship and stream type through label/shape rather than a Git commit DAG.

Every stream has a graph-visibility toggle. Tree and graph selection are synchronized. Text and a separate fill/border mark the current workspace stream. SVG does not stretch nodes beyond a defined natural size when the graph has few elements.

The tree supports Ctrl/Cmd-toggle and Shift-range multi-select. `Show selected` / `Hide selected` commands live in the top panel and act on the current selection, while `Show all` / `Hide all` act on the whole catalog. A selected stream's checkbox applies its action to the full multi-selection. Disabling a parent hides its entire subtree, while enabling a parent enables only that parent. Separate context-menu commands explicitly show or hide all descendants; an indeterminate checkbox represents mixed child state. Every branch with children independently collapses and expands through a caret button without changing the graph.

Streams supports the same local cosmetic **Unactual** section:

- the context menu moves a stream into the collapsible bottom section;
- the context menu returns it to the actual tree;
- drag-and-drop moves one stream or a selected group from one section to another;
- moving a parent to Unactual moves its whole subtree, while restoring a parent restores only the parent; the context menu contains explicit commands to move/restore all descendants;
- the stream remains available for viewing and switching;
- state is stored separately per server/user/workspace and cleaned for vanished stream paths.

### 5.2 Switching streams

Switching starts with a double left click or context-menu item. Before mutation, a shared dialog always opens and shows source stream, target stream, and two independent strategies:

**Local opened files**

- `Shelve` — first save local opened files in a server shelf; Default changelist requires a safe numbered-changelist workflow or blocks the choice with an explanation;
- `Keep` — retain local files; the dialog warns about possible conflicts when changing the client spec.

**Depot/workspace content after switching**

- `Download now` — after changing the stream, perform sync preview and then sync the entire newly mapped workspace scope;
- `Keep as is` — change the stream in the client spec without immediate sync.

Safe operation order:

1. Reread the current workspace and opened changes.
2. Under Shelve, create the server shelf and stop on failure.
3. Obtain the current client spec and replace only `Stream`, preserving unknown fields/options.
4. Reread workspace/server info.
5. Under Download now, start the existing sync operation protocol.
6. Report partial results honestly: the spec may have changed even if sync failed or was cancelled.

The dialog prevents repeated submit, has a safe default, and does not use browser `confirm`.

## 6. Localization and accessibility

- Add every new string simultaneously to complete `locales/en.json` and `locales/ru.json`.
- Sidebar, tree, graph, context menus, source switcher, disclosure controls, and dialog are keyboard accessible.
- Open the context menu by right click, `ContextMenu`, or `Shift+F10`.
- Duplicate hover-only information through focus/title/inspector.
- Verify English/Russian, long paths and names, narrow window, 100/125/200% scale, and `prefers-reduced-motion`.

## 7. Verification and boundaries

- Pure frontend tests: three sidebar states, tree construction, unactual partition/cleanup, and stream graph/tree state.
- Rust tests: stream-list parser, safe arguments, preserving the client form while changing Stream, and switch-workflow branching.
- Full gate: frontend tests, Rust fmt/test/Clippy, and release build.
- Mutating `p4` smoke is not run against the connected user server without separate authorization.
- Features for which the server provides no reliable data (for example, local untracked file size outside safe backend scope) show an absent value instead of inventing one.

## 8. Acceptance criteria

- [x] Sidebar is compact by default, expands, and hides; navigation matches the new grouping.
- [x] Files combines local/depot tree, status presentation, history inspector, sync, and allowed context actions.
- [x] Local Files shows the whole mapped workspace on entry; optional scope/search/filter controls do not obscure the tree.
- [x] Local Files shows the full disk/cache snapshot independently of Perforce and updates cached status only when the changelist fingerprint changes.
- [x] Ignored elements use muted orange text without a colored background; local-only elements in depot mode are gray and inactive.
- [x] My Changes has a working persistent Unactual section without changing server state.
- [x] My Changes moves numbered changelists to/from Unactual through context menu and DnD.
- [x] Streams loads from the server, builds tree/graph, supports multi-select, batch visibility, and collapsible branches, and has a persistent Unactual section with DnD and a safe switch dialog.
- [x] Every mutation uses narrow Tauri commands, validation, direct `Command` arguments, and refresh.
- [x] English/Russian packs are complete, and tests and release build pass.

## 9. Clarifications after repeated UX review

- The Unactual drop target occupies all remaining bottom space in the My Changes and Streams column, so highlighting does not stop at the final list row.
- Local Files publishes filesystem scans in chunks and is not blocked by automatic reconcile preview; server statuses remain read-only and arrive later.
- Turning off a checkbox within a multi-selection hides every selected branch in one action.
- Enabling a parent does not change children; disabling a parent cascades downward.
- The stream context menu contains separate `Show all children` / `Hide all children` and equivalent Unactual commands.
- Graph nodes do not scale beyond a fixed layout size; the current stream has its own color accent.
- Files history fills the remaining height of the expanded inspector, selects the revision for `Update selected`, and opens submitted changelist details with safe single/batch export.
