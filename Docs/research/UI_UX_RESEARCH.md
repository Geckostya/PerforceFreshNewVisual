# P4FNV UI/UX research and original specification

> Research snapshot. Current implementation rules are in [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md).

Status: foundational product document<br>
Research date: July 21, 2026<br>
Scope: Helix Core desktop client for a developer's daily work

## 1. Document purpose

This document defines P4FNV's information architecture, screen structure, key-workflow behavior, and visual principles. It is the source of truth for interface design and complements the technical architecture in `ARCHITECTURE.md`.

The product goal is to give users the functional completeness needed for Perforce work without forcing them to think in CLI commands or understand P4V's structure. The interface must:

- Be quick to learn for developers familiar with Git clients.
- Accurately represent the Helix Core model.
- Retain enough density for large workspaces and changelists.
- Never hide the consequences of potentially destructive operations.
- Remain pleasant during hours of daily use.

This document uses these requirement levels:

- **must** — required for the first implementation of the corresponding screen.
- **should** — the default decision, changed only for a clear reason.
- **later** — deliberately outside the MVP.

## 2. Research inputs

The research is based on official documentation and current materials for these clients:

| Product | Areas studied | Value for P4FNV |
|---|---|---|
| Unity Version Control / Plastic SCM | Pending Changes, Incoming Changes, Branch Explorer, merge, Gluon | Task-based navigation, branch visualization, separation of local and external changes, and large-binary workflows |
| P4V | Main window, Depot/Workspace, changelists, Stream Graph, Revision Graph | Functional baseline and accurate Perforce model |
| GitKraken Desktop | Commit graph, WIP node, contextual Commit Panel, command palette, undo/redo | Strong visual history, contextual panel, and quick actions |
| Fork | Commit list, changes, diff, conflict resolver, repository tabs | High information density without overload |
| Sublime Merge | Overview/Details, line and hunk actions, search, command palette | Speed, keyboard-first workflow, and strong diff UX |
| GitHub Desktop | Changes/History, simple commit flow, recovery of discarded changes | Clarity, good action wording, and safe defaults |
| Tower | Working Copy, sidebar, Quick Actions, undo, snapshots | User confidence, predictable undo, and quick object navigation |

This is not an attempt to collect every competitor feature. We adopt proven patterns while preserving Perforce semantics.

## 3. Primary competitive-analysis findings

### 3.1 Plastic SCM / Unity Version Control

Strengths:

- Primary navigation is organized around work tasks: workspace, pending changes, changesets, and branches.
- The current workspace and branch remain visible.
- Pending Changes combines the check-in description, file tree/table, and preview.
- Changes can be grouped by type or changelist.
- Incoming Changes is clearly separated from local work.
- Branch Explorer places branches on a timeline and makes merge relationships tangible.
- Gluon demonstrates the value of a simplified workflow for large-binary users: select, download, lock, edit, and submit.

Weaknesses to avoid:

- Many small unlabeled icons.
- Important operations hidden in long context menus.
- Source and destination are easy to confuse during merge.
- Numerous visualization settings shift design responsibility to the user.
- Branch Explorer requires substantial effort to read complex history.
- The split between Plastic, Gluon, and Unity integration fragments the mental model.

P4FNV conclusion: use task-based navigation and a strong changes screen without separate application modes. Reveal complexity contextually.

### 3.2 P4V

Strengths:

- Covers nearly the entire Helix Core model.
- Honestly separates Depot Tree from Workspace Tree.
- Provides Pending/Submitted Changelists, Streams, Stream Graph, and Revision Graph.
- Supports configurable columns, filters, and large working sets.
- Exposes operation state and logs in a lower panel.

Weaknesses that create P4FNV's primary product opportunity:

- Navigation is organized around entities and tools rather than user intent.
- Three panes and many tabs create substantial visual noise.
- Primary actions are often available only through right-click.
- The toolbar contains many similar icons and disabled states.
- Separate graph windows break working context.
- Terminology is accurate but rarely explains action consequences.

P4FNV conclusion: P4V is a functionality checklist, not an interface layout.

### 3.3 GitKraken Desktop

Strengths:

- The three-zone `navigation → graph → context panel` model scales well.
- WIP is part of history and therefore visually connected to the future commit.
- Selecting a commit immediately changes the right pane to its details.
- Panes are resizable and preserve settings.
- Undo/Redo are visible and explain which action will be reversed.
- The command palette avoids hunting for rare actions in menus.
- Graph highlighting reduces noise from irrelevant branches.

Weaknesses:

- The central graph dominates even when the user is working with files.
- The sidebar is overloaded with integrations, issues, PRs, actions, and utility entities.
- A colorful graph easily becomes decorative noise.
- Numerous toolbar actions require learning.

P4FNV conclusion: a contextual panel and command palette are required, but history must not dominate Workspace or Changes.

### 3.4 Fork

Strengths:

- High data density with clear hierarchy.
- Tabs keep multiple repositories open.
- The commit graph is embedded in the regular history table.
- The selected commit and its files remain on the same screen.
- Image diff, file history, and conflict resolver are built in.
- The toolbar uses clear labels beside icons.

Weaknesses:

- Some hit targets and secondary text are too small.
- Some capabilities depend on context menus.
- The Git staging model consumes substantial visual space and does not apply to Perforce.

