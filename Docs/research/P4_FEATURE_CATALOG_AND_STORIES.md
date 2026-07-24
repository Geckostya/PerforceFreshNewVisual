# Полный каталог функций и user stories P4FNV

> Research snapshot. Актуальный приоритетный backlog находится в [`../P4_FEATURE_CHECKLIST.md`](../P4_FEATURE_CHECKLIST.md).

Статус: живой продуктовый контракт и очередь реализации<br>
Дата аудита: 21 июля 2026 года<br>
База сравнения: P4V 2026.2, P4 CLI 2026.1 и текущее состояние исходного кода P4FNV<br>
Локальный CLI при аудите: P4/NTX64/2025.1/2831954; поэтому новые возможности обязаны проходить runtime capability check

## 1. Назначение и границы

Этот документ отвечает на три вопроса:

1. Какие возможности Helix Core нужны программисту, чтобы использовать P4FNV вместо P4V в повседневной работе.
2. Какими командами установленного P4 CLI эти возможности реализуются.
3. Что уже реализовано в P4FNV, что сделано частично, а что ещё отсутствует.

Это не каталог всех административных команд P4 Server. Управление protections, группами, лицензиями, триггерами, репликацией, checkpoints, obliterate и серверными configurables относится к P4 Admin и не входит в обязательное ядро P4FNV.

P4 CLI в этом проекте является прикладным интерфейсом к серверу. Для команд со стабильным структурированным выводом следует использовать <code>p4 -ztag -Mj</code>. Формы спецификаций (<code>change -o/-i</code>, <code>client -o/-i</code>, <code>stream -o/-i</code>, <code>label -o/-i</code>) обрабатываются как текстовые формы. Пароли и ответы интерактивной аутентификации передаются через stdin или официальный интерактивный механизм, но не через аргументы процесса.

## 2. Как читать и обновлять чеклист

Обозначения:

- [x] **Готово** — сценарий существует сквозным путём UI → Rust → P4 CLI → refresh UI и подтверждён аудитом кода.
- [ ] **Частично** — часть пути существует, но сценарий ещё нельзя считать надёжным для ежедневного использования.
- [ ] **Не реализовано** — пользовательского сценария нет.
- **P0** — обязательный минимум для ежедневной работы.
- **P1** — профессиональная функциональность, необходимая для замены P4V в stream-based проектах.
- **P2** — расширенный командный workflow.
- **P3** — специализированная или редко используемая возможность.

Отметка «Готово» в текущем снимке означает наличие реализации и автоматических тестов там, где они есть. Она не заменяет отдельный smoke-тест против тестового P4 Server. Если поведение зависит от topology, permissions, триггеров, SSO/MFA, типа depot или конкретной версии сервера, live-server проверка должна быть записана отдельно.

### Универсальное определение готовности пункта

Любой новый пункт разрешается переключить в [x] только когда:

- есть отдельные модели Rust и TypeScript для данных сценария;
- Rust строит разрешённые аргументы P4 без shell-интерполяции и валидирует changelist, revision и пути;
- Tauri command узкая и не принимает произвольную командную строку;
- UI содержит loading, empty, permission denied, offline/stale и partial-result состояния;
- после мутации данные перечитываются с сервера, а selection и scroll сохраняются, если объект ещё существует;
- длительная операция имеет operation id, поток событий, предупреждения, итог и отмену, если процесс допускает безопасное прерывание;
- destructive flow показывает точный workspace, scope и последствия;
- доступны мышь, клавиатура и batch-операция для multi-select, где она имеет смысл;
- все строки вынесены в полные <code>locales/en.json</code> и <code>locales/ru.json</code>;
- добавлены unit-тесты построения аргументов, парсинга и нетривиальной UI-логики;
- выполнены frontend/Rust проверки и релевантный smoke-test на disposable P4 Server либо явно записано, что именно не проверено;
- этот документ и связанный living contract обновлены.

## 3. Снимок текущего состояния

Отметки этого раздела сверены с allow-listed Tauri commands в [commands.rs](../../src-tauri/src/commands.rs), фактическими аргументами CLI и тестами в [p4.rs](../../src-tauri/src/p4.rs), typed frontend API в [api.ts](../../src/shared/api.ts), рабочими экранами [ConnectionScreen.tsx](../../src/features/connection/ConnectionScreen.tsx) и [ChangesView.tsx](../../src/features/changes/ChangesView.tsx), а также с контрактом [CHANGELIST_REQUIREMENTS.md](../CHANGELIST_REQUIREMENTS.md).

### 3.1 Уже реализовано

- [x] **P0. Поиск P4 CLI и показ версии.** Явный путь или поиск <code>p4.exe</code> в PATH; команда <code>p4 -V</code>.
- [x] **P0. Проверка базового соединения.** Ввод P4PORT, P4USER, P4CLIENT и P4CHARSET; команда <code>p4 info</code>; классификация auth, trust и permission ошибок.
- [x] **P0. Выбор существующего workspace.** Получение собственных clients через <code>p4 clients -u ...</code>, ручной ввод, recent profiles.
- [x] **P0. Восстановление последнего workspace.** Сохраняются только несекретные поля; при старте выполняются <code>p4 info</code> и <code>p4 login -s</code>; Exit workspace не удаляет профиль.
- [x] **P0. Pending changelists и opened files текущего workspace.** Команды <code>p4 changes -s pending</code>, <code>p4 changes -s shelved</code>, <code>p4 opened -C</code>.
- [x] **P0. Раздельное отображение local opened и shelved files.** Shelf текущего changelist загружается лениво через <code>p4 files @=change</code>.
- [x] **P0. Создание, изменение описания и удаление пустого numbered changelist.** Формы <code>p4 change -i</code>, <code>p4 change -o</code>, удаление <code>p4 change -d</code>.
- [x] **P0. Перемещение файлов между changelists.** Single/multi-select, Ctrl/Cmd, Shift range, inspector и drag-and-drop; batch <code>p4 reopen -c</code>.
- [x] **P0. Базовый текстовый diff.** Local ↔ have через <code>p4 diff -du</code>, shelf ↔ head через <code>p4 diff2 -du</code>, local ↔ shelf; лимит 2 MiB и признак truncation.
- [x] **P0. Shelve/update.** Выбранные файлы, полный replace shelf, опциональный revert после shelf; <code>p4 shelve -f/-r -c ... -Af</code>.
- [x] **P0. Unshelve.** Выбранные или все файлы в Default/numbered changelist; <code>p4 unshelve -s -c -Af</code>.
- [x] **P0. Preflight конфликтов shelved add.** <code>p4 where</code> + проверка локального файла; безопасный Skip по умолчанию и явный <code>unshelve -f</code> только для выбранных путей.
- [x] **P0. Удаление shelf целиком или выбранных shelved files.** <code>p4 shelve -d</code> с подтверждением.
- [x] **P0. Revert выбранных или всех local files changelist.** <code>p4 revert -c</code>; для opened-for-add есть сохраняемая явная настройка <code>-w</code>.
- [x] **P0. Submit local, shelf и конфликтующего local+shelf состояния.** Реализованы четыре режима submit, recovery changelist и compensation при составных ошибках.
- [x] **P0. Refresh после мутаций и при возврате фокуса.** Shelf cache очищается, UI перечитывает server state.
- [x] **P0. Сессионный журнал предупреждений и ошибок CLI.** Ограниченный журнал с техническими деталями и очисткой.
- [x] **P0. Внешние RU/EN language packs.** Дополнительный полный JSON-словарь можно положить рядом с executable или в app config directory.

### 3.2 Реализовано частично и не должно считаться закрытым

- [ ] **P0. Полная аутентификация — частично.** Реализованы password login и logout с безопасным stdin/подтверждением; продление/expiry ticket, <code>p4 login2</code>, SSO/P4 Authentication Service и подтверждение SSL fingerprint через <code>p4 trust</code> ещё не закрыты.
- [ ] **P0. Управление workspace — частично.** Список, открытие, session-level безопасное переключение, read-only inspector и explicit create/edit/delete/rename client spec workflows есть; edit сохраняет неизвестные form fields/mappings и обновляет root/stream/description.
- [ ] **P0. Submit review — частично.** Реализован read-only preflight opened/fstat, pending <code>resolve -n</code>, missing/out-of-date/other-open/lock issues, bounded jobs через <code>p4 fixes -c</code>, structured server warnings, stream spec из client form и суммарный file size с повторным явным подтверждением; richer trigger diagnostics ещё не закрыты.
- [ ] **P0. Diff viewer — частично.** Есть bounded unified/split viewer, line numbers, hunk navigation, export patch, binary state и режимы exact/ignore whitespace changes/ignore whitespace/ignore line endings; syntax highlighting и image diff остаются.
- [ ] **P0. Error model — частично.** Добавлены отдельные `conflict`, `offline`, `cancelled`, `stale` и `partial_result` classifications с локализованными hints; полноценный stale/offline mode и partial success recovery UI ещё не закрыты.
- [ ] **P0. Operations Center — частично.** App-level центр получает streaming sync/local submit events, хранит bounded историю, показывает progress/path/status и cancel; для failed/cancelled sync добавлен explicit retry с подтверждением, shelf-preserving submit operation и mutation recovery UI ещё не закрыты.
- [ ] **P0. Accessibility changelist UI — частично.** Multi-select, buttons и keyboard context menu (`ContextMenu`/`Shift+F10`) есть; полная навигация по panes, screen-reader announcements и визуальная проверка 200% ещё не закрыты.
- [ ] **P0. Интеграционные тесты — частично.** Есть Rust/TypeScript unit tests; отсутствует зафиксированная матрица smoke-tests на disposable P4 Server для submit/shelf compensation и topology-dependent сценариев.

### 3.3 Крупные отсутствующие области

- [ ] Workspace/project file browser и status. Есть scoped list/status slice, client spec inspector, local search, Tree/List режим и status filters opened/outdated/unresolved/other-open/unmapped/untracked; untracked filter дополняет `fstat` безопасным `reconcile -n`, virtualization ещё не закрыта.
- [ ] Depot browser. Есть read-only scoped `p4 dirs`/`p4 files` browser с каталогами и head metadata, автоматическим переходом по каталогам, breadcrumbs/up-навигацией, явным include deleted/archived toggle и file inspector с bounded history/print preview; lazy server tree ещё не закрыта.
- [ ] Sync/update с preview, safe apply, refresh, progress, cancel и local-modified preflight реализованы; расширенные target modes ещё не закрыты.
- [ ] Edit/add/delete/reconcile из file browser реализованы базовыми batch-командами; Workspace также даёт явный single-file rename через `p4 move -n` → `p4 move -c`, lock/unlock доступны в Workspace и Changes для selected/all opened files, clean и полный file browser ещё не закрыты.
- [ ] Submitted changelist history для выбранного проекта, папки или файла. Есть глобальный submitted changes list и lazy details.
- [ ] File history, revision compare, content preview, annotate и Revision Graph. Есть file history, print preview и compare revisions.
- [ ] Get Revision и безопасный rollback через <code>p4 undo</code>.
- [ ] Streams tree, Stream Graph, stream workspaces и stream switching.
- [ ] Merge, copy, cherry-pick/integrate и interchanges.
- [ ] Полноценный resolve workflow.
- [ ] Jobs/fixes, labels и глобальный поиск. Есть bounded Jobs browser через `p4 jobs -l -m`, job fixes inspector через `p4 fixes -j` и Labels browser через `p4 labels -t -m`, все с bounded server search/metadata; создание и редактирование jobs/fixes/labels остаётся следующим расширением.

## 4. P0 — подключение, аутентификация и capability detection

### 4.1 Профили соединения

- [x] **Хранить recent connection profiles без секретов.**
  - Данные: executable, port, user, workspace, charset.
  - Не хранить password, MFA code или содержимое ticket.
  - Готово в текущем проекте; список ограничен десятью профилями.

- [ ] **Favorite profiles и понятные имена.**
  - Пользователь задаёт alias, закрепляет и меняет порядок профилей.
  - CLI не требуется; это локальная настройка.
  - Favorite profiles можно выбрать до открытия workspace и toggle-ить без logout; aliases/ручная сортировка ещё не закрыты.

- [x] **Использование P4CONFIG/P4ENVIRO как явный вариант.**
  - Команды: <code>p4 set</code>, <code>p4 info</code>; чтение effective environment.
  - UI передаёт явно заданные P4CONFIG/P4ENVIRO в каждый вызов p4 и не читает/не логирует их содержимое.
  - Пустые значения не задаются, поэтому глобальная конфигурация пользователя не перезаписывается.

### 4.2 Login, tickets, trust и MFA

- [ ] **Интерактивный login.**
  - CLI: <code>p4 login</code>, пароль через stdin; status через <code>p4 login -s</code>.
  - UI: password field не сохраняется, есть expiry, Renew session и Retry.
  - Ошибка login не должна называться connection failure.
  - Реализован password input на connection screen только после auth error; Rust передаёт пароль через stdin, валидирует отсутствие newline, очищает UI после успеха и повторяет `p4 info`. Добавлена ручная bounded-проверка `p4 login -s` с отображением минут до expiry и явным Renew через ephemeral password field; MFA/login2, SSO и trust confirmation остаются отдельными сценариями.

