# P4FNV UI/UX contract

This document contains only implementation and acceptance rules. Competitive analysis, original wireframes, narrative flows, and sources are preserved in [`research/UI_UX_RESEARCH.md`](research/UI_UX_RESEARCH.md).

## Base model

P4FNV presents intent and consequences, not a collection of CLI flags. The primary flow for any complex operation is:

1. Select an object or scope.
2. Obtain a server-backed preview.
3. Show source, target, affected items, and risk.
4. Start the action with a button that names the concrete outcome.
5. For a long operation, close the dialog and hand progress/cancel to Operations Center.
6. Reread server state after the terminal result.

Do not create a staging area, false Git commit graph, or universal Undo action. Get Revision changes workspace content; `p4 undo` creates new opened changes. They are different commands.

## Application shell

Persistent shell:

- header: user, workspace, a Go To control understandable from placeholder and tooltip, language, Sign out, and Close workspace;
- sidebar: compact by default, expanded with labels, or fully hidden;
- sidebar order: Files, My Changes, Streams, separator, Shelves, Jobs;
- main surface: current resource screen;
- bottom-right: Operations Center and CLI diagnostics without overlap;
- command palette: navigation and Go To focus, not a hidden home for every feature action.

Server/user/workspace context must remain available. Changing workspace is explicit; Close workspace returns to connections without logout and is clearly distinct from Sign out, which revokes the current p4 ticket.

## Resource screen

MyChanges is the structural reference:

```text
page heading + view-level actions
compact search/filter toolbar
list/tree | persistent inspector
```

- The header contains only whole-view actions: Refresh, New, Preview Sync, and similar actions.
- The toolbar contains search, scope, filters, sort, and view mode.
- Selection changes the inspector without navigating to a pseudo-screen or causing a layout jump.
- The inspector contains metadata, preview, and actions for the selected object.
- The primary action exists in one main location. The context menu is an accelerator, not the only path.
- Empty/loading/error/permission/stale/partial states use the same structure as data.

In a narrow window, panes may stack or the inspector may become a drawer, but the action and full path must not disappear. The Tauri config defines the minimum window size, which is verified during visual QA.

## Screen contracts

| Screen | Primary list | Inspector / primary action |
|---|---|---|
| Connection | recent/favorite profiles and form | detect/test/login/open workspace; password in memory only |
| Files / Local files | scoped workspace file tree, status filters | paths/status/size/changelist/history; sync/edit/add/ignore/delete/revert |
| Files / Depot files | directories, depot files, and inactive local-only entries | bounded folder/file history and sync preview |
| My Changes | pending changelists, opened and shelved sections | diff, reopen, shelve, unshelve, revert, submit |
| Streams | stream tree with visibility and Unactual | parent/child graph and safe stream switching |
| History | file revisions or submitted changes | preview/compare/export/annotate/undo |
| Shelves | server shelves | files, target changelist, unshelve/reshelve/export |
| Jobs | bounded jobs | fixes, explicit attach/detach |
| Labels | bounded labels | metadata/files and sync preview |

History and Labels remain available through Go To/command palette without occupying the main sidebar. Integration and full Resolve do not appear in navigation/actions before a working backend flow exists.

### Files

The end-to-end UI, Local Files cache, history, and safe-sync contract is in [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md). The shared resource-screen, selection, dialog, feedback, visual-language, and accessibility rules in this document apply to Files without repetition.

### Unactual

- In My Changes, a numbered changelist can be moved locally into the collapsible bottom Unactual section and restored through the context menu or by dragging a row between sections.
- Changelist rows support single, Ctrl/Cmd-toggle, and Shift-range selection; movement to/from Unactual applies to the whole selected group from the same section.
- When Actual and Unactual lists in My Changes or Streams do not fit vertically, the entire column scrolls; sections retain their content height and never overlap.
- Streams uses the same classification for a stream path; movement is available through the context menu and drag-and-drop, including a selected group of streams from one section. The object remains fully functional; only its UI position changes.
- The section drop target occupies all remaining Unactual space. Archiving a parent cascades to descendants; ordinary restore returns only selected paths, while separate context commands operate on all descendants.
- State is stored locally per server/user/workspace, does not change Helix Core, and is cleaned for vanished objects. Default changelist cannot be archived.

### Streams

