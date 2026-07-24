# Архитектура P4FNV

Этот документ фиксирует устойчивые технические границы. Текущая готовность функций находится в [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md), UI-контракт — в [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md).

## Стек и поток вызова

- Windows desktop: Tauri 2.
- Frontend: React, TypeScript, Vite и обычный CSS.
- Backend: Rust stable MSVC.
- Helix Core: установленный пользователем `p4` CLI.
- Настройки: небольшой JSON в app config directory; секреты не сохраняются.

```text
React feature
  -> typed wrapper in src/shared/api.ts
  -> allow-listed Tauri command
  -> validated Rust domain operation
  -> src-tauri/src/p4/runner.rs
  -> p4 CLI
  -> Helix Core Server
```

Helix Core Server остаётся источником истины. Приложение не воспроизводит permissions, client mapping, integration history или changelist state собственным локальным индексом.

## Ответственность слоёв

Frontend:

- показывает server DTO, selection, формы, preview, progress и ошибки;
- хранит только состояние текущего экрана;
- перечитывает затронутые данные после mutation и при возврате фокуса;
- не строит аргументы `p4`, не хранит пароль и не интерпретирует сырой stderr.
- может хранить косметические списки Unactual в `localStorage`, а крупный read-only cache Files — в памяти/IndexedDB, scoped по server/user/workspace/scope; большие file arrays не проходят через синхронный `localStorage`. Disk snapshot определяет состав Local Files, а cached Perforce info инвалидируется changelist fingerprint.

Rust backend:

- валидирует changelist IDs, revision specs и пути;
- строит аргументы конкретной разрешённой операции;
- применяет connection environment только к дочернему процессу;
- преобразует CLI records в стабильные DTO и `AppError`;
- владеет child processes, cancellation, settings и безопасной записью файлов.

`p4` и сервер:

- выполняют аутентификацию, trust, permissions и mutations;
- разрешают client view, streams, topology и server-side race conditions;
- являются окончательной проверкой после любого preview.

## Process boundary

`src-tauri/src/p4/runner.rs` — единственная низкоуровневая точка запуска `p4`.

- Процесс запускается напрямую через `Command`; shell не используется.
- Аргументы передаются отдельными значениями.
- Для стабильного structured output используются `-ztag -Mj`; stdout читается как JSON Lines, не как один массив.
- Частое действие Update сразу запускает `p4 sync -s`: safe sync скачивает обычные файлы и пропускает локальные файлы, которые нельзя безопасно перезаписать. После завершения CLI, но до terminal event, приложение получает оставшийся incoming set через `p4 sync -n` и проверяет его одним `p4 diff -f -sa` через валидированный `p4 -x -` stdin. `-f` здесь разрешает read-only сравнение как opened, так и unopened client files и не означает overwrite. Если mapped-файл существует локально, но ещё не имеет `haveRev`, ожидаемый ответ `generic=17 / severity=2 / file(s) not on client` не попадает в warning-log; совпадающие файлы сначала восстанавливаются через `p4 reconcile -k`. Оставшиеся read-only файлы восстанавливаются независимо от safe sync. При явно выбранном `Overwrite from depot` backend до `p4 sync -f` фиксирует server-backed snapshot точных `depotFile#rev` и локальных путей, потому что неуспешный sync может оптимистично изменить have-list. После force-sync каждый выбранный snapshot-item безусловно проходит `p4 print -o` во временный файл рядом с целью, проверку warning-record, атомарную замену с атрибутами скачанного файла и `p4 flush -f depotFile#rev`; depot-deletion удаляет локальный файл и получает `flush #none`. Новое пустое `sync -n` само по себе не считается доказательством замены. Для профилей `utf8`/`utf8-bom` print получает content/command-line override `utf8unchecked`/`utf8unchecked-bom`, который имеет приоритет над P4CONFIG/P4ENVIRO; сохранённый профиль не меняется. Ошибка одного файла не останавливает восстановление остальных, временный файл всегда очищается, а ошибка flush оставляет уже загруженное содержимое для следующего `reconcile -k`. Force-operation считается успешной только при успешном применении всего snapshot и пустом финальном `p4 sync -n`; writable-файлы без явного Overwrite не входят в автоматический safe-recovery. Для остальных конфликтов UI предлагает `Keep` или `Overwrite`; completed-result закрывает dialog, а любая ошибка сохраняет весь явно выбранный набор для безопасного идемпотентного retry и не доверяет одному только have-list. Полный `//...` disk diff не запускается.
- Все frontend-точки получения файлов — Update в Files/My Changes, scoped sync из Depot, sync по Label и `Download now` после смены stream — проходят один `useSafeSync` post-check и один диалог разрешения writable-конфликтов. IPC принимает только массив scopes; отдельного короткого blocking sync-пути нет.
- Form workflows (`change/client/stream/label -o/-i`) обрабатываются как текстовые формы и не обязаны возвращать JSON.
- stdout, stderr, exit code и warning/error records обрабатываются раздельно.
- Password передаётся только через stdin; tickets, password и полный environment не логируются.
- Frontend не получает универсальную команду вида `run_p4(command)` и не выбирает executable для отдельной операции.

