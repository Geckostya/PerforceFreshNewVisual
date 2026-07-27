# Codex MCP setup

## Responsibility

This living contract defines how the P4FNV Agent MCP reaches a Codex Desktop task, which namespace the task must use, and the shortest supported diagnostic path. Native UI actions and safety rules belong to [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md); build commands belong to [`TOOLCHAIN.md`](TOOLCHAIN.md). Version-specific investigation history and deep protocol diagnostics live in [`research/CODEX_MCP_DESKTOP_INTEGRATION.md`](research/CODEX_MCP_DESKTOP_INTEGRATION.md).

## Required Desktop integration

P4FNV has two registrations for the same local STDIO server:

- `.codex/config.toml` registers the raw project server as `p4fnv_agent` for CLI and app-server diagnostics.
- Codex Desktop tasks use the personal P4FNV Agent plugin and its `p4fnv_agent_plugin` namespace.

The Desktop namespace is the application-verification contract. Do not silently fall back to the raw namespace or web-only testing when `p4fnv_agent_plugin` is missing.

A usable Desktop task exposes all nine tools:

```text
app_start  app_status  app_stop
ui_click   ui_focus    ui_input  ui_key
ui_snapshot  ui_wait
```

Plugin inventory is fixed when a task is created. After installing or updating the plugin, create a new task before testing it.

## Initial setup

From the repository root, prepare the bundled runtime and agent:

```powershell
. .\scripts\toolchain.ps1
npm ci
npm run build:agent
```

The tracked raw registration in `.codex/config.toml` starts `.toolchain\node\node.exe` with `tools\p4fnv-agent\start.mjs`. The repository must be trusted, and all referenced paths must exist.

Codex Desktop currently consumes the same server through the personal plugin `p4fnv-agent@personal`. Its source is machine-local; on the maintained Windows environment it is `C:\Users\PC\plugins\p4fnv-agent`. The plugin MCP entry must:

- be named `p4fnv_agent_plugin`;
- use absolute paths to this checkout's bundled Node, launcher, and working directory;
- allow enough startup/tool time for an incremental release build;
- approve `app_stop` so cleanup cannot be stranded by a write approval.

Validate and install an existing plugin source with the system `plugin-creator` utilities, then create a new Codex task:

```powershell
$pluginCreator = "$env:USERPROFILE\.codex\skills\.system\plugin-creator"
python "$pluginCreator\scripts\validate_plugin.py" C:\Users\PC\plugins\p4fnv-agent
codex plugin add p4fnv-agent@personal --json
```

Installation copies a versioned snapshot into the Codex plugin cache. Editing the source directory does not update the installed copy; use the plugin creator's cachebuster/reinstall flow after changes. The scaffold procedure and reference configuration are preserved in the [integration research](research/CODEX_MCP_DESKTOP_INTEGRATION.md).

## Verify a task

1. Confirm that the task inventory contains `p4fnv_agent_plugin` and all nine tools above.
2. Run the requested native workflow through that namespace. For a minimum lifecycle check, use `app_start(visible=true) → ui_snapshot → app_stop`.
3. For UI or bridge verification, follow the complete versioned-action workflow in [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).
4. Confirm that `app_stop` succeeded and no child or temporary agent session remains.

Seeing `p4fnv_agent` in configuration, `codex mcp list`, or an app-server status response does not prove that a Desktop task received `p4fnv_agent_plugin`.

## Short diagnostic path

| Symptom | Check |
|---|---|
| `p4fnv_agent_plugin` is absent | Ensure the personal plugin is installed, then create a new post-install task. |
| Only raw `p4fnv_agent` is visible | Treat it as configuration evidence, not Desktop task readiness; validate/reinstall the plugin. |
| MCP command is not resolvable | Check the exact bundled Node, launcher, and working-directory paths without guessing a different base directory. |
| `app_start` times out | Check build freshness, plugin timeouts, and launcher stderr. |
| A hidden native window hangs | Use only `visible: true`; WebView2 suspends hidden/background sessions. |
| CLI and Desktop report different servers | Check the actual host user, `CODEX_HOME`, task creation time, and merged configuration. Managed sandboxes may use a different profile. |

For app-server JSON-RPC inspection, process ancestry, Desktop log locations, alternative raw registrations, or the original exposure-bug evidence, use the [extended diagnostic research](research/CODEX_MCP_DESKTOP_INTEGRATION.md).

## Maintenance

After changing Codex, the bundled Node/Rust toolchain, the launcher, `.codex/config.toml`, or the personal plugin:

1. run the MCP configuration test and `npm run build:agent`;
2. validate and reinstall the personal plugin when its source changed;
3. create a new task and confirm the nine `p4fnv_agent_plugin` tools;
4. run native smoke and finish through `app_stop`;
5. update this contract only if current setup or required behavior changed; record investigation details in research.