P4FNV conclusion: adopt compactness, tabs, and inline details, but do not copy Stage/Unstage.

### 3.5 Sublime Merge

Strengths:

- High interface speed is part of UX, not merely a technical detail.
- The Overview/Details structure is predictable.
- Diff supports file, hunk, and line workflows.
- Diff context can expand smoothly to the full file.
- A command palette and complete keyboard navigation accelerate power users.
- The primary-button label changes with process state, such as continuing rebase or completing cherry-pick.

Weaknesses:

- The interface assumes Git knowledge.
- High density and a keyboard-first approach can make onboarding harder.
- Rare features are less discoverable without the command palette.

P4FNV conclusion: diff and keyboard workflows must be first-class, but every action remains available by mouse and has a clear label.

### 3.6 GitHub Desktop

Strengths:

- Only two primary work tabs: Changes and History.
- The commit composer sits directly beside the changes list.
- The button includes the action target: `Commit to <branch>`.
- A destructive flow shows the affected-file list.
- Discarded changes move to Trash when the platform permits.
- Reset, Revert, Amend, and Cherry-pick are explained as distinct intentions.

Weaknesses:

- Complex graphs, integrations, and large repositories are not priorities.
- Many advanced capabilities are hidden.
- A single remote-hosting workflow model does not fit Perforce.

P4FNV conclusion: simple wording and explicit action scope are required, but the product must not remove professional workflows.

### 3.7 Tower

Strengths:

- The sidebar represents work areas, while the detail pane represents the selected object.
- Quick Actions searches commands, files, branches, and commits together.
- Undo/Redo covers a broad set of actions.
- The interface distinguishes reset, revert, and discard.
- Auto-stash/snapshots support safe context switching.

Weaknesses:

- Broad Undo in Git relies on a local model and does not transfer directly to Perforce server operations.
- Numerous automatic safeguards can hide actual state.

P4FNV conclusion: action history and compensating operations are useful, but the interface never promises Undo when a server operation can only be compensated by a new changelist.

## 4. Product position

P4FNV should sit between Fork and GitHub Desktop in visual complexity:

- Clearer and calmer than P4V.
- More capable than GitHub Desktop.
- Less graph-centric than GitKraken.
- More mouse-friendly than Sublime Merge.
- More honest about operation consequences than interfaces with universal Undo.

The key product metaphor is a **workspace centered on changes**, not a “Perforce command control panel.”

## 5. Git patterns that do not transfer

### 5.1 Do not create a staging area

In Perforce, a file already belongs to the default or a numbered changelist. A file checkbox may select it for a bulk action, but never means “staged.” Moving files to another changelist uses an explicit `Move to changelist…` action or drag-and-drop with a verifiable result.

### 5.2 Do not draw a false commit DAG

Helix Core submitted changelists do not form the same user-facing DAG as Git commits. Integration relationships appear only where the server reports them reliably:

- Stream Graph — stream relationships.
- Revision Graph — history of a specific file.
- Integrations — relationships among selected revisions/changes.
- History — a linear changelist table with integration markers, not a decorative Git graph.

### 5.3 Do not label different operations Undo

The interface must distinguish:

| Intent | UI label | Semantics |
|---|---|---|
| Remove unsubmitted local changes | **Revert local changes** | `p4 revert`; loses unsaved work |
| Retrieve an older revision into the workspace | **Get this revision** | Changes have revision/content without creating server rollback |
| Reverse the effect of a submitted change | **Create change rollback** | `p4 undo`; creates new pending changes for review and submit |
| Restore only selected files from history | **Restore files as a new change** | Creates a new pending changelist |

### 5.4 Do not hide the workspace

Every mutation depends on `P4CLIENT`. The current server, user, workspace, and stream must be visible before the action and within the preview for a potentially dangerous operation.

## 6. Interaction principles

### 6.1 Intent matters more than the command

Primary labels describe the result:

- `Update workspace`, not `Sync`.
- `Transfer change…`, not merely `Integrate`.
- `Create rollback`, not `Undo`.
- `Revert local changes`, not an unqualified `Revert`.

The official term or CLI command appears in secondary text, a tooltip, or technical details.

### 6.2 Context is always visible

The top bar always shows:

- Connection profile / server.
- User.
- Workspace.
- Stream or `classic workspace`.
- Connection status.
- Number of active/recently completed operations.

Changing workspaces is not a simple dropdown side effect: if opened files or an unfinished operation exist, the user sees the consequences first.

### 6.3 Selection → preview → action

All complex operations use one model:

1. The user selects an object or scope.
2. The application shows a server-generated preview.
3. The user sees the source, destination, files, and warnings.
4. The primary button names the result and object count.
5. The operation moves to the Operations Center and does not block the entire window.

Preview is required for sync with overwrite risk, submit, integrate, change transfers, restore/undo, and stream switching with local work.

### 6.4 Primary actions are not hidden

A context menu accelerates work but is never the only way to perform an important command. Primary actions for the selected object are repeated in a contextual toolbar or inspector.

### 6.5 Progressive disclosure

The first level shows safe, common parameters. Rare flags live under `Advanced options`, while selected non-default values appear in the pre-launch summary.