`AppError.kind` должен различать как минимум auth, trust, permission, conflict, offline, cancelled, stale, partial result, invalid output и command failure. Обычный отказ операции не называется ошибкой подключения.

`p4 filelog -Mj` возвращает ревизии как индексированные поля (`rev0`, `change0`, `how0,0`), поэтому history parser разворачивает каждый индекс в отдельный `FileRevision`; плоские records также поддерживаются для совместимости и unit fixtures.

## Короткие и длительные операции

Короткие read-запросы возвращают DTO обычной Tauri command. Длительные sync/submit и будущие integrate/large transfer используют один протокол:

1. Frontend подписывается на operation events до запуска команды.
2. `start_*` создаёт отдельный child process и возвращает `operation_id`.
3. Backend публикует `started`, `progress`, `warning`, `completed`, `failed` или `cancelled`; sync progress дополнительно несёт `totalFileCount`, `totalFileSize` и накопленный `fileSize` из tagged output выполняющегося sync, без отдельного blocking preflight.
4. App-level Operations Center является единственным progress/cancel/retry surface; retry sync сохраняет исходный массив file/folder scopes без склейки в один filespec. Backend не запускает второй sync, пока первый не завершился terminal event.
5. `cancel_operation(id)` отправляет сигнал выделенному waiter-каналу соответствующей операции. Waiter опрашивает `Child::try_wait`, по сигналу вызывает `Child::kill` и `wait`, после чего публикует terminal `cancelled`; блокирующий `Child::wait` не удерживает mutex, нужный отмене.
6. После terminal event handle удаляется, а feature перечитывает server state.

Cancel не означает rollback. Retry mutation разрешён только как новый явно подтверждённый workflow после read-back; submit/integrate не повторяются автоматически при неизвестном результате.

## Данные и безопасность mutations

`depot_path`, `client_path`, `local_path` и `revision` — разные поля моделей. Отображённый путь с `U+FFFD` после невалидного UTF-8 нельзя использовать как mutation identifier без безопасного round trip.

Для mutation обязательны:

- точный workspace/source/target/scope до запуска;
- server-backed preview для destructive, overwrite, sync-risk, submit, undo, integrate и resolve flows;
- безопасный default: Skip/Cancel без неявного `-f`;
- batch CLI invocation для выбранного набора, если команда это поддерживает;
- явная compensation и честный `partial_result` для составной операции;
- refresh после success, failure и cancellation, если server state мог измениться.

Нельзя автоматически доверять SSL fingerprint, перезаписывать untracked/writable file, изменять protections или выполнять admin force flags из обычного UI.

Локальные filesystem mutations разрешены только узкими backend-операциями. Backend получает client root через `p4 info`, canonicalize-ит root и выбранный файл, проверяет принадлежность файла root и только затем удаляет точный файл либо дописывает точное относительное правило в корневой `.p4ignore`. Frontend не получает общий filesystem API.

Переключение stream — составная операция с явной стратегией. Каталог читается bounded-командой `p4 streams`; вариант Keep использует безопасно сформированный `p4 client -s -f -S`, не трогая содержимое workspace, а вариант Shelve сначала сохраняет и ревертит numbered changelists и затем использует `p4 switch --no-sync` для Default work. Последующий sync запускается отдельно через существующий preview/operation protocol, поэтому ошибка sync не маскирует уже выполненную смену stream.

