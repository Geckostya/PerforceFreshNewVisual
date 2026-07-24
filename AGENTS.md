# P4FNV agent workflow

- Read `.agents/skills/develop-p4fnv/SKILL.md` and the living contracts it routes to before changing the application.
- Activate `.\scripts\toolchain.ps1` before Node or Rust commands.
- For native UI changes, use the project-scoped `p4fnv_agent` MCP: `app_start` (`visible: true`) → `ui_snapshot` → UI action with the current `stateVersion` → `ui_wait` → `app_stop`. If the tool is unavailable, report that the project MCP was not loaded and inspect `.codex/config.toml`; do not silently replace native verification with web-only testing.
- Always read a fresh snapshot before an action. Treat stale-version rejection as a reason to inspect again, not to repeat a mutation blindly.
- Never bypass application previews or confirmation dialogs. Do not perform mutating Perforce smoke tests against the user's connected server without explicit authorization or a disposable test server.
- Prefer structured snapshot state over screenshots. Use visible pixel inspection only for clipping, overlap, typography, color, spacing, scaling, GPU/WebView rendering, focus, or native drag-and-drop.
- Before handoff run `npm test -- --run`, Rust fmt/test/Clippy, `npm run build`, and a native MCP smoke when UI or the bridge changed.
