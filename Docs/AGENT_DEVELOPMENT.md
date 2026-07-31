# Agent-driven P4FNV development

## Goal

The agent must independently build and start native P4FNV, read the real WebView2 DOM, perform an action through the same React path as the user, wait for a settled state, and terminate only its own test session.

The MCP is a development-only orchestration boundary. It is not a new Helix Core API and provides no shortcut to a mutation. Every potentially destructive action still passes through the existing preview, dialog, explicit confirmation, typed Tauri command, and server read-back.

## Connection

In Codex Desktop, use the `p4fnv_agent_plugin` namespace exposed by the personal P4FNV Agent plugin. The raw project registration remains named `p4fnv_agent`, but it is not a substitute when Desktop omits raw custom STDIO tools from a task. Installation, discovery, and startup diagnostics belong to [`CODEX_MCP_SETUP.md`](CODEX_MCP_SETUP.md).

Both registrations start the bundled Node and `tools/p4fnv-agent/start.mjs`. On first launch, the launcher builds the server when `dist/server.js` is missing or older than the TypeScript source, then loads it in the same STDIO process.

The project config leaves write-tool approvals enabled. Permanent usage rules and the prohibition on live-server mutations without authorization are in the root `AGENTS.md`.

Available tools:

- `app_start`, `app_status`, `app_stop` — lifecycle of one child process;
- `ui_snapshot` — compact snapshot v2 with optional sanitized HTML;
- `ui_click`, `ui_input`, `ui_focus`, `ui_key` — allow-listed DOM actions;
- `ui_resize` — resizes the visible native window within bounded logical dimensions for responsive-layout verification;
- `ui_wait` — wait for a version, text, locator, or settled/busy state.

Structured `elements` includes `ignored` for Files rows representing files and folders. Folders have a stable `agent:workspace-folder:<client-path>` locator, so ignored state can be verified without parsing HTML.

## Transport and security boundary

The low-level snapshot transport is enabled only by an absolute `P4FNV_UI_SNAPSHOT_PATH`. The frontend writes the timestamp, URL, viewport, active element, form state, and sanitized `body.outerHTML` through an allow-listed Tauri command. Password values are replaced with `[redacted]`, `value` attributes are removed, and snapshot size is limited to 8 MiB. Without the environment variable, the transport is completely disabled; there is no listener or HTTP port.

The MCP adds exact `P4FNV_AGENT_COMMAND_PATH`, `P4FNV_AGENT_RESPONSE_PATH`, and a random `P4FNV_AGENT_TOKEN`. Rust accepts no more than 64 KiB and verifies the token, request ID, expected `stateVersion`, and the allow-listed UI methods. `ui.resize` accepts only 640–4000 × 480–3000 logical pixels. Arbitrary selectors, JavaScript, Tauri invoke, filesystem, shell, and `p4` commands are unsupported.

Snapshot schema v2 contains a monotonic `stateVersion`, `settled`/`busy`, and structured elements. A `data-agent-id` or HTML `id` provides a stable locator; an indexed locator is valid only for the same version. An action sends ordinary DOM/React events and does not bypass production preview, dialog, IPC, or refresh behavior. The response is written atomically and does not return form values.

## Mandatory agent workflow

Use the tools from `p4fnv_agent_plugin` in Codex Desktop:

1. Call `app_start` with `visible: true` (the default). It compares the release with all build inputs and performs an incremental build when needed; `build: "always"` forces a rebuild, while `build: "never"` is allowed only when intentionally verifying an already-built executable.
2. Obtain `ui_snapshot` before an action.
3. Select a locator from `elements` and pass the current `stateVersion`.
4. On a stale response, read another snapshot; do not blindly repeat a mutation.
5. Call `ui_wait` after the action, then inspect a new structured snapshot.
6. For a destructive flow, pass through the preview separately and press confirm; the bridge accepts neither `force` nor a domain command.
7. Always end the session with `app_stop`.

Indexed `ui:N` locators are valid only in a snapshot with the same version. Add a nonlocalized `data-agent-id` to a frequently used or semantically important control; an existing unique HTML `id` automatically becomes `id:<value>`.

## Safety and limitations

- There is no listener or port: Codex starts an STDIO process, and P4FNV communicates only through exact temporary files.
- Command/response size is limited to 64 KiB and snapshot size to 8 MiB; writes are atomic.
- The random token exists only in the child session's environment and in each message.
- Password values are redacted; the agent response does not return the entered value.
- The MCP accepts no executable, working directory, environment, deletion path, selector, JavaScript, shell, Tauri invoke, or `p4` arguments.
- `app_stop` retains the child handle and removes only the verified `p4fnv-agent-*` directory inside the OS temp directory.
- Windows WebView2 suspends a hidden, offscreen, or background window even with diagnostic Chromium flags. A native agent session therefore requires a normal window (`visible: true`); `visible: false` is rejected before launch. This is a runtime limitation, not an MCP transport limitation.
- Server mutations cannot be proven automatically without a disposable or fake Helix Core server. Mutating smoke against the user's server is prohibited without explicit authorization.

## Verifying the MCP implementation

```powershell
. .\scripts\toolchain.ps1
npm run build:agent
npm test -- --run
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

Native smoke must at minimum start the release through `app_start`, obtain schema v2 through `ui_snapshot`, perform a safe UI action with the current version, observe a new `stateVersion`, and stop the session.

From the terminal, `npm run smoke:agent` performs the same mandatory lifecycle. The command always stops the created session in `finally`; an unsuccessful `app_start` also terminates its child process and removes the temporary directory.