- [ ] **Logout текущего пользователя.**
  - CLI: <code>p4 logout</code>; отдельный confirm, если это повлияет на другие P4-приложения, использующие тот же ticket file.
  - Exit workspace остаётся отдельным действием и не вызывает logout.
  - Реализована отдельная кнопка Logout с локализованным подтверждением; при ошибке текущая workspace-сессия сохраняется, Exit workspace по-прежнему не отзывает ticket.

- [ ] **MFA/login2.**
  - CLI: <code>p4 login2</code> и поддерживаемый сервером challenge flow.
  - UI не предполагает фиксированную схему одного OTP-поля: методы и этапы приходят от сервера.

- [ ] **SSO и P4 Authentication Service.**
  - Поддержать auth-check-sso/P4 AS поведение установленного CLI, видимый browser/IdP handoff и возврат к проверке ticket.
  - Нельзя логировать URL/token/credentials из auth flow.

- [ ] **SSL trust.**
  - CLI: <code>p4 trust</code>, получение fingerprint и явное подтверждение.
  - Новый или изменившийся fingerprint показывается полностью; при изменении по умолчанию Cancel и рекомендация связаться с администратором.
  - Запрещено автоматически применять trust без участия пользователя.
  - Реализован read-only просмотр локальных записей через `p4 trust -l`; установка, удаление и explicit fingerprint confirmation остаются отдельными действиями.

### 4.3 Capability detection

- [ ] **Определять версии client/server и доступные возможности.**
  - CLI: <code>p4 -V</code>, <code>p4 info</code>, при необходимости <code>p4 help command</code>.
  - Хранить client version, server version, unicode, case handling, server services, serverID и security/auth hints.
  - UI скрывает только гарантированно недоступные функции; permission errors остаются server-authoritative.
  - `p4 info` уже показывает в connection result server services, server ID, security, client address и user email; capability-gated actions и `p4 help` probing ещё не закрыты.

- [ ] **Определять topology.**
  - CLI: поля <code>p4 info</code>, при доступности <code>p4 topology</code>.
  - Нужны признаки standard/commit/edge/replica/proxy/broker, чтобы корректно работать с global locks, promoted shelves и server-bound workspaces.

## 5. P0 — workspace и mapping

### 5.1 Просмотр и выбор

- [x] **Список workspaces текущего пользователя.**
  - CLI: <code>p4 clients -u user</code>.
  - Сейчас ограничено первыми 200 записями; перед закрытием пункта масштабирования нужна pagination/search strategy.

- [ ] **Полный inspector workspace.**
  - CLI: <code>p4 client -o name</code>, <code>p4 info</code>.
  - Показывать Owner, Host, Root/active AltRoot, Stream, StreamAtChange, View, ChangeView, Options, SubmitOptions, LineEnd, Type, ServerID, Access/Update.
  - Depot/client/local пространства путей должны быть отдельными полями.

- [ ] **Фильтр workspaces.**
  - CLI: <code>p4 clients -u</code>, <code>-e</code>, <code>-E</code>, <code>-S</code> и <code>-m</code> по возможностям версии.
  - Фильтры: owner, host/current computer, stream, root, name, recent/favorite.

### 5.2 Создание и изменение

- [ ] **Создать classic workspace.**
  - CLI: <code>p4 client -o</code> + валидированная форма в <code>p4 client -i</code>.
  - UI: name, root, host, template, view builder и безопасные defaults.
  - Preview показывает resulting mapping и локальный root; папки на диске создаются только после confirm.

- [ ] **Создать stream workspace.**
  - CLI: <code>p4 client -S stream -o name</code> + <code>p4 client -i</code>.
  - Generated View read-only; пользователь редактирует stream association и workspace options, а не подменяет server mapping.

- [ ] **Редактировать mapping.**
  - Поддержать обычные, exclusion, overlay и ditto mappings, не теряя порядок строк.
  - Основной parser mapping не должен пытаться заменить серверную семантику; проверка доступности пути выполняется через <code>p4 where</code>.

- [ ] **Редактировать workspace options.**
  - В UI явно объяснить clobber/noclobber, allwrite/noallwrite, modtime/nomodtime, rmdir/normdir, locked/unlocked и submit options.
  - Опасные изменения не применяются без summary последствий.

- [ ] **Переименовать, удалить или выгрузить workspace.**
  - CLI: <code>p4 renameclient</code>, <code>p4 client -d</code>, при необходимости <code>p4 unload/reload</code>.
  - Preflight: opened files, shelves, pending changes, host/server binding.
  - Удаление server spec не должно удалять локальные файлы.

### 5.3 Переключение workspace/stream

- [ ] **Безопасно переключить workspace.**
  - Перед switch: <code>p4 opened</code>, <code>p4 reconcile -n</code>/<code>p4 status</code>, активные операции.
  - Варианты: Shelve and switch, Revert and switch, Cancel; никогда не терять локальные изменения молча.

- [ ] **Переключить stream в текущем workspace.**
  - CLI: <code>p4 switch</code> там, где его semantics подходят, либо <code>p4 client -s -S</code> + preview sync.
  - UI обязан объяснять, сохраняется ли работа автоматически, создаётся ли shelf и когда меняется view.

## 6. P0 — просмотр файлов проекта (Workspace)

### 6.1 Дерево и список

- [ ] **Ленивое дерево локального workspace.**
  - Реализован scoped list slice `WorkspaceView` → `p4 fstat -Ro -Ol` и client-side Tree/List режим с группировкой по depot-папкам; отдельный untracked filter объединяет результат с `p4 reconcile -n`, virtualization ещё не реализована.
  - CLI: <code>p4 fstat</code>, <code>p4 dirs</code>, <code>p4 files</code>, <code>p4 where</code>; локальная файловая система только для уже mapped scope.
  - Показывать mapped depot files, локальные untracked files и папки без полной рекурсивной загрузки.
  - Expand folder загружает только выбранный scope; большие lists виртуализируются.

- [ ] **Переключение Tree/List и breadcrumbs.** Tree/List переключение реализовано для загруженного scoped списка; breadcrumbs и lazy server tree остаются отдельными расширениями.
  - Сохранять выбранный view, scroll, expanded nodes и selection per workspace.
  - Breadcrumb поддерживает переход к local root, client path и depot path.

- [ ] **Колонки статуса.**
  - Реализованы depot/local/client path, action, change, have/head, type, mapped, other-open и unresolved для загруженного scope; UI показывает derived status badges и фильтры.
  - Минимум: name/path, action, changelist, have/head, mapped, local modified, otherOpen, lock owner, resolve state, file type, size, last change.
  - Основной источник: <code>p4 fstat -T ...</code>; не собирать статус из десятков per-file команд.

### 6.2 Статусы и фильтры

- [ ] **Фильтр Opened.**
  - CLI: <code>p4 opened</code> или поля fstat.
  - Состояния add/edit/delete/move/branch/integrate/import/purge должны иметь icon + label.

- [ ] **Фильтр Modified outside P4.**
  - CLI: <code>p4 reconcile -n</code> или <code>p4 status</code>.
  - Отличать modified, missing, untracked, move candidate и ignored.

- [ ] **Фильтр Outdated / Have < Head.**
  - CLI: <code>p4 fstat</code>, <code>p4 cstat</code>, для scoped preview <code>p4 sync -n</code>.
  - Показывать have revision, head revision, head change и actionable Update.

- [ ] **Фильтр Not in depot и ignored.**
  - Учитывать P4IGNORE; ignored по умолчанию скрыты, но доступны отдельным toggle.
  - Нельзя предлагать Add для файла вне mapping или запрещённого protections без объяснения.

- [ ] **Фильтры conflicts, locked, shelved counterpart, changed by others.** Реализован server-backed locked filter через `otherLock`; conflicts и shelved counterpart остаются отдельными расширениями.
  - Источник: fstat resolve/otherOpen/otherLock fields, opened, resolved.
  - Фильтр должен масштабироваться на текущий folder scope.

### 6.3 Inspector файла/папки

- [ ] **Раздельные пути и mapping.**
  - CLI: <code>p4 where</code>.
  - Показывать depot path, client path, local path и исключение mapping.

- [ ] **Revision и ownership metadata.**
  - CLI: <code>p4 fstat</code>.
  - Head/have, head action/change/time/type, opened action/change, lock/other users, movedFile/movedRev, unresolved records.

- [ ] **Быстрые действия.**
  - Diff, History, Check out, Add, Delete, Move/Rename, Revert, Lock/Unlock, Reveal in Explorer, Open in editor, Copy each path.
  - Primary действия доступны не только через context menu.

## 7. P0 — просмотр Depot

- [ ] **Список depot roots.** Есть read-only scoped directories/files browser; отдельный depot roots endpoint ещё не выделен.
  - CLI: <code>p4 depots</code>.
  - Отображать local, stream, spec, remote, archive, unload и graph types с понятными ограничениями.

- [ ] **Ленивое Depot Tree.**
  - CLI: <code>p4 dirs</code>, <code>p4 files</code>, scoped <code>p4 fstat</code>.
  - Поддержать deleted-at-head toggle, permission-denied branches и server maxresults.

- [ ] **Depot file inspector.**
  - CLI: <code>p4 fstat</code>, <code>p4 filelog</code>, <code>p4 print</code>.
  - Head revision/type/change, size/digest, workspace mapping, have status, open/lock users, last submit.

- [ ] **Depot ↔ Workspace navigation.**
  - CLI: <code>p4 where</code>.
  - Если path не mapped, показать причину и действие Edit workspace mapping, а не ложный локальный путь.

- [ ] **Работа с не-mapped depot files.**
  - Preview/print/history доступны без mapping при достаточных permissions.
  - Sync/edit требует mapped target; UI предлагает осознанно изменить workspace или выбрать другой workspace.

- [ ] **Поиск файла в depot.**
  - CLI: <code>p4 files</code> и scoped patterns; для metadata filter — <code>p4 fstat -F</code>.
  - Не запускать неограниченный <code>//...</code> запрос без user scope, debounce, cancel и limit.

## 8. P0 — ежедневные файловые операции

### 8.1 Получение файлов

- [ ] **Sync latest выбранных файлов/папок/workspace.**
  - Реализованы server-backed `p4 sync -n` preview, `p4 diff -sa/-se` local-modified preflight, explicit acknowledgement перед safe apply, refresh списка и отдельная cancelable sync operation с progress/failure diagnostics; parallel transfer и расширенные target modes ещё не реализованы.
  - CLI: preview <code>p4 sync -n</code>, выполнение <code>p4 sync</code>, safe mode <code>-s</code>, optional parallel transfer.
  - Preview показывает add/update/delete, bytes, locally modified files и возможные resolves.
  - Force sync никогда не является default.

- [ ] **Sync к changelist/date/label/revision.**
  - CLI: revision specifiers в <code>p4 sync</code>.
  - UI различает «получить историческое содержимое» и «создать rollback».

- [ ] **Get Revision для файла или папки.** Реализован preview/apply через `sync -n`/`sync` с depot scope и numeric revision; server-backed safety checks и полноценный target picker остаются расширениями.
  - CLI: <code>p4 sync path#rev</code> или другой выбранный revSpec.
  - Перед выполнением показывать затрагиваемые files и local changes; после sync обновить have/head.

- [ ] **Network estimate и parallel settings.**
  - CLI: <code>p4 sync -N</code>, <code>--parallel=threads=N,...</code>.
  - Применять parallel только при server support и user/admin limits; не придумывать скорость/ETA без данных.

### 8.2 Открытие и изменение

- [ ] **Open for edit / Check out.**
  - Реализован batch `p4 edit -c` из WorkspaceView для выбранных depot paths; mapping/lock preflight и полноценный destination picker ещё впереди.
  - CLI: batch <code>p4 edit -c change</code>, optional file type.
  - Выбор destination changelist, проверка mapped/have/otherOpen/lock state.

- [ ] **Mark for add.**
  - Реализован batch `p4 add -c` для выбранных mapped paths; P4IGNORE/untracked discovery пока не закрыты.
  - CLI: batch <code>p4 add -c change</code>, P4IGNORE-aware preview.
  - Поддержать special characters через корректный file argument, а не shell escaping.

- [ ] **Mark for delete.**
  - Реализован batch `p4 delete -c` для выбранных mapped paths; отдельный missing-file preview ещё впереди.
  - CLI: <code>p4 delete -c change</code>.
  - Preview объясняет удаление workspace file и будущую depot revision; локально missing file обрабатывается отдельно.

- [ ] **Move/Rename file или folder.**
  - CLI: <code>p4 move -c change</code>; offline rename — preview через <code>p4 reconcile -n -M</code>.
  - Проверять mapping, case-only rename, target collision и partial directory result.

- [ ] **Изменить file type/modifiers.**
  - CLI: <code>p4 reopen -t type</code>.
  - UI валидирует text/binary/unicode/symlink и modifiers +l, +w, +x, +S; destructive storage changes помечаются advanced.

