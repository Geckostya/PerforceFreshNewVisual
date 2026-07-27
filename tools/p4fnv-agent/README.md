# P4FNV agent MCP

The local STDIO MCP server starts a separate opt-in session of the release application and controls the real React UI. It opens no port and exposes no arbitrary JavaScript, filesystem, Tauri invoke, shell, or `p4` command.

## Lifecycle

1. Codex starts the bundled Node with `start.mjs` through either the raw project registration or the Desktop personal plugin.
2. `app_start` checks all build inputs, builds the release when needed, and creates a temporary directory with command/response/snapshot files. Explicit `build: "always"` forces a rebuild, while `build: "never"` is allowed only when intentionally verifying an already-built executable.
3. P4FNV receives exact paths and a random session token only through the child-process environment.
4. `ui_snapshot` returns current interactive locators and `stateVersion`.
5. UI tools require the current version and pass through existing DOM events and React handlers.
6. `app_stop` terminates only the process started by the server and removes its temporary directory.

Codex-side registration and troubleshooting belong to [`Docs/CODEX_MCP_SETUP.md`](../../Docs/CODEX_MCP_SETUP.md). In Codex Desktop the expected tool namespace is `p4fnv_agent_plugin`; the raw project registration is named `p4fnv_agent`. To start the server manually, use `npm run --silent mcp:agent`; stdout is reserved for MCP JSON-RPC, so the npm banner must be disabled.

Run the complete safe smoke with `npm run smoke:agent`: it builds the release, obtains schema v2, focuses an available control with the current `stateVersion`, waits for a settled state, and always calls `app_stop`.

## Verification flow

```text
app_start -> ui_snapshot -> ui_input/ui_click -> ui_wait -> ui_snapshot -> app_stop
```

With the current Windows WebView2 runtime, a native session requires a normal window (`visible: true`, the default): a hidden, offscreen, or background window suspends JavaScript. `visible: false` is rejected before launch, but the server still builds, starts, and closes the application itself.