## Frontend и UI state

- Feature-код владеет загрузкой, selection и mutation orchestration своей области.
- Общие DTO/API/i18n/operations/UI primitives находятся в `src/shared` только при использовании несколькими features.
- List/tree selection использует общие single/Ctrl-toggle/Shift-range правила; context menu сам владеет dismissal, безопасным positioning и клавиатурной навигацией.
- My Changes и Streams используют один scoped hook хранения/очистки Unactual IDs и один валидируемый DnD transport; доменное каскадирование stream-поддерева остаётся в Streams.
- Resource screens используют `View` и стабильный list/inspector layout по образцу MyChanges.
- Browser-native `prompt`/`confirm` не используются; общий dialog блокирует повторный submit и безопасно обрабатывает Escape.
- Global state manager, query library, database, filesystem watcher и virtualization добавляются только после измеренной необходимости.

HTML5 drag-and-drop требует `app.windows[].dragDropEnabled = false` в `src-tauri/tauri.conf.json`; нативный Tauri file-drop иначе перехватывает события WebView2. DnD всегда имеет button/context-menu эквивалент. Reopen и косметический перенос в/из Unactual — move, shelve/unshelve — copy. Оба feature используют общий валидируемый archive payload и синхронный in-memory fallback для WebView2; payload не вызывает Perforce mutation.

## Opt-in UI diagnostics and agent bridge

Низкоуровневый transport нативной диагностики включается абсолютным путём в `P4FNV_UI_SNAPSHOT_PATH`. Основной агентный workflow управляет этим transport через project-scoped MCP; ручной запуск с одной snapshot-переменной остаётся read-only fallback для диагностики bridge. Только в opt-in режиме frontend наблюдает изменения DOM/form state и viewport и через allow-listed Tauri command атомарно обновляет JSON-файл. Snapshot содержит timestamp, URL, viewport, активный элемент, текущие значения form controls и санитизированный `body.outerHTML`; значения password inputs заменяются на `[redacted]`, а `value` attributes удаляются из HTML-копии. Размер ограничен 8 MiB.

Механизм не открывает HTTP-порт, не принимает путь от frontend и полностью выключен без environment variable. Snapshot событийный: приостановленный WebView не обновляет timestamp, но его DOM при этом также не меняется. Это диагностический read-only канал состояния UI, а не общий filesystem API и не способ управлять приложением.

Для локальной агентной разработки отдельный STDIO MCP-процесс может запустить release с дополнительными `P4FNV_AGENT_COMMAND_PATH`, `P4FNV_AGENT_RESPONSE_PATH` и случайным `P4FNV_AGENT_TOKEN`. Только когда одновременно настроен snapshot и все три agent-параметра, frontend опрашивает точный command-файл через allow-listed Tauri command. Rust принимает максимум 64 KiB, проверяет session token, request ID, ожидаемую версию DOM и allow-list `ui.click`/`ui.input`/`ui.key`/`ui.focus`; произвольные selector, JavaScript, Tauri invoke, filesystem, shell и `p4` command отсутствуют.

Snapshot schema v2 добавляет монотонный `stateVersion`, `settled`/`busy` и структурированный список interactive elements. Явный `data-agent-id` или HTML `id` даёт стабильный locator; остальные элементы получают индексный locator, допустимый только с той же `stateVersion`. Frontend выполняет действие над реальным DOM element и отправляет обычные click/input/change/keyboard events, поэтому существующий React handler, preview, dialog, Tauri IPC и refresh остаются единственным production-маршрутом. Agent response записывается атомарно и не содержит form value. Password по-прежнему редактируется в structured snapshot и отсутствует в HTML-копии.

MCP владеет только процессом P4FNV, который сам запустил, и временным каталогом своей сессии. `app_stop` не ищет и не завершает другие процессы. На текущем Windows WebView2 полностью hidden/offscreen/background window приостанавливает JavaScript даже с diagnostic Chromium flags, поэтому native agent session требует `visible: true`; `visible: false` отклоняется до запуска. Сервер всё равно самостоятельно управляет lifecycle, а обычное окно обеспечивает честную проверку focus, drag-and-drop, scaling и WebView-specific поведения. Текущий bridge не подменяет Helix Core и не разрешает mutation без существующего UI preview/confirmation.