### 8.3 Reconcile и очистка

- [ ] **Reconcile preview.**
  - Добавлены typed `preview_reconcile` и apply-команда `p4 reconcile -c`; UI показывает candidates и позволяет выбрать subset.
  - CLI: <code>p4 reconcile -n</code> или <code>p4 status</code>.
  - Группы: add, edit, delete, move pair, ignored, unsafe/unknown.
  - Пользователь выбирает subset и destination changelist.
  - Теперь UI показывает весь preview, позволяет снять subset и применяет только выбранные paths; группировка ignored/move/unsafe и повторная stale-проверка ещё не полные.

- [ ] **Apply reconcile.**
  - CLI: <code>p4 reconcile -c</code> с выбранными флагами <code>-a/-e/-d/-M/-t</code>.
  - Реализован apply выбранных paths через `reconcile -c`; перед apply повторно выполняется `reconcile -n` для каждого выбранного path, stale preview классифицируется как conflict и mutation не запускается.
  - Перед apply preview должен быть повторно проверен или явно считаться stale.

- [ ] **Clean workspace.**
  - CLI: <code>p4 clean</code> или destructive <code>p4 reconcile -w</code>.
  - P2 по discoverability, несмотря на P0 backend requirement: действие разрушительное, требует полного preview и typed scope.
  - Нельзя смешивать с обычным Revert.

### 8.4 Revert

- [x] **Revert выбранных opened files из changelist.**
  - Текущая реализация: batch <code>p4 revert -c</code>, confirm, optional <code>-w</code>.

- [ ] **Revert unchanged.**
  - CLI: <code>p4 revert -a</code> в выбранном changelist/scope.
  - Preview показывает только неизменённые файлы и не затрагивает реальные edits.
  - Реализованы `p4 revert -n -a -c` preview и явный apply `p4 revert -a -c` для выбранного changelist; пустой preview блокирует apply.

- [ ] **Revert всего changelist с server-backed preview.** Реализован `revert -n -c` preview с полным списком файлов и подтверждением перед apply; partial selection и compensation остаются отдельными расширениями.
  - Получить полный affected list, unresolved/locks/adds и local consequences до запуска.
  - Shelf не удаляется и показывается как сохранённая серверная копия.

- [ ] **Revert после submit другого пользователя / admin workflow.**
  - Не входит в обычный P0 UI; не применять <code>-C</code>/<code>-f</code> без отдельной P2 функции и permission check.

## 9. P0 — changelists и submit

### 9.1 Список и детали

- [x] **Default и numbered pending changelists текущего workspace.**
- [x] **Opened и shelved sections не смешиваются.**
- [x] **Создать/edit description/delete empty changelist.**
- [x] **Переместить один, несколько или все opened files.**

- [ ] **Показать полную changelist spec.**
  - CLI: <code>p4 change -o</code>, <code>p4 fixes -c</code>, <code>p4 opened -c</code>.
  - Поля: owner, client, status, type public/restricted, date, jobs, stream spec, files, shelf access time.

- [ ] **Фильтры pending changes.** — локальный фильтр Changes поддерживает ID/description/user/client и сохраняет текущий выбранный CL видимым при фильтрации.
  - Собственные/current workspace по умолчанию; optional all accessible by user/workspace/path/status.
  - Ограничения restricted changelist отображаются корректно.

- [ ] **Change owner/workspace handoff.**
  - CLI: form <code>p4 change -o/-i</code>, разрешённые <code>-U</code> варианты.
  - Preflight учитывает opened files, shelf, permissions и commit-edge location.

- [ ] **Public/restricted.**
  - CLI: <code>p4 change -t public|restricted</code>.
  - UI объясняет, кто увидит description и shelf; не обещает confidentiality сверх protections.

### 9.2 Submit review

- [ ] **Server-backed submit preflight.**
  - Проверить opened list, <code>p4 resolved</code>/<code>p4 resolve -n</code>, have/head через fstat, locks/otherOpen, missing files, jobs и stream spec.
  - Серверная проверка остаётся окончательной; race после preview обрабатывается точной ошибкой.
  - Реализован preflight через opened + fstat + scoped `resolve -n` + bounded `fixes -c` + client spec: полный список missing, unresolved/pending-resolve, out-of-date и active other-open/lock issues, jobs, stream и total size показываются в SubmitDialog; повторное явное подтверждение требуется перед submit.

- [ ] **Submit review screen.**
  - Description, workspace, stream, grouped files, total size, jobs, unresolved, out-of-date, locks, warnings.
  - Primary button называет количество файлов и не скрывает mode local/shelf.

- [x] **Submit default и numbered local changelist.**
  - CLI: <code>p4 submit -d</code> или <code>p4 submit -c</code>.

- [x] **Submit shelf.**
  - CLI: <code>p4 submit -e</code>; local files сохраняются в recovery changelist.

- [x] **Явные стратегии local+shelf.**
  - Submit shelf с сохранением local; удалить shelf и submit local; обновить shelf и submit local.

- [ ] **Progress/cancel/unknown-result handling.**
  - Submit идёт через Operations Center.
  - После cancel/network loss нельзя предполагать rollback: перечитать change/describe/opened и сообщить submitted, pending или unknown.
  - Для Sync и обычного local submit добавлен operation slice: operation id, started/progress/completed/failed/cancelled events, cancel собственного child process и обязательный refresh после любого финального исхода. Submit failures дополнительно выполняют best-effort read-back pending/submitted/unknown и refresh Changes; shelf-preserving submit modes и единый Operations Center ещё впереди.

- [ ] **Parallel submit capability.**
  - Использовать server-supported parallel submit/shelve только после capability check; advanced setting, не жёстко заданный флаг.

- [ ] **Edit submitted description/type/jobs.**
  - CLI: разрешённый пользователю <code>p4 change -u</code> / form.
  - Отдельное действие с audit-friendly summary; не менять files или owner без admin rights.

## 10. P0/P1 — shelves

- [x] **List own shelves current workspace и lazy file list.**
- [x] **Shelve selected, update all, optional revert local.**
- [x] **Unshelve selected/all в выбранный changelist.**
- [x] **Safe collision preview для shelved add.**
- [x] **Delete selected/all shelved files.**
- [x] **Diff shelf ↔ head и shelf ↔ local.**

- [ ] **Общий Shelves screen.** **P1** — частично: отдельный screen показывает server shelves, files, target changelist и preview/apply unshelve; конфликтующие файлы по умолчанию Skip, явный per-file Overwrite использует `-f`, shelf export остаётся.
  - CLI: <code>p4 changes -s shelved</code>, filters owner/user/client/path/date; <code>p4 describe -S</code>.
  - Показывать доступные чужие shelves, restricted/permission состояния и origin server.

- [ ] **Unshelve preview для всех типов конфликтов.** **P0** — частично: shelved-add/local collisions возвращаются полным списком с per-file Skip/Overwrite; типы конфликтов кроме add и richer server diagnostics остаются.
  - Не только untracked collision для add: opened target, already shelved/opened revisions, resolve requirement, mapping и write permissions.

- [ ] **Экспорт shelved content без unshelve.** **P1** — частично: общий Shelves screen экспортирует один выбранный файл через `p4 print -q path@=change` в новый output path без перезаписи; batch export и native picker остаются.
  - CLI: <code>p4 print path@=change</code>, безопасный Save As.
  - Не писать за пределы выбранного пользователем файла/папки.

- [ ] **Reshelve/copy shelf.** **P1** — частично: выбранные files можно явно скопировать в существующий target shelf через `p4 reshelve -s -c`; source shelf не изменяется, promoted/force variants остаются.
  - CLI: <code>p4 reshelve -s source -c target</code>; source shelf сохраняется.
  - Collision overwrite <code>-f</code> только для явно выбранных путей.

- [ ] **Promoted shelves и edge topology.** **P2**
  - CLI: <code>p4 shelve -p</code> или <code>p4 reshelve -p</code> по поддерживаемой семантике.
  - Показывать local/promoted origin; действие появляется только на edge/commit topology.

- [ ] **Shelf stream spec.** **P2**
  - Показывать, diff, shelve/unshelve/submit opened stream spec отдельно от file shelf.

- [ ] **P4 Code Review action.** **P2**
  - Показывать Create/Update Review только при настроенной интеграции; core shelf workflow не зависит от Swarm/P4 Code Review.

## 11. P0 — история changelists для проекта, папки и файла

### 11.1 Submitted history

- [ ] **История выбранного project/folder/file path.**
  - CLI: <code>p4 changes -s submitted -l -t path/...</code>.
  - Scope всегда видим: выбранная папка, depot/client/local path и include subfolders.
  - Это обязательный сценарий, отдельно от глобальной истории сервера.
  - Реализован submitted-history режим с видимым depot scope, явным `Load more` и нарастающим `-m` limit до 5000; локальный поиск по номеру/user/client/description и user/client filters добавлены, полноценные cursor/server filters и folder tree ещё не закрыты.

- [ ] **Глобальная submitted history.**
  - CLI: <code>p4 changes -s submitted</code> с <code>-m</code>, user/client/time/path/revision filters.
  - Инкрементальная загрузка/pagination; не фиксированный невидимый limit 200.

- [ ] **Фильтры истории.**
  - Changelist number/range, user, workspace, description text, path, date range, stream, jobs, has integrations.
  - Сохранённые recent filters и понятное server-side/client-side различие.

- [ ] **Submitted changelist details.**
  - CLI: <code>p4 describe -s change</code>, optional diffs через <code>p4 describe -du</code>, jobs/fixes.
  - Показывать author, client, time, description, type, files/actions/revisions, stream spec, jobs, integrations.
  - Реализован lazy `describe -s` для выбранного CL с user/client/time/description, jobs и affected files/actions/revisions; stream spec/integrations ещё не закрыты.

- [ ] **Inline diff файлов changelist.**
  - CLI: <code>p4 describe</code> или per-file <code>p4 diff2 path#rev-1 path#rev</code>.
  - Lazy-load diff выбранного файла, а не весь большой change сразу.
  - Для numeric revisions добавлена lazy-кнопка per-file `diff2` в submitted change details; special revision forms и binary presentation остаются отдельными задачами.

- [ ] **Сравнить два changelists или состояния папки.**
  - CLI: <code>p4 diff2 path@changeA path@changeB</code> либо file-pair list.
  - Summary added/changed/deleted/type-changed; folder diff не притворяется одним text diff.

### 11.2 Действия из истории

- [ ] **Get revisions for files in changelist.**
  - CLI: scoped <code>p4 sync file@change</code>.
  - В отличие от P4V, P4FNV должен всегда показывать preview и Cancel до force/sync.

- [ ] **Создать rollback submitted change.**
  - CLI: preview <code>p4 undo -n @change</code>, apply <code>p4 undo -c target @change</code>.
  - Результат — новые opened changes, а исходный change остаётся в истории.
  - Реализованы preview/apply из HistoryView с обязательным target changelist и явным подтверждением; live-server smoke test ещё не выполнялся.

- [ ] **Rollback диапазона.**
  - CLI: <code>p4 undo -n/apply path@from,@to</code>.
  - Направление и включённые revisions должны быть явно показаны.

- [ ] **Перенести change в другой stream/changelist.**
  - Переход к cherry-pick/integrate workflow; нельзя выполнять немедленно из context menu.

## 12. P0/P1 — история файла, compare, preview и Revision Graph

### 12.1 File history

- [ ] **Список revisions файла.** **P0**
  - CLI: <code>p4 filelog -l -t</code>, optional <code>-i</code> и <code>-s</code>.
  - Поля: rev, action, change, author, client, time, type, size, description, integrations, labels.
  - Have/head выделяются отдельными badges.
  - Реализован read-only `HistoryView` с `filelog -i -l -t -m` limit до 5000, явным Load more, rev/action/change/user/time/type/description/client/size/labels и integration records.

- [ ] **История удалённого/перемещённого файла.** **P0**
  - Следовать rename/integration records и показывать file-name history/content history как разные режимы.

- [ ] **Preview произвольной revision.** **P0**
  - CLI: <code>p4 print -q path#rev</code>, ограничение размера и streaming.
  - Text/image/binary fallback; preview не изменяет have list и workspace.
  - Реализован text read-only preview через `p4 print -q path#rev` с общим лимитом diff 2 MiB; binary/image fallback и streaming ещё впереди.

- [ ] **Save revision as/export.** **P1** Реализовано сохранение `p4 print -q path#rev` в явно указанный новый путь без неявной перезаписи; native file picker и file metadata preservation остаются расширениями.
  - CLI: <code>p4 print -o</code> либо stdout с безопасной записью в выбранный путь.
  - Сохранять file type/permissions, где это поддержано, и предупреждать о symlink/charset.

### 12.2 Compare

- [ ] **Revision ↔ previous.** **P0** Реализована отдельная History action для сравнения выбранной numeric revision с предыдущей через `diff2`.
  - CLI: <code>p4 diff2 -du path#N-1 path#N</code>.

