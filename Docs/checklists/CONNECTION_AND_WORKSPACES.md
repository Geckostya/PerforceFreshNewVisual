# Connection and workspaces checklist

Current status for connection, authentication, client specs, mapping, and workspace/stream switching. Technical boundaries are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Discover an explicit or PATH `p4` executable and show its version.
- [x] P0 Test connection and distinguish CLI, network, auth, trust, and permission errors.
- [x] P0 Store bounded recent/favorite profiles without secrets and restore the last valid workspace.
- [x] P0 Password login/status/renew and explicit logout use safe stdin and confirmation.
- [x] P0 List, open, switch, create, edit, rename, and delete client specs while preserving unknown form fields and mappings; inspection represents AltRoots, options, ChangeView, workspace type, and server binding, and save returns an authoritative server read-back.
- [x] P0 Show a read-only trust list and useful server/client information.
- [x] P0 Confirm a complete new or changed SSL fingerprint through an explicit narrow trust write and verified read-back.
- [x] P0 Support bounded server-driven `login2` MFA/browser stages without persisting or logging secrets; password login remains the fallback.
- [x] P0 Build a tri-state session capability snapshot from CLI help, server facts, topology, depot modes, and workspace binding.
- [~] P1 Switch a stream with explicit local/content strategies; disposable-server topology coverage is not recorded.

## P0 gaps

- [~] Client-spec inspection represents AltRoots, options, ChangeView, workspace type, and server binding, and save returns an authoritative server read-back; native verification of the expanded details dialog remains.
- [~] Navigate Depot ↔ client ↔ local through bounded server `where` results without inventing unmapped local paths; native matrix coverage is still required.
- [ ] Provide a safe visual mapping editor for include/exclude/overlay/ditto entries without reimplementing server mapping semantics.
- [ ] Add bounded workspace search/filter beyond the current list limit.

The disposable standard server verifies password fallback and capability collection. SSL new/changed certificates, a configured MFA/SSO provider, commit-edge topology, and alternate Unicode/case-mode servers still require environment-matrix live runs; unit and fake-output tests cover their parsing, exact arguments, redaction, and unknown-state behavior.

## Later

- [ ] P1 Verify classic/stream switching across opened, offline, shelved, and active-operation states.
- [ ] P2 Unload/reload and advanced workspace handoff only with permission/topology-aware preflight.
