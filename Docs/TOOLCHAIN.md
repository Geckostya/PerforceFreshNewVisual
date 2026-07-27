# Development toolchain

## Requirements

- Windows 10/11 x64.
- Visual Studio 2022 Build Tools/Community with MSVC and the Windows SDK.
- WebView2 Runtime.
- An installed `p4.exe` for manual server interaction.
- Node `24.16.0` from `.node-version`.
- Rust `1.97.1` with rustfmt/Clippy from `rust-toolchain.toml`.

In the current workspace, Node, Rust, and the npm cache live in the ignored `.toolchain` directory. A global Tauri CLI, pnpm/yarn, C++ P4API, Docker, and a local P4 Server are not needed for an ordinary build.

## Activation and dependency installation

Start every PowerShell session from the project root:

```powershell
. .\scripts\toolchain.ps1
```

The dot and space are required: the script modifies the current session's environment. Then run:

```powershell
npm ci
```

Quick check:

```powershell
node --version
rustc --version
cargo clippy --version
p4 -V
```

## Development

```powershell
npm run dev       # Tauri application
npm run dev:web   # Vite UI only; Tauri IPC is unavailable
```

For low-level read-only diagnostics of the snapshot bridge without MCP, set an absolute path before launch:

```powershell
$env:P4FNV_UI_SNAPSHOT_PATH = "C:\Temp\p4fnv-ui.json"
npm run dev
Get-Content -Raw $env:P4FNV_UI_SNAPSHOT_PATH
```

The file is updated atomically after DOM/form state or viewport changes. Without the variable, the observer and writer do not start. Password values are redacted in the snapshot. Use the primary MCP workflow below for ordinary agent verification; the manual variable is only for diagnosing the bridge itself.

### Agent MCP

The raw project-scoped STDIO MCP is registered as `p4fnv_agent` in `.codex/config.toml`. Codex Desktop uses the personal plugin namespace `p4fnv_agent_plugin`. After the first checkout or an MCP configuration change:

```powershell
. .\scripts\toolchain.ps1
npm ci
npm run build:agent
```

Then perform Codex-side registration and verification according to [`CODEX_MCP_SETUP.md`](CODEX_MCP_SETUP.md). Codex starts the bundled Node with `tools/p4fnv-agent/start.mjs`; no server process or local HTTP port needs to be kept running manually. For manual protocol diagnostics, use `npm run --silent mcp:agent`; `--silent` removes the npm banner from stdout, which is reserved for MCP JSON-RPC.

The primary verification flow, build freshness, transport, and WebView2 limitations belong to [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).

Complete manual smoke from an ordinary terminal:

```powershell
. .\scripts\toolchain.ps1
npm run smoke:agent
```

The smoke builds the agent and release, reads schema v2, performs a safe `ui_focus` with the current version, waits for a new settled state, and stops only the test process it created. If `p4fnv_agent_plugin` does not appear in a Desktop task, follow [`CODEX_MCP_SETUP.md`](CODEX_MCP_SETUP.md).

## Checks

For a small change, run the nearest test first. Before handoff, run the full gate:

```powershell
. .\scripts\toolchain.ps1
npm test -- --run
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
npm run build
```

`npm run build` includes the TypeScript check, Vite production build, Rust release build, and copying language packs.

## Shipping artifact

```text
src-tauri\target\release\p4fnv.exe
src-tauri\target\release\locales\en.json
src-tauri\target\release\locales\ru.json
src-tauri\target\release\THIRD_PARTY_NOTICES.md
```

Before handoff, verify the locale files and obtain a hash:

```powershell
Get-FileHash .\src-tauri\target\release\p4fnv.exe -Algorithm SHA256
```

If the `.exe` is locked, first verify the process path and terminate only the `p4fnv.exe` instance from this repository. Do not terminate `p4`, `p4d`, or other Perforce processes.

## Version updates

Update Node/Rust/Tauri in a dedicated change together with version files, the lockfile, and the full gate. Do not use a floating `latest`. Build the Tauri desktop bundle on each OS's native runner; cross-compilation is not a project goal.

The initial setup history and installer links are preserved in [`research/TOOLCHAIN_BOOTSTRAP.md`](research/TOOLCHAIN_BOOTSTRAP.md).
