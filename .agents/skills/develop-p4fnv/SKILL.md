---
name: develop-p4fnv
description: Continue developing P4FNV, a Windows Tauri 2 desktop client for Perforce Helix Core built with React/TypeScript and Rust. Use for any request in the P4FNV repository involving product requirements, changelists, shelves, submit/unshelve/revert workflows, drag-and-drop, UI/UX, localization, CLI integration, architecture, debugging, DOM snapshot-based native UI verification, tests, documentation, toolchain maintenance, or shipping builds.
---

# Develop P4FNV

Build a convenient, trustworthy Perforce client with a modern minimal interface and complete programmer workflows. Treat UX quality, correct Helix Core semantics, modularity, and verified shipping artifacts as equally important.

## Establish project context

1. Locate the repository root containing `src-tauri/tauri.conf.json`, `src/`, and `Docs/`.
2. Before the first project action in a new chat, read `Docs/README.md` and inspect these living contracts when present:
   - `Docs/ARCHITECTURE.md`
   - `Docs/PROJECT_STRUCTURE.md`
   - `Docs/UI_UX_SPECIFICATION.md`
   - `Docs/CHANGELIST_REQUIREMENTS.md`
   - `Docs/LOCALIZATION.md`
   - `Docs/TOOLCHAIN.md`
   - `Docs/AGENT_DEVELOPMENT.md`
   Files under `Docs/research` are historical sources, not living contracts; read one only when the task needs that research or decision history.
3. Read the files and tests relevant to the current feature before editing. Preserve unrelated user changes.
4. Treat living documents as product contracts. Update the relevant document when behavior, architecture, or a workflow changes.

Do not rely on chat memory when repository documentation or code can provide fresher evidence.

## Follow the product principles

- Optimize for everyday convenience. A feature is incomplete if it is technically present but hard to discover, understand, or operate.
- Use modern, restrained UI: clear hierarchy, stable layout, compact spacing, calm colors, and meaningful labels.
- Prefer human meaning over identifiers. For example, make a changelist description primary and its number secondary.
- Keep frequent actions visible. Put uncommon, advanced, or destructive actions in context menus with confirmation where appropriate.
- Never add a screen, button, menu item, checkbox, or drag target without working backend logic.
- Avoid layout jumps. Show transient operation success in fixed toast notifications; keep persistent CLI warnings and errors in the bottom-right session log without overlap.
- Support single, Ctrl/Cmd-toggle, Shift-range, and batch operations wherever file lists support selection.
- Offer equivalent non-drag commands for drag-and-drop operations.
- Show every conflicting file in a preflight instead of failing at the first one. Let the user resolve a selected subset safely; default to the non-destructive choice.
- Keep server-side shelves distinct from local opened files even when depot paths match.
- Treat the P4 Server as the source of truth. Invalidate stale caches after mutations and refresh from the server, including when the window regains focus.
- Match the user's language in communication. Keep all application strings externalized in complete English and Russian locale JSON files.
- Preserve support for additional language JSON files placed beside an already-built shipping application.

## Keep the UI system coherent

- Treat `src/index.css` as the owner of shared size tokens and `src/app/app.css` as their consumer. Reuse the existing semantic tokens; do not introduce feature-local font, control-height, row-height, spacing, or radius scales.
- Use the Windows desktop type ramp: 14/20 px for ordinary readable content, 12/16 px for secondary metadata, 16/22 px for section subtitles, 20/28 px for page titles, and 28/36 px only for display headings. Never use text below 12 px for user-readable content; 10 px is reserved for short nonessential badges.
- Use the 4 px spacing grid (`4, 8, 12, 16, 24, 32`). Controls are 32 px compact or 36 px default; standalone icon buttons and every adjacent pointer target are at least 32 px. Data rows are 44 px single-line or 52 px two-line.
- Components with the same role share geometry and typography. In one tree, files and folders use the same row height, horizontal rhythm, primary text, metadata style, hover, focus, and selection treatment; concept-specific differences belong to icons, disclosure, status, and available actions.
- Build hierarchy with semantic type roles, weight, spacing, and borders. Color is supporting information only. Do not shrink text to make content fit; wrap, truncate with a full-value affordance, scroll the owning pane, or adapt the layout.
- Verify changed screens at 100%, 125%, and 200% scaling. Text must remain available without clipping; interactive targets must remain at least 24 CSS px and use the project 32 px minimum wherever layout permits.

## Preserve the architecture

Implement a feature as a vertical slice through the existing layers:

1. Shared TypeScript and Rust models.
2. Validated Rust Perforce adapter logic.
3. Narrow Tauri commands.
4. Typed frontend API wrappers.
5. Feature-local React state and UI.
6. External RU/EN translations.
7. Unit tests and relevant living documentation.

Keep Perforce command construction in Rust. Validate changelist IDs and depot paths, pass arguments directly to `Command`, and never interpolate them through a shell.

Prefer one batch CLI invocation for a selected set when the command supports multiple file arguments. For multi-step operations, define compensation or rollback behavior and report partial success honestly.

Use `-ztag -Mj` for commands with stable structured output. Treat form workflows separately: `p4 change -o` and `p4 change -i` may use text forms and text success responses. Do not require JSON from form input commands.

Keep error classification precise. Do not label an ordinary rejected operation as a connection failure. Preserve technical diagnostics and collect CLI records with warning/error severity in the session log.

