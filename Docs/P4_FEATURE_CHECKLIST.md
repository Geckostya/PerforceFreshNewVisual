# Функциональный checklist P4FNV

Статус: живой backlog и снимок реализации. Обновлено 23 июля 2026 года.

Полный исходный каталог CLI-возможностей, personas и narrative user stories сохранён в [`research/P4_FEATURE_CATALOG_AND_STORIES.md`](research/P4_FEATURE_CATALOG_AND_STORIES.md). Этот документ содержит только данные, необходимые для выбора и завершения следующей разработки.

## Статусы и Definition of Done

- `[x]` — пользовательский flow реализован UI → Rust → `p4` → refresh и покрыт релевантной автоматической проверкой.
- `[~]` — flow полезен, но перечисленные ограничения не позволяют считать область закрытой.
- `[ ]` — пользовательского flow нет.
- P0 — ежедневная работа; P1 — профессиональная stream/team работа; P2 — редкий/advanced workflow.

Пункт становится `[x]`, когда:

- Tauri command узкая, Rust валидирует IDs/paths/revisions и не использует shell;
- mutation имеет точный scope, preview/confirmation по риску и server refresh;
- partial/unknown result не маскируется как success;
- есть loading/empty/error/permission states и keyboard path;
- новые строки добавлены в полные EN/RU packs;
- добавлен минимальный regression test для parser/arguments/state logic;
- выполнен полный gate из [`TOOLCHAIN.md`](TOOLCHAIN.md);
- live-server/WebView зависимость либо проверена на disposable setup, либо явно отмечена непроверенной.

## Текущий продукт

| Область | Статус | Реализовано | Не закрыто |
|---|---|---|---|
| Connection/auth | `[~]` P0 | detect `p4`, profiles/favorites, info, password login/status/logout, read-only trust list, restore last workspace | trust confirmation/write, MFA/login2, SSO/P4 AS, capability matrix |
| Workspace spec | `[~]` P0 | list/open/switch/create/edit/rename/delete, stream switch dialog, unknown form fields/mappings preserved | visual mapping editor, AltRoots/options validation, live-server stream-switch matrix |
| Workspace files | `[~]` P0 | lazy authorized-root directory reads, per-directory memory/IndexedDB disk and P4 cache, per-folder loading state, changelist-fingerprint-gated non-recursive `fstat -Rc`, explicit reconcile preview, optional disclosed scope/search/filter, status icons/tooltips, file/folder history, ignored/local-only presentation, edit/add/ignore/delete-local/delete/move/lock/unlock/revert/reconcile | virtualization of a single exceptionally large directory, full mapping/ignore/move classification, external editor |
| Sync/Get revision | `[~]` P0 | единый safe-sync controller для project/selection/depot/label/post-stream-switch, per-file writable keep/force resolution, batch force apply, file/byte progress with ETA и cancel, previewed numeric revision и label targets | changelist/date picker, parallel transfer controls, richer recovery |
| My Changes | `[x]` P0 | pending/default CL, local/shelf sections, cosmetic persistent Unactual with context/DnD transfer, create/edit/delete, batch reopen, filtering, DnD equivalents | advanced owner/type/jobs editing belongs to later scopes |
| Shelve/unshelve | `[x]` P0 | selected/full shelf, safe add-collision preview, per-file force, partial result, delete shelf/files | broader conflict taxonomy tracked below |
| Submit | `[~]` P0 | local, shelf and local+shelf strategies; preflight; recovery/compensation; local submit events | richer trigger diagnostics, shelf-preserving operations in common operation protocol, unknown-result recovery UI |
| Revert | `[x]` P0 | selected, unchanged and full CL with server preview; explicit delete-added-files setting | partial-selection compensation is optional expansion |
| Resolve | `[~]` P0 | unresolved detection, submit gate, preview, keep workspace/accept server/auto-safe/auto-merge | three-way editor, binary/move/filetype/stream-spec resolve |
| Depot | `[~]` P0 | source switch, scoped dirs/files, deleted toggle, breadcrumbs, blue depot/local-only disabled presentation, bounded folder/file history and sync preview | depot roots/types, lazy recursive tree, mapping navigation, server pagination |
| History | `[~]` P0 | scoped submitted list/details/jobs/files, filelog, preview/export, compare, workspace diff, annotate, undo preview/apply | cursor/server filters, range/folder compare, rename history, Revision Graph |
| Diff | `[~]` P0 | shared bounded unified/split viewer, line numbers, hunk navigation, whitespace modes, binary state, patch export | chunked large text, syntax/word highlight, image/binary preview, external tools |
| Operations/errors | `[~]` P0 | app-level sync/submit events, cancel, bounded history/log, explicit sync retry, core error kinds | all long operations, generic partial recovery, stale/offline mode, timeout/capability errors |
| Jobs | `[~]` P1 | bounded search/details/fixes, attach/detach, submit preflight metadata, history job filter | custom jobspec-aware create/edit and status workflow |
| Labels | `[~]` P1 | bounded search/details/files and safe sync preview/apply | static/automatic details, create/edit/delete, tag/untag |
| Search/keyboard | `[~]` P0 | Global Go To, screen command palette, screen shortcuts, keyboard context menus | action commands, stream/user targets, pane navigation, shortcut help |
| Streams/integration | `[~]` P1 | bounded stream catalog/tree/graph, multi-select with top-panel batch show/hide, collapsible branches, asymmetric hierarchical visibility, subtree-aware cosmetic Unactual with batch DnD, confirmed switch with local/content strategies | disposable-server switch verification, stream spec/history, integrate/copy/cherry-pick/interchanges |
| Settings/accessibility | `[~]` P0 | language, connection/revert settings, semantic controls and core keyboard flows | themes/density/preferences, full screen-reader contract, verified 200% layout |