- The left pane shows a bounded parent/child tree and visibility checkbox; the right shows a graph of enabled streams only. Text marks the current stream; color and a label mark type.
- The tree supports single, Ctrl/Cmd-toggle, and Shift-range multi-select. The top panel contains `Show selected` / `Hide selected`; `Show all` and `Hide all` change the whole set. A stream checkbox within a selection applies the action to the whole selection. Disabling a parent cascades through its subtree; enabling changes only the parent. Separate context commands show or hide all descendants. A partially visible subtree uses an indeterminate checkbox.
- Branches with child streams have a separate caret and `aria-expanded`; collapsed children disappear only from the tree and range-selection order, without changing graph visibility or selection state.
- Graph visibility, collapsed branches, and Unactual expansion are stored locally per server/user/workspace and restored between sessions.
- SVG preserves a fixed maximum node size with few streams; the current stream has a distinct fill and border in addition to its text label.
- Double-click, Enter, or the context menu opens the switch dialog. It independently selects a local strategy (`Shelve`/`Keep`) and content strategy (`Download now`/`Keep as is`).
- `Shelve` saves and reverts numbered changelists before switching; `p4 switch` handles Default work. `Keep` changes the client stream without immediately changing files. `Download now` after switching starts a sync preview and requires acknowledgment for writable modified files.
- After confirmed preview, `Download now` passes scopes to the shared safe-sync controller. Changing streams immediately invalidates the hidden Local Files tree, so returning to Files cannot show the previous stream's mapping.

## Selection, keyboard, and drag-and-drop

File lists support:

- click — single selection;
- Ctrl/Cmd+click — toggle;
- Shift+click — contiguous range;
- batch action over the whole selection;
- preserving existing IDs after refresh and removing stale selection.

These rules are identical for opened/shelved files in My Changes, files and folders in the workspace tree, changelists, Streams, and files in the selected shelf. One workspace-tree selection may contain files and folders simultaneously; no separate always-toggle mode is used for a similar list.

Drag-and-drop always has a button/context-menu equivalent. The cursor reflects semantics: reopen and movement to/from Unactual are moves; shelve/unshelve are copies. Invalid/external payloads are ignored; Default Shelf and Default changelist in Unactual reject drops.

Mandatory keyboard paths:

- `Ctrl/Cmd+K` — command palette;
- `Ctrl/Cmd+L` — Go To;
- `Ctrl/Cmd+1..5` — Files, My Changes, Streams, Shelves, and Jobs;
- `ContextMenu` or `Shift+F10` — context menu for the focused row;
- `Escape` — close a safe modal/menu;
- Tab/Shift+Tab — predictable focus order.

No action may be drag-only, hover-only, or color-only.

## Dialogs and destructive actions

- Use shared `Modal`/`ActionDialog`; browser-native `prompt` and `confirm` are prohibited.
- The title and primary button name the outcome: `Delete shelf`, `Revert 8 files`, not `OK`.
- The dialog shows scope and consequences; a dangerous default is not selected automatically.
- While a mutation runs, repeated submit and Escape closing are disabled.
- Enable force/overwrite separately for specific files; the safe default is Skip/Cancel.
- A disabled control must have a visible nearby reason or accessible tooltip/help text.

## Operations and feedback

Operations Center is the only UI progress/cancel/retry surface for one long operation. A feature does not render a duplicate progress block.

After Cancel, the button immediately enters disabled `Cancelling…` state. The backend stops the corresponding CLI process and publishes a terminal event; only then does the UI show persistent `Cancelled`, clear active state, and refresh the feature workspace. The panel is constrained to available window height, and its operation list scrolls internally.

While sync is active, the top heading row beside `WORKSPACE` shows a spinner, byte-based progress bar, processed/remaining files, ETA, and current file. The row spans the full width to the right edge above the title/action row; a long path is not narrowed by the action group or allowed to shift it. Final `totalFileCount`/`totalFileSize` come from tagged output of the already-running `p4 sync`, so a separate preview does not delay retrieval. After the main transfer, the same location briefly shows the check for remaining writable conflicts. This is a global indicator; cancel/retry and full diagnostics remain in Operations Center.

- Show operation kind, scope, status, processed count, current path, and a safe diagnostics summary.
- In Operations Center, counters and ETA are separate from the current path. A long path occupies up to two lines and is fully available through a tooltip; long diagnostics scroll inside the card without expanding the popup.
- Do not invent a percentage or ETA without server data.
- Cancel means stopping the process, not rollback.
- Retry is allowed only for an idempotent read/sync or a new explicitly confirmed flow; sync repeats with the exact original file/folder scopes. While sync is active, other Update/Retry actions do not start a parallel process.
- Success may be a transient toast; warnings/errors remain in the bounded CLI log until viewed or cleared.
- An error answers what was not done, why, and what is safe to do next. When overwrite was not confirmed completely, the entire explicitly selected set preserves its Overwrite decisions for a safe idempotent retry: an empty have list without confirmed physical replacement does not hide the file.

