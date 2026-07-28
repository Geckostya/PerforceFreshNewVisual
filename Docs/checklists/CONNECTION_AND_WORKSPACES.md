# Connection and workspaces checklist

Current status for connection, authentication, client specs, mapping, and workspace/stream switching. Technical boundaries are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Discover an explicit or PATH `p4` executable and show its version.
- [x] P0 Test connection and distinguish CLI, network, auth, trust, and permission errors.
- [x] P0 Store bounded recent/favorite profiles without secrets and restore the last valid workspace.
- [x] P0 Password login/status/renew and explicit logout use safe stdin and confirmation.
- [x] P0 List, open, switch, create, edit, rename, and delete client specs while preserving unknown form fields and mappings.
- [x] P0 Show a read-only trust list and useful server/client information.
- [~] P1 Switch a stream with explicit local/content strategies; disposable-server topology coverage is not recorded.

## P0 gaps

- [ ] Confirm a new or changed SSL fingerprint in full before an explicit `p4 trust` write.
- [ ] Support server-driven MFA/login2 and SSO/P4 Authentication Service without logging stages, URLs, or tokens.
- [ ] Build a capability snapshot from versions, command help, services/topology, Unicode, case mode, and supported flags.
- [~] Complete client-spec inspection and validation for AltRoots, options, ChangeView, workspace type, and server binding.
- [ ] Navigate Depot ↔ client ↔ local through server `where`; never invent a local path for an unmapped depot file.
- [ ] Provide a safe visual mapping editor for include/exclude/overlay/ditto entries without reimplementing server mapping semantics.
- [ ] Add bounded workspace search/filter beyond the current list limit.

## Later

- [ ] P1 Verify classic/stream switching across opened, offline, shelved, and active-operation states.
- [ ] P2 Unload/reload and advanced workspace handoff only with permission/topology-aware preflight.