Сложная семантика changelist, shelf, DnD и submit зафиксирована в [`CHANGELIST_REQUIREMENTS.md`](CHANGELIST_REQUIREMENTS.md).

## P0 — следующий обязательный слой

### Authentication и capability

- [ ] Trust flow: показать полный новый/изменившийся fingerprint, default Cancel, explicit `p4 trust` только после подтверждения.
- [ ] MFA/login2 и SSO/P4 Authentication Service без логирования URL/token/credentials.
- [ ] Capability snapshot из client/server version, services/topology, unicode/case handling и доступности нужных command flags.

### Workspace/Depot correctness

- [ ] Depot roots/types и lazy bounded tree с permission/maxresults состояниями.
- [ ] Depot ↔ client ↔ local mapping navigation через server `where`; unmapped path не получает ложный local path.
- [ ] Reconcile классифицирует add/edit/delete/move/ignored/unsafe и повторно проверяет stale preview.
- [ ] Edit/add/delete/move preflight показывает mapping, have/head, collision, other-open/lock и destination changelist.
- [ ] Большие file lists/history используют incremental loading; virtualization добавляется только после измерения.

### Resolve и submit reliability

- [ ] Three-way text resolve: base/source/workspace/result, conflict navigation, save и server read-back.
- [ ] Binary, move/name, filetype/attribute и stream-spec resolve имеют отдельные понятные flows.
- [ ] Trigger rejection, cancellation/network loss и unknown submit result дают read-back `submitted/pending/unknown` и recovery action.
- [ ] Shelf-preserving submit modes публикуют те же operation events, что local submit.
- [ ] Partial result UI показывает succeeded/failed/skipped и compensation outcome.

### History и recovery

- [ ] Server-side path/user/client/date/job filters и incremental cursor/limit без скрытого глобального scan.
- [ ] Folder/changelist compare показывает added/changed/deleted/type-changed summary.
- [ ] File rename/integration history следует records, не склеивая имена эвристикой.
- [ ] Rollback range имеет preview направления/revisions и создаёт opened changes, не меняя историю.