- [ ] **Две выбранные revisions.** **P0**
  - CLI: <code>p4 diff2</code>; выбор двух rows без drag-only UX.
  - Реализован выбор двух строк и compare через `p4 diff2 -du`; inline viewer остаётся базовым text viewer.

- [ ] **Revision ↔ workspace.** **P0** — частично: History action сравнивает выбранную revision с текущим workspace через <code>p4 diff -du path#rev</code>; richer three-pane viewer остаётся.
  - CLI: <code>p4 diff</code> с revision spec либо временный print + internal viewer там, где CLI semantics требуют.

- [ ] **Revision ↔ shelf/head/another path.** **P1**
  - CLI: <code>p4 diff2</code> и shelf revision <code>@=change</code>.

### 12.3 Annotate и граф

- [ ] **Blame/Annotate.** **P1** — частично: History запускает bounded text-first <code>p4 annotate -c -u</code> и показывает changelist/user/date для строк; click-through в changelist, binary handling и richer large-file fallback остаются.
  - CLI: <code>p4 annotate -c -u</code>, optional <code>-i</code>, whitespace modes.
  - Клик строки открывает changelist/revision; большие файлы и server maxsize дают явный fallback.

- [ ] **Time-lapse style view.** **P2**
  - Синхронизировать content, annotate и revision slider; не запускать N отдельных print без cache/limit.

- [ ] **Revision Graph.** **P1**
  - Данные: <code>p4 filelog -i</code>, integration records через filelog/integrated.
  - Показывать add/edit/branch/merge/copy/move/delete/undo и contributing ranges.
  - Zoom/pan/filter/focus, переход к changelist и compare; граф не должен выдумывать связи.

## 13. P1 — streams и Stream Graph

### 13.1 Streams catalog

- [ ] **List/tree streams.**
  - CLI: <code>p4 streams</code> с filter/max/fields.
  - Поля: Stream, Parent, Type, ParentView, Owner, Description, Options, firmerThanParent, deleted/unloaded.

- [ ] **Stream details/spec.**
  - CLI: <code>p4 stream -o</code>, <code>p4 streamlog</code>.
  - Показывать Paths, Remapped, Ignored, View, change history и associated workspaces.

- [ ] **Search/filter streams.**
  - Name, owner, type, parent, depot, path view match.
  - Required ancestors остаются muted, а не исчезают из иерархии.

### 13.2 Stream Graph

- [ ] **Иерархический граф parent/child.**
  - Mainline/development/release/task/virtual/sparse types кодируются shape + label, не только цветом.
  - Tree и graph синхронизируют selection; текущий workspace marker виден в обоих.

- [ ] **Merge/copy hints.**
  - CLI: <code>p4 istat</code> для parent relationship, <code>p4 interchanges</code> для changes/files.
  - Отдельно Files Only, Stream Spec Only и Both, если server configuration это поддерживает.

- [ ] **Graph navigation.**
  - Zoom/pan, focus selected stream, minimap при необходимости, saved filters.
  - Не рисовать Stream Graph как Git commit DAG.

### 13.3 Stream lifecycle

- [ ] **Создать stream.**
  - CLI: <code>p4 stream -o/-i</code>.
  - Templates/default flow rules; validate depot depth и parent/type constraints.

- [ ] **Edit/open stream spec.**
  - Поддержать private edit/opened stream spec, changelist association, revert, resolve и submit.

- [ ] **Reparent/delete stream.**
  - Preview влияния на views, child streams, open workspaces и pending integration.
  - Delete и obliterate — разные действия; obliterate не входит в обычный пользовательский UI.

- [ ] **Create/switch workspace for stream.**
  - Явно предложить existing compatible workspace или создание нового.
  - Не обещать Git-like branch checkout, если требуется server client spec.

## 14. P1 — merge, copy и cherry-pick

### 14.1 Общий integration preflight

- [ ] **Явные source и target.**
  - Source слева, target workspace/stream справа, направленная стрелка, полные paths.
  - Target обязан быть mapped в текущий workspace.

- [ ] **Server-generated preview.**
  - CLI: <code>p4 integrate -n</code>, <code>p4 copy -n</code> или соответствующий stream syntax.
  - Summary: branch/integrate/delete/move, already integrated, needs resolve, permissions.

- [ ] **Pending interchanges.**
  - CLI: <code>p4 interchanges</code>, для streams <code>-S</code>.
  - Показывать полностью/частично интегрированные changelists и affected files.

- [ ] **Apply в отдельный changelist.**
  - CLI: <code>p4 integrate -c</code>/<code>p4 copy -c</code>.
  - Никогда автоматически не submit; результат проходит Resolve → Review → Submit.

### 14.2 Merge down / copy up

- [ ] **Merge down parent → child.**
  - Уважать stream flow rules и <code>p4 istat</code>.
  - UI объясняет необходимость merge down перед copy up.

- [ ] **Copy up child → parent.**
  - Использовать copy semantics, а не маскировать их общим словом merge.
  - Preview показывает, что source content заменяет target для выбранных revisions.

- [ ] **Merge/copy stream spec отдельно от files.**
  - CLI: <code>-As</code>/<code>-Af</code> варианты по команде и server configuration.
  - Если нужны оба, это две явно отслеживаемые операции.

### 14.3 Cherry-pick

- [ ] **Перенести один submitted changelist.**
  - CLI: integration ограниченная source revision range/change.
  - Уже integrated revisions исключены по умолчанию.

- [ ] **Перенести выбранные files/revisions.**
  - Пользователь видит, что частичный перенос может изменить integration history.
  - Mapping source/target валидируется server preview.

- [ ] **Перенести последовательность changelists.**
  - Сохранять понятный порядок и показывать conflicts на каждом этапе либо в объединённом preview.
  - Partial success оформляется отдельными результатами, не одним зелёным toast.

### 14.4 Classic branch maps

- [ ] **List/view branch specs.** **P2**
  - CLI: <code>p4 branches</code>, <code>p4 branch -o</code>.

- [ ] **Integrate через branch map.** **P2**
  - CLI: <code>p4 integrate -b</code>, <code>p4 interchanges -b</code>.
  - Свободное ручное mapping редактируется как form workflow с preview.

## 15. P0/P1 — resolve conflicts

### 15.1 Обнаружение

- [ ] **Список unresolved files.** **P0**
  - CLI: <code>p4 resolve -n</code>, <code>p4 resolved</code>, fstat resolve fields.
  - Различать content, filetype, filename/move, attribute, branch и stream spec resolve.
  - Workspace показывает unresolved status, сначала выполняет preview через `p4 resolve -n`, затем даёт явные batch actions Keep workspace (`-ay`) / Accept server (`-at`) / Auto-safe (`-as`) / Auto-merge (`-am`) с подтверждением; three-way detail и остальные resolve types ещё не закрыты.

- [ ] **Resolve gate перед submit.** **P0** — submit блокируется при unresolved-файлах после preflight; shelving остаётся доступным для сохранения работы.
  - Submit disabled с точным количеством unresolved и переходом к списку.

### 15.2 Text resolve

- [ ] **Three-way merge UI.** **P0**
  - Base, theirs/source, yours/workspace и editable result.
  - Linked scroll, syntax highlighting, hunks, previous/next conflict, save/validate.

- [ ] **Безопасные accept actions.** **P0**
  - CLI: preview <code>p4 resolve -n</code>, затем <code>p4 resolve -ay/-at/-as/-am</code> только после явного выбора; <code>-ae</code> ещё не закрыт.
  - Кнопки называют содержимое: «оставить workspace» / «использовать //source», а не голые yours/theirs.

- [ ] **Auto resolve non-conflicting.** **P1** — частично: Workspace даёт explicit preview/confirmation actions для <code>p4 resolve -as/-am</code> по выбранному scope; granular result classification и richer conflict detail остаются.
  - Conflicting files остаются unresolved и перечисляются все.

### 15.3 Binary, move и stream spec resolve

- [ ] **Binary resolve.** **P0**
  - Metadata, size, author, revision и доступный image preview; выбор одной стороны или external tool.
  - Не показывать пустой text editor.

- [ ] **Move/filename resolve.** **P1**
  - Показывать source/target names, mapping и collision; отдельные semantics от content merge.

- [ ] **File type/attribute resolve.** **P1**
  - Полное описание применяемых modifiers/attributes.

- [ ] **Stream spec resolve.** **P1**
  - CLI: <code>p4 stream resolve</code> / поддерживаемая форма <code>p4 resolve -So</code>.
  - Diff Paths/Remapped/Ignored и inherited view.

- [ ] **External merge tools.** **P1**
  - Настройки P4MERGE/P4DIFF либо explicit configured tool с безопасными отдельными аргументами.
  - После возврата tool приложение проверяет server resolve state.

## 16. P1 — locks и совместная работа

- [ ] **Показывать otherOpen и otherLock.**
  - CLI: поля <code>p4 fstat</code>, <code>p4 opened -a</code> в scoped запросах.
  - User, workspace, changelist и server origin.

- [ ] **Lock выбранных opened files.**
  - CLI: <code>p4 lock -c change files</code>.
  - Не путать explicit lock с exclusive file type <code>+l</code>.
  - Реализована базовая batch-команда для выбранных opened files; explicit `+l` distinction и topology-aware global locks ещё не закрыты.

- [ ] **Unlock собственных files.**
  - CLI: <code>p4 unlock -c</code>, shelf unlock при корректном состоянии.
  - Force/admin flags не появляются в обычном UI.
  - Реализована базовая batch-команда для выбранных opened files; shelf unlock и topology details ещё не закрыты.

- [ ] **Global locks в commit-edge.**
  - CLI: <code>p4 lock -g -c</code>; capability/topology check.
  - Показывать local/global status и корректную ошибку при недоступном commit server.

- [ ] **Contact/open user details.**
  - CLI: <code>p4 user -o</code> для доступной public информации.
  - Не раскрывать больше данных, чем возвращает сервер и разрешает политика.

## 17. P1/P2 — jobs и fixes

- [ ] **List/search jobs.** **P1** — частично: bounded Jobs browser использует <code>p4 jobs -l -m</code> с server-side text search и локальными filters.
  - CLI: <code>p4 jobs</code>, server-defined job fields.
  - Нельзя жёстко кодировать только стандартный jobspec: схема может быть кастомной.

- [ ] **Job details и create/edit.** **P2**
  - CLI: <code>p4 job -o/-i</code>, jobspec-aware form.

- [ ] **Attach/detach jobs to numbered changelist.** **P1** — частично: Jobs inspector поддерживает explicit attach/detach через <code>p4 fix -c</code>/<code>p4 fix -d -c</code> и readback <code>p4 fixes -c</code>.
  - CLI: <code>p4 fix -c</code>, <code>p4 fix -d -c</code>, <code>p4 fixes -c</code>.
  - Default changelist jobs добавляются через submit form, а не ложный <code>p4 fix</code>.

- [ ] **Submit job status.** **P1** — частично: submit preflight показывает до 100 связанных jobs с доступными status/user/date и backward-safe fallback по ID; отдельный jobs browser и richer metadata остаются общими задачами.
  - Поддержать server-defined statuses и специальное same; показать будущий status до submit.

- [ ] **History by job/path.** **P2** — path-scoped submitted history и exact job filter через `p4 fixes -j` уже доступны; richer cross-scope search остаётся расширением.
  - CLI: <code>p4 fixes</code> с job/change/path filters.

## 18. P1/P2 — labels

- [ ] **List/filter labels.** **P1** — частично: bounded Labels browser использует <code>p4 labels -t -m</code>, server search и локальные name/owner/date/description filters.
  - CLI: <code>p4 labels</code>; owner/name/date/path filters и pagination.

- [ ] **Label details.** **P1** — частично: inspector показывает owner/update/description и bounded files через <code>p4 files //...@label</code>.
  - CLI: <code>p4 label -o</code>, files via <code>p4 files @label</code>.
  - Отличать automatic и static labels, locked/unlocked, autoreload.

- [ ] **Sync workspace to label.** **P1** — частично: preview/apply использует <code>p4 sync -n/-s //...@label</code>, modified acknowledgement, progress и cancel.
  - CLI: preview/execution <code>p4 sync @label</code>.
  - Тот же безопасный sync preflight, что для changelist/revision.

- [ ] **Create/edit/delete label.** **P2**
  - CLI: <code>p4 label -o/-i/-d</code>.
  - View/Revision validation и permissions.

- [ ] **Tag/untag revisions.** **P2**
  - CLI: <code>p4 tag</code> или <code>p4 labelsync</code>.
  - Полный preview, особенно для операций, снимающих старые tags.

## 19. P0/P1 — diff, preview и external tools

- [x] **Базовый unified text diff local/head/shelf.**

- [ ] **Встроенный production diff viewer.** **P0** — частично: shared `DiffViewer` используется Changes/History/Depot; richer syntax/image/binary support остаётся.
  - Unified/split, line/word highlighting, collapse unchanged, expandable context, file/hunk navigation, sticky header.

