# UI/UX-контракт P4FNV

Этот документ содержит только правила реализации и приёмки. Конкурентный анализ, исходные wireframes, narrative flows и источники сохранены в [`research/UI_UX_RESEARCH.md`](research/UI_UX_RESEARCH.md).

## Базовая модель

P4FNV показывает намерение и последствия, а не набор флагов CLI. Основной flow любой сложной операции:

1. Выбрать объект или scope.
2. Получить server-backed preview.
3. Показать source, target, affected items и риск.
4. Запустить действие кнопкой с конкретным результатом.
5. Для длительной операции закрыть dialog и передать progress/cancel в Operations Center.
6. После terminal result перечитать server state.

Не создавать staging area, ложный Git commit graph или универсальное действие Undo. Get Revision изменяет workspace content; `p4 undo` создаёт новые opened changes — это разные команды.

## Каркас приложения

Постоянный shell:

- header: user, workspace, понятный по placeholder и tooltip быстрый переход, language, Sign out и Close workspace;
- sidebar имеет компактное состояние по умолчанию, раскрытое состояние с подписями и полностью скрытое состояние;
- порядок sidebar: Files, My Changes, Streams, разделитель, Shelves, Jobs;
- main surface: текущий resource screen;
- bottom-right: Operations Center и CLI diagnostics без перекрытия;
- command palette: навигация и фокус быстрого перехода, но не скрытое место для всех feature actions.

Контекст server/user/workspace должен оставаться доступным. Смена workspace — явное действие; Close workspace возвращает к подключениям без logout и явно отличается от Sign out, отзывающего текущий p4 ticket.

## Resource screen

MyChanges — эталон структуры:

```text
page heading + view-level actions
compact search/filter toolbar
list/tree | persistent inspector
```

- Header содержит только действия всего view: Refresh, New, Preview Sync и подобные.
- Toolbar содержит search, scope, filters, sort и view mode.
- Selection меняет inspector без перехода на псевдоэкран и без layout jump.
- Inspector содержит metadata, preview и действия выбранного объекта.
- Primary action существует в одном основном месте. Context menu — ускоритель, а не единственный путь.
- Empty/loading/error/permission/stale/partial states занимают ту же структуру, что и данные.

На узком окне panes могут складываться или inspector может стать drawer, но action и полный path не должны исчезать. Минимальный размер окна задаётся Tauri config и проверяется при visual QA.

## Экранные контракты

| Экран | Основной список | Inspector / главное действие |
|---|---|---|
| Connection | recent/favorite profiles и форма | detect/test/login/open workspace; password только in-memory |
| Files / Local files | scoped workspace file tree, status filters | paths/status/size/changelist/history; sync/edit/add/ignore/delete/revert |
| Files / Depot files | directories, depot files и неактивные local-only entries | bounded folder/file history и preview sync |
| My Changes | pending changelists, opened и shelved sections | diff, reopen, shelve, unshelve, revert, submit |
| Streams | stream tree с visibility и Unactual | parent/child graph и безопасное переключение stream |
| History | file revisions или submitted changes | preview/compare/export/annotate/undo |
| Shelves | server shelves | files, target changelist, unshelve/reshelve/export |
| Jobs | bounded jobs | fixes, explicit attach/detach |
| Labels | bounded labels | metadata/files и sync preview |

History и Labels остаются доступны через быстрый переход/command palette, но не занимают место в основной панели. Integration и full Resolve не появляются в navigation/actions до работающего backend flow.

### Files

