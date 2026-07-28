# P4FNV development documentation

The root of `Docs` contains the application's living contracts. This file is the only mandatory index: after reading it, load only the documents relevant to the current task. Compact reusable references live in [`research`](research/README.md) and are not sources of truth.

## What to read

| Document | When it is needed |
|---|---|
| [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) | any documentation/skill change or feature closeout that changes a contract or status |
| [`TOOLCHAIN.md`](TOOLCHAIN.md) | running, testing, and producing release builds |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | IPC, the P4 process boundary, state, and security |
| [`WORKSPACE_FILES.md`](WORKSPACE_FILES.md) | Files, Local Files cache/history, sync, and overwrite recovery |
| [`PORTABILITY.md`](PORTABILITY.md) | Windows-first development and mandatory boundaries for future macOS/Linux ports |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | code placement and dependency direction |
| [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md) | feature-status index, priorities, Definition of Done, and links to area checklists |
| [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md) | layout, interaction, accessibility, and visual QA |
| [`CHANGELIST_REQUIREMENTS.md`](CHANGELIST_REQUIREMENTS.md) | submit, shelf, unshelve, revert, and drag-and-drop |
| [`LOCALIZATION.md`](LOCALIZATION.md) | English/Russian and external language packs |
| [`CODEX_MCP_SETUP.md`](CODEX_MCP_SETUP.md) | installing, discovering, and diagnosing the P4FNV Agent plugin in Codex |
| [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md) | local MCP, the native UI bridge, and autonomous verification |

## Freshness rule

- Code and automated tests demonstrate current behavior; a living document records the mandatory contract and next priority.
- A change to architecture, a user workflow, localization, or shipping commands updates the owning document in the same change.
- Keep only reusable reference or verification material in `Docs/research`; Git history holds obsolete snapshots and investigation logs.
- One fact has one owner: feature status belongs in the checklist, a UI rule in UI/UX, and a technical boundary in architecture.
- The skill and `AGENTS.md` route to the owner without copying the detailed contract. Size, splitting, and validation rules are defined in [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md).
