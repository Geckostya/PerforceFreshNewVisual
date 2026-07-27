# Original project context: a visual client for Perforce Helix Core

> Research snapshot. This document records assumptions from before application implementation and is not the current development contract.

## Goal

Create a new cross-platform visual client for Perforce Helix Core. The client should cover a developer's main daily operations and may eventually approach P4V's capabilities.

## Adopted technical direction

Primary stack:

- **Rust** for the local backend and Perforce integration;
- **Tauri** for the desktop shell;
- **React or Svelte** for the UI, selected when creating the project;
- system-installed **`p4` CLI** as the primary Helix Core interface;
- structured command output through **`p4 -ztag -Mj`** (JSON Lines).

Proposed flow:

```text
Tauri UI (React/Svelte)
        ↓ Tauri commands + events
Rust backend
        ↓ separate p4 processes
p4 -ztag -Mj <command> ...
        ↓
Helix Core Server
```

## Why this approach was selected

- Helix Core APIs are sufficient for a complete visual client.
- Perforce provides official APIs for C/C++, .NET, Java, Python, and several other languages, but no complete official Rust SDK.
- Connecting C++ P4API through FFI would significantly complicate builds, updates, OpenSSL compatibility, and platform support.
- The `p4` CLI covers nearly every user operation and can return machine-readable results.
- A separate process per long operation naturally supports streaming output, progress, and cancellation.
- Rust provides one compact backend binary, good portability, and strict error checking.
- Tauri suits a lightweight desktop client and keeps Perforce access in Rust without exposing an arbitrary shell to frontend code.

Do not base the primary implementation on P4 REST API: in Helix Core 2026.1 it still has **Technology Preview** status, changes actively, and already contains breaking changes.

## Primary implementation principle

Start with a minimal working client over the CLI. Do not prebuild a universal SDK, plugin system, multiple transport layers, or abstractions for future REST/P4API.

Move to C++ P4API/FFI only when a specific operation objectively cannot be handled adequately by the CLI.

## First MVP boundaries

### Connection

- configure the path to `p4`;
- `P4PORT`, `P4USER`, `P4CLIENT`;
- verify connection through `p4 info`;
- SSL trust;
- `p4 login` and ticket-based authentication;
- select an existing workspace/client.

### Data browsing

- depot/workspace tree;
- file status;
- opened files;
- pending changelists;
- submitted changelists;
- changelist description;
- file history;
- diff of a selected revision.

### Operations

- sync;
- edit;
- add;
- delete;
- revert;
- create and edit changelists;
- move files between changelists;
- submit.

### Candidate commands for the first phase

```text
info
clients
client -o
fstat
opened
changes
describe
filelog
diff / diff2
sync
edit
add
delete
revert
reopen
change -o / change -i
submit
```

Shelve/unshelve, reconcile, streams, labels, jobs, and interactive resolve can follow a stable MVP.

## Proposed minimal structure

```text
src-tauri/src/
  p4.rs           # safe p4 launch and JSON Lines reading
  connection.rs   # connection parameters, environment, tickets
  commands.rs     # narrow Tauri commands for the UI
  main.rs

src/
  components/
    DepotTree
    Changelists
    FileHistory
    SubmitDialog
```

The structure is illustrative. Do not create a separate file or layer before a real workflow needs it.

## Requirements for launching `p4`

- Never construct a shell command by concatenating strings.
- Pass the command name and arguments through `Command::args()`.
- Do not pass the password through process arguments.
- Use `p4 login`, tickets, and system secret storage when needed.
- Restrict operations available to the frontend through Tauri commands.
- Do not let the frontend start arbitrary shell commands.
- Read stdout line by line: `-Mj` returns a sequence of JSON objects, not one JSON array.
- Handle stdout, stderr, exit code, Perforce warnings, and errors separately.
- Use a separate child process for long operations and retain its identifier/handle for cancellation.
- Account for non-UTF-8 names and content; `-Mj` replaces invalid UTF-8 bytes with `U+FFFD`, so file paths require separate validation.
- Obtain the `p4` path from explicit user settings or `PATH`.
- Do not bundle `p4` with the application without reviewing Perforce licensing and redistribution rules.

## Helix Core properties that must be preserved

- depot path, client path, and local filesystem path are different namespaces;
- a client view can include, exclude, and redirect paths;
- file operations depend on the selected workspace;
- one API connection is not intended for parallel requests, although every command is a separate process in the CLI architecture;
- Unicode mode and `P4CHARSET`;
- case-sensitive and case-insensitive servers/filesystems;
- commit/edge server topology;
- tickets, SSO, MFA, and SSL trust;
- server permissions and protections;
- interactive prompts and resolve;
- large binary files, long sync/submit, and operation cancellation.

## Proposed first vertical workflow

Do not start with the entire feature list. The first complete workflow is:

1. Find `p4` and show its version.
2. Enter `P4PORT`, `P4USER`, `P4CLIENT`.
3. Run `p4 info` and display the result.
4. Obtain `p4 opened` and show opened files.
5. Obtain pending changelists.
6. Move a selected file to a changelist through `p4 reopen`.
7. Add minimal tests for JSON Lines parsing and process errors.

Then add the depot tree, sync, and submit.

## Open decisions

- React or Svelte for the UI.
- Windows-only or Windows/macOS/Linux support.
- Whether the client should use only user-installed `p4` or distribute it separately after legal review.
- How closely the UI should follow P4V.
- Whether streams support is needed in the first public release.

## Useful official sources

- [P4 CLI: global options and JSON output](https://help.perforce.com/helix-core/server-apps/cmdref/2025.1/Content/CmdRef/global.options.html)
- [P4 API for C/C++](https://help.perforce.com/helix-core/apis/p4api/current/Content/P4API/Home-p4api.html)
- [P4Python: universal `run()` and API model](https://help.perforce.com/helix-core/apis/p4python/current/Content/P4Python/python.p4.html)
- [P4Java](https://help.perforce.com/helix-core/apis/p4java/current/Content/P4Java/Home-p4java.html)
- [P4 REST API — Technology Preview](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/p4-rest-api.html)
- [Tauri: launching external binaries](https://v2.tauri.app/develop/sidecar/)

## Ready-to-use instruction for a new chat

```text
Use PERFORCE_CLIENT_CONTEXT.md as the original project context.

Create a new cross-platform desktop visual client for Perforce Helix Core with Tauri + Rust. Primary Perforce integration must use the installed p4 CLI with `-ztag -Mj` output. Follow the minimal architecture in this document: do not add C++ P4API FFI, REST, a universal transport layer, or other abstractions without a real need.

First inspect the environment and propose/create the smallest vertical workflow: find p4, show its version, enter P4PORT/P4USER/P4CLIENT, run p4 info, and display the result. Pass every process argument safely without shell concatenation. Add a minimal test for result and error parsing.
```