Do not create a separate `Beginner/Advanced mode`: modes hide capabilities and complicate maintenance. One interface reveals complexity contextually.

### 6.6 Predictable feedback

- An action receives visual acknowledgement within 100 ms.
- Reads under 300 ms need no spinner.
- After 300 ms, show local skeleton/progress.
- After 1 second, show an operation explanation.
- A long-running operation shows processed-file count, warnings, and cancellation.
- After a mutation, reread data from the server; the UI does not assume success optimistically.

### 6.7 Preserve control

- If an action is reversible, the snackbar offers a specific `Return file to Default changelist`.
- If compensation is required, the UI says `Create compensating change`, not `Undo`.
- Irreversible local changes require preview and typed scope, not annoying confirmation for every file.
- A disabled control always has a tooltip explaining why.

## 7. Information architecture

### 7.1 Primary navigation

Persistent sections:

1. **Workspace** — files, mapping, status, update, checkout/add/delete/revert.
2. **My Changes** — default/numbered changelists, diff, description, shelve, submit.
3. **History** — submitted changelists, file/folder history, compare, restore/undo.
4. **Branches** — streams, relationships, merge/integrate, workspace association.
5. **Shelves** — shelves and unshelve; appears after implementation.

Utility entry points:

- Global search / command palette.
- Operations Center.
- Connection/workspace switcher.
- Settings at the bottom of the sidebar.
- Help/diagnostics through the profile menu.

`Merge`, `Cherry-pick`, `Submit`, `Resolve`, and `Sync Preview` are not persistent navigation items. They are contextual workflows launched from a selected object.

### 7.2 Screen map

```text
Connection
  └─ Workspace selection
      └─ Workspace
          ├─ My Changes ── Submit / Shelve
          ├─ History ───── Compare / Restore / Undo
          ├─ Branches ──── Merge / Integrate
          └─ Shelves ───── Diff / Unshelve

Any screen
  ├─ Command palette / Search
  ├─ Operations Center
  ├─ Connection & workspace switcher
  └─ Settings

Merge / Integrate
  └─ Preview
      ├─ Apply to workspace
      ├─ Resolve conflicts
      └─ Pending changelist → Submit
```

## 8. Application shell

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ P4FNV │ server / user │ workspace / stream │ Search ⌘K │ operations │ ● │
├──────────────┬──────────────────────────────────────────┬────────────────┤
│ Workspace    │ Page title                      Actions │ Inspector      │
│ Changes   12 │──────────────────────────────────────────│ selected item  │
│ History      │                                          │ metadata       │
│ Streams      │ Tree / table / graph / diff             │ common actions │
│ Shelves      │                                          │ warnings       │
│              │                                          │                │
│              │                                          │                │
│ Settings     │                                          │                │
├──────────────┴──────────────────────────────────────────┴────────────────┤
│ Operation: Sync 241/920 files                         Cancel │ Details  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Top context bar

Height around 48 px. Left to right:

- Application name / repository context.
- Connection profile and user.
- Workspace switcher.
- Stream badge.
- Global search/command field.
- Operations indicator.
- Connection status and profile menu.

The full path, server, and workspace are available on hover/click. A truncated string is never the only place to discover context.

### 8.2 Sidebar

- Expanded width: approximately 216–232 px.
- Collapsed width: approximately 52–56 px.
- Icon plus text when expanded.
- Badges show only actionable counts: pending files, conflicts, and failed operations.
- Arbitrary server entities are not added to the top level.
- The current section has a background, accent marker, and correct accessible state.

### 8.3 Main surface

Every section uses the same frame:

- Title plus compact context.
- Primary action on the right.
- Filter/search row.
- Main representation.
- Optional inspector on the right.

The inspector is resizable and defaults to 340–400 px. Below 1100 px wide, it becomes an overlay drawer. Size settings persist separately for each section.

The current baseline implementation follows My Changes: a page heading, compact toolbar, and stable list/inspector workbench. Workspace, History, Depot, Shelves, Jobs, and Labels do not open details as a separate pseudo-screen or duplicate primary commands in both header and toolbar. Selecting a row changes inspector content; previews remain inline or open in the shared modal when a mutation requires separate confirmation.

### 8.4 Operations Center

The collapsed strip is always available at the bottom. When expanded, it shows a queue:

- Action and scope.
- Server/workspace.
- Start time and duration.
- Determinate or indeterminate progress.
- Current file without leaking credentials.
- Warnings/errors.
- Cancel, Retry, and Copy diagnostics.

A completed operation does not vanish immediately. A successful operation remains briefly in the strip; warnings/errors remain until viewed or dismissed.

A feature screen does not render a second progress/cancel block for the same operation. After launch, the modal closes, the Operations Center becomes the sole owner of progress, cancellation, and retry, and the feature only rereads server state on the terminal event.

## 9. Screen specifications

### 9.1 First connection

Goal: take the user from launch to a valid `p4 info` without requiring knowledge of environment variables.

```text
┌─────────────────────────────────────────────────────────────┐
│ Connect to Helix Core                                      │
│ p4 detected: C:\Program Files\Perforce\p4.exe  2025.1 ✓   │
│                                                             │
│ Server       ssl:perforce.company.net:1666                  │
│ User         alex                                           │
│ Workspace    alex-main                                      │
│ Charset      Automatic                              Advanced │
│                                                             │
│ [Test connection]                    [Open workspace]        │
└─────────────────────────────────────────────────────────────┘
```