- Верхний переключатель `Local files` / `Depot files` меняет источник внутри одного экрана, не создавая отдельный навигационный пункт.
- Local tree сразу показывает IndexedDB snapshot корневого каталога и перечитывает только этот уровень. Каждая вложенная папка остаётся раскрываемой и при первом раскрытии получает свой cached snapshot, компактный `aria-busy` spinner и фоновое чтение только непосредственных children. Пустые папки отображаются; незагруженная папка показывает многоточие вместо ложного нулевого count. В Local Files входят только существующие на диске файлы; server-only records не подмешиваются. Disk/status snapshots индексируются по server/user/workspace/directory и не сериализуются в `localStorage`. Перед нерекурсивным read-only `fstat //client/path/*` приложение получает fingerprint из последнего submitted changelist, pending changelists и opened-файлов workspace; пока fingerprint не изменился, cached status каталога не перечитывается. Тяжёлый reconcile-preview запускается только явной кнопкой Reconcile.
- Scope, поиск, status filter и смена tree/list находятся в сворачиваемом блоке «Поиск и фильтры». В закрытом состоянии блок сообщает, показан ли весь проект или используется настроенное представление; scope применяется явно кнопкой или Enter.
- File-type icon отделена от status markers; hover/focus title содержит полный путь, статус, размер и changelist.
- Игнорируемые файлы и каталоги окрашиваются приглушённо-оранжевым по результату `p4 ignores -i`; ветка также получает этот акцент, когда все отображаемые файлы внутри неё ignored. Depot files имеют синий акцент; local-only entries в depot mode остаются видимыми серыми и disabled.
- Выбор файла показывает bounded file history, выбор папки — bounded submitted history её scope. `Get selected files` использует batch preview sync и Operations Center.
- Явная кнопка `Update project` доступна из Files и My Changes и сразу запускает safe `p4 sync -s`, не задерживая большое обновление полным preview. В Files выбор конкретных файлов или одной/нескольких папок меняет действие на scoped `Update selected`; папки передаются одним batch как `folder/...`. Safe sync скачивает все неконфликтующие файлы и не перезаписывает локально изменённые writable-файлы. После основной загрузки bounded post-check восстанавливает совпадающие отсутствующие have-записи. Оставшиеся mapped read-only файлы автоматически загружаются как точные depot-ревизии через проверенный временный файл; writable-файлы не входят в автоматическое восстановление. Оставшиеся incoming paths одним dialog предлагают `Keep local` или destructive `Overwrite from depot`. Для выбранного Overwrite backend до batch `p4 sync -f` фиксирует точные depot-ревизии и локальные пути, затем безусловно загружает каждый snapshot-item, атомарно заменяет файл с depot-атрибутами и регистрирует revision в have-list. Диалог закрывается только после успешного применения всего snapshot и пустого read-back, иначе сохраняет реальный partial result.
- Depot `Get selected files`, sync по Label и download после смены stream используют тот же safe-sync post-check и тот же per-file `Keep`/`Overwrite` dialog; preview отличается scope, но не правилами защиты локальных файлов.
- Контекстное меню показывает только допустимые для текущего состояния edit/add/ignore/mark-delete/revert/delete-local actions. Локальное удаление всегда требует destructive confirmation.

### Unactual

- В My Changes numbered changelist можно локально перенести в сворачиваемую нижнюю секцию Unactual и вернуть обратно через context menu или drag-and-drop строки между секциями.
- Строки changelist поддерживают single, Ctrl/Cmd-toggle и Shift-range; перенос в/из Unactual применяется ко всей выбранной группе из той же секции.
- Если списки Actual и Unactual в My Changes или Streams не помещаются по высоте, колонка прокручивается целиком; секции сохраняют высоту содержимого и не перекрывают друг друга.
- В Streams та же классификация применяется к stream path; перенос доступен через context menu и drag-and-drop, включая выбранную группу stream одной секции. Объект остаётся полностью рабочим; меняется только его положение в UI.
- Drop-target секции занимает всю оставшуюся область Unactual. Архивирование родителя каскадирует на потомков; обычное восстановление возвращает только выбранные paths, а отдельные context-команды работают со всеми потомками.
- Состояние хранится локально по server/user/workspace, не меняет Helix Core и очищается для исчезнувших объектов. Default changelist не архивируется.

### Streams

- Левая pane показывает bounded parent/child tree и checkbox видимости; правая — граф только включённых streams. Текущий stream отмечен текстом, type — цветом и подписью.
- Дерево поддерживает single, Ctrl/Cmd-toggle и Shift-range multi-select. В верхней панели находятся `Показать выбранные` / `Скрыть выбранные`; `Показать все` и `Скрыть все` меняют весь набор. Checkbox stream внутри selection применяет действие ко всей selection. Выключение родителя каскадирует на поддерево, включение меняет только родителя; отдельные context-команды показывают или скрывают всех потомков. Частично видимое поддерево показывается indeterminate checkbox.
- Ветки с дочерними streams имеют отдельный caret и `aria-expanded`; свёрнутые дети исчезают только из дерева и range-selection order, не меняя visibility графа или selection state.
- Visibility графа, свёрнутые ветки и раскрытие секции Unactual сохраняются локально по server/user/workspace и восстанавливаются между сеансами.
- SVG сохраняет фиксированный максимальный размер узлов при малом числе streams; текущий stream выделен отдельной заливкой и рамкой помимо текстовой метки.
- Двойной клик, Enter или context menu открывают switch dialog. В нём независимо выбираются local strategy (`Shelve`/`Keep`) и content strategy (`Download now`/`Keep as is`).
- `Shelve` сохраняет и ревертит numbered changelists до switch; Default work обрабатывает `p4 switch`. `Keep` меняет client stream без немедленного изменения файлов. `Download now` после switch запускает preview sync и требует acknowledgment при writable modified files.
- После подтверждённого preview `Download now` передаёт scopes общему safe-sync controller. Изменение stream немедленно инвалидирует скрытое дерево Local Files, поэтому возврат в Files не показывает mapping предыдущего stream.