## Settings и локализация

- Settings записываются через temporary file и atomic replace; повреждённый JSON не затирается молча.
- Косметические Unactual IDs и scoped-настройки представления Streams хранятся браузерным `localStorage` отдельно от settings и никогда не отправляются серверу.
- Unactual IDs нельзя очищать, пока соответствующий pending/stream snapshot ещё loading/error: stale cleanup разрешён только после успешного server read.
- После успешного `open_workspace` backend запоминает авторизованный client root для активного server/user. Узкая команда Local Files принимает client directory, проверяет префикс текущего workspace, собирает локальный путь только из безопасных компонентов, canonicalize-ит его внутри root и читает ровно один уровень. Symlink не обходятся; недоступная вложенная папка считается пустой для текущего чтения.
- Ignored-состояние Local Files определяется совместимым с однопутевыми версиями CLI вызовом `p4 ignores -i` для каждого непосредственного файла. Если в root workspace есть `.p4ignore`, Files явно передаёт его абсолютным `P4IGNORE`, чтобы корневой проектный файл имел приоритет над неявным поиском defaults; синтаксис и исключения всё равно интерпретирует сам `p4`. Для каталога проверяется несуществующий безопасный child-path: сам каталог не считается filepath, тогда как пробный child отражает правило, применяемое к содержимому. Результат передаётся отдельно для файлов и каталогов.
- Local Files загружает root при входе, а дочерний каталог — только при первом раскрытии. Для каждого каталога IndexedDB отдельно хранит непосредственные подпапки, disk files, cached Perforce records и changelist fingerprint по ключу server/user/workspace/directory. Кеш показывается сразу, после чего перечитывается только выбранный каталог. Perforce status обновляется нерекурсивным `p4 fstat -Rc -Ol //client/path/*` лишь при изменившемся fingerprint из последнего submitted changelist, pending changes и `opened -C`; `*` не пересекает границу каталога. Ожидаемый `generic=17 / severity=2` для каталога без совпавших depot-файлов или history отсутствующего client file считается пустым read-result и не попадает в warning-log; остальные warning/error records сохраняются. Явный Refresh перечитывает только уже загруженные каталоги. Полный reconcile preview для untracked/ignored запускается отдельно по явному намерению пользователя. Merge выполняется по case-insensitive local/client path с нормализацией Windows `\\?\` prefix; совпавший `fstat` record считается mapped даже при отсутствии отдельного поля `path`. History запрашивается только после завершённого статуса для tracked/mapped файла.
- Local Files остаётся смонтированным на время workspace-сессии, когда пользователь переходит в другие разделы или переключается на Depot Files: загруженное дерево, in-flight directory request и in-memory index сохраняются, а возврат не создаёт дубликат запроса.
- Connection profile содержит только executable, port, user, client, charset и явные config paths.
- Все пользовательские строки существуют в полных `locales/en.json` и `locales/ru.json`.
- Дополнительные полные JSON packs загружаются рядом с shipping executable или из app config directory; подробности — в [`LOCALIZATION.md`](LOCALIZATION.md).

## Проверка изменений

- Rust unit tests: validation, argument builders, JSON/form parsers, error classification и compensation state.
- Frontend tests: только нетривиальная pure/state logic.
- Fake executable или disposable test server: process boundary и integration paths.
- Live-server smoke не выполняется на пользовательском сервере без явного разрешения.
- UI-изменения проверяются на RU/EN, empty/loading/error, длинных путях, keyboard-only и 100/125/200% scale.

Полный локальный gate и release-команды находятся в [`TOOLCHAIN.md`](TOOLCHAIN.md).

## Не добавлять без доказанной необходимости

- универсальный Perforce SDK/transport, C++ P4API FFI или REST layer;
- shell console из frontend;
- локальную БД и фоновую индексацию;
- plugin SDK, DI container, event bus или несколько crates;
- собственный parser client view;
- зависимость или abstraction с единственным потребителем.
