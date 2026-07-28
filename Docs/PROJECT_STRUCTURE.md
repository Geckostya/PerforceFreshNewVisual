# Project structure

## Purpose of the structure

The structure must make feature code easy to find without forcing developers to maintain layers that do not yet provide value. The frontend's primary organizational unit is a user feature; the backend's is a safe Perforce operation.

The project remains one Tauri application in one repository. A monorepo, separate packages, a plugin SDK, and a general "Perforce SDK" are not needed at the outset.

## Target structure

```text
P4FNV/
├─ Docs/
│  ├─ README.md                 # entry point and contract owners
│  ├─ DOCUMENTATION_POLICY.md   # progressive disclosure and ownership rules
│  ├─ ARCHITECTURE.md           # boundaries, data flows, decisions
│  ├─ WORKSPACE_FILES.md        # Files, Local Files cache, and safe sync
│  ├─ PROJECT_STRUCTURE.md      # code-placement rules
│  ├─ P4_FEATURE_CHECKLIST.md   # prioritized backlog and implementation status
│  ├─ UI_UX_SPECIFICATION.md    # working UI/UX contract
│  ├─ CHANGELIST_REQUIREMENTS.md # complex changes/shelves/submit semantics
│  ├─ TOOLCHAIN.md              # environment and installation verification
│  ├─ LOCALIZATION.md           # language-pack format and installation
│  └─ research/                 # history, research, and full source catalogs
├─ locales/                     # external JSON translations for the shipping build
│  ├─ en.json
│  └─ ru.json
├─ scripts/
│  ├─ toolchain.ps1             # local development environment
│  └─ copy-locales.mjs          # copy packs beside the release executable
├─ tools/
│  └─ p4fnv-agent/              # local STDIO MCP and native app lifecycle
├─ .codex/
│  └─ config.toml               # project-scoped MCP registration
├─ src/                         # React + TypeScript frontend
│  ├─ app/
│  │  ├─ App.tsx                # window shell and top navigation
│  │  └─ app.css                # theme, grid, and design tokens
│  ├─ features/
│  │  ├─ connection/            # server, user, workspace, login
│  │  ├─ changes/               # changelists, shelves, submit, DnD
│  │  ├─ workspace/             # workspace files, sync, reconcile, resolve
│  │  ├─ streams/               # stream tree/graph and switch orchestration
│  │  │  └─ streamPreferences.ts # scoped visibility/collapse preferences
│  │  ├─ depot/                 # read-only depot browser
│  │  ├─ history/               # file/submitted history, compare, undo
│  │  ├─ shelves/               # shelf browser, unshelve, reshelve, export
│  │  ├─ jobs/                  # jobs and fixes
│  │  └─ labels/                # labels and sync preview
│  ├─ shared/
│  │  ├─ ItemList.tsx           # shared selectable/list/tree row behavior and markup
│  │  ├─ ChangelistDescription.tsx # safe Markdown display/editor for changelist descriptions
│  │  ├─ api.ts                 # typed Tauri invoke/event calls
│  │  ├─ i18n.tsx               # pack loading, fallback, and current UI language
│  │  ├─ models.ts              # DTOs genuinely shared by multiple features
│  │  ├─ operations.ts          # shared subscription and long-operation model
│  │  ├─ ChangelistHistory.tsx  # shared submitted-changelist history panel and rows
│  │  ├─ localArchive.ts        # scoped cosmetic Unactual IDs and validated DnD payload
│  │  ├─ useLocalArchive.ts      # shared lifecycle for persistent Unactual state
│  │  ├─ useArchiveDragDrop.ts  # shared WebView-safe DnD between actual/Unactual
│  │  ├─ selection.ts            # shared selection and keyboard-interaction rules
│  │  ├─ useMultiSelection.ts     # shared state/anchor lifecycle for list multiselect
│  │  ├─ useContextMenu.ts        # shared pointer/keyboard context-menu positioning
│  │  ├─ SafeSync.tsx            # shared safe-sync post-check, preview, and conflict UI
│  │  ├─ OperationsCenter.tsx   # the only progress/cancel/retry surface
│  │  ├─ uiSnapshot.ts          # opt-in DOM snapshot and allow-listed agent actions
│  │  └─ View.tsx               # shared page/dialog/empty/error vocabulary
│  ├─ main.tsx
│  └─ index.css                 # reset and global base styles
├─ src-tauri/
│  ├─ capabilities/
│  │  └─ default.json           # minimum window permissions
│  ├─ src/
│  │  ├─ main.rs                # desktop entry point
│  │  ├─ lib.rs                 # Tauri setup, commands, and managed state
│  │  ├─ p4.rs                  # allowed domain operations and parsers
│  │  ├─ p4/
│  │  │  ├─ jobs.rs             # jobs/fixes operations and parsers
│  │  │  ├─ labels.rs           # labels operations and parsers
│  │  │  ├─ runner.rs           # process boundary, JSON Lines, errors, CLI log
│  │  │  └─ validation.rs       # shared validation of P4 identifiers and form values
│  │  ├─ commands.rs            # allowed UI operations
│  │  ├─ diagnostics.rs         # opt-in snapshot and tokenized agent mailbox
│  │  ├─ models.rs              # serializable application models
│  │  └─ settings.rs            # nonsecret local settings
│  ├─ Cargo.toml
│  ├─ build.rs
│  └─ tauri.conf.json
├─ .gitignore
├─ .node-version
├─ rust-toolchain.toml
├─ package.json
├─ package-lock.json
├─ tsconfig.json
└─ vite.config.ts
```