## Selection, keyboard и drag-and-drop

File lists поддерживают:

- click — single selection;
- Ctrl/Cmd+click — toggle;
- Shift+click — contiguous range;
- batch action над всей selection;
- сохранение существующих IDs после refresh и удаление stale selection.

Эти правила одинаковы для opened/shelved файлов в My Changes, файлов и папок workspace tree, changelist, Streams и файлов выбранного shelf. В workspace tree одна selection может одновременно содержать файлы и папки; отдельный всегда-toggle режим для похожего списка не используется.

Drag-and-drop всегда имеет button/context-menu эквивалент. Курсор отражает семантику: reopen и перенос в/из Unactual — move, shelve/unshelve — copy. Invalid/external payload игнорируется; Default Shelf и Default changelist в Unactual не принимают drop.

Обязательные keyboard paths:

- `Ctrl/Cmd+K` — command palette;
- `Ctrl/Cmd+L` — быстрый переход;
- `Ctrl/Cmd+1..5` — Files, My Changes, Streams, Shelves и Jobs;
- `ContextMenu` или `Shift+F10` — context menu focused row;
- `Escape` — закрыть безопасный modal/menu;
- Tab/Shift+Tab — предсказуемый focus order.

Ни одно действие не должно быть drag-only, hover-only или color-only.

## Dialogs и destructive actions

- Использовать shared `Modal`/`ActionDialog`; browser-native `prompt` и `confirm` запрещены.
- Заголовок и primary button называют итог: «Удалить shelf», «Отменить 8 файлов», а не «OK».
- Dialog показывает scope и последствия; опасный default не выбирается автоматически.
- Пока mutation выполняется, повторный submit и закрытие по Escape отключены.
- Force/overwrite включается отдельно для конкретных файлов; safe default — Skip/Cancel.
- Disabled control должен иметь видимую причину рядом или доступный tooltip/help text.

## Operations и feedback

Operations Center — единственный UI progress/cancel/retry для одной длительной операции. Feature не рисует дублирующий progress block.

После Cancel кнопка сразу переходит в disabled-состояние `Отмена…`. Backend прекращает соответствующий CLI-процесс и публикует terminal event; только после него UI показывает постоянный результат `Отменено`, снимает active-state и feature обновляет workspace. Панель ограничена доступной высотой окна, а список операций прокручивается внутри неё.

Пока sync активен, верхняя строка heading рядом с `WORKSPACE` показывает spinner, byte-based progress bar, обработанные/оставшиеся файлы, ETA и текущий файл. Строка занимает всю ширину до правого края поверх ряда title/actions; длинный путь не сужается шириной action-группы и не сдвигает её. Итоговые `totalFileCount`/`totalFileSize` берутся из tagged output уже запущенного `p4 sync`, поэтому отдельный preview не задерживает загрузку. После основной загрузки там же кратко показывается проверка оставшихся writable-конфликтов. Это глобальный индикатор; cancel/retry и полная диагностика остаются в Operations Center.

- Показывать operation kind, scope, status, processed count, current path и безопасную diagnostics summary.
- В Operations Center счётчики и ETA отделены от текущего path. Длинный path занимает до двух строк и полностью доступен через tooltip; длинная diagnostics прокручивается внутри карточки и не расширяет popup.
- Не выдумывать процент или ETA без server data.
- Cancel означает остановку process, а не rollback.
- Retry разрешён только для idempotent read/sync либо нового явно подтверждённого flow; sync повторяется с точным исходным набором file/folder scopes. Пока sync активен, остальные Update/Retry actions не запускают параллельный процесс.
- Success может быть transient toast; warning/error остаётся в bounded CLI log до просмотра/очистки.
- Ошибка отвечает: что не выполнено, почему, что безопасно сделать дальше. Если overwrite не подтверждён целиком, весь явно выбранный набор сохраняет решение Overwrite для безопасного идемпотентного retry: пустой have-list без подтверждённой физической замены не скрывает файл.

