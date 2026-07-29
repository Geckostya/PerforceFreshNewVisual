# Operations, errors, settings, and accessibility checklist

Current status for cross-feature operations, recovery, navigation, settings, localization, scale, and accessibility. Shared UI rules are owned by [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md), localization by [`../LOCALIZATION.md`](../LOCALIZATION.md), and operation boundaries by [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [~] P0 Operations Center receives sync/local-submit/reconcile events, shows bounded history/progress/item/read-back results, cancels a specific process, and explicitly retries safe sync.
- [x] P0 Core errors distinguish conflict, offline, timeout, unsupported capability, server limit, cancelled, stale, partial result, invalid output, and command failure with localized hints.
- [~] P0 My Changes and Streams preserve a read-only stale snapshot and block primary mutations until controlled Refresh succeeds.
- [x] P0 Bounded session CLI warnings/errors remain available for diagnostics.
- [x] P0 Global Go To, screen command palette, screen shortcuts, pane/list/tree focus navigation, shortcut help, multi-select, and keyboard context menus exist.
- [x] P0 Complete built-in English/Russian packs and complete external JSON packs are supported.
- [~] P0 Core controls are semantic and keyboard-usable; full pane/screen-reader/scale verification remains.

## P0 gaps

- [ ] Put every long mutation on the shared event/cancel/read-back protocol; never retry an unknown mutation automatically.
- [~] Finish typed item/compensation/read-back output for Safe Sync and shelf-preserving submit modes; Operations Center already renders the shared result.
- [ ] Extend the stale/offline snapshot pattern and complete mutation gating for Files and other resource screens.
- [x] Complete pane navigation, focus restoration, and shortcut help; operation start/cancel/terminal announcements are implemented without progress spam, with terminal problems announced assertively.
- [ ] Verify English/Russian at 100%, 125%, and 200%, minimum window size, and Windows Narrator.
- [~] Keep selection/scroll/focus stable across incremental loading and refresh in large lists; shared keyboard focus and Local Files selection retention are implemented, while other feature-specific scroll retention still needs native verification.

## P1 settings and productivity

- [ ] Persist appearance/density, pane sizes, columns, diff mode, filters, external tools, shortcuts, and diagnostics/privacy preferences.
- [ ] Add action commands and stream/user/entity targets to navigation without an unbounded global query.
- [ ] Add saved filters and recent destinations per server/workspace.