Required:

- Automatically discovered `p4` with its version and an option to change the path.
- server, user, optional charset;
- Inline validation rather than errors only after submit.
- Separate states for SSL trust, login, SSO/MFA, and permission denied.
- `Open workspace` is available without a mandatory prior `Test connection`: one action validates the server and active login ticket, then opens the specified workspace or leaves the user on the form with a precise error.
- `Test connection` remains a supporting action: after successful info, it loads existing workspaces with owner, host, root, and stream.
- The last successfully opened connection with a workspace is saved; on the next launch, the application checks the ticket through `p4 login -s` and opens the workspace immediately when the session is valid.
- An explicit `Exit workspace` is always available from a workspace, returning to the initial screen without deleting the profile or running `p4 logout`.
- Workspace creation is available as a secondary action but is not mixed with selection.
- A connection profile stores only non-secret fields.

Never show technical stderr instead of a user-facing explanation. Technical details expand through a link.

### 9.2 Workspace

Goal: understand file state and perform daily file operations.

```text
┌ Workspace: game_alex_win ─ //Game/dev ───────── [Update workspace] ┐
│ path: C:\work\game   [All] [Open] [Modified] [Outdated]   Filter  │
├──────────────────────────────────────────────┬─────────────────────┤
│ Name                          Status   Head  │ selected file       │
│ ▾ Source                                     │ local/depot path    │
│   Player.cpp                 Modified   ✓    │ changelist          │
│   Player.h                   Open       ✓    │ lock / owner        │
│ ▾ Content                                    │ revision / history  │
│   Hero.fbx                   Outdated   #18  │                     │
│                                              │ [Diff] [History]    │
│                                              │ [More…]             │
└──────────────────────────────────────────────┴─────────────────────┘
```

Structure:

- Breadcrumb and local root.
- Tree/list toggle with remembered selection.
- Filters: `All`, `Opened`, `Locally modified`, `Needs update`, and `Not in depot`.
- columns: name/path, local status, changelist, head/have, lock owner, file type;
- Inspector: separate depot/client/local paths, revision, changelist, lock, stream, and last submitted change.
- contextual actions: Open, Reveal in Explorer, Diff, History, Check out, Add, Mark for delete, Move, Revert, Copy path variants.

`Update workspace` opens a preview when the operation affects locally modified/open files or a large volume. An ordinary safe update may start with one click and move to the Operations Center.

Do not create a separate global `Incoming` screen that imitates DVCS. In Perforce, `have < head` appears as `Needs update` in Workspace, a banner, and a filter. A separate pane may appear later if server data provides a useful changeset-oriented preview.

### 9.3 My Changes

This is the application's primary screen.

```text
┌ My Changes ───────────────────────────────────── [New changelist] ┐
├ changelists ─────┬ files ───────────────────────┬ diff / details ┤
│ Default       3  │ Modified                     │ Player.cpp     │
│ CL 1042      12  │  M Player.cpp               │ unified/split  │
│   NET-284         │  M Player.h                 │ diff           │
│ CL 1038       1  │ Added                        │                │
│   WIP shaders     │  A NetDriver.cpp            │                │
│                   │ Deleted                      │                │
│                   │  D OldDriver.cpp            │                │
├───────────────────┴──────────────────────────────┴────────────────┤
│ Description: Fix reconnect race...            [Submit 12 files] │
└──────────────────────────────────────────────────────────────────┘
```

Left column:

- Default changelist is always first.
- Numbered changelists show ID, first description line, file count, shelved indicator, and conflict/warning badge.
- The user may reorder presentation only, not server identity.
- `New changelist` and filter.
- Empty changelists can be hidden by a toggle but are never lost.

Center column:

- Files in the selected changelist.
- Grouping by status or folder.
- Row selection for bulk actions, without stage-checkbox semantics.
- Drag-and-drop between changelists invokes `reopen` and highlights the destination.
- keyboard alternative: `Move to changelist…`;
- After a move, show the snackbar `3 files moved to CL 1042 — Undo`.
- Status uses an icon plus text/tooltip, not color alone.

Right column:

- code diff unified/split;
- image diff side-by-side/overlay/blink;
- Binary metadata for unsupported previews.
- quick links History, Open in editor, Reveal, Copy path;
- Full-screen diff through `Enter`/double-click.

Bottom composer:

- Description is edited inline and has saved/unsaved state.
- Optional jobs/fixes expand in a separate block.
- Actions: `Shelve`, `Revert…`, and `Submit N files`.
- Submit is disabled with a specific reason: empty description, unresolved files, permissions, or empty changelist.

### 9.4 Submit review

Submit opens as a wide right sheet or focused full-window task, not a small modal.

Sections:

1. Changelist ID and workspace.
2. Description and jobs.
3. files grouped by action;
4. automated checks: unresolved, out-of-date, locks, missing files, server warnings;
5. advanced submit options;
6. Final button: `Submit 12 files`.

When preflight is clean, the user sees a compact summary. Errors expand the problematic group and provide a direct action: `Show 2 unresolved files`.

After launch, the sheet closes and the operation appears in the Operations Center. On success, submitted-changelist details open. On a partial/unknown result, the application rereads the changelist from the server.

