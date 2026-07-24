# Архитектурный снимок приложения

> Research snapshot. Актуальный краткий контракт находится в [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. Архитектурная цель

Приложение должно ощущаться как современный рабочий инструмент, а не графическая оболочка над списком команд. Пользователь работает с файлами и изменениями, видит последствия операции до запуска, получает прогресс и может отменить длительную задачу.

При этом Helix Core остаётся источником истины. Клиент не воспроизводит серверную модель локально и не скрывает важные понятия Perforce настолько, чтобы действие стало двусмысленным.

## 2. Принятый стек

| Область | Решение | Причина |
|---|---|---|
| Desktop | Tauri 2 | компактная кроссплатформенная оболочка и строгая IPC-граница |
| Backend | Rust stable (MSVC на Windows) | безопасные процессы, потоковый I/O и один локальный бинарник |
| UI | React + TypeScript + Vite | зрелая экосистема для сложных деревьев, таблиц и desktop-сценариев |
| Стили | обычный CSS, CSS variables, локальные стили компонентов | минимум магии, простая тема, отсутствие runtime-зависимости |
| Perforce | установленный `p4` CLI | официальный и полный интерфейс к Helix Core без C++ FFI |
| Формат `p4` | `-ztag -Mj` | структурированные построчные JSON-записи |
| Настройки | JSON в app config directory | объём мал; БД пока не оправдана |
| Пакеты JS | npm + lockfile | поставляется с Node.js, отдельный package manager не нужен |

Tauri CLI устанавливается в `devDependencies` проекта. Глобальная версия не используется.

## 3. Границы системы

```text
┌──────────────────────────────────────────────────────────────┐
│ React UI                                                    │
│ views, selection, forms, optimistic interaction, progress   │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed invoke + events
┌──────────────────────────────▼───────────────────────────────┐
│ Tauri / Rust                                                │
│ allow-listed commands, validation, settings, operations     │
└──────────────────────────────┬───────────────────────────────┘
                               │ Command::args, no shell
┌──────────────────────────────▼───────────────────────────────┐
│ p4 CLI                                                      │
│ -ztag -Mj, one child process per operation                  │
└──────────────────────────────┬───────────────────────────────┘
                               │ Helix protocols
┌──────────────────────────────▼───────────────────────────────┐
│ Helix Core Server                                           │
│ source of truth, permissions, streams, revisions, locks     │
└──────────────────────────────────────────────────────────────┘
```

### Frontend отвечает за

- представление данных и навигацию;
- выбор файлов/ревизий и подтверждение опасных действий;
- локальное состояние формы и выбранных элементов;
- отображение прогресса, предупреждений и ошибок;
- обновление затронутых экранов после успешной операции.

Frontend не знает аргументы `p4`, не хранит пароль и не интерпретирует сырой stderr.

### Rust backend отвечает за

- поиск и проверку версии `p4`;
- построение аргументов только для разрешённых операций;
- применение `P4PORT`, `P4USER`, `P4CLIENT`, `P4CHARSET` к конкретному процессу;
- чтение JSON Lines, stderr и exit code;
- нормализацию ответов и ошибок в стабильные DTO приложения;
- жизненный цикл длительных операций и отмену child process;
- чтение и атомарную запись несекретных настроек.

### `p4` и сервер отвечают за

- аутентификацию, tickets, SSO/MFA и SSL trust;
- права доступа и серверную валидацию;
- фактические операции с файлами, changelist, streams и интеграциями;
- историю и содержимое ревизий.

## 4. Модель backend

### P4 runner

`src-tauri/src/p4/runner.rs` является единственной низкоуровневой точкой запуска процесса. Доменные функции в `p4.rs` валидируют конкретную операцию, собирают аргументы отдельными значениями и передают настроенный `Command` runner-у. Универсального `P4Request` и произвольной командной строки нет: такой envelope добавляется только вместе с реальным протоколом длительных отменяемых операций.

Runner:

1. запускает настроенный executable напрямую через `std::process::Command`;
2. добавляет глобальные флаги `-ztag -Mj` там, где команда их поддерживает;
3. передаёт аргументы отдельными значениями;
4. читает stdout построчно как последовательность JSON-объектов;
5. отдельно сохраняет stderr и код завершения;
6. классифицирует process/CLI errors и складывает warnings/errors в ограниченный сессионный журнал;
7. не пишет secrets и полный environment в лог.

У runner нет публичного метода вида `run(command: string)` для frontend. Каждая Tauri command строит конкретный разрешённый запрос.

### Модели ответа

Rust преобразует поля Perforce в небольшие модели приложения. Внешние поля `p4` не должны растекаться по React-компонентам: формат CLI может отличаться между командами и версиями сервера.

Общий envelope для ошибки:

```text
AppError {
  kind: executable_not_found | auth | trust | permission | conflict |
        offline | cancelled | stale | partial_result |
        invalid_output | command_failed,
  message,
  hints[],
  diagnostics?       # безопасные технические детали без секретов
}
```

Предупреждения Perforce не приравниваются автоматически к ошибкам. Частичный успех длительной операции должен возвращать выполненные элементы и диагностические записи.

### Состояние процесса

Глобальное managed state минимально:

- текущие несекретные настройки подключения;
- явные необязательные `P4CONFIG`/`P4ENVIRO`, передаваемые только выбранному процессу `p4`;
- registry запущенных длительных операций `operation_id -> child/cancel handle`.

Списки файлов, changelists и история не копируются в Rust-кэш без причины. Ими владеет feature-hook frontend и обновляет после мутаций. Пока окно было неактивно, данные считаются потенциально устаревшими: при возврате фокуса hook повторяет короткие read-запросы. Выбор сохраняется только для файлов, которые всё ещё существуют в новом server snapshot; удалённые или перемещённые элементы автоматически исключаются. События фокуса ограничиваются по частоте; отдельный filesystem watcher для этого сценария не нужен.

## 5. Короткие и длительные операции

Короткие чтения (`info`, `opened`, небольшой `changes`) возвращают результат обычной Tauri command.

Длительные операции (`sync`, `submit`, `integrate`, большие `fstat`) используют протокол:

1. UI вызывает `start_*` и получает `operation_id`.
2. Backend запускает отдельный child process.
3. Backend отправляет типизированные events `started`, `progress`, `warning`, `completed`, `failed`, `cancelled` с этим id.
4. UI показывает задачу в едином центре операций.
5. `cancel_operation(id)` завершает только соответствующий процесс.
6. После завершения backend обязательно удаляет handle из registry.

Прогресс не выдумывается. Если сервер не сообщает общий объём, UI показывает количество обработанных файлов и неопределённый progress indicator.

## 6. Модель данных и пути

Нельзя смешивать:

- `depot_path` — `//depot/...`;
- `client_path` — `//workspace/...`;
- `local_path` — путь файловой системы;
- `revision` — номер/спецификация версии.

Они должны быть отдельными полями моделей, а не одним универсальным `path`.

До любой файловой операции backend использует тот вид пути, который ожидает конкретная команда. Маппинг client view, включая exclusions и overlays, оставляется серверу/`p4`, а не воспроизводится собственным парсером без необходимости.

`-Mj` может заменить невалидный UTF-8 на `U+FFFD`. Поэтому операция над локальным путём не должна слепо использовать отображённую строку как идентификатор. Для проблемных путей нужен отдельный round-trip тест на каждой поддерживаемой ОС; до его появления UI обязан предупреждать и не выполнять потенциально неверную мутацию.

## 7. Пользовательские области

### Подключение

Хранит путь к `p4`, адрес сервера, пользователя, workspace и charset. Выполняет `p4 info`, trust/login и выбор workspace. `P4Info` сохраняет server services, server ID, security, client address и user email для capability-aware UI. При auth error connection screen принимает пароль только в memory, передаёт его через stdin для `p4 login`, очищает после успеха и не сохраняет его в settings/log.

После успешного `p4 info` приложение сохраняет до десяти последних и до двадцати избранных несекретных профилей подключения в `settings.json` внутри app config directory. Профиль включает только путь к `p4`, server, user, workspace и charset. Избранные и последние профили предлагаются до открытия workspace; пароль и ticket в этот файл не попадают.

### Рабочая область

Объединяет дерево и статус файлов, чтобы пользователь не переключался между техническими экранами. Действия: обновить, открыть для изменения, добавить, удалить, переместить, отменить локальные изменения. Read-only inspector текущего client spec показывает mapping, options, root/AltRoots, host и stream перед файловыми операциями; запись spec пока не входит в этот slice.

### Мои изменения

Показывает default и numbered pending changelists, открытые файлы, описание, shelved files и submit validation. Перетаскивание между списками вызывает `reopen`, а не меняет только UI.

### История

Показывает submitted changes и filelog, diff двух ревизий, получение старой ревизии и отдельное создание отката через `p4 undo`. Перед откатом отображаются будущие изменения и новый pending changelist.

### Интеграция

Merge и cherry-pick — два режима одного пользовательского сценария, но не одна неявная команда. Backend строит preview (`integrate -n` там, где применимо), UI показывает источник, цель и затронутые файлы, затем запускает integrate и resolve.

### Ветки (Streams)

Stream остаётся официальным термином во вторичной подписи. Переключение stream учитывает связанный workspace; UI не обещает «переключить ветку» как в Git, если операция требует создать или изменить client spec.

## 8. UI-архитектура

Детальная структура экранов, interaction flows, visual language и UX acceptance criteria определены в актуальном [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md). Этот раздел фиксирует только архитектурные границы UI.

Пользовательские строки загружаются из внешних `locales/<code>.json`; формат и порядок поиска описаны в актуальном [`../LOCALIZATION.md`](../LOCALIZATION.md). `shared/i18n.tsx` содержит только context, типизированные ключи и английский fallback. Backend валидирует полноту language packs и возвращает стабильный `ErrorKind`, а пользовательский текст ошибки выбирается frontend на текущем языке. Техническая диагностика не локализуется.

Основной desktop layout:

```text
┌ sidebar ─────┬ main workspace ─────────────────┬ details ────┐
│ Workspace    │ tree / changes / history        │ selection   │
│ Changes      │                                  │ preview     │
│ History      │                                  │ actions     │
│ Streams      │                                  │             │
├──────────────┴──────────────────────────────────┴─────────────┤
│ operations: progress, warnings, cancel                       │
└──────────────────────────────────────────────────────────────┘
```

- Один основной контекст на экране; детали выбранного объекта справа.
- Основные действия доступны рядом с объектом и через command palette; destructive actions требуют понятного preview/confirmation.
- Состояния loading, empty, permission denied, offline и partial result проектируются вместе с happy path.
- Клавиатурная навигация, focus states, семантические элементы и контраст являются базовыми требованиями.
- `CommandPalette` предоставляет `Ctrl/Cmd+K` для навигации по основным экранам и фокуса Global Go To; feature actions остаются в своих доменных контекстах.
- Цвет не используется как единственный признак статуса файла.

`shared/View.tsx` задаёт общий словарь ресурсных экранов: page heading, error/notice, empty state и modal/action dialog. Workspace, Changes, History, Depot, Shelves, Jobs и Labels следуют одному потоку «выбрать строку → увидеть постоянный inspector → запустить preview/action». Основные команды располагаются в page header или inspector; альтернативные context menu остаются только там, где ускоряют плотную работу со списком. Browser-native `prompt` и `confirm` не используются: подтверждения имеют одинаковое поведение, блокируют повторный запуск во время mutation и закрываются по Escape только в безопасном состоянии.

Длительные submit/sync не имеют собственного progress/cancel UI внутри feature. Feature регистрирует наблюдатель до запуска Tauri-команды, обновляет server snapshot после terminal event, а отображение, cancel и допустимый retry принадлежат только app-level Operations Center. Это исключает два конкурирующих источника состояния одной операции.

На старте достаточно React state и небольших feature hooks. Глобальный state manager и query library добавляются только когда ручная синхронизация между несколькими живыми экранами стала реальной проблемой. Для больших деревьев виртуализация добавляется после измерения, но API списка проектируется с возможностью инкрементальной выдачи.

Для `changes` ответственность разделена так:

- `ChangesView.tsx` связывает пользовательские сценарии и доменные команды, но не владеет механизмом загрузки, selection или browser DnD;
- `useChangesData.ts` владеет server snapshot, lazy shelf loading, refresh после мутаций и refresh-on-focus;
- `useFileSelection.ts` обеспечивает единый single/toggle/range selection для opened и shelved files и удаляет устаревшие selections после refresh;
- `ChangesView.tsx` открывает контекстное меню также с focused row через системную клавишу `ContextMenu` или `Shift+F10`, используя bounds элемента вместо pointer coordinates;
- `useChangeDragDrop.ts` является browser DnD boundary; `changes.ts` содержит чистую матрицу допустимых drop-действий;
- `ChangeComponents.tsx` содержит только специфичные для changes submit dialog и context menu; общий page/dialog/empty/error vocabulary находится в `shared/View.tsx`;
- все мутации завершаются одним `refreshData`, поэтому списки changelists, opened files и shelves получают согласованный server snapshot.

`ShelvesView` — отдельный read/unshelve slice для server-side shelves: он загружает bounded shelf list, files выбранного shelf и pending targets, требует `preview_unshelve` перед apply. Local conflicts по умолчанию Skip; для каждого конфликтующего файла пользователь может явно выбрать Overwrite, после чего backend разделяет normal batch и `-f` batch. Не выбранные конфликтные paths исключаются из apply. Если normal batch успешен, а force batch неуспешен, backend возвращает `partial_result` с явным описанием уже применённой части. Один выбранный shelved file можно экспортировать без unshelve через `p4 print path@=change`; destination обязана быть новой.

Для `workspace` добавлен отдельный вертикальный slice: `WorkspaceView` запрашивает scoped `fstat`, хранит только локальный selection, выполняет batch edit/add/delete/lock/unlock через узкие Tauri-команды и поддерживает локальный поиск/status filters и Tree/List группировку по depot-папкам для server-backed DTO. Фильтр `untracked` по запросу пользователя объединяет `fstat` с read-only `reconcile -n` и добавляет только кандидатов `add` с локальным путём, не меняя workspace state. Sync разделён на `preview_sync` и `sync_workspace`; preview дополнительно проверяет `p4 diff -sa/-se`, показывает локально изменённые файлы и требует явного acknowledgement перед запуском. Get Revision использует тот же preview/apply контракт с безопасным depot scope `path#revision`. Отдельный child process сообщает progress/cancel events. Reconcile разделён на `preview_reconcile` (`p4 reconcile -n`) и guarded apply выбранного subset через `reconcile -c`: перед mutation каждый выбранный path повторно проверяется, а исчезнувший candidate возвращает `Stale` без запуска apply. Одно выбранное workspace file теперь имеет Copy depot/local path и Windows-only Reveal in Explorer через узкий `reveal_path`, который валидирует path и запускает только `explorer.exe` без shell. На текущем этапе virtualization и lazy server tree остаются следующими расширениями.

Для `depot` добавлен read-only scoped browser: отдельные `p4 dirs` и `p4 files -m` возвращают каталоги и head metadata без чтения содержимого и без мутаций. UI преобразует пользовательский scope в безопасные patterns для каталогов (`*`) и файлов (`...`), автоматически загружает выбранный каталог, показывает breadcrumbs/up-навигацию и по умолчанию добавляет `p4 files -e`; явный include deleted/archived toggle снимает этот фильтр. Клик по файлу открывает bounded `filelog` inspector с безопасным `print -q path#rev` preview, без mapping и без мутаций. Lazy server tree остаётся следующим расширением.

Для `history` добавлен read-only slice: `HistoryView` запрашивает `filelog` с bounded limit до 5000 и Load more, показывает server revisions, выполняет text preview или безопасный Save revision as через `print -q path#rev`, `diff2` выбранных revisions или отдельное сравнение revision с предыдущей. Submitted change details также имеют lazy `describe -s` с jobs и per-file `diff2` для numeric revision pairs; submitted history поддерживает exact job filter через bounded `fixes -j` + scoped `changes`, а локальные user/client/description filters применяются поверх результата. Changes/History могут передать `-db`, `-dw` или `-dl` для явного comparison mode. Preview не меняет have/workspace state. Rollback и annotate остаются отдельными действиями с собственным preview-контрактом.
Binary ответы diff/print помечаются backend и не рендерятся как повреждённый текст: viewer показывает безопасное состояние, а сохранение revision остаётся отдельным способом получить payload.

History также имеет submitted-changes режим: scoped `p4 changes -s submitted -l -t -m N` возвращает список changelists, UI позволяет явно загружать следующие порции до безопасного лимита 5000, а `describe -s` вызывается только для выбранного CL. UI поддерживает локальный поиск по номеру/user/client/description и user/client filters. Для выбранного submitted CL доступен явный `p4 undo -n @change` preview и `p4 undo -c target @change` apply; cursor/server filters и rollback ranges пока не входят в slice.

Submit перед mutation выполняет отдельный `submit_preflight`: opened files changelist перечитываются через `fstat`, а missing local path, unresolved, pending resolve, out-of-date и active other-open/lock records показываются полным списком. Для pending resolve дополнительно вызывается scoped `p4 resolve -n`; автоматический resolve не выполняется. Preflight также получает до 100 связанных jobs через `p4 fixes -c`, включая доступные status/user/date, с fallback на ID для старых ответов. Наличие обычных issues требует второго явного submit-подтверждения; unresolved-файлы блокируют submit и локальные shelf+submit варианты, при этом обычное shelving остаётся доступным. Preflight сам не меняет server/workspace state.
Для unresolved workspace files добавлен preview/apply контракт: выбранные paths сначала проходят `resolve -n`, UI показывает server candidates и только после второго подтверждения вызывает safe batch action `resolve -ay` (сохранить workspace content) или `resolve -at` (принять incoming server content). Full three-way editor и auto-resolve остаются отдельным scope.

Logout — отдельная подтверждаемая команда `p4 logout`; `Exit workspace` только покидает UI-сессию и не отзывает ticket. Connection screen также показывает локальные SSL fingerprints через read-only `p4 trust -l`; приложение не устанавливает и не удаляет trust автоматически.

Revert selected, unchanged и full changelist используют серверный двухшаговый контракт: `preview_revert_selected` вызывает `p4 revert -n -c change paths`, `preview_revert_unchanged` — `p4 revert -n -a -c`, а `preview_revert_all` — `p4 revert -n -c`; UI показывает paths, затем применяет только подтверждённые preview paths. Пустой preview не может быть подтверждён как mutation.

## 9. Безопасность и сохранность данных

- Никакой shell-конкатенации и произвольного запуска команд из frontend.
- Tauri capabilities дают окну минимально необходимые разрешения.
- Пароли, tickets и environment не попадают в application log или telemetry.
- Мутации показывают точный scope до запуска: workspace, changelist, файлы, источник и цель.
- Submit, revert, undo, integrate и resolve получают тесты на ошибки и частичный результат.
- При неизвестном состоянии после прерывания UI перечитывает данные с сервера, а не предполагает rollback.
- Настройки записываются через временный файл и atomic replace; повреждённый JSON не затирается молча.

## 10. Тестирование

Минимальная пирамида:

1. Rust unit tests для JSON Lines, ошибок процесса и построения аргументов.
2. Frontend tests только для нетривиального преобразования/поведения; визуальная статика проверяется вручную в story/demo screen до появления необходимости в отдельном Storybook.
3. Integration tests через fake executable, который пишет контролируемые stdout/stderr и exit codes. Это проверяет process boundary без живого сервера.
4. Небольшой набор ручных smoke-сценариев против тестового Helix Core: login, opened, reopen, sync, submit, cancel.

Реальный сервер не должен быть обязательным для обычного `cargo test`/`npm test`.

## 11. Порядок реализации

Актуальный приоритетный backlog находится в [`../P4_FEATURE_CHECKLIST.md`](../P4_FEATURE_CHECKLIST.md).

Текущее состояние: вертикали подключения и основного pending changelist workflow реализованы сквозным сценарием. Последний успешно открытый workspace автоматически восстанавливается при следующем запуске после проверки подключения и ticket; ручное открытие не требует отдельного предварительного Test, а Exit workspace возвращает к форме, не удаляя профиль. В workspace пользователь видит Default и numbered changelists, а внутри выбранного CL — независимые списки local opened и shelved files. Доступны local/shelf diff, edit/delete пустого CL, reopen, выборочные и полные shelve/unshelve/delete shelf, lock/unlock, revert выбранного local-файла, full changelist revert с server preview и drag-and-drop с реальными командами. Submit явно разрешает конфликт local+shelf тремя стратегиями с recovery/compensation; обычный local submit запускается как отдельная cancellable child-process operation с progress events, а при ошибке backend выполняет best-effort read-back pending/submitted/unknown и frontend перечитывает Changes. Shelf-preserving submit modes сохраняют awaited compensation workflow. Экран перечитывает состояние при возврате фокуса и после каждой мутации. Детальный контракт и оставшиеся расширенные действия находятся в `CHANGELIST_REQUIREMENTS.md`. Для Sync и local submit используется operation slice: отдельный child process, operation id, operation kind, started/progress/completed/failed/cancelled events и cancel только собственного процесса; feature наблюдает terminal event для refresh, а App-level Operations Center является единственным progress/cancel surface и агрегирует до 30 событий.

Operations Center также сохраняет bounded retry metadata для sync: failed/cancelled sync можно повторить только после явного подтверждения пользователя через текущую connection. Submit event не retryable, поскольку повтор mutation требует нового submit review.

`ShelvesView` также поддерживает explicit server-to-server copy выбранных shelved files в существующий target changelist через `p4 reshelve -s -c`; source shelf и workspace остаются неизменными.

Changes sidebar имеет локальный bounded filter по ID, description, user и client/workspace. Текущий selected changelist принудительно остаётся в списке при фильтрации, поэтому ввод запроса не меняет контекст и не вызывает server request.

### Вертикаль 1 — подключение и открытые файлы

Поиск `p4`, версия, настройки connection, `info`, `opened`, pending changes, `reopen`. Это проверяет весь архитектурный путь и обработку ошибок.

### Вертикаль 2 — рабочая область

Дерево и статус, sync с прогрессом/отменой, edit/add/delete/revert.

### Вертикаль 3 — changelist workflow

Создание/редактирование, drag-and-drop через reopen, diff, submit preview и submit.

### Вертикаль 4 — история и откат

Submitted changes, filelog, diff2, get revision, `undo` как отдельная безопасная операция.

### Вертикаль 5 — интеграции и streams

Streams/workspace mapping, integrate preview, merge/cherry-pick, resolve workflow.

Reconcile, full resolve/merge editor, jobs, labels и расширенный поиск добавляются после устойчивости базовых вертикалей. Базовые selected-file locks и explicit `resolve -ay/-at` уже входят в Workspace vertical; базовый shelf workflow уже входит в вертикаль changelist.

## 12. Сознательно не добавляем сейчас

- C++ P4API/FFI и REST transport;
- локальную базу данных и фоновую индексацию;
- Redux/Zustand и универсальный event bus;
- plugin system и публичный SDK;
- несколько Rust crates и DI-контейнер;
- собственный parser client view;
- поставку `p4` внутри инсталлятора до юридической проверки.

Эти решения пересматриваются только по конкретному ограничению рабочего сценария или измерению производительности.

Workspace single-file rename принимает явный depot destination и выполняет read-only `p4 move -n` перед `p4 move -c`; invalid target не запускает mutation. Header также имеет bounded Global Go To classifier: `//...` открывает scoped Depot Browser, `ws://...` — Workspace, numeric/`#N` — выбранный pending changelist, `job:...` — Jobs, `label:...` — Labels; неизвестные targets не запускают CLI.

Jobs browser использует bounded `p4 jobs -l -m` и передаёт непустой search как один `-e` argument; выбранный job запрашивает bounded `p4 fixes -j` inspector. Labels browser аналогично использует `p4 labels -t -m` с case-insensitive `-E`. UI показывает только server metadata и локально фильтрует уже загруженные bounded results; создание и редактирование остаётся отдельным slice.
