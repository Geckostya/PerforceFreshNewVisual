# P4 capability reference

This research note maps user-facing P4 workflows to the CLI surface and the conditions that affect their implementation. It does not track P4FNV status or priorities; use [`../P4_FEATURE_CHECKLIST.md`](../P4_FEATURE_CHECKLIST.md) for that. Process and mutation safety remain owned by [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

Use the current official references below when researching a command, then gate version-dependent flags against the user's installed CLI and connected server at runtime.

## Product boundary

P4FNV is a developer client for everyday work with classic and stream workspaces. Server administration—protections, groups, licenses, triggers, replication, checkpoints, recovery, `obliterate`, and configurables—belongs to P4 Admin or the CLI.

Graph/hybrid depots, DVCS/remotes, P4 Search, P4 Code Review, and administrative force operations are separate product modes or optional integrations. They must not complicate the classic-server workflow before a concrete requirement exists.

## Workflow-to-command map

| Workflow | Primary CLI surface | Important constraints |
|---|---|---|
| Discover/connect | `p4 -V`, `info`, `set`, `login -s` | Separate missing CLI, network, auth, trust, and permission failures. |
| Authenticate | `login`, `login2`, `logout`, `trust` | Fingerprint changes default to Cancel; MFA/SSO stages come from the server. |
| Detect capabilities | `info`, `help <command>`, `topology` | Record client/server versions, services, ServerID, Unicode, case mode, security, and topology. |
| List/manage workspaces | `clients`, `client -o/-i/-d`, `renameclient`, `unload`, `reload` | Preserve unknown form fields and mapping order; deletion never deletes local files. |
| Resolve mappings | `where`, `client -o` | Never emulate full View semantics in the frontend; unmapped paths receive no false local path. |
| Browse workspace/depot | `depots`, `dirs`, `files`, `fstat`, `have`, `cstat` | Load one bounded scope; represent permission and maxresults as partial state. |
| Detect offline work | `reconcile -n`, `status`, `ignores -i` | Distinguish add/edit/delete/move/ignored/unsafe and revalidate before apply. |
| Retrieve content | `sync -n`, `sync -s`, `sync`, `print` | Safe sync is the default; overwrite is explicit and recoverable. Date/change/label/revision targets share one safety contract. |
| Open files | `edit`, `add`, `delete`, `move`, `reopen` | Batch selected paths, validate mapping/collisions, and choose a destination changelist. |
| Revert/clean | `revert -n/-a/-w`, `clean`, `reconcile -w` | Revert and destructive clean are separate workflows; preview exact local consequences. |
| Pending changes | `changes`, `change -o/-i/-d`, `opened`, `reopen`, `fixes` | Default, local-only, shelf-only, and local+shelf are different states. |
| Shelves | `shelve`, `unshelve`, `files @=change`, `describe -S`, `reshelve` | Unshelve preserves the source shelf; `-f` applies only to explicitly selected conflicts. |
| Submit | `submit -c/-d/-e`, `resolved`, `resolve -n`, `fstat`, `fixes` | Reread pending/submitted/opened state after interruption; never retry an unknown mutation automatically. |
| Submitted history | `changes -s submitted`, `describe`, `diff2` | Scope and limits stay visible; load file diffs lazily. |
| File history/content | `filelog -i`, `print`, `diff`, `diff2`, `annotate` | Follow real integration/move records; bound text and provide a binary fallback. |
| Retrieve vs rollback | `sync path@rev`, `undo -n`, `undo -c` | Getting old content changes the have state; undo creates new opened changes. Keep the actions distinct. |
| Resolve | `resolve -n`, `resolved`, `resolve -ay/-at/-as/-am` | Text, binary, move/name, filetype/attribute, and stream-spec conflicts need distinct presentation. |
| Streams | `streams`, `stream -o/-i`, `streamlog`, `istat`, `switch` | A Stream Graph is a hierarchy with flow hints, not a Git commit graph. Switching must account for opened/offline work. |
| Integrate/copy | `integrate -n/-c`, `copy -n/-c`, `interchanges`, `integrated` | Show explicit source and target; apply into a pending changelist; never submit automatically. |
| Locks | `fstat`, `opened -a`, `lock`, `unlock` | Explicit locks and filetype `+l` differ; global locks require commit-edge awareness. |
| Jobs/fixes | `jobs`, `job -o/-i`, `jobspec -o`, `fix`, `fixes` | Jobspecs are server-defined; do not hard-code the default schema or status flow. |
| Labels | `labels`, `label -o/-i/-d`, `files @label`, `tag`, `labelsync` | Distinguish static/automatic and locked/unlocked labels; label sync uses safe sync. |
| Search/navigation | Entity commands plus optional P4 Search | Keep fallback searches scoped, bounded, debounced, and cancellable. |

## Compatibility gates

| Gate | Workflows affected |
|---|---|
| New or changed SSL fingerprint | Connection and trust confirmation. |
| Password, MFA/login2, SSO/P4 Authentication Service | Authentication stages and browser handoff. |
| Standard vs commit/edge/replica/proxy/broker | Promoted shelves, global locks, workspace binding, and mutation origin. |
| Classic vs stream workspace | Mapping edits, stream switching, stream-spec shelves, and integration. |
| Include/exclude/overlay/ditto mappings | Browsing, reconcile, sync, rename, and depot-to-local navigation. |
| Case-sensitive vs case-insensitive | Stable IDs, selection, filters, and case-only rename. |
| Unicode and non-UTF-8 filenames | Parsing, display-only paths, filesystem round trips, and mutation safety. |
| Server limits and restricted records | Pagination, partial results, permission states, and narrowed retry. |
| Depot type | Local/stream/spec/remote/archive/unload/graph visibility and allowed actions. |
| CLI/server version and command flags | Parallel transfer, sparse streams, login2, topology, and newer filters. |

## Primary official references

- [P4 CLI commands](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands.html)
- [Global options and structured output](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/global.options.html)
- [P4V connection and authentication](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.connecting.html)
- [P4V workspaces](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.workspaces.html)
- [P4V file retrieval](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.retrieve.html)
- [P4V changelists and submit](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.submit.html)
- [P4V streams](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.about.html)
- [P4V merge down and copy up](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.merge_copy.html)

Open the command-specific page for uncertain flags or destructive semantics. Do not copy the full upstream reference into project documentation.
