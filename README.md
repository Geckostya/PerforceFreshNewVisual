# P4FNV

P4FNV (Perforce Fresh New Visual) is a modern Windows desktop client for
Perforce Helix Core. It is built with Tauri 2, React, TypeScript, and Rust and
uses the locally installed `p4` CLI for server operations.

> [!NOTE]
> The project is under active development. Review the feature checklist before
> relying on a workflow in production.

## Current scope

- Workspace files and depot browsing
- Pending changelists, shelves, submit, unshelve, and revert workflows
- Streams, labels, jobs, history, diff, and undo surfaces
- Safe sync conflict handling and operation progress/cancellation
- External English and Russian language packs
- Native UI verification through the project-scoped Codex MCP bridge

The detailed product and implementation contracts live in
[`Docs/README.md`](Docs/README.md). Current feature status is tracked in
[`Docs/P4_FEATURE_CHECKLIST.md`](Docs/P4_FEATURE_CHECKLIST.md).

## Requirements

- Windows 10 or 11 (x64)
- Visual Studio 2022 Build Tools or Community with MSVC and Windows SDK
- WebView2 Runtime
- Perforce CLI (`p4.exe`)
- Node.js 24.16.0
- Rust 1.97.1 with rustfmt and Clippy

The repository can use its ignored `.toolchain` directory for pinned local
Node.js and Rust installations. See [`Docs/TOOLCHAIN.md`](Docs/TOOLCHAIN.md)
for setup details.

## Development

```powershell
. .\scripts\toolchain.ps1
npm ci
npm run dev
```

Run the full verification gate before shipping:

```powershell
. .\scripts\toolchain.ps1
npm test -- --run
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
npm run build
```

The standard build artifact is
`src-tauri\target\release\p4fnv.exe`; external locale files are copied beside
it during the build.

## License

Licensed under the [MIT License](LICENSE).
