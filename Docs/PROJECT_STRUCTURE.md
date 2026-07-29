# Project structure

This living contract owns code placement and dependency direction. Cross-feature runtime boundaries are in [`ARCHITECTURE.md`](ARCHITECTURE.md); documentation placement is in [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md).

## Repository areas

```text
Docs/                  living contracts, area checklists, and selected research
locales/               complete external English and Russian packs
scripts/               repository-wide build and packaging helpers
tools/p4fnv-agent/     development-only native UI MCP
tools/parallel-workflow/ prioritized worktree queue and isolated validator
src/app/               application shell, navigation, and global composition
src/features/<area>/   one user-facing vertical slice
src/shared/            primitives used by more than one feature
src-tauri/src/         narrow commands, models, settings, operations, diagnostics
src-tauri/src/p4/      reusable P4 process, validation, and split domain modules
```

This is intentionally not a file inventory. Use `rg --files` for the current tree and code/tests for current exports. Add a directory to this contract only when its ownership or dependency direction would otherwise be ambiguous.

The project remains one Tauri application in one repository. Do not add a monorepo, plugin SDK, general Perforce SDK, or separate crate without a demonstrated second consumer or independently releasable boundary.

## Frontend placement

A feature folder owns its screen, feature-specific components, hooks, pure transformations, and focused tests. Create it with the first complete workflow, not as a future scaffold.

```text
src/features/changes/
  ChangesView.tsx        workflow orchestration
  ChangeComponents.tsx  feature dialogs and menus
  useChangesData.ts      server snapshot and refresh lifecycle
  changes.ts             pure domain-to-view transformations
  changes.test.ts        focused regressions
```

Keep code in the feature until at least two features need the same behavior. Shared primitives describe reusable behavior (`View`, selection, safe sync, diff, operations), not one screen. Do not create generic top-level `components`, `hooks`, `services`, `utils`, or `types` dumping grounds.

`src/app` assembles screens and cross-feature navigation. Feature modules do not import other feature modules; the app layer or a small shared module coordinates a genuine cross-feature workflow. `src/shared` imports nothing from `src/features`.

## Rust placement

- `commands.rs` exposes allow-listed Tauri intents and owns async/process orchestration.
- `p4.rs` and domain modules under `p4/` validate and implement safe Perforce operations.
- `p4/runner.rs` is the only low-level `p4` launch boundary; it knows processes, structured output, errors, and diagnostics, not UI workflows.
- `models.rs`, `settings.rs`, `operations.rs`, and `diagnostics.rs` own their named cross-cutting boundaries.

Split a large Rust file by a complete domain such as changes, history, or integration when navigation and ownership become unclear. Do not split by line count alone, introduce a trait with one implementation, or add repository/service/controller layers for every entity.

## Dependency direction

```text
React feature -> shared/api.ts -> specific Tauri command
                                      |
                                      v
                         validated domain operation
                                      |
                                      v
                              P4 runner -> p4 CLI
```

- The frontend never passes an arbitrary command line, executable, environment, or filesystem operation.
- Command handlers know user intent; domain functions know safe P4 arguments and parsing; the runner knows only the process boundary.
- Shared DTOs exist only when several operations or features genuinely share the same transport shape.
- Feature screens may be lazy-loaded; the app decides which state must remain mounted across navigation.

## Naming and growth

- Use English Helix Core terms in code: `workspace`, `changelist`, `revision`, `stream`, and `integrate`.
- Name components as nouns and handlers/commands as actions. Tauri commands describe intent (`list_pending_changes`), never generic execution (`run_p4`).
- Keep Get Revision distinct from Undo: retrieval changes workspace content; `p4 undo` creates opened work for a later submit.
- End each feature increment with a working UI → Rust → `p4` → refreshed UI slice.
- Add dependencies and abstractions only for a present requirement that platform or standard-library code would handle less safely or clearly.
- Record a stable cross-feature boundary in `ARCHITECTURE.md`; create ADRs only if accumulated decisions make that document hard to navigate.