### 9.5 Change history

```text
┌ History ─────────────────────────────────────── Search / filters ┐
├ filters ────────┬ submitted changes ───────────┬ change details ┤
│ Path            │ 1048  Fix reconnect race     │ description    │
│ User            │       Alex · 12 files · 5m   │ author / date  │
│ Date            │ 1047  Update hero materials  │ jobs / stream  │
│ Stream          │       Maya · 4 files · 1h    │ changed files  │
│ Has integrations│ 1046  Merge dev → main       │ diff preview   │
└─────────────────┴───────────────────────────────┴────────────────┘
```

Required:

- virtualized chronological list/table;
- Query/filter by number, user, description, path, date range, and stream.
- saved recent filters;
- Selected changelist details in the inspector.
- Files and diff do not require a new window.
- Multi-select of two compatible revisions enables `Compare`.
- Actions: `Transfer change…`, `Create rollback…`, `Get files from this revision…`, and `Open file history`.
- An integration marker appears only when server data exists.

History does not draw decorative lines among all changelists. Revision Graph is available for a specific file and Stream Graph for streams.

### 9.6 File history and Revision Graph

The screen opens from Workspace, Changes, or History and preserves the return path.

Modes:

- `List` — revisions, action, changelist, author, date, type, and file size.
- `Graph` — integrations/branches for the specific file.
- `Blame` — later.
- `Compare` — two selected revisions.

Current have/head revisions use text badges. Selecting one revision shows a preview. Selecting two enables comparison without drag-only interaction.

Primary actions:

- `Get this revision`.
- `Compare with workspace`.
- `Compare with previous`.
- `Restore as a new change`.
- `Transfer revision…` when the integration flow supports it.

### 9.7 Branches (Streams)

```text
┌ Streams ── depot: //Game ───────────────────── [New workspace] ┐
│ [Tree] [Graph]                    Filter owner/type/name        │
├ stream tree ──────────┬ relationship graph ─────┬ details ────┤
│ mainline main         │        main              │ //Game/dev  │
│ ├─ dev  ● workspace   │       /    \             │ parent main │
│ │  ├─ task/net-284    │     dev   release        │ flow rules  │
│ └─ release            │      |                  │ workspace   │
│                       │   task/net-284           │ [Merge…]    │
└───────────────────────┴──────────────────────────┴──────────────┘
```

Principles:

- Tree and graph synchronize selection.
- The current-workspace marker is visible in both representations.
- Stream type uses shape/icon plus label, not color alone.
- Focus mode dims irrelevant branches instead of removing them.
- The graph has zoom/pan and a minimap only when content exceeds the viewport.
- Filters do not hide required ancestors; they appear muted.
- The detail inspector shows parent, type, owner, paths, flow rules, associated workspaces, and last activity.
- Merge begins with an explicit source/target preview.

A Branch Explorer-like temporal history may appear later as `Activity timeline`, but it is not mixed with the hierarchical Stream Graph.

### 9.8 Merge / Integrate

The primary goal is to prevent direction mistakes.

```text
┌ Merge changes ─────────────────────────────────────────────────┐
│                                                               │
│  Source                         Target                         │
│  //Game/dev                     //Game/main                    │
│  latest CL 1048       ───────▶  workspace game_alex_main      │
│                                                               │
│  Will apply: 37 files · 4 deletions · 2 possible conflicts     │
│  [View files] [Advanced options]                              │
│                                                               │
│  The result will appear in new pending changelist CL 1051      │
│                                      [Apply to workspace]      │
└───────────────────────────────────────────────────────────────┘
```

Required:

- Source on the left, destination on the right, and a large directional arrow.
- Destination includes workspace and stream.
- Server-generated preview before apply.
- Summary of actions and potential conflicts.
- File list with reason/action.
- Advanced integration flags are collapsed.
- The result is never submitted automatically: first pending changelist, resolve, and review.
- step indicator: `Preview → Apply → Resolve → Review → Submit`;
- Closing the task does not lose ongoing merge state.

Buttons such as `Keep source`/`Keep destination` are not used without context. Wording always includes a clear object: `Use version from //Game/dev` and `Keep workspace version`.

### 9.9 Transfer a selected change (cherry-pick)

Launched from a submitted changelist or several sequential changes.

The flow resembles Merge, but the source card contains change numbers and a revision list. Primary copy:

- Title: `Transfer change`.
- Subtitle: `Apply the contents of CL 1042 to //Game/release`.
- Button: `Apply 8 files to workspace`.

If some revisions are already integrated, they appear in a separate group and are not reapplied by default. The user can expand the technical explanation.

### 9.10 Resolve conflicts

```text
┌ Resolve 3 conflicts ───────────────────────────────────────────┐
├ files ─────────┬ source ─────────┬ result ────────┬ workspace ┤
│ Player.cpp  2  │ //Game/dev      │ editable       │ destination│
│ Hero.fbx    bin │ changed block   │ merged output  │ local block│
│ Config.json 1  │ [Use source →]  │                │ [← Keep]  │
├────────────────┴─────────────────┴────────────────┴───────────┤
│ 1 of 3 resolved                     [Save] [Next conflict]    │
└───────────────────────────────────────────────────────────────┘
```

