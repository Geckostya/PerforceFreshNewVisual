# Initial development toolchain setup

> Research snapshot. Current commands are in [`../TOOLCHAIN.md`](../TOOLCHAIN.md).

## Current Windows machine state

Verified on July 21, 2026:

| Component | Version / state | Location |
|---|---|---|
| Windows | 10.0.26200, x64 | system |
| Visual Studio | Community 2022 17.13.5 | `C:\Tools\Visual Studio\2022\Community` |
| MSVC | 14.38 and 14.43, x64 tools | Visual Studio |
| Windows SDK | 10.0.22621.0 | system |
| WebView2 Runtime | 150.0.4078.83 | system |
| Git | 2.51.0.windows.1 | `C:\Tools\Git` |
| Perforce CLI | P4/NTX64/2025.1/2831954 | `C:\Program Files\Perforce\p4.exe` |
| Node.js LTS | 24.16.0 | `.toolchain/node` |
| npm | 11.13.0 | `.toolchain/node` |
| Rust | 1.97.1 stable-msvc | `.toolchain/rustup` |
| Cargo, rustfmt, Clippy | from Rust 1.97.1 | `.toolchain/cargo/bin` |

System Tauri dependencies for Windows were already installed. Node.js and Rust were downloaded from official sources into the local ignored `.toolchain` directory because the current session has no administrative token for a system-wide MSI.

## Activation

In a new PowerShell from the project root, run:

```powershell
. .\scripts\toolchain.ps1
```

The leading dot and space matter: the script must modify the current PowerShell session's environment. Afterwards, `node`, `npm`, `rustup`, `rustc`, `cargo`, `rustfmt`, and `clippy` are available. The npm cache also remains in the ignored `.toolchain/npm-cache` directory.

Check:

```powershell
node --version
npm --version
rustc --version
cargo --version
cargo clippy --version
p4 -V
```

## Pinned versions

- `.node-version` pins Node.js `24.16.0`.
- `rust-toolchain.toml` pins Rust `1.97.1`, rustfmt, and Clippy.
- Once the frontend exists, `package-lock.json` pins npm dependencies.
- Tauri CLI must be a `devDependency`, invoked through `npm run tauri`, not a global installation.

## Creating the application in the next phase

After activating the environment, the project can be initialized with a Tauri React + TypeScript template in the current directory. Preserve existing `Docs`, `scripts`, and version files first; the automatic generator must not overwrite them.

Preferred npm scripts after initialization:

```json
{
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "tauri": "tauri"
  }
}
```

Add Vitest with the first nontrivial frontend test, not before. Rust uses Cargo's built-in test runner.

## Not required

- Global Tauri CLI: the version must live in the project.
- pnpm/yarn: npm already ships with Node and creates the lockfile.
- C++ P4API: integration uses the installed `p4`.
- Docker and a local Helix Server for ordinary builds: a fake executable covers integration tests; a real server is needed only for smoke tests.
- Android/iOS toolchain: the application is desktop-only until a separate product decision.

## Updates

Update Node or Rust in a dedicated change together with version files, the lockfile, and full verification:

```powershell
npm ci
npm run typecheck
npm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Do not use a floating `latest` in CI. Each OS builds its Tauri installer on a native runner; cross-compiling a desktop bundle from Windows to macOS/Linux is not a goal.

## Installation sources

- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Rust: https://www.rust-lang.org/tools/install
- Node.js LTS: https://nodejs.org/en/download
- Perforce CLI: https://www.perforce.com/downloads/helix-command-line-client-p4

The Node.js archive was verified against official `SHASUMS256.txt`. `rustup-init.exe` came from the official HTTPS endpoint `https://win.rustup.rs/x86_64`; the Windows rustup binary has no Authenticode signature, so the source and TLS endpoint are essential.