- [ ] **Whitespace и line-ending modes.** **P0**
  - CLI options <code>-db/-dw/-dl</code> либо consistent internal rendering.
  - Активный non-default mode всегда виден.
  - Реализованы `-db`, `-dw` и `-dl` selectors в Changes/History diff actions; split viewer и persistent mode остаются отдельными расширениями.

- [ ] **Large text diff.** **P0**
  - Streaming/chunking, cancel и понятный fallback вместо silent truncation.
  - Текущий лимит 2 MiB остаётся защитой, но пользователь должен уметь открыть external diff.

- [ ] **Image diff.** **P1**
  - Side-by-side, overlay opacity, blink, actual size/fit, alpha checkerboard, dimensions/format/size.

- [ ] **Binary metadata/preview.** **P0** — частично: backend распознаёт binary marker/нулевые байты и viewer показывает безопасное состояние; полноценный binary metadata/preview остаётся.
  - Никогда не декодировать binary как текст; type, size, digest/revision и Open externally.

- [ ] **3D/asset preview.** **P3**
  - Только после стабильного image/binary contract; renderer ограничен по размеру и не блокирует UI.

- [ ] **External editor/diff/merge configuration.** **P1**
  - Executable и argument templates валидируются и запускаются без shell.
  - Workspace/depot temporary files имеют явный lifecycle и очистку.

## 20. P0/P1 — поиск, навигация и продуктивность

- [ ] **Global Go To.** **P0** — частично: header принимает depot path, `ws://` workspace scope, changelist number, `job:` и `label:` и передаёт их в соответствующий экран; stream/user targets и entity-specific server lookup ещё не закрыты.
  - CLI/navigation uses entity-specific screens, а не один неограниченный глобальный запрос.

- [ ] **Command palette.** **P1** — частично: `Ctrl/Cmd+K` открывает searchable palette для основных экранов и Global Go To; action commands и configurable shortcuts остаются.
  - Команды фильтруются по текущему selection/capability; destructive action открывает preview, а не выполняется сразу.

- [ ] **Поиск по changelist description.** **P1**
  - Использовать доступные server/P4 Search capabilities; без них честный bounded client-side search.

- [ ] **Saved filters и recent destinations.** **P1**
  - Per workspace/server; invalid destination не удаляется молча, а помечается unavailable.

- [ ] **Keyboard model.** **P0** — частично: `Ctrl/Cmd+1..6` переключает основные экраны, `Ctrl/Cmd+L` фокусирует Global Go To; pane-level navigation и полный shortcut help остаются.
  - F5 refresh, Ctrl+F local filter, Enter details, Esc close, F6 panes, Shift+F10 context menu, Ctrl+N changelist, Ctrl+Enter после submit review.

- [ ] **Reveal/Open/Copy path.** **P0** — частично: workspace, depot inspector и file history показывают Copy depot path; workspace также Copy local path/Reveal in Explorer через безопасный Tauri command, native Open/editor actions остаются.
  - Reveal in Explorer, Open in configured editor, Open terminal in current P4 environment, copy depot/client/local path separately.

## 21. P0 — Operations Center, надёжность и безопасность

- [ ] **Единый registry длительных операций.**
  - Sync, submit, fstat/history, print/export, reconcile, integrate и resolve получают operation id.

- [ ] **Поток событий.**
  - Started, progress, warning, completed, failed, cancelled; текущий файл и processed count без credentials.
  - Использовать реальный CLI progress (<code>p4 -I</code>) или records; не выдумывать percent.

- [ ] **Cancel.**
  - Завершать только конкретный child process.
  - После cancel перечитать server/workspace state; отмена процесса не означает rollback уже переданных файлов.

- [ ] **Retry.**
  - Retry повторяет только idempotent read или новый явно подтверждённый mutation flow.
  - Submit/integrate не повторяются автоматически после unknown result.

- [ ] **Partial success.** — unshelve normal/force partition уже классифицирует ошибку force batch после успешного normal batch как `partial_result`; общий recovery UI и read-back для всех мутаций остаются.
  - Результат содержит succeeded/failed/skipped items и compensation outcome.
  - UI не скрывает успешно изменившиеся файлы из-за одного error record.

- [ ] **Stale/offline mode.**
  - Последние данные остаются видимы с badge Stale; mutations disabled с причиной.
  - Возврат соединения запускает controlled refresh, а не сбрасывает весь UI.

- [x] **Сессионный CLI log.**
  - Уже есть warnings/errors, timestamps, details и clear.

- [ ] **Расширенная error taxonomy.**
  - Добавить conflict, cancelled, timeout/offline, unsupported, partial_result и validation.
  - Technical diagnostics отделены от локализованного пользовательского текста.

- [ ] **Unicode и не-UTF-8 paths.**
  - <code>-Mj</code> может заменить invalid UTF-8 на U+FFFD; такой display path нельзя использовать как mutation id.
  - До безопасного round trip подозрительный path только read-only с предупреждением.

- [ ] **Case-sensitive/case-insensitive корректность.**
  - Стабильные ids и selection учитывают server case handling и filesystem semantics.
  - Case-only rename имеет отдельный tested flow.

- [ ] **Permission-aware UI.**
  - Не пытаться полностью вычислить protections на клиенте; сервер — источник истины.
  - Известно запрещённые actions скрываются/disabled, race/trigger refusal показывается точно.

## 22. P0 — настройки, accessibility и масштаб

- [x] **RU/EN и внешние language packs.**

- [ ] **Settings sections.**
  - Connections, Language, Perforce executable/environment, Appearance/density, Diff/Merge, External tools, Notifications, Shortcuts, Diagnostics/privacy.

- [ ] **Light/Dark/System и compact/comfortable.**
  - Tokens проверены на реальных trees/tables/diffs и WCAG contrast.

- [ ] **Persistent view preferences.**
  - Pane sizes, collapsed state, column visibility/order/width, sort, tree/list, diff mode и filters per view/workspace.

- [ ] **Полная keyboard accessibility.**
  - Logical tab/arrow model, focus restoration, visible focus, no drag-only action.

- [ ] **Screen reader contract.**
  - Roles/selected/expanded/busy, operation/error announcements, accessible diff additions/deletions.

- [ ] **200% scale и минимальное окно.**
  - Inspector превращается в drawer, actions не исчезают, context menu остаётся в viewport.

- [ ] **Virtualization и incremental data.**
  - Большие changelists/history/file lists/streams; selection и screen-reader semantics не ломаются.

- [ ] **Server limits.**
  - Maxresults/maxscan/maxlocktime и truncated output распознаются как partial result с возможностью сузить filter.

- [ ] **Focus refresh без polling.**
  - Для Changes реализовано; распространить на Workspace, History, Streams и Shelves с throttling и сохранением selection.

## 23. P2/P3 — расширенные, но не обязательные ежедневные возможности

- [ ] **P4 Code Review integration.** Review create/update/open status/comments только при настроенном endpoint.
- [ ] **File attributes.** Просмотр и разрешённое редактирование через <code>p4 attribute</code>; binary attributes требуют size-safe path.
- [ ] **Graph/hybrid depot read-only browsing.** Учитывать ограниченную metadata модель Git Connector и workspace type.
- [ ] **Remote/DVCS workflows.** <code>p4 clone/fetch/push/pull/remotes</code> — отдельный продуктовый режим, не часть classic-server MVP.
- [ ] **Personal server stream switching.** <code>p4 switch</code> с автоматическими shelves требует отдельного capability contract.
- [ ] **Spec depot browsing.** Read-only просмотр versioned specs; editing остаётся entity-specific.
- [ ] **Archive/unload visibility.** Понятные placeholders и reload request; обычный пользователь не запускает admin archive commands.
- [ ] **Custom tools.** Configurable allow-listed commands с explicit arguments; никакого общего shell console из frontend.
- [ ] **P4 Search integration.** Опциональное ускорение description/content search с graceful fallback.

## 24. Матрица команд P4 CLI

### Уже вызываются текущим кодом

| Область | Команды |
|---|---|
| Tool/connection | <code>p4 -V</code>, <code>p4 info</code>, <code>p4 login -s</code> |
| Workspaces | <code>p4 clients</code> |
| Pending changes | <code>p4 changes</code>, <code>p4 opened</code>, <code>p4 change -o/-i/-d</code>, <code>p4 reopen</code> |
| Shelves | <code>p4 files @=change</code>, <code>p4 shelve</code>, <code>p4 unshelve</code>, <code>p4 where</code> |
| Diff | <code>p4 diff</code>, <code>p4 diff2</code> |
| Revert/submit | <code>p4 revert</code>, <code>p4 submit</code> |

### Нужны для P0

| Область | Команды |
|---|---|
| Auth/trust | <code>login</code>, <code>login2</code>, <code>logout</code>, <code>trust</code> |
| Workspace | <code>client -o/-i</code>, <code>where</code>, <code>clients</code> |
| Project/depot browser | <code>depots</code>, <code>dirs</code>, <code>files</code>, <code>fstat</code>, <code>have</code>, <code>cstat</code> |
| File lifecycle | <code>sync</code>, <code>edit</code>, <code>add</code>, <code>delete</code>, <code>move</code>, <code>reopen</code>, <code>revert</code>, <code>reconcile</code>, <code>status</code> |
| History/content | <code>changes</code>, <code>describe</code>, <code>filelog</code>, <code>print</code>, <code>diff</code>, <code>diff2</code>, <code>undo</code> |
| Resolve | <code>resolve</code>, <code>resolved</code> |

### Нужны для P1/P2

| Область | Команды |
|---|---|
| Streams | <code>streams</code>, <code>stream -o/-i</code>, <code>streamlog</code>, <code>istat</code>, <code>switch</code> |
| Integration | <code>integrate</code>, <code>copy</code>, <code>merge</code> where applicable, <code>interchanges</code>, <code>integrated</code>, <code>branch/branches</code>, <code>populate</code> |
| Shelves/topology | <code>reshelve</code>, promoted shelf flags, <code>topology</code> |
| Collaboration | <code>lock</code>, <code>unlock</code>, <code>user -o</code> |
| Jobs | <code>jobs</code>, <code>job -o/-i</code>, <code>fix</code>, <code>fixes</code>, <code>jobspec -o</code> |
| Labels | <code>labels</code>, <code>label -o/-i</code>, <code>tag</code>, <code>labelsync</code> |
| Analysis | <code>annotate</code>, <code>grep</code> при bounded search |

## 25. Рекомендуемый порядок реализации

### Milestone A — действительно usable workspace (P0)

1. Auth/trust/login UI и capability detection.
2. Workspace inspector и безопасное переключение.
3. Workspace tree/list на <code>p4 fstat</code> с status filters.
4. Depot tree и mapping navigation.
5. Sync preview → progress/cancel → refresh.
6. Edit/add/delete/move и reconcile preview/apply.
7. Operations Center и расширенная error taxonomy.

Критерий выхода: пользователь может подключиться на новой машине, получить проект, увидеть локальное состояние, открыть/добавить/удалить/переместить файлы, безопасно обновиться и вернуться к уже реализованному changelist submit workflow.

### Milestone B — история и безопасный rollback (P0)

1. Path-scoped submitted history.
2. Changelist details и lazy per-file diff.
3. File history, print preview и revision compare.
4. Get Revision с preview.
5. Undo preview/apply в новый pending changelist.
6. Production diff viewer.

Критерий выхода: пользователь может ответить «что менялось в этой папке/файле, кем и когда», сравнить состояния и выполнить get/rollback без путаницы.

### Milestone C — resolve и надёжный submit (P0/P1)

1. Unresolved detection и submit gate.
2. Text/binary resolve.
3. Полный submit preflight.
4. Unknown/partial result recovery.
5. Lock/unlock.

Критерий выхода: обычный sync conflict и submit race решаются внутри P4FNV без возврата к P4V/CLI.

### Milestone D — streams, graph и integrations (P1)

1. Streams tree/details и compatible workspaces.
2. Stream Graph и istat/interchanges hints.
3. Safe stream switching.
4. Merge down/copy up preview/apply.
5. Cherry-pick submitted changelist/revisions.
6. Resolve filename/stream spec conflicts.

Критерий выхода: stream-based команда выполняет основной propagation workflow целиком в P4FNV.

### Milestone E — командные расширения (P1/P2)

1. Общий Shelves screen/reshelve/promote.
2. Jobs/fixes.
3. Labels.
4. Annotate/Revision Graph.
5. Global search/command palette.
6. P4 Code Review и optional integrations.

## 26. Обязательные smoke-сценарии перед отметкой крупных milestone

1. Plain и SSL server; новый fingerprint и изменившийся fingerprint.
2. Password login, expired ticket, logout; доступный тестовый MFA/SSO setup при наличии.
3. Classic workspace с include/exclude/overlay mapping.
4. Stream workspace на standard server и commit-edge topology.
5. Case-sensitive и case-insensitive server; Unicode server и non-ASCII paths.
6. Большой workspace/changelist с server limits и partial output.
7. Safe sync с локально изменённым unopened файлом; cancel посередине.
8. Reconcile add/edit/delete/move с P4IGNORE.
9. Submit success, unresolved, out-of-date, lock conflict, trigger rejection и network interruption.
10. Shelf-only, local-only и local+shelf; forced unshelve только выбранных collision paths.
11. Undo одного change и диапазона с последующим resolve.
12. Merge down, copy up и partially integrated cherry-pick.
13. Text, binary, move и stream spec resolve.
14. Restricted changelist/shelf и permission denied на части tree.
15. RU/EN, 100/125/200% scale, keyboard-only и Windows Narrator.

