---
name: develop-p4fnv
description: Develop and verify P4FNV, a Windows Tauri 2 desktop client for Perforce Helix Core. Use for repository work involving UI/UX, Perforce workflows, localization, architecture, debugging, native MCP verification, tests, documentation, toolchain maintenance, or releases.
---

# Develop P4FNV

Work from repository evidence and load project context progressively.

## Start every task

1. Locate the root containing `src-tauri/tauri.conf.json`, `src/`, and `Docs/`.
2. Read `Docs/README.md`, then read only the living contracts routed to the current task. Do not preload every contract.
3. Read the relevant implementation and tests before editing. Preserve unrelated and uncommitted user changes.
4. For changes to documentation, skills, `AGENTS.md`, feature status, or a documented contract, also read `Docs/DOCUMENTATION_POLICY.md`.

Repository documents and code are fresher than chat memory. Files under `Docs/research` are optional references; read them only for a relevant command map or verification matrix.

Communicate with the user in the language of their latest request unless they ask otherwise. Keep project documentation and code comments in English regardless of the conversation language.

## Select contracts by task

- Build, tests, versions, dependencies, release artifact: `Docs/TOOLCHAIN.md`.
- Portable distribution, application versions, GitHub Releases, or in-app updates: `Docs/RELEASES_AND_UPDATES.md` and `Docs/TOOLCHAIN.md`.
- Cross-feature architecture, IPC, P4 process boundary, errors, operations, security: `Docs/ARCHITECTURE.md`.
- Files, local tree/cache, history in Files, sync and overwrite recovery: `Docs/WORKSPACE_FILES.md`.
- New modules, ownership, dependency direction, structural refactors: `Docs/PROJECT_STRUCTURE.md`.
- Product status, priorities, or Definition of Done for a feature: `Docs/P4_FEATURE_CHECKLIST.md`.
- Shared layout, interaction, accessibility, typography, or visual QA: `Docs/UI_UX_SPECIFICATION.md`.
- Changelists, shelves, submit, unshelve, revert, or related drag-and-drop: `Docs/CHANGELIST_REQUIREMENTS.md`.
- Strings, RU/EN packs, or external languages: `Docs/LOCALIZATION.md`.
- Codex Desktop plugin installation, `p4fnv_agent_plugin` discovery, or MCP startup diagnostics: `Docs/CODEX_MCP_SETUP.md`.
- Native UI verification or snapshot/MCP bridge: `Docs/AGENT_DEVELOPMENT.md`.
- Parallel feature workers, priority queues, worktree isolation, or serialized validation: `Docs/PARALLEL_DEVELOPMENT.md`.
- Windows/macOS/Linux boundaries: `Docs/PORTABILITY.md`.
- Documentation creation, cleanup, ownership, size, or feature closeout: `Docs/DOCUMENTATION_POLICY.md`.

## Implement safely

- Build complete vertical slices through typed frontend models/API, narrow Tauri commands, validated Rust operations, UI state, localization, tests, and the owning document as applicable.
- During feature closeout, replace obsolete statements in the owning contract and update the area checklist only when readiness changed. Do not add task plans, progress logs, implementation snapshots, or facts already evident from code/tests.
- Keep P4 command construction and validation in Rust. Pass arguments directly to `Command`; never interpolate through a shell.
- Treat the P4 Server as source of truth. Refresh affected state after mutations and report partial results or compensation honestly.
- Use server-backed preview and a non-destructive default for destructive, overwrite, submit, integrate, resolve, and sync-risk flows.
- Preserve the distinction between local opened files, shelves, submitted revisions, depot paths, client paths, and local paths.
- Keep new user-visible strings in complete English and Russian packs.
- Extend existing feature boundaries and shared primitives; do not add speculative abstractions or unrelated refactors.

For uncertain Helix Core semantics or destructive flags, use current official Perforce documentation. Never run mutating P4 smoke tests against the user's connected server without explicit authorization or a disposable server.

## Verify and hand off

- Activate `. .\scripts\toolchain.ps1` before Node or Rust commands.
- Run focused checks during development and the gate required by `AGENTS.md` and `Docs/TOOLCHAIN.md` before handoff.
- For UI or bridge changes, follow `Docs/AGENT_DEVELOPMENT.md` through `p4fnv_agent_plugin`. If the namespace is missing, follow `Docs/CODEX_MCP_SETUP.md`; do not substitute web-only verification for Tauri behavior.
- Rebuild and report the standard shipping artifact when the request changes application behavior and a safe build is possible.
- When documentation changed, verify relative links, the `Docs/README.md` index, and the size limits in `Docs/DOCUMENTATION_POLICY.md`.