For text conflicts:

- Three primary meanings: source, result, and workspace/destination.
- Base is available through a toggle rather than occupying a permanent fourth column.
- Linked scrolling and syntax highlighting.
- Previous/next conflict navigation.
- Take controls live beside the specific hunk.
- Resolved status persists per file.
- Before completion, show unresolved count and output validation.

For binary/directory conflicts:

- Do not show an empty code editor.
- side-by-side metadata/preview;
- File size, author, date, revision, and image/3D preview where possible.
- Actions use complete wording.
- Option to open an external merge tool.

### 9.11 Shelves

The screen appears after the MVP:

- List of own and accessible shelves with owner/date/description/file count.
- Filters: `Mine`, `Workspace`, `User`, and `Date`.
- Selected-shelf details and diff.
- `Apply to workspace…`, `Delete shelf…`, and `Compare`.
- Unshelve always shows the destination changelist and collision preview.
- After shelving, the UI explicitly asks/shows whether local changes remain.

### 9.12 Global search and command palette

Shortcut: `Ctrl+K` or `Ctrl+P`; verify the final shortcut against platform conventions.

Search combines:

- Commands.
- files/paths;
- changelist numbers;
- streams;
- workspaces;
- users;
- recent destinations.

Results are grouped and include secondary context. A command requiring parameters does not run immediately; the palette routes to a compact parameter picker or complete preview.

Examples:

- `1042` → open a submitted/pending changelist.
- `Player.cpp` → workspace file, file history, depot result;
- `release` → stream and workspace.
- `revert` → `Revert local changes…`, not immediate execution.

### 9.13 Settings

Full-screen page with limited content width. Groups:

- Connections;
- Language (Russian / English, with support for adding complete dictionaries).
- Perforce executable and environment;
- Appearance and density;
- Diff and merge;
- External tools;
- Notifications;
- Keyboard shortcuts;
- Diagnostics and privacy.

Settings changed in daily context remain next to the object. Settings contains only durable preferences.

## 10. End-to-end workflows

### 10.1 Daily submit

```text
Changes badge → select changelist → inspect diff → edit description
→ Submit review → resolve preflight issues → Submit → submitted details
```

Target path for a clean changelist: no more than two deliberate actions after completing review — `Submit`, followed by confirmation only when a warning exists.

### 10.2 Update workspace

```text
Update workspace → quick preflight
  ├─ safe → operation starts
  └─ risk exists → preview affected files → Update / Cancel
→ progress → refresh statuses → summary
```

### 10.3 Switch stream/workspace with local changes

```text
Select destination → detect opened/local files
→ options with consequences:
   Shelve and switch / Move work when supported / Stay here
→ preview → operation → destination context visibly changes
```

Never silently transfer local work between streams.

### 10.4 Roll back a submitted change

```text
History → select CL → Create rollback
→ explain new pending change → server preview
→ choose destination changelist → Apply
→ review diff in My Changes → Submit
```

### 10.5 Merge

```text
Streams → choose source → Merge into… → explicit source/target preview
→ Apply → resolve conflicts → review pending changelist → Submit
```

## 11. Table, tree, and selection rules

- row height: 32 px compact, 38 px comfortable;
- headers sticky;
- Column resizing/reordering is available and persists per view.
- Default columns cover 80% of the workflow; others live in the column chooser.
- Sorting shows direction and precedence.
- Hierarchy expands through an arrow; double-click must never unexpectedly perform a destructive action.
- Single-click selects; Enter opens primary detail.
- Space toggles a checkbox only where the checkbox has real semantics.
- Shift/Ctrl selection follows platform conventions.
- Select all applies to the current filtered scope and states the count explicitly.
- On data refresh, selection persists by stable ID if the object exists.
- A virtualized list does not break keyboard navigation or screen-reader semantics.

## 12. Diff UX

Shared capabilities:

- Unified and side-by-side.
- collapse unchanged regions;
- Expand context by several lines or to the full file.
- Ignore-whitespace toggle with a visible active state.
- syntax highlighting;
- Next/previous file and next/previous change.
- sticky file header;
- Word-level highlights within changed lines.
- copy path, copy selection, open in editor;
- Line numbers are not the only click target for an action.
- Large/binary files show a deliberate fallback, not a frozen blank surface.

Image diff:

- side-by-side;
- overlay opacity slider;
- blink A/B;
- actual size / fit;
- dimensions, format, file size;
- Checkerboard for alpha.

3D preview belongs to a later version, but the preview layout must allow adding a renderer without redesigning the screen.

## 13. Visual language

### 13.1 Character

The interface is calm, precise, and tool-like. It must not resemble a game launcher, a 2000s admin panel, or a web dashboard with oversized cards.

Principles:

- Content matters more than chrome.
- Flat surfaces are separated by thin borders and tone, not persistent shadows.
- Accent is used for focus, selection, and the primary action.
- Semantic colors are reserved for status.
- Gradients, glass, and decorative animation are not used in work areas.
- Density is high, but whitespace preserves grouping.

### 13.2 Typography

- UI: system stack, prioritizing `Segoe UI Variable` / `Segoe UI` on Windows.
- Diff/code: `Cascadia Mono`, then platform monospace.
- Body: 13–14 px at 100% desktop scale.
- Secondary metadata: at least 12 px.
- page title: 20–22 px semibold;
- section title: 14–16 px semibold;
- Uppercase is not used for long headers and buttons.

