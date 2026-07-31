# Connection and workspaces checklist

Current status for connection, authentication, client specs, mapping, and workspace/stream switching. Technical boundaries are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Discover an explicit or PATH `p4` executable, show its version, and offer an official download link only when the executable is missing.
- [x] P0 Test connection and distinguish CLI, network, auth, trust, timeout, capability, and permission errors.
- [x] P0 Store bounded recent/favorite profiles without secrets and restore the last valid workspace.
- [x] P0 Password login/status/renew, bounded `login2` browser/MFA stages, and explicit logout use safe channels and confirmation.
- [x] P0 List, open, switch, create, edit, rename, and delete client specs while preserving unknown form fields and mappings.
- [x] P0 Inspect AltRoots, Options, ChangeView, workspace type, server binding, trust, and runtime capabilities with authoritative read-back.
- [x] P0 Navigate Depot ↔ client ↔ local through bounded server `where` results without inventing unmapped paths.
- [x] P0 Search/filter workspaces with bounded results, cancellation, and explicit partial state.
- [x] P0 Edit include/exclude/overlay/ditto mappings through server forms without a frontend View parser.

## Remaining reliability work

- [~] Complete the live environment matrix for new/changed SSL certificates, configured SSO, commit-edge topology, and alternate Unicode/case modes. Fake-P4 and unit coverage already exists.
- [~] Verify classic/stream switching across opened, offline, shelved, and active-operation states on disposable servers.

## Only on demand

- [ ] Unload/reload and advanced workspace handoff, only when a real server topology or administration workflow requires it.