## Diff и preview

- Text diff: unified/split, line numbers, hunk navigation и явно видимый whitespace mode.
- Ограничение/truncation показывается пользователю; binary не декодируется как текст.
- Preview revision/shelf не меняет have/workspace state.
- Export пишет только в выбранный новый path без неявного overwrite.
- File, folder и changelist summary не притворяются одним text diff, если изменились разные типы объектов.

## Visual language

- Использовать tokens и существующие selectors в `src/app/app.css`; не добавлять локальную конкурирующую тему.
- Иерархия строится spacing, typography и borders; цвет только дополняет label/icon/status text.
- Controls компактные и стабильные; длинные paths сокращаются визуально, но доступны полностью через inspector/title/copy.
- Motion короткий и отключается при `prefers-reduced-motion`.
- RU и EN обязаны помещаться без отдельной разметки для языка.

### Size system

Единственный источник размеров — семантические CSS tokens в `src/index.css`. Feature-компоненты не создают собственную шкалу.

| Роль | Token / значение | Применение |
|---|---|---|
| Caption | 12/16 px | вторичная metadata, timestamps, hints |
| Body | 14/20 px | основной текст, строки списков и деревьев, поля и действия |
| Subtitle | 16/22 px | заголовки inspector/dialog/секций |
| Title | 20/28 px | заголовки resource screens |
| Display | 28/36 px | только крупный heading connection screen |
| Compact/default control | 32/36 px | toolbar/context controls и обычные формы |
| Single/two-line row | 44/52 px | строки с одним или двумя уровнями текста |

- Читаемый текст не меньше 12 px. Размер 10 px разрешён только коротким необязательным badges/status markers; он не используется для истории, путей, описаний, timestamps или действий.
- Spacing использует 4 px grid: 4, 8, 12, 16, 24, 32 px. Произвольное промежуточное значение допускается только для геометрического выравнивания иконки или hairline.
- Соседние pointer targets имеют размер не меньше 32 px; абсолютный accessibility floor — 24×24 CSS px.
- Файлы и папки внутри одного дерева являются вариантами одной строки: одинаковые row height, padding, primary/caption type, hover/focus/selection. Различаются disclosure, icon, status и допустимые действия.
- Плотность не создаётся уменьшением текста. Для длинного содержимого используются truncation с доступом к полному значению, wrapping, internal scroll или responsive stacking.
- История и diagnostics используют Body для смыслового содержимого и Caption для автора, changelist, времени и технических деталей.

Обоснование и аудит исходного состояния находятся в [`research/UI_STYLE_RESEARCH.md`](research/UI_STYLE_RESEARCH.md).

## Accessibility и производительность

- Семантические `button`, `input`, `label`, `table/list/tree` roles; visible focus.
- Selection, expanded, busy, error и operation result доступны assistive technology.
- Проверять keyboard-only, Windows Narrator для ключевых flows и scale 200%.
- Server queries всегда scoped/bounded. `//...` без limit, debounce/cancel или user intent запрещён.
- Большие списки получают pagination/incremental loading; virtualization добавляется после измерения и не должна ломать selection/accessibility.
- После 300 ms чтения показывать локальный loading state; длительная работа уходит в Operations Center.
- Resource workbench занимает всю доступную высоту окна; прокрутка длинного дерева или inspector происходит внутри соответствующей панели, а не сокращает экран до высоты содержимого.

## UI Definition of Done

- Flow работает через UI → Rust → `p4` → refresh, а не только визуально.
- Частое действие видно; редкое/destructive доступно через inspector/context menu с confirmation.
- Проверены loading, empty, long text/path, permission error, partial result и повторный refresh.
- Есть keyboard-equivalent и корректное focus restoration после dialog.
- Все новые строки присутствуют в полных EN/RU packs.
- Visual QA выполнен на RU/EN, 100/125/200%, минимальном окне и светлой/тёмной теме, когда темы поддерживаются.