### 13.3 Spacing and geometry

- Base grid: 4 px; primary intervals are multiples of 8 px.
- Border radius: 6 px for controls, 8 px for dialogs/drawers.
- Primary buttons are at least 32–36 px high.
- Icon buttons have a hit target of at least 28–32 px.
- The splitter has a visually thin line and an expanded interactive area.
- Content stays at least 12 px from pane edges except in virtualized table rows.

### 13.4 Themes

Light and Dark are equal. Do not invert colors mechanically.

Dark direction:

- Background is nearly neutral dark, not pure black.
- Surfaces differ by a small but visible luminance.
- Primary text is softer than pure white.
- Diff green/red have sufficient contrast without saturating large areas.

Light direction:

- Soft off-white background.
- Borders are visible without heavy shadows.
- Selected rows remain visible beside diff colors.
- Disabled text remains readable.

Specific tokens are approved after contrast checks on real tables/diffs, not on an isolated palette board.

### 13.5 Icons

- One 16/18 px outline set.
- Primary toolbar actions receive text labels.
- Icon-only is acceptable for familiar actions beside context: search, refresh, close, and more.
- Every icon-only control has a tooltip and accessible name.
- A status icon always includes shape/text/tooltip support.
- Do not use different icons for the same action on different screens.

### 13.6 Motion

- 120–180 ms for hover, selection, and drawer transitions.
- Progress represents work rather than entertaining.
- Graph transitions preserve spatial context.
- `prefers-reduced-motion` disables movement while retaining opacity/state changes.
- No animation delays input or navigation.

## 14. Status system

Minimum file-status vocabulary:

| State | Icon/shape | Color role | Text |
|---|---|---|---|
| Modified / open for edit | pencil / M | accent-warning | Modified |
| Added | plus / A | success | Added |
| Deleted | minus/trash / D | danger | Deleted |
| Moved | arrow / R | info | Moved |
| Outdated | download arrow | warning | Needs update |
| Locked by me | closed lock | accent | Locked by you |
| Locked by other | lock + user | danger/warning | Locked: user |
| Unresolved | conflict diamond | danger | Needs resolve |
| Shelved | archive | neutral-info | Shelved |
| Not in depot | hollow file | neutral | Untracked |

Color cannot be the only information carrier. A legend is available through a help tooltip, but ordinary work must not require memorizing it.

## 15. Text and microcopy

### 15.1 The button describes the result

Good:

- `Submit 12 files`.
- `Apply CL 1042 to //Game/release`.
- `Revert changes in 3 files`.
- `Create new rollback changelist`.

Bad:

- `OK`;
- `Run`;
- `Process`;
- `Undo` without an object.
- `Merge` without source/target.

### 15.2 An error answers three questions

1. What failed?
2. Why did it happen?
3. What can the user do now?

Example:

> Could not submit CL 1042: two files require resolve. Open the conflicting files or leave the changelist unchanged.

Actions: `Show conflicts`, `Copy technical details`.

### 15.3 Terminology

The first appearance of a complex Perforce term may include an explanation:

- `Workspace`.
- `Changelist`.
- `Branch (stream)`.

After introduction, the interface uses the short form. Do not replace terms so completely that Perforce documentation becomes impossible to find.

## 16. Accessibility

The baseline goal is WCAG 2.2 AA for the webview UI and complete desktop keyboard usability.

Required:

- Contrast of at least 4.5:1 for normal text and 3:1 for large text.
- Visible focus on every interactive control.
- Focus is not hidden by sticky headers/drawers.
- logical tab order;
- Arrow-key navigation within tree/table/list.
- At least 24×24 CSS px per target or sufficient spacing; working target is 28–32 px.
- Resize UI to 200% without losing actions.
- screen reader names, roles, selected/expanded/busy states;
- Announcements for completed operations, errors, and selection-context changes.
- Status is not encoded only by color.
- Diff additions/deletions have a symbol/text and accessible description.
- Drag-and-drop always has a keyboard alternative.
- Do not rely on hover alone.

Checks run keyboard-only, with Windows Narrator, and with at least one additional screen reader on a supported platform.

## 17. Empty, loading, error and offline states

Every screen is designed in at least six states:

1. normal data;
2. loading;
3. empty expected;
4. empty because of filter;
5. permission/connection error;
6. partial/stale data.

Examples:

- Changes empty: `No files are open in the workspace` plus `Refresh`.
- Filter empty: `Nothing matches the current filters` plus `Reset filters`.
- Connection lost: data remains visible with a `Stale` badge; mutations are disabled with a reason.
- Partial result: show received rows and a non-blocking warning.
- First run: explain the next action instead of showing an empty table.

The skeleton matches the future row structure and is not used for a server operation of unknown duration. The Operations Center shows real status for long-running requests.

## 18. Keyboard model

Minimum set:

| Action | Shortcut |
|---|---|
| Command palette / global search | `Ctrl+K` or the final selected shared shortcut |
| Refresh current view | `F5` |
| Open selected item | `Enter` |
| Close detail/task | `Esc` |
| Find/filter in current view | `Ctrl+F` |
| New changelist | `Ctrl+N` in the Changes context |
| Submit selected changelist | `Ctrl+Enter` after review |
| Navigate panes | `F6` / `Shift+F6` |
| Next/previous diff change | configurable standard shortcuts |