### UX, errors и scale

- [ ] Stale/offline mode сохраняет read-only snapshot, отключает mutation с причиной и делает controlled refresh.
- [ ] Timeout/unsupported/server-limit errors отделены от connection failure; truncated records считаются partial result.
- [ ] Pane keyboard navigation, focus restoration, operation announcements и Windows Narrator smoke.
- [ ] Проверенный layout на RU/EN, 100/125/200% и минимальном окне.

## P1 — замена P4V для stream/team workflow

### Streams и integration

- [ ] Bounded streams tree реализовано; details/spec/history и compatible workspaces требуют следующего инкремента и live-server smoke.
- [ ] Stream Graph parent/child/type реализован и визуально проверен; accessibility/scale matrix ещё не закрывает полный DoD.
- [ ] Safe workspace/stream switch и стратегии реализованы; требуется mutating smoke на disposable Helix Core.
- [ ] `integrate/copy -n` preview с явными source/target, interchanges и target changelist.
- [ ] Merge down, copy up и cherry-pick не выполняют автоматический submit; результат идёт Resolve → Review → Submit.
- [ ] Filename/stream-spec conflicts проходят соответствующий resolve flow.

### Content tools

- [ ] External editor/diff/merge запускается без shell с явными arguments и lifecycle temp files.
- [ ] Image diff и binary metadata preview имеют size limits и безопасный fallback.
- [ ] Revision Graph использует filelog/integration records, имеет focus/filter/compare и не выдумывает edges.

### Collaboration и productivity

- [ ] Jobs create/edit учитывает custom jobspec; submit показывает будущий server-defined status.
- [ ] Labels create/edit/delete и tag/untag имеют preview и permission handling.
- [ ] Saved filters/recent destinations хранятся per server/workspace.
- [ ] Settings: appearance/density, pane sizes, columns, diff mode, external tools, shortcuts и diagnostics/privacy.

## P2 — после P0/P1

- [ ] Promoted shelves и commit-edge topology actions.
- [ ] P4 Code Review integration только при настроенном endpoint.
- [ ] Classic branch maps и advanced integration ranges.
- [ ] File attributes, spec depot read-only browsing, archive/unload visibility.
- [ ] Graph/hybrid depot и DVCS/remotes как отдельный product mode.
- [ ] P4 Search integration с bounded fallback.
- [ ] Custom tools только как validated executable + explicit arguments; общего shell console не будет.

## Порядок реализации

1. Закрыть P0 reliability: auth/trust, mapping/reconcile, resolve, submit recovery, stale/partial states.
2. Закрыть P0 scale/history: bounded Depot/History, incremental lists, accessibility и visual scale.
3. Проверить Stream switch на disposable server и продолжить Streams → Integration → Resolve → Submit как P1 vertical workflow.
4. Добавить production content tools, Jobs/Labels CRUD и persistent preferences.
5. Брать P2 только по конкретному пользовательскому запросу или server topology.

## Обязательный smoke перед крупной отметкой `[x]`

- Plain и SSL server; новый/изменившийся fingerprint.
- Valid/expired ticket, password login/logout и доступный тестовый MFA/SSO setup.
- Classic и stream workspace; include/exclude/overlay mapping.
- Case-sensitive/case-insensitive и Unicode paths.
- Server limit/permission/trigger failure и partial output.
- Sync с locally modified unopened file и cancel посередине.
- Reconcile add/edit/delete/move с P4IGNORE.
- Submit success, unresolved, out-of-date, lock conflict и network interruption.
- Shelf-only/local-only/local+shelf; force unshelve только выбранных collision paths.
- Undo/resolve и, после появления integration, merge down/copy up/cherry-pick.
- RU/EN, keyboard-only, 100/125/200% и Windows Narrator.

Не запускать mutating smoke на пользовательском сервере без явного разрешения; использовать disposable Helix Core setup.