## 27. User stories и сценарные тест-чеклисты

### 27.1 Назначение каталога stories

Feature checklist отвечает, какие возможности должны существовать. User story отвечает, какую законченную задачу способен выполнить человек и какой наблюдаемый результат доказывает, что задача действительно выполнена.

У каждой story есть стабильный идентификатор. Идентификатор следует использовать в названиях integration/E2E тестов, test plans, bug reports и release notes. Изменение UI-текста или внутренней команды не должно менять идентификатор, пока пользовательская цель остаётся прежней.

Статусы:

- **Доступно сейчас** — пользовательский путь существует в текущем UI и backend.
- **Частично доступно** — часть пути существует, но пользователь вынужден завершить задачу в P4V/CLI либо не получает требуемой гарантии.
- **Целевая story** — сценарий нужен продукту, но пока недоступен.

Отметки тестов:

- **UNIT** — чистая frontend/Rust логика, parser, validation или argument builder.
- **FAKE-P4** — process-boundary integration test с управляемым fake executable.
- **LIVE-P4** — disposable P4 Server с реальными server semantics.
- **UI** — component/E2E или ручной desktop test, включая keyboard, localization и visual state.
- **RECOVERY** — ошибка посередине составной операции, refresh и проверка фактического server state.

Story нельзя считать полностью подтверждённой только потому, что её отдельные функции отмечены [x]. Все применимые тестовые пункты должны иметь ссылку на test code или запись test run. В текущем снимке LIVE-P4 пункты намеренно не отмечены: подтверждённая live-server матрица в репозитории отсутствует.

### 27.2 Персоны и основные цели

| Персона | Что ей необходимо сделать | Основные stories |
|---|---|---|
| Разработчик | подключиться, организовать изменения, посмотреть diff, shelve/revert/submit | US-CON-01…02, US-CHG-01…03, US-DIFF-01, US-SHELF-01…03, US-REVERT-01, US-SUBMIT-01…03 |
| Новый участник проекта | выбрать workspace, получить файлы, понять статусы и историю | US-CON-01, US-WORKSPACE-01, US-DEPOT-01, US-SYNC-01, US-HISTORY-01 |
| Технический художник | работать с большими binary assets, locks, shelves и безопасным sync | US-SYNC-01, US-LOCK-01, US-RESOLVE-01, US-DIFF-02 |
| Release/build engineer | получить состояние по change/label, перенести fix, выполнить rollback | US-HISTORY-01…02, US-INTEGRATE-01, US-LABEL-01 |
| Stream owner/lead | видеть Stream Graph, контролировать merge down/copy up и handoff | US-STREAM-01, US-INTEGRATE-01, US-CHG-04 |
| Пользователь edge server | понимать origin shelf/lock и partial/unknown result | US-SHELF-04, US-LOCK-01, US-OPS-01 |

### 27.3 Stories, доступные пользователю сейчас

#### US-CON-01 — открыть существующий workspace с действующим ticket

**Доступность:** доступно сейчас с ограничением: P4 CLI уже установлен, SSL fingerprint уже trusted, login ticket действителен.

> Как разработчик, я хочу указать server, user и workspace, чтобы открыть свою рабочую сессию и увидеть изменения этого workspace.

**Предусловия:**

- P4 CLI доступен в PATH или указан полный путь;
- workspace существует и доступен пользователю;
- authentication/trust уже настроены внешним P4-инструментом.

**Основной сценарий:**

1. Пользователь открывает P4FNV.
2. Приложение находит P4 CLI и показывает путь и версию.
3. Пользователь вводит P4PORT, P4USER, P4CLIENT и при необходимости P4CHARSET.
4. Пользователь может выполнить Test connection и получить список своих workspaces.
5. Пользователь нажимает Open workspace.
6. Приложение выполняет <code>p4 info</code>, проверяет ticket через <code>p4 login -s</code> и открывает My Changes.

**Наблюдаемый результат:** header показывает user/workspace, sidebar — workspace root или stream, My Changes загружает Default, numbered changelists и opened files.

**Альтернативы и ошибки:** неверные port/user/workspace, отсутствующий executable, auth, trust и permission errors остаются на connection screen с техническими деталями; пароль в текущем UI ввести нельзя.

**Тест-чеклист:**

- [x] UNIT: plain/SSL address, port range, user и required workspace validation.
- [x] UNIT: executable resolution, info JSON parsing и non-empty environment fields.
- [ ] FAKE-P4: полный detect → info → login status → workspace open.
- [ ] LIVE-P4: plain server и уже trusted SSL server с действующим ticket.
- [ ] UI: RU/EN, keyboard-only form, loading/error/success, 100/125/200% scale.

#### US-CON-02 — автоматически вернуться в последний успешно открытый workspace

**Доступность:** доступно сейчас.

> Как постоянный пользователь, я хочу после запуска сразу вернуться в последний workspace, чтобы не вводить параметры каждый день.

**Основной сценарий:**

1. После успешного Open workspace приложение сохраняет несекретный recent profile.
2. При следующем запуске выбирается первый полный профиль с workspace.
3. Приложение повторно проверяет server и ticket.
4. При успехе My Changes открывается автоматически.
5. Exit workspace возвращает connection form, но не удаляет профиль и не выполняет logout.

**Наблюдаемый результат:** секреты не записаны в settings, invalid/expired session не открывает workspace, а показывает connection screen с ошибкой.

**Тест-чеклист:**

- [x] UNIT: выбирается последний полный профиль, incomplete profile пропускается.
- [x] UNIT: recent profiles deduplicated, bounded и проходят atomic settings round-trip.
- [ ] FAKE-P4: успешное и неуспешное auto-open после перезапуска.
- [ ] UI: startup state не мигает connection/workspace и не теряет initial error.
- [ ] LIVE-P4: valid и expired ticket.

#### US-CHG-01 — увидеть и понять текущую локальную работу

**Доступность:** доступно сейчас.

> Как разработчик, я хочу видеть Default и numbered changelists с раздельными local и shelved files, чтобы понимать, что находится только в workspace, а что сохранено на сервере.

**Основной сценарий:**

1. Пользователь открывает My Changes.
2. Приложение параллельно загружает pending changes, shelved changes и opened files.
3. Default всегда находится первым.
4. После выбора numbered changelist shelf загружается лениво.
5. Local opened и shelf отображаются отдельными секциями даже для одинакового depot path.

**Наблюдаемый результат:** action, revision/type при наличии и источник LOCAL/SHELF не смешиваются; shelf-only changelist не исчезает; ручной Refresh перечитывает server state.

**Тест-чеклист:**

- [x] UNIT: Default всегда присутствует; unlisted и shelf-only changelists сохраняются.
- [x] UNIT: stale shelf cache скрывается после исчезновения shelf на сервере.
- [x] UNIT: parser pending/opened/shelved records.
- [ ] FAKE-P4: partial failure одного из параллельных запросов.
- [ ] LIVE-P4: empty, local-only, shelf-only и local+shelf.
- [ ] UI: long paths, empty/loading/permission error и multi-select visibility.

#### US-CHG-02 — создать, переименовать и удалить пустой changelist

**Доступность:** доступно сейчас для numbered pending changelist текущего пользователя/workspace.

> Как разработчик, я хочу создавать changelists для отдельных задач и поддерживать понятные описания.

**Основной сценарий:**

1. Пользователь нажимает New changelist.
2. Вводит непустое описание.
3. Приложение создаёт numbered changelist и выбирает его.
4. Через context action пользователь меняет описание.
5. Пустой changelist без shelf можно удалить после подтверждения.

**Наблюдаемый результат:** созданный id приходит от P4 Server; edit сохраняет остальные поля form; после mutation список перечитывается.

**Альтернативы и ошибки:** Default нельзя редактировать/удалить этим flow; непустой changelist или changelist с shelf не предлагается удалить как пустой; окончательные инварианты проверяет сервер.

**Тест-чеклист:**

- [x] UNIT: безопасная changelist form и extraction created id.
- [x] UNIT: replace только Description без потери остальных form fields.
- [ ] FAKE-P4: create/edit/delete text form success и malformed response.
- [ ] LIVE-P4: create → edit → delete; server rejection для непустого changelist.
- [ ] UI: validation, confirm, refresh и selection после удаления.

#### US-CHG-03 — переместить один или несколько opened files в другой changelist

**Доступность:** доступно сейчас через inspector/context action и drag-and-drop.

> Как разработчик, я хочу сгруппировать файлы по задачам, чтобы каждый submit содержал только связанные изменения.

**Основной сценарий:**

1. Пользователь выбирает один файл, Ctrl/Cmd-toggle набор или Shift-range.
2. Выбирает destination changelist либо перетаскивает selection.
3. Приложение выполняет один batch <code>p4 reopen -c target paths...</code>.
4. После успеха server refresh показывает файлы только в destination.

**Наблюдаемый результат:** drag cursor показывает move; исходный и целевой changelists не дублируют файл; внешний/повреждённый drag payload игнорируется.

**Тест-чеклист:**

- [x] UNIT: single/toggle/range selection и удаление исчезнувших после refresh ids.
- [x] UNIT: encode/decode internal drag payload, copyMove и drop intent.
- [x] UNIT: validation changelist ids и depot paths.
- [ ] FAKE-P4: один batch reopen с точным набором аргументов.
- [ ] LIVE-P4: move one/many/all между Default и numbered CL.
- [ ] UI: mouse, keyboard alternative, drop highlight и failure without optimistic drift.

#### US-DIFF-01 — посмотреть базовый diff local или shelf

**Доступность:** доступно сейчас для одного выбранного text file; viewer базовый.

> Как разработчик, я хочу увидеть отличие файла до shelve/revert/submit, чтобы проверить содержимое изменения.

**Доступные сравнения:**

- local workspace ↔ have revision через <code>p4 diff -du</code>;
- shelf ↔ depot head через <code>p4 diff2 -du</code>;
- shelf ↔ local, если тот же depot path открыт в workspace.

**Наблюдаемый результат:** текст показывается в inspector; при превышении 2 MiB есть признак truncation; внешний P4DIFF не перехватывает встроенный запрос.

**Ограничения:** нет split view, syntax highlighting, hunk navigation, whitespace modes, image diff и полноценного binary fallback.

**Тест-чеклист:**

- [ ] UNIT: truncation boundary, empty/identical diff и invalid UTF-8 replacement behavior.
- [ ] FAKE-P4: exact diff/diff2 arguments, stdout/stderr и non-zero exit.
- [ ] LIVE-P4: edit/add/delete, shelf/head и shelf/local text cases.
- [ ] UI: large/truncated, binary, loading, error и selection change while request runs.

#### US-SHELF-01 — сохранить выбранную или всю локальную работу на shelf

**Доступность:** доступно сейчас для numbered changelist.

> Как разработчик, я хочу сохранить серверную копию незавершённой работы, чтобы поделиться ею или защититься от потери локальных файлов.

**Основной сценарий:**

1. Пользователь выбирает opened files и запускает Shelve либо выбирает Shelve/Update all.
2. Приложение выполняет <code>p4 shelve</code> для выбранного набора или полный replace.
3. По выбору пользователя после успешного shelf local files остаются opened либо выполняется revert.
4. Refresh показывает отдельную shelf section.

**Наблюдаемый результат:** shelf является копией и не заменяет local state; при ошибке revert пользователь видит, что shelf уже обновлён, а local cleanup не завершён.

**Тест-чеклист:**

- [ ] UNIT: selected/replace-all/revert-after argument matrix.
- [ ] FAKE-P4: shelf succeeds + revert fails с точным partial-result message.
- [ ] LIVE-P4: create shelf, update subset, replace all, shelf then revert.
- [ ] RECOVERY: shelf сохранён при неуспешном post-shelf revert.
- [ ] UI: Default shelf action отсутствует; confirm ясно описывает судьбу local files.

#### US-SHELF-02 — применить shelf в выбранный changelist без потери конфликтующих local files

**Доступность:** доступно сейчас; расширенный preflight покрывает прежде всего collision shelved add с существующим untracked local file.

> Как разработчик, я хочу unshelve выбранные файлы в Default или numbered changelist и сам решить, какие локальные файлы можно перезаписать.

**Основной сценарий:**

1. Пользователь выбирает один, несколько или все shelved files.
2. Выбирает target changelist.
3. Приложение получает shelved adds, opened files и mappings через <code>p4 where</code>.
4. Все найденные local collisions показываются одним списком.
5. По умолчанию конфликтующие paths получают Skip.
6. Пользователь может выбрать subset и назначить Overwrite from shelf.
7. Normal paths идут обычным unshelve; force применяется только к явно выбранному subset.