`tools/p4fnv-agent` is a development-only process outside the Tauri process boundary. It can build/start the release, exchange only allow-listed UI events through the opt-in bridge, and stop its own child process. Perforce domain logic, the connection environment, and mutations remain inside the existing React → typed Tauri command → Rust → `p4` boundaries.

Feature folders in `src/features` map the implemented product, not a future scaffold. A new folder appears with its first complete user workflow.

## Contents of a frontend feature

Minimal example:

```text
features/changes/
├─ ChangesView.tsx          # user-workflow orchestration
├─ ChangeComponents.tsx     # changes-specific dialogs and context menu
├─ useChangesData.ts        # server snapshot, shelves, refresh-on-focus
├─ useFileSelection.ts      # consistent opened/shelved multiselect
├─ useChangeDragDrop.ts     # browser drag-and-drop boundary
├─ changes.ts               # pure transformations and drop-action matrix
└─ changes.test.ts          # regression tests for pure logic
```

Components, requests, and tests for one feature live together. Do not create separate global `components`, `hooks`, `services`, `utils`, or `types` folders: they quickly become dumping grounds without a clear owner.

Move a file to `shared` only when at least two features genuinely use it. A shared UI primitive describes behavior (`View`, `ActionDialog`, `EmptyState`), not a specific screen (`SubmitDialog`). Resource screens use one "heading → compact toolbar → list/inspector workbench" shell; domain differences remain inside the feature.

## When to split Rust files

Start with flat `p4.rs`, `commands.rs`, `models.rs`, and `settings.rs`. Split a file by responsibility when it becomes difficult to navigate, not by line count alone.

Current split:

```text
src-tauri/src/
├─ p4.rs                # validated Perforce operations and DTO parsers
├─ p4/
│  ├─ jobs.rs           # jobs/fixes operations and parsers
│  ├─ labels.rs         # labels operations and parsers
│  ├─ runner.rs         # executable/process/JSON/error/log boundary
│  └─ validation.rs     # shared trust-boundary validation for P4 operations
├─ commands.rs          # allow-listed Tauri IPC
├─ models.rs
├─ settings.rs
└─ locales.rs
```

Further splits of `p4.rs` or `commands.rs` follow a complete user domain (`changes`, `history`, `integration`) when the corresponding vertical slice exists. `runner.rs` must not know about submit/unshelve/revert and does not expose universal command execution to the frontend.

Do not create a trait with one implementation, a repository/service/controller for every entity, or a separate crate before a second real implementation or independent reuse exists.

## Dependency direction

```text
React feature -> shared/api.ts -> specific Tauri command
                                      |
                                      v
                              Rust command handler
                                      |
                                      v
                         domain operation / parser
                                      |
                                      v
                                 P4 runner -> p4 CLI
```

- Frontend features do not import each other. The `app` layer or a small shared module assembles a cross-feature workflow.
- Feature screens are loaded lazily by the app shell; the default Files screen preserves its mounted state after the first load.
- `shared` imports nothing from `features`.
- A Rust command handler knows the user intent; a `p4.rs` domain function knows the safe Perforce command and converts DTOs; `p4/runner.rs` knows only the process, JSON Lines, diagnostics, and CLI log.
- The frontend never passes an arbitrary command line, executable name, or environment variables.

## Naming

- Use English Helix Core terms in code: `workspace`, `changelist`, `revision`, `stream`, `integrate`.
- In the UI, use an understandable action, with the official term in secondary text when needed.
- Components are nouns (`ChangeList`, `FileHistory`); handlers are actions (`submit_change`, `revert_files`).
- Tauri commands describe intent: `list_pending_changes`, not `run_p4_changes`.

Recommended UI vocabulary:

| Helix Core term | English UI name |
|---|---|
| Workspace / client | Workspace |
| Pending changelist | My Changes |
| Submitted changelist | Change History |
| Sync | Update files |
| Revert | Revert local changes |
| Stream | Stream |
| Integrate / merge | Merge changes |
| Cherry-pick | Apply selected changes |
| Get revision | Get this revision |
| Undo | Create an undo change |

The last two operations cannot share one button: retrieving an older revision changes workspace contents, while `p4 undo` creates new opened changes for a later submit.

## Growth rules

1. Every phase ends with a working vertical UI → Rust → `p4` → UI workflow.
2. Add a dependency only for an existing task that would be harder and riskier to solve with the platform or standard library.
3. Store settings in a small JSON file. A database is needed only after a proven need for a local index or offline search.
4. Do not duplicate models "just in case." Split a DTO into transport/domain/view forms only when those forms genuinely diverge.
5. Record an architecture decision in `Docs/ARCHITECTURE.md`; create a separate ADR directory only when enough decisions accumulate that one document impairs navigation.
