# Codex Desktop MCP integration research

## Status

This document preserves the investigation history and extended diagnostics behind the living [`CODEX_MCP_SETUP.md`](../CODEX_MCP_SETUP.md). It is not the current agent contract. Re-check version-specific behavior after Codex updates and promote only durable requirements back to the living document.

The observations below were verified with Codex Desktop `26.721.4979.0` and app-server `0.146.0-alpha.3.1` on Windows 11.

Primary references used during the investigation:

- [Codex manual](https://developers.openai.com/codex/codex-manual.md)
- [Configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Codex issue #19425](https://github.com/openai/codex/issues/19425)
- [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## Why the personal plugin was introduced

An MCP reaches a model task through several independent layers:

1. Codex selects `CODEX_HOME` and loads user configuration.
2. A trusted repository contributes project `.codex/config.toml` layers.
3. Codex resolves and starts the STDIO process.
4. The server completes JSON-RPC initialization and publishes tools.
5. The client constructs the tool inventory for a particular task.

The investigated Desktop build successfully loaded the raw `p4fnv_agent` configuration and exposed it through `mcpServerStatus/list`, but omitted its tools from Desktop task inventories. User-created, agent-created, projectless, and saved-project tasks showed the same result. This isolated the failure to Desktop tool exposure rather than launcher startup, project association, or a stale server process.

Installing the same STDIO server as a personal plugin used a different ingestion path. A new post-install task exposed all nine tools under `p4fnv_agent_plugin` and completed a native lifecycle. This became the required Desktop workaround while the raw custom-STDIO exposure issue remained present.

An existing task retains its old tool inventory. Restarting can reload raw configuration but does not retrofit an installed plugin into a task created earlier.

## Raw project registration

The verified project configuration was:

```toml
sandbox_mode = "workspace-write"

[mcp_servers.p4fnv_agent]
command = '.\.toolchain\node\node.exe'
args = ['.\tools\p4fnv-agent\start.mjs']
cwd = '.'
enabled = true
required = false
startup_timeout_sec = 30
tool_timeout_sec = 900
default_tools_approval_mode = "writes"

[sandbox_workspace_write]
network_access = true
```

With app-server `0.146.0-alpha.3.1`, these paths resolved from the effective repository working directory. Changing them to `..\.toolchain\...` produced `stdio command ... is not resolvable`, despite more general project-config path guidance. This is version-specific evidence, not a universal path rule.

An optional user-scoped diagnostic registration used absolute paths:

```toml
[mcp_servers.p4fnv_agent]
command = 'C:\Projects\P4FNV\.toolchain\node\node.exe'
args = ['C:\Projects\P4FNV\tools\p4fnv-agent\start.mjs']
```

The equivalent CLI command was:

```powershell
codex mcp add p4fnv_agent -- `
  C:\Projects\P4FNV\.toolchain\node\node.exe `
  C:\Projects\P4FNV\tools\p4fnv-agent\start.mjs
```

This user fallback is tied to one checkout and can be overridden by a same-named project layer. It was useful for diagnosis but did not fix Desktop task exposure.

## Personal plugin reference

The verified source was `C:\Users\PC\plugins\p4fnv-agent`, registered as `p4fnv-agent@personal`. Its `.codex-plugin/plugin.json` referenced `./.mcp.json`, whose MCP entry was:

```json
{
  "mcpServers": {
    "p4fnv_agent_plugin": {
      "command": "C:\\Projects\\P4FNV\\.toolchain\\node\\node.exe",
      "args": ["C:\\Projects\\P4FNV\\tools\\p4fnv-agent\\start.mjs"],
      "cwd": "C:\\Projects\\P4FNV",
      "startup_timeout_sec": 30,
      "tool_timeout_sec": 900,
      "tools": {
        "app_stop": {
          "approval_mode": "approve"
        }
      }
    }
  }
}
```

The system `plugin-creator` skill was used because it maintains personal marketplace metadata and validates the plugin structure:

```powershell
$pluginCreator = "$env:USERPROFILE\.codex\skills\.system\plugin-creator"
python "$pluginCreator\scripts\create_basic_plugin.py" `
  p4fnv-agent --with-mcp --with-marketplace

python "$pluginCreator\scripts\validate_plugin.py" `
  C:\Users\PC\plugins\p4fnv-agent
codex plugin add p4fnv-agent@personal --json
```

Installation copies a versioned snapshot to the Codex plugin cache. Source edits require the plugin creator's cachebuster flow, reinstall, and a new task.

## Extended diagnostic ladder

### Host context

Managed execution may replace `%USERPROFILE%` and `CODEX_HOME`. A successful check under a sandbox user says nothing about the Desktop user's configuration.

```powershell
$env:USERPROFILE
$env:CODEX_HOME
Get-Command codex -All
codex doctor --json
```

Inspect the current executable, effective `CODEX_HOME`, loaded configuration files, and working directory. Do not copy credentials or bypass the sandbox to make contexts appear identical.

### Merged raw configuration

From the P4FNV root:

```powershell
codex mcp get p4fnv_agent
codex mcp list
codex doctor --json
```

Expected raw evidence included an enabled STDIO transport, the intended command/arguments/working directory, and no MCP configuration error. This proves configuration resolution, not initialization or task exposure.

### Launcher and protocol

The launcher finds the repository root relative to `start.mjs`, builds TypeScript when needed, changes to the repository root, and imports `dist/server.js`. It requires no daemon or TCP port. Its stdout is reserved for JSON-RPC; manual npm startup must use `npm run --silent mcp:agent`.

For app-server protocol inspection:

```powershell
codex app-server generate-json-schema --experimental --out $env:TEMP\codex-app-server-schema
codex app-server --stdio
```

After `initialize` and `initialized`, request `mcpServerStatus/list` with full detail. A healthy server reported `serverInfo.name = "p4fnv-agent"` and these tools:

```text
app_start  app_status  app_stop
ui_click   ui_focus    ui_input  ui_key
ui_snapshot  ui_wait
```

If app-server sees them but a fresh Desktop task does not, the launcher is not the failing layer.

### Task inventory and native lifecycle

A valid plugin check creates a new task after installation, confirms `p4fnv_agent_plugin`, and calls the tools. In the original successful run, `app_start(visible=true)` started PID `22364`, `ui_snapshot` returned a settled workspace at `stateVersion = 8`, and `app_stop` stopped that process. It also worked from a generated worktree because the plugin used absolute paths to the primary checkout.

The process shape used for diagnosis was bundled `node.exe` running `tools\p4fnv-agent\start.mjs`, parented by the Desktop app-server `codex.exe`. A child process proves spawn, not task exposure.

### Logs and process safety

Identify the actual Desktop process before reading logs or terminating diagnostic children:

```powershell
Get-Process codex -ErrorAction SilentlyContinue |
  Select-Object Id, StartTime, Path
```

Packaged-app logs were under `%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\Local\Codex\Logs`. Active logs may be buffered. Never terminate every process named `codex`; Desktop, IDE integrations, and diagnostic app-server processes may coexist. Inspect executable, parent, and command line and stop only a child created for the diagnostic session.

## Historical symptom map

| Symptom | Investigated layer | Historical response |
|---|---|---|
| `No MCP servers configured yet` | wrong host profile or `CODEX_HOME` | inspect host context and loaded config |
| `No MCP server named ...` | project trust or config discovery | inspect effective cwd, trust, and merged layers |
| `stdio command ... is not resolvable` | executable/path base | verify exact resolved paths |
| launcher exits immediately | dependencies, build, or stdout pollution | build the agent and inspect stderr |
| app-server sees tools but Desktop task does not | Desktop exposure issue | install/update the personal plugin and create a new task |
| `app_start` times out | timeout or stale build | inspect tool timeout and launcher stderr |
| hidden native window hangs | WebView2 suspension | use `visible: true` |
| resources/templates return `Method not found` | tools-only server | ignore when `tools/list` succeeds |

## Re-evaluation triggers

Repeat the investigation after a material Codex Desktop/app-server update, plugin ingestion change, launcher change, or configuration-schema change. If raw project STDIO tools become reliably available to new Desktop tasks, remove the personal-plugin requirement from the living contract and record the confirming version and lifecycle here.