**Наблюдаемый результат:** source shelf сохраняется; drag cursor показывает copy; после refresh applied files находятся в target changelist.

**Тест-чеклист:**

- [x] UNIT: depot → local mapping parser для preflight.
- [x] UNIT: multi-select и drag shelf → changelist имеет copy semantics.
- [ ] UNIT: normal/force partition не дублирует paths.
- [ ] FAKE-P4: all collisions returned, Skip default, exact per-subset <code>-f</code>.
- [ ] LIVE-P4: no collision, one/many untracked add collisions, target Default/numbered.
- [ ] RECOVERY: normal batch succeeds, force batch fails; UI показывает фактический partial state.

#### US-SHELF-03 — удалить shelf или выбранные shelved copies

**Доступность:** доступно сейчас с подтверждением.

> Как владелец shelf, я хочу удалить устаревшие серверные копии, не затронув local opened files.

**Основной сценарий:** пользователь выбирает shelved files или весь shelf, видит destructive confirmation и запускает delete.

**Наблюдаемый результат:** <code>p4 shelve -d</code> получает либо полный change, либо <code>-Af</code> и выбранные paths; local opened section не меняется; после refresh shelf исчезает только если сервер больше его не сообщает.

**Тест-чеклист:**

- [x] UNIT: различный syntax для whole/partial shelf delete.
- [ ] FAKE-P4: warning/error records и permission failure.
- [ ] LIVE-P4: delete selected, delete all, чужой/restricted shelf.
- [ ] UI: полный affected list и отсутствие опасного действия для Default.

#### US-REVERT-01 — отменить выбранные локальные изменения

**Доступность:** доступно сейчас.

> Как разработчик, я хочу отменить local opened changes после просмотра scope, чтобы вернуть workspace к have revision.

**Основной сценарий:**

1. Пользователь выбирает один, несколько или все opened files changelist.
2. Confirmation перечисляет affected paths и предупреждает о потере local work.
3. Для opened-for-add пользователь выбирает, оставить файл на диске или удалить через <code>p4 revert -w</code>.
4. После revert server refresh убирает files из opened section.

**Наблюдаемый результат:** shelf того же changelist не удаляется; настройка delete-added-files сохраняется; операция не называется rollback submitted change.

**Тест-чеклист:**

- [x] UNIT: <code>-w</code> добавляется только по explicit preference.
- [x] UNIT: empty selection и unsafe paths отклоняются.
- [ ] FAKE-P4: one/many paths, warning, permission и partial output.
- [ ] LIVE-P4: edit/add/delete и сохранение shelf.
- [ ] UI: destructive copy, affected list, persisted preference и keyboard path.

#### US-SUBMIT-01 — отправить local-only changelist

**Доступность:** доступно сейчас; полноценный preflight ещё отсутствует.

> Как разработчик, я хочу отправить reviewed local changes в depot и увидеть актуальное состояние после submit.

**Основной сценарий:**

1. Пользователь выбирает Default или numbered changelist с local files без shelf.
2. Для Default вводит description; numbered CL использует своё description.
3. Пользователь подтверждает Submit.
4. Приложение выполняет <code>p4 submit -d</code> или <code>p4 submit -c</code>.
5. После success/failure перечитываются pending changes, shelves и opened files.

**Наблюдаемый результат:** успешный change исчезает из pending state; server error не маскируется как connection failure.

**Ограничение:** UI ещё не показывает заранее unresolved, out-of-date, locks, jobs, sizes и trigger warnings.

**Тест-чеклист:**

- [ ] UNIT: mode selection Default/numbered и description validation.
- [ ] FAKE-P4: success, structured rejection и unknown/non-JSON output.
- [ ] LIVE-P4: Default/numbered success; unresolved/out-of-date/lock/trigger rejection.
- [ ] RECOVERY: network/process interruption с последующей проверкой pending/submitted state.
- [ ] UI: correct disabled reason, busy state и no duplicate submit.

#### US-SUBMIT-02 — отправить shelf-only changelist

**Доступность:** доступно сейчас.

> Как разработчик или build engineer, я хочу отправить готовый shelf без предварительного unshelve, если сервер допускает direct shelf submit.

**Основной сценарий:** пользователь выбирает shelf-only changelist и запускает Submit shelf; приложение выполняет <code>p4 submit -e change</code> и refresh.

**Наблюдаемый результат:** при success shelf/pending change исчезает; task-stream, edge-origin и permission restrictions приходят как точная server error.

**Тест-чеклист:**

- [ ] UNIT: shelf-only mode и numbered change validation.
- [ ] FAKE-P4: exact <code>submit -e</code>, warning/error classification.
- [ ] LIVE-P4: supported direct submit; restricted/task-stream/edge limitations.
- [ ] RECOVERY: unknown result после прерывания.
- [ ] UI: copy ясно говорит, что отправляется shelf, а не local workspace.

#### US-SUBMIT-03 — выбрать правильную версию при одновременных local files и shelf

**Доступность:** доступно сейчас тремя явными стратегиями.

> Как разработчик, я хочу осознанно выбрать local или shelved версию при submit, чтобы более новая локальная работа или серверная контрольная точка не потерялась молча.

**Вариант A — Submit shelf, сохранить local:**

1. Создать recovery changelist.
2. Переместить туда local opened files.
3. Выполнить <code>submit -e</code> исходного shelf.
4. Показать номер recovery CL.

**Вариант B — Submit local, удалить старый shelf:**

1. Явно предупредить о необратимом удалении shelf.
2. Удалить shelf.
3. Submit local changelist.

**Вариант C — обновить shelf из local и Submit local:**

1. Полностью заменить shelf текущими local files.
2. Удалить shelf перед обычным submit.
3. Submit local.
4. При неуспешном submit попытаться восстановить обновлённый shelf.

**Наблюдаемый результат:** UI называет выбранную версию и судьбу другой версии; compensation result сообщается отдельно.

**Тест-чеклист:**

- [ ] UNIT: state matrix local/shelf/both → допустимые modes.
- [ ] FAKE-P4: точная последовательность каждой стратегии.
- [ ] LIVE-P4: success для A/B/C.
- [ ] RECOVERY: ошибка create/reopen/submit/restore на каждом шаге и проверка surviving data.
- [ ] UI: destructive emphasis только для B, recovery CL видим, повторный click заблокирован.

#### US-SESSION-01 — получить свежие данные и диагностику после внешних изменений

**Доступность:** доступно сейчас для My Changes.

> Как пользователь нескольких P4-инструментов, я хочу, чтобы P4FNV обновлялся после возврата фокуса и показывал CLI warnings/errors, чтобы не работать со stale state.

**Основной сценарий:**

1. Пользователь меняет changelist/shelf вне P4FNV.
2. При возврате фокуса throttled refresh перечитывает данные.
3. Selection сохраняется, если object/path ещё существует, иначе очищается.
4. Warning/error records доступны в сессионном журнале справа внизу.

**Тест-чеклист:**

- [x] UNIT: focus-only throttling.
- [x] UNIT: stale shelf cache и disappeared selection.
- [ ] FAKE-P4: warning records попадают в bounded session log.
- [ ] LIVE-P4: external P4V/CLI mutation while P4FNV unfocused.
- [ ] UI: log placement, clear, focus/scroll preservation и no polling.

#### US-LOCALE-01 — работать на русском/английском и установить внешний язык

**Доступность:** доступно сейчас.

> Как пользователь, я хочу выбрать язык приложения и добавить полный language pack без пересборки.

**Основной сценарий:** пользователь переключает RU/EN; приложение сохраняет выбор. Полный внешний JSON pack из shipping/config directory появляется после restart, а incomplete/corrupt pack пропускается с warning.

**Тест-чеклист:**

- [x] UNIT: built-in locale contracts полны и имеют одинаковые keys.
- [x] UNIT: incomplete external pack пропускается, complete pack обнаруживается.
- [x] UNIT: один typed key возвращает перевод выбранного языка.
- [ ] UI: полный обход доступных экранов на RU/EN и длинных строках.
- [ ] SHIPPING: locale files находятся рядом с release executable.

### 27.4 Частично доступные stories и точная граница возможностей

#### US-AUTH-01 — восстановить истёкшую или недоверенную сессию

**Доступность:** частично доступно.

Пользователь уже получает auth/trust error и остаётся на connection screen, но не может ввести пароль, пройти login2/SSO/MFA, подтвердить fingerprint или выполнить logout внутри P4FNV. Story закрывается только после реализации раздела 4.2.

**Тест-чеклист:**

- [x] UNIT: auth/trust message classification.
- [ ] FAKE-P4: expired ticket → login flow → successful retry.
- [ ] LIVE-P4: password, new/changed SSL fingerprint, MFA и доступный SSO setup.
- [ ] SECURITY: password, MFA data, ticket и auth URL/token отсутствуют в logs/settings.

#### US-DIFF-02 — проверить большой или binary asset

**Доступность:** частично доступно.

Пользователь может запросить diff, но текущий viewer ограничен text output 2 MiB и не предоставляет production-grade image/binary/large-file flow. Story закрывается после раздела 19.

**Тест-чеклист:**

- [ ] UNIT: type/size routing и truncation.
- [ ] FAKE-P4: large streaming output и cancel.
- [ ] LIVE-P4: text >2 MiB, binary, image, unicode и symlink.
- [ ] UI: deliberate fallback, external tool и отсутствие зависшего blank pane.

#### US-SUBMIT-04 — исправить проблемы до запуска submit

**Доступность:** частично доступно.

Пользователь может запустить submit и получить server rejection, но пока не видит полный preflight unresolved/out-of-date/locks/missing/jobs/stream spec. Story закрывается после разделов 9.2 и 15.

**Тест-чеклист:**

- [ ] UNIT: aggregation всех preflight issue groups.
- [ ] FAKE-P4: несколько одновременных problems, а не stop-on-first.
- [ ] LIVE-P4: unresolved + out-of-date + lock combinations.
- [ ] UI: переход из issue к affected files и disabled reason.

#### US-CHG-04 — передать changelist другому пользователю/workspace

**Доступность:** частично доступно только через внешние P4V/CLI.

P4FNV уже показывает owner/client в модели pending change, но не предоставляет handoff, public/restricted или promoted shelf workflow. Story закрывается после разделов 9.1 и 10.

### 27.5 Целевые stories для следующих milestone

#### US-WORKSPACE-01 — просмотреть файлы проекта и их реальный статус

**Доступность:** целевая story, Milestone A.

> Как разработчик, я хочу открыть tree/list своего workspace, отфильтровать opened/modified/outdated/untracked files и увидеть depot/client/local paths, чтобы понимать состояние проекта без CLI.

**Acceptance checklist:**

- [ ] Lazy tree/list не требует рекурсивного full-workspace запроса.
- [ ] Status строится scoped batch <code>p4 fstat</code>/<code>status</code>, а не per-file N+1.
- [ ] Have/head, changelist, locks, resolve, mapping и file type видимы.
- [ ] Expand/filter сохраняют selection/scroll после refresh.
- [ ] File inspector предоставляет Diff, History и ежедневные actions.

**Test checklist:** UNIT parser/status grouping; FAKE-P4 large/partial output; LIVE-P4 classic/stream mappings; UI keyboard/virtualization/200%.

#### US-DEPOT-01 — просмотреть depot независимо от workspace mapping

**Доступность:** целевая story, Milestone A.

> Как разработчик, я хочу найти файл в depot, увидеть head metadata/history и перейти к его workspace mapping, даже если файл сейчас не mapped.

**Acceptance checklist:**

- [ ] Depot roots/types, lazy dirs/files и deleted-at-head toggle.
- [x] Preview/history доступны для readable non-mapped file.
- [ ] Sync/edit non-mapped file не запускается; предлагается изменить mapping/workspace.
- [ ] Permission/maxresults показываются как scoped partial state.

**Test checklist:** fake large tree; live local/stream/spec/graph-readable depots; restricted subtree; depot ↔ local navigation.

#### US-SYNC-01 — безопасно обновить workspace

**Доступность:** целевая story, Milestone A.

> Как пользователь, я хочу увидеть server-generated preview обновления, запустить sync с прогрессом и отменить его, не потеряв локальные изменения.

**Acceptance checklist:**

- [ ] <code>p4 sync -n</code> показывает add/update/delete/bytes и affected local/open files.
- [ ] Safe mode является default; force — отдельное advanced действие.
- [ ] Progress отражает real processed files; операция имеет cancel.
- [ ] После success/cancel/error have/head перечитываются.
- [ ] Sync to change/date/label/revision использует тот же safety contract.

**Test checklist:** fake streaming/cancel; live safe overwrite protection, open-file resolve, parallel capability, interrupted network; UI Operation Center.

#### US-FILES-01 — выполнить ежедневные edit/add/delete/move/reconcile операции

**Доступность:** целевая story, Milestone A.

> Как разработчик, я хочу открыть, добавить, удалить или переименовать выбранные файлы и reconcile offline changes в нужный changelist.

**Acceptance checklist:**