On Windows, keep `app.windows[].dragDropEnabled` set to `false` in `src-tauri/tauri.conf.json`; Tauri's native file-drop handler otherwise blocks HTML5 drag-and-drop in WebView2. Internal drag state must not depend solely on `DataTransfer.types`. Allow `copyMove` for local files: reopen is a move, while shelve and unshelve are copies.

## Handle feedback and bugs

Treat user reports as evidence. Reproduce or trace the entire event path before patching symptoms:

1. Identify whether the failure is in React state, browser/WebView behavior, Tauri configuration, IPC serialization, CLI command construction, or server semantics.
2. Inspect exact diagnostics and the session CLI log.
3. Verify unstable framework or Perforce behavior against current primary documentation.
4. Fix the lowest layer that owns the broken contract.
5. Add a regression test around pure logic and state boundaries where practical.
6. Rebuild the shipping executable so the user tests the actual fix.

Do not repeatedly adjust frontend event handlers when the operating layer or Tauri configuration prevents those events from arriving.

## Research Helix Core behavior

Use current official Perforce documentation for commands and destructive flags. Distinguish local files, opened state, shelves, pending changelists, submitted revisions, and workspace mappings explicitly.

Never run mutating `p4` commands against the user's connected server merely to verify an implementation. Use pure unit tests, argument builders, parsers, and a dedicated disposable test server only when the user explicitly provides or authorizes one.

## Test and ship changes

Activate the repository toolchain before Node or Rust commands:

```powershell
. .\scripts\toolchain.ps1
```

Run checks proportional to the change, and run the full gate before handing off a shipping build:

```powershell
npm test -- --run
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
npm run build
```

Treat TypeScript compilation and the Vite build inside `npm run build` as required. Keep Rust formatting clean with `cargo fmt --manifest-path src-tauri\Cargo.toml`.

### Verify native UI through the project MCP

Use the project-scoped `p4fnv_agent` MCP as the default verification path for the Tauri UI:

1. Call `app_start` with `visible: true`. The server owns only the child process and temporary session it creates.
2. Read `ui_snapshot`; use its structured `screen`, `settled`, `busy`, `elements`, and current `stateVersion` instead of locating controls from pixels.
3. Execute `ui_click`, `ui_input`, `ui_focus`, or `ui_key` with a locator from that snapshot and the exact `stateVersion`. These actions dispatch through the real DOM and React event route.
4. Call `ui_wait`, then inspect a fresh snapshot. On a stale-version response, inspect again rather than blindly retrying an action.
5. Always call `app_stop`, including after a failed assertion.

The MCP is registered in `.codex/config.toml`; Codex starts its STDIO process automatically after the trusted project is reopened. Do not ask the user to keep a server or port running. If `p4fnv_agent` is unavailable, first report that the project MCP was not loaded and check the project configuration. For bridge diagnostics only, fall back to setting an absolute `P4FNV_UI_SNAPSHOT_PATH`, launching the native app, and reading schema v2 directly; this fallback is read-only and is not the normal interaction workflow.

The current Windows WebView2 runtime suspends a fully hidden/offscreen/background window, so native agent sessions require `visible: true`. Do not claim headless coverage from this bridge.

Do not use screenshots to locate controls, confirm text, inspect hierarchy, verify loading/selection/expanded/disabled state, or perform ordinary UI smoke tests. Do not open `npm run dev:web` as a substitute for native verification when the behavior depends on Tauri IPC.

Use a screenshot only as an exceptional fallback when the question is inherently pixel-level—clipping, overlap, typography, color, spacing, scaling, GPU/WebView rendering—or when the MCP/snapshot bridge failed after a concrete diagnostic attempt. Before capturing one, state the exact visual property that structured state cannot establish. Keep screenshot inspection narrowly cropped to that property.

If `src-tauri\target\release\p4fnv.exe` is locked, the user has explicitly authorized closing the running P4FNV application before rebuilding. Confirm the process path belongs to this repository, terminate only the `p4fnv` process, and never terminate `p4`, `p4d`, or unrelated processes.

Use the standard shipping artifact:

`src-tauri\target\release\p4fnv.exe`

Ensure external locale files are copied beside it. In the final response, link the executable, summarize user-visible behavior, report test counts and build status, and include a SHA-256 hash. State clearly when live-server integration was not exercised.

## Guardrails

- Do not use Ponytail for P4FNV work unless the user explicitly reverses the existing prohibition.
- Do not reduce a requested complete feature set to a minimal placeholder implementation.
- Do not add speculative abstractions; extend the existing modular boundaries.
- Do not hide destructive consequences behind generic labels.
- Do not silently overwrite untracked or writable files. Require an explicit per-file resolution for forced unshelve.
- Do not introduce a dependency when the existing stack or a small established library already solves the problem cleanly.
- Do not perform unrelated refactors during a focused bug fix.
- Do not claim success from tests alone when the behavior depends on a real Perforce server or WebView interaction; distinguish verified automation from user validation.

## Definition of done

Finish only when the requested workflow is implemented end to end, localized, covered by appropriate tests, reflected in documentation, free of compiler and Clippy warnings, present in the rebuilt standard release executable, and—when UI behavior changed—verified through the native `p4fnv_agent` flow (`app_start` → snapshot/action/wait → `app_stop`). Avoid handing off source-only changes when a safe shipping build is possible.
