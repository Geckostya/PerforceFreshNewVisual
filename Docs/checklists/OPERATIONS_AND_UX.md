# Operations, errors, settings, and accessibility checklist

Current status for cross-feature operations, recovery, navigation, settings, localization, scale, and accessibility. Shared UI rules are owned by [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md), localization by [`../LOCALIZATION.md`](../LOCALIZATION.md), and operation boundaries by [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [~] P0 Operations Center receives sync/local-submit events, shows bounded history/progress, cancels a specific process, and explicitly retries sync.
- [~] P0 Core errors distinguish conflict, offline, cancelled, stale, and partial result with localized hints.
- [x] P0 Bounded session CLI warnings/errors remain available for diagnostics.
- [~] P0 Global Go To, screen command palette, screen shortcuts, multi-select, and keyboard context menus exist.
- [x] P0 Complete built-in English/Russian packs and complete external JSON packs are supported.
- [~] P0 Core controls are semantic and keyboard-usable; full pane/screen-reader/scale verification remains.

## P0 gaps

- [ ] Put every long mutation on the shared event/cancel/read-back protocol; never retry an unknown mutation automatically.
- [ ] Standardize partial-result UI with succeeded/failed/skipped items, compensation, and recovery actions.
- [ ] Preserve a read-only stale/offline snapshot and disable mutations with a reason until controlled refresh succeeds.
- [ ] Separate timeout, unsupported capability, server limit, invalid output, and connection failure.
- [ ] Complete pane navigation, focus restoration, operation announcements, and shortcut help.
- [ ] Verify English/Russian at 100%, 125%, and 200%, minimum window size, and Windows Narrator.
- [ ] Keep selection/scroll/focus stable across incremental loading and refresh in large lists.

## P1 settings and productivity

- [ ] Persist appearance/density, pane sizes, columns, diff mode, filters, external tools, shortcuts, and diagnostics/privacy preferences.
- [ ] Add action commands and stream/user/entity targets to navigation without an unbounded global query.
- [ ] Add saved filters and recent destinations per server/workspace.
