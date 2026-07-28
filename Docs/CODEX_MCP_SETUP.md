# Codex MCP setup

This living contract owns how the P4FNV Agent MCP reaches a Codex Desktop task and the shortest supported diagnostic path. Native UI actions and safety belong to [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md); build commands belong to [`TOOLCHAIN.md`](TOOLCHAIN.md).

## Required integration

The repository registers the local STDIO server as `p4fnv_agent` in `.codex/config.toml`. Codex Desktop verification uses the personal P4FNV Agent plugin and its `p4fnv_agent_plugin` namespace. Do not silently replace a missing plugin namespace with the raw registration or web-only testing.

A usable Desktop task exposes all nine tools:

```text
app_start  app_status  app_stop
ui_click   ui_focus    ui_input  ui_key
ui_snapshot  ui_wait
```

Task tool inventory is fixed at task creation. Create a new task after installing or updating the plugin.

## Prepare the repository

```powershell
. .\scripts\toolchain.ps1
npm ci
npm run build:agent
```

The raw registration and the personal plugin both start the bundled Node with `tools/p4fnv-agent/start.mjs` from this checkout. A plugin installation must use absolute paths for Node, the launcher, and the repository working directory, allow enough time for an incremental release build, and approve `app_stop` so cleanup cannot be stranded.

The plugin source and installed cache are machine-local and are not project documentation. When its configuration changes, validate and reinstall it with the current `plugin-creator` workflow, then create a new task. Editing a source directory does not update an already installed cached copy.

## Verify and diagnose

1. Confirm that the new task exposes `p4fnv_agent_plugin` and all nine tools.
2. Run `app_start(visible=true) → ui_snapshot → app_stop` for a minimum lifecycle check.
3. For UI or bridge work, use the complete versioned-action workflow in [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).
4. Confirm that `app_stop` succeeded and no child or temporary agent session remains.

| Symptom | Check |
|---|---|
| Plugin namespace absent | Validate/reinstall the personal plugin, then create a post-install task. |
| Only raw `p4fnv_agent` is visible | Treat it as configuration evidence, not Desktop task readiness. |
| Command is not resolvable | Check the exact absolute Node, launcher, and working-directory paths. |
| `app_start` times out | Build the agent, then check plugin startup/tool timeouts and launcher stderr. |
| Hidden native window hangs | Use only `visible: true`; WebView2 suspends hidden/background sessions. |
| CLI and Desktop disagree | Check the actual host user, effective `CODEX_HOME`, repository trust, and task creation time. |

`codex mcp list` proving the raw registration is healthy does not prove that a Desktop task received plugin tools. Do not record process IDs, local log paths, machine-specific plugin paths, or one-version Codex behavior here; retain only a durable fix in this contract.

## Maintenance

After changing the launcher, `.codex/config.toml`, bundled toolchain, or personal plugin:

1. run the MCP configuration tests and `npm run build:agent`;
2. validate/reinstall the plugin when its source changed;
3. create a new task and confirm all nine tools;
4. run native smoke and finish through `app_stop`;
5. update this contract only if the supported setup or diagnostic decision changed.
