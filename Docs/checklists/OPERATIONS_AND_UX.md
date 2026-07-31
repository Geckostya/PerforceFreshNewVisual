# Operations, errors, settings, and accessibility checklist

Current status for cross-feature operations, recovery, navigation, settings, localization, and accessibility. Shared UI rules are owned by [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md), localization by [`../LOCALIZATION.md`](../LOCALIZATION.md), and operation boundaries by [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Available

- [x] P0 Operations Center receives sync/local-submit/reconcile events, shows bounded progress/item/read-back results, cancels a specific process, and retries only safe sync.
- [x] P0 Core errors distinguish conflict, offline, timeout, unsupported capability, server limit, cancelled, stale, partial result, invalid output, and command failure.
- [x] P0 Background discovery is bounded, cancellable, backoff-aware, yields to foreground work, and never scans the whole workspace by default.
- [x] P0 Global Go To, command palette, shortcuts, pane/list/tree focus navigation, multi-select, and keyboard context menus exist.
- [x] P0 English/Russian packs and external JSON packs are complete.

## Remaining reliability work

- [~] Put every remaining long mutation on the shared event/cancel/read-back protocol; never retry an unknown mutation.
- [~] Extend the stale/offline snapshot pattern and mutation gating to every resource screen.
- [~] Finish uniform succeeded/failed/skipped, compensation, and recovery presentation for compound operations.
- [~] Keep selection/scroll/focus stable across incremental loading and refresh in large lists.
- [~] Complete native verification of keyboard and semantic controls on the workflows users actually use.

## Product settings only when demanded

- [ ] Persist only settings with demonstrated value (filters, density, columns, external tools, and privacy/diagnostics). Do not make a broad preferences system a current milestone.