## Diff and preview

- Text diff: unified/split, line numbers, hunk navigation, and clearly visible whitespace mode.
- Show limits/truncation to the user; do not decode binary content as text.
- Previewing a revision/shelf does not change have/workspace state.
- Export writes only to a selected new path without implicit overwrite.
- File, folder, and changelist summaries do not pretend to be one text diff when different object types changed.

## Visual language

- Use tokens and existing selectors in `src/app/app.css`; do not add a competing local theme.
- UI icons come from the pinned `lucide-react` dependency. Use named imports of specific icons so Vite includes only used SVGs in the bundle; do not hand-copy `path`, use an icon font, emoji, or textual Unicode symbols as icons.
- An ordinary icon receives the `ui-icon` class (18×18 px, stroke 1.8). Navigation, file type/status, and other semantic roles may refine size through an existing shared selector in `src/app/app.css`, but do not create a feature-local scale.
- A decorative icon has `aria-hidden="true"`. An icon-only button retains localized `aria-label` and `title`; meaningful status remains available through text or `aria-label` and is never encoded by an icon alone.
- Build hierarchy with spacing, typography, and borders; color only supplements label/icon/status text.
- Controls are compact and stable; long paths are visually truncated but fully available through inspector/title/copy.
- Motion is brief and disabled under `prefers-reduced-motion`.
- English and Russian must fit without language-specific layout.

### Size system

Semantic CSS tokens in `src/index.css` are the only source of sizes. Feature components do not create their own scale.

| Role | Token / value | Use |
|---|---|---|
| Caption | 12/16 px | secondary metadata, timestamps, hints |
| Body | 14/20 px | primary text, list/tree rows, fields, actions |
| Subtitle | 16/22 px | inspector/dialog/section headings |
| Title | 20/28 px | resource-screen headings |
| Display | 28/36 px | large connection-screen heading only |
| Compact/default control | 32/36 px | toolbar/context controls and ordinary forms |
| Single/two-line row | 44/52 px | rows with one or two text levels |

- Readable text is at least 12 px. Use 10 px only for short optional badges/status markers, never for history, paths, descriptions, timestamps, or actions.
- Spacing uses a 4 px grid: 4, 8, 12, 16, 24, 32 px. An arbitrary intermediate value is allowed only for geometric icon or hairline alignment.
- Adjacent pointer targets are at least 32 px; the absolute accessibility floor is 24×24 CSS px.
- Files and folders within one tree are variants of the same row: identical row height, padding, primary/caption type, hover/focus/selection. Disclosure, icon, status, and allowed actions may differ.
- Do not create density by shrinking text. Use truncation with full-value access, wrapping, internal scroll, or responsive stacking for long content.
- History and diagnostics use Body for meaningful content and Caption for author, changelist, time, and technical details.

The rationale and original-state audit are in [`research/UI_STYLE_RESEARCH.md`](research/UI_STYLE_RESEARCH.md).

## Accessibility and performance

- Semantic `button`, `input`, `label`, and `table/list/tree` roles; visible focus.
- Selection, expanded, busy, error, and operation result are available to assistive technology.
- Verify keyboard-only use, Windows Narrator for key flows, and 200% scale.
- Server queries are always scoped/bounded. `//...` without a limit, debounce/cancel, or user intent is prohibited.
- Large lists receive pagination/incremental loading; virtualization is added after measurement and must not break selection/accessibility.
- Show a local loading state after 300 ms of reading; long work moves to Operations Center.
- The resource workbench occupies all available window height; a long tree or inspector scrolls inside its panel instead of shrinking the screen to content height.

## UI Definition of Done

- The flow works through UI → Rust → `p4` → refresh, not visually only.
- A frequent action is visible; a rare/destructive action is available through inspector/context menu with confirmation.
- Loading, empty, long text/path, permission error, partial result, and repeated refresh are verified.
- A keyboard equivalent and correct focus restoration after a dialog exist.
- Every new string is present in complete English/Russian packs.
- Visual QA is complete in English/Russian at 100/125/200%, the minimum window, and light/dark themes when themes are supported.