- [ ] Batch edit/add/delete/move с destination changelist; single-file depot rename доступен с явным destination path.
- [ ] Reconcile preview группирует add/edit/delete/move/ignored.
- [ ] P4IGNORE, mapping, special characters и case-only rename учтены.
- [ ] Apply использует выбранный subset; server refresh подтверждает result.
- [ ] Clean отделён как destructive flow с полным preview.

**Test checklist:** unit argument builders; fake partial records; live all actions + P4IGNORE + case modes; recovery after partial directory move.

#### US-HISTORY-01 — увидеть историю changelists выбранной папки проекта

**Доступность:** целевая story, Milestone B.

> Как разработчик или lead, я хочу выбрать папку и увидеть только submitted changelists, затрагивавшие её, с author/date/description/files/diff.

**Acceptance checklist:**

- [ ] Scope path и include-subfolders постоянно видимы.
- [ ] Filters number/user/date/description/stream/jobs и incremental load.
- [ ] Selected change показывает details и lazy file diff без нового окна.
- [ ] Restricted/partial/maxresults не выглядят как пустая история.
- [ ] Доступны Compare, Get revisions, Create rollback и Cherry-pick entry points.

**Test checklist:** fake pagination/truncation; live folder/file/deleted path, restricted change, large history; UI saved filters/virtualization.

#### US-HISTORY-02 — исследовать файл и безопасно получить или отменить revision

**Доступность:** целевая story, Milestone B.

> Как разработчик, я хочу увидеть filelog/integration history, preview revision, сравнить две версии, получить старую версию или создать новый rollback changelist.

**Acceptance checklist:**

- [ ] Revisions содержат action/change/author/time/type/integration/labels.
- [ ] Preview через <code>p4 print</code> не изменяет workspace.
- [ ] Get Revision и <code>p4 undo</code> имеют разные labels и consequences.
- [ ] Undo сначала выполняет <code>-n</code>, затем открывает files в выбранный pending CL.
- [ ] Revision Graph отображает только реальные integration records.

**Test checklist:** live edit/branch/move/delete/undo history; compare text/binary; undo conflict requiring resolve; UI graph navigation.

#### US-RESOLVE-01 — разрешить конфликт и вернуться к submit

**Доступность:** целевая story, Milestone C.

> Как разработчик, я хочу увидеть все unresolved files, выбрать/отредактировать result и завершить resolve, не путая source и workspace versions.

**Acceptance checklist:**

- [ ] Submit gate показывает полный unresolved count.
- [ ] Text resolve имеет base/source/workspace/result и hunk navigation.
- [ ] Accept actions называют содержимое, а не только yours/theirs.
- [ ] Binary/move/filetype/stream spec conflicts имеют специализированный UI.
- [ ] После external tool server resolve state перечитывается.

**Test checklist:** live content conflict/no-conflict, binary, move, filetype и stream spec; fake tool failure; UI save/next/keyboard.

#### US-STREAM-01 — понять структуру streams и безопасно сменить рабочий контекст

**Доступность:** целевая story, Milestone D.

> Как пользователь streams, я хочу видеть tree/graph, текущий workspace и merge/copy hints, а затем безопасно переключиться в другой stream.

**Acceptance checklist:**

- [ ] Tree/graph синхронизируют selection и показывают ancestors.
- [ ] Type, parent, flow rules, paths, workspaces и activity доступны в inspector.
- [ ] <code>p4 istat</code>/<code>interchanges</code> дают server-backed hints.
- [ ] Перед switch обнаруживаются opened/offline changes и active operations.
- [ ] Пользователь выбирает Shelve and switch / supported move / Stay; silent loss невозможен.

**Test checklist:** live mainline/dev/release/task/virtual/sparse, classic vs stream workspace, opened changes, edge server; UI zoom/filter.

#### US-INTEGRATE-01 — выполнить merge down, copy up или cherry-pick

**Доступность:** целевая story, Milestone D.

> Как разработчик или release engineer, я хочу явно выбрать source/target, увидеть interchanges и применить изменения в pending changelist для resolve/review.

**Acceptance checklist:**

- [ ] Source слева, target workspace/stream справа и направление нельзя перепутать.
- [ ] Preview показывает files/actions/already-integrated/conflicts.
- [ ] Merge, copy и cherry-pick используют различимую semantics.
- [ ] Apply никогда не submit автоматически.
- [ ] Partial result и compensation показываются по шагам Preview → Apply → Resolve → Review → Submit.

**Test checklist:** live merge down/copy up, partial cherry-pick, moves, already integrated, task stream; fake failure between batches; UI direction comprehension.

#### US-LOCK-01 — защитить binary/critical files от конкурирующего submit

**Доступность:** целевая story, Milestone C/E.

> Как технический художник, я хочу увидеть, кто открыл/заблокировал asset, поставить собственный lock и безопасно снять его.

**Acceptance checklist:**

- [ ] otherOpen, otherLock, user/workspace/change видимы.
- [ ] Explicit lock не путается с filetype <code>+l</code>.
- [ ] Local/global lock зависит от detected topology.
- [ ] Force admin actions отсутствуют в обычном UI.

**Test checklist:** live lock conflict, submit releases lock, edge global lock, orphan/error state; UI binary inspector.

#### US-JOB-01 — связать задачу с changelist и submit

**Доступность:** целевая story, Milestone E.

> Как разработчик, я хочу найти server-defined job, связать его с numbered changelist и увидеть ожидаемый status после submit.

**Acceptance checklist:**

- [ ] Custom jobspec fields не теряются.
- [ ] Attach/detach использует fix/fixes semantics.
- [ ] Default changelist обрабатывается через submit form.
- [ ] same/custom status и resulting fix видимы.

**Test checklist:** custom jobspec, many jobs, permission, pending/submitted fixes, submit failure.

#### US-LABEL-01 — получить воспроизводимое состояние по label

**Доступность:** целевая story, Milestone E.

> Как build/release engineer, я хочу найти label, проверить его revisions и безопасно sync workspace к нему.

**Acceptance checklist:**

- [ ] Automatic/static и locked/unlocked labels различаются.
- [ ] Label view/revision/files доступны до sync.
- [ ] Sync to label использует US-SYNC-01 preview/cancel/recovery.
- [ ] Tag/untag остаётся отдельным P2 destructive workflow.

**Test checklist:** live static/automatic/locked labels, partial mapping, label deleted between preview/apply; UI history navigation.

#### US-OPS-01 — контролировать длительную операцию и понять итог после сбоя

**Доступность:** целевая cross-cutting story, обязательна для Milestone A.

> Как пользователь большого проекта, я хочу продолжать навигацию, видеть прогресс sync/submit/integrate и отменить конкретную задачу, понимая, что уже успело измениться.

**Acceptance checklist:**

- [ ] Каждая операция имеет id, scope, workspace/server и event stream.
- [ ] Cancel завершает только выбранный child.
- [ ] Completed/warning/error остаются доступными в Operations Center.
- [ ] Unknown result запускает read-back и не обещает rollback.
- [ ] Retry автоматичен только для безопасных read; mutation требует нового confirm.

**Test checklist:** fake interleaved operations, cancellation, warnings, malformed records; live partial sync/network loss/submit unknown; UI navigation while running.

### 27.6 Матрица трассировки stories к feature-разделам

| Story | Feature-разделы | Текущий статус |
|---|---|---|
| US-CON-01…02 | 4, 5.1, 21 | Доступно с valid ticket/trust |
| US-CHG-01…03 | 9.1 | Доступно |
| US-DIFF-01 | 12.2, 19 | Доступно частично по качеству viewer |
| US-SHELF-01…03 | 10 | Доступно |
| US-REVERT-01 | 8.4 | Доступно |
| US-SUBMIT-01…03 | 9.2 | Доступно без полного preflight |
| US-SESSION-01 | 21, 22 | Доступно для My Changes |
| US-LOCALE-01 | 22 | Доступно |
| US-AUTH-01, US-DIFF-02, US-SUBMIT-04, US-CHG-04 | 4.2, 9, 10, 19 | Частично |
| US-WORKSPACE-01, US-DEPOT-01, US-SYNC-01, US-FILES-01 | 5–8, 21 | Целевые P0 |
| US-HISTORY-01…02 | 11–12 | Целевые P0/P1 |
| US-RESOLVE-01 | 15 | Целевая P0/P1 |
| US-STREAM-01, US-INTEGRATE-01 | 13–14 | Целевые P1 |
| US-LOCK-01, US-JOB-01, US-LABEL-01 | 16–18 | Целевые P1/P2 |
| US-OPS-01 | 21 | Целевая P0 |

### 27.7 Правило превращения story в test suite

Для каждой реализуемой story агент создаёт или обновляет test plan со следующими группами:

1. **Happy path:** минимальный валидный сценарий и batch вариант.
2. **Empty state:** нет файлов/changes/results; это не ошибка.
3. **Validation:** invalid id/path/revision/form value не доходит до process.
4. **Permissions/restricted:** server rejection сохраняет diagnostics и текущие данные.
5. **Concurrency/race:** объект изменился после preview, до apply.
6. **Partial/unknown:** часть subprocess sequence прошла; server state перечитан.
7. **Cancel:** проверено, что именно уже изменилось.
8. **Scale:** large list/output, maxresults, long path/description, virtualization.
9. **Environment:** plain/SSL, Unicode/case mode, classic/stream, standard/edge где применимо.
10. **UX/accessibility:** RU/EN, keyboard-only, focus/selection/scroll, 100/125/200%, screen reader announcements.

Формат имени теста:

<code>US-&lt;AREA&gt;-NN__&lt;given&gt;__&lt;when&gt;__&lt;then&gt;</code>

Примеры:

- <code>US-CHG-03__three_opened_files_selected__move_to_numbered_change__one_batch_reopen_and_refresh</code>
- <code>US-SHELF-02__two_untracked_add_collisions__overwrite_one__other_is_skipped</code>
- <code>US-SUBMIT-03__submit_shelf_fails__rollback_succeeds__local_files_return_to_source_change</code>

Результат test run для LIVE-P4 должен записывать server/client versions, topology, Unicode/case mode, использованный disposable dataset и непроверенные варианты. Нельзя отмечать LIVE-P4 пункт по результату unit/fake test.

## 28. Официальные источники

### P4V

- [About P4V and depot/workspace model](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/introduction.about.html)
- [Connect to P4 Server, SSL, MFA and Authentication Service](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.connecting.html)
- [Navigate Depot and Workspace trees](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.navigating.html)
- [Create and manage workspaces](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.workspaces.html)
- [Retrieve files from the depot](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.retrieve.html)
- [Submit files and manage changelists](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.submit.html)
- [Shelve files](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.shelve.html)
- [Display revision history](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/files.history.html)
- [Revision Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/advanced_files.revgraph.html)
- [Search and filter](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.filters.html)
- [About streams](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.about.html)
- [Stream Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.graph.html)
- [Merge down and copy up](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.merge_copy.html)
- [Manage jobs](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/branches.jobs.html)

### P4 CLI

- [P4 CLI command reference](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands.html)
- [Commands by functional area](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/commands-by-functional-area.html)
- [Global options and structured output](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/global.options.html)
- [p4 client](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_client.html)
- [p4 fstat](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_fstat.html)
- [p4 sync](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_sync.html)
- [p4 reconcile](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_reconcile.html)
- [p4 changes](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_changes.html)
- [p4 change](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_change.html)
- [p4 describe](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_describe.html)
- [p4 filelog](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_filelog.html)
- [p4 print](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_print.html)
- [p4 diff2](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_diff2.html)
- [p4 undo](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_undo.html)
- [p4 integrate](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_integrate.html)
- [p4 interchanges](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_interchanges.html)
- [p4 istat](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_istat.html)
- [p4 streams](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_streams.html)
- [p4 stream](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_stream.html)
- [Resolve conflicts](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/P4Guide/resolve.howto.html)
- [p4 lock](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_lock.html)
- [p4 reshelve](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_reshelve.html)
- [p4 jobs and p4 fix](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_jobs.html)
- [p4 label](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_label.html)
- [p4 annotate](https://help.perforce.com/helix-core/server-apps/cmdref/current/Content/CmdRef/p4_annotate.html)

## 29. Правило для будущих агентов

Перед реализацией агент выбирает один незакрытый пункт или компактную группу с общей backend-командой, находит связанные story ID из раздела 27, читает связанные разделы этого документа, <code>ARCHITECTURE.md</code>, <code>UI_UX_SPECIFICATION.md</code> и релевантную официальную документацию. После реализации агент:

1. отмечает только действительно завершённые пункты;
2. добавляет рядом краткую запись о фактических ограничениях;
3. обновляет матрицу команд, если появилась новая команда/flag;
4. записывает выполненные tests и live-server smoke scope;
5. обновляет доступность story и отмечает только фактически выполненные UNIT/FAKE-P4/LIVE-P4/UI/RECOVERY проверки;
6. использует story ID в именах новых integration/E2E tests и bug reports;
7. не помечает родительский workflow готовым, пока не закрыты preview, error/partial state, refresh, localization и keyboard path.