All shortcuts appear in menus/tooltips/the command palette. Never assign a destructive action to a single easily pressed key without preview.

## 19. Performance as part of UX

- The window becomes usable before background refresh completes.
- Large lists are virtualized.
- Expanding a folder loads only the required scope.
- Search has debounce and cancellation.
- Stale data is not cleared during refresh; rows remain with progress state.
- Returning focus to the desktop window triggers a throttled background refresh for the current screen; persistent polling and a filesystem watcher are not used.
- Large-file diffs load in chunks.
- Changing selection does not launch optional heavy requests until after a short delay.
- Background refresh does not steal focus or reset scroll.
- An operation in one pane does not block navigation through cached/read-only data in another.
- The user can cancel a long `sync`, `fstat`, history, or integrate preview.

Target UX budgets are refined on real servers but measured as time-to-first-row, time-to-interactive, and sustained 60 FPS during scrolling, not only total command time.

## 20. Personalization without shifting design responsibility to the user

Allowed:

- Light/Dark/System;
- Compact/Comfortable density;
- column visibility/order/width;
- pane sizes and collapsed state;
- unified/split diff;
- external editor/merge tool;
- shortcuts;
- Saved filters.

Do not add:

- Arbitrary coloring for every status.
- Dozens of toolbar layouts.
- Separate beginner/expert modes.
- UI plugins before the core workflow is stable.
- A setting that compensates for a poor default instead of fixing the default.

## 21. Design validation

### 21.1 Prototypes before implementation

A clickable prototype is created for every core screen in at least normal, empty, loading, and error states. Prototypes are checked at 1024×720, 1280×800, 1440×900, and 200% scale.

### 21.2 User testing

Minimum sample per major iteration:

- 3–4 developers with Perforce/P4V experience.
- 2 developers with Git GUI experience but no Perforce experience.
- 1 build/release engineer or technical artist for large files/locks.

Tasks:

1. Find a modified file and identify its changelist.
2. Move files to a new changelist and submit.
3. Find who changed a line/file and when.
4. Retrieve an old revision without creating server rollback.
5. Create a rollback for a submitted changelist.
6. Transfer a selected change to a release stream.
7. Explain merge direction before launch.
8. Cancel a long sync and understand the final state.

Measure:

- Task success without prompts.
- time to completion;
- Number of incorrect launches/backtracks.
- Understanding of source/destination.
- Understanding the distinction among Get Revision / Revert Local / Create Rollback.
- Subjective confidence before Submit/Merge/Undo.
- discoverability keyboard and mouse paths.

### 21.3 UX acceptance criteria

A screen is not ready when:

- The primary action is available only through a context menu.
- Loading/error/empty states are undefined.
- A keyboard user cannot complete the primary workflow.
- Source/target or workspace is hidden in a destructive flow.
- Status is understandable only by color.
- After cancel/error, the user cannot determine what actually changed.
- A screen reader does not receive selection, progress, and error state.
- Scroll/selection resets after an ordinary refresh.

## 22. Implementation priority

### Stage UI-0 — Design foundation

- application shell;
- themes, typography, spacing, status icons;
- table/tree primitives;
- inspector and split panes;
- dialog/sheet and Operations Center;
- focus/keyboard model.

### Stage UI-1 — first vertical workflow

- connection;
- workspace context bar;
- My Changes with opened files and pending changelists.
- file move between changelists;
- basic diff;
- error and loading states.

### Stage UI-2

- Workspace tree/status;
- update preview and operation progress;
- edit/add/delete/revert;
- Submit review.

### Stage UI-3

- History and file history;
- compare;
- Get Revision;
- Create Rollback.

### Stage UI-4

- Streams tree/graph;
- integrate/cherry-pick preview;
- conflict resolver.

### Stage UI-5

- Shelves;
- image diff improvements;
- advanced search, saved filters and personalization.

## 23. Sources

Official product sources:

- [Unity Version Control: Pending Changes](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/pending-changes-tab)
- [Unity Version Control: Merge reference](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/merge-reference)
- [Unity Version Control: Settings](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/settings-window)
- [Unity Version Control: Gluon](https://docs.unity.com/en-us/unity-version-control/gluon/gluon)
- [P4V navigation and layout](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.navigating.html)
- [P4V Stream Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.graph.html)
- [P4V Revision Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/advanced_files.revgraph.html)
- [GitKraken interface](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [Fork](https://fork.dev/)
- [Sublime Merge getting started](https://www.sublimemerge.com/docs/getting_started)
- [Sublime Merge diff context](https://www.sublimemerge.com/docs/diff_context)
- [GitHub Desktop changes and commits](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- [Tower interface overview](https://www.git-tower.com/help/guides/first-steps/tower-overview/mac)
- [Tower undo](https://www.git-tower.com/features/undo)

Design and accessibility references:

- [Microsoft Windows app design guidelines](https://learn.microsoft.com/en-us/windows/apps/design/guidelines-overview)
- [Microsoft commanding guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/commanding)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Apple Human Interface Guidelines: Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
