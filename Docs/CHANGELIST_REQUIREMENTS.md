# Требования к changelist и shelf

Статус документа: рабочий контракт продукта и реализации. Обновлено 2026-07-22.

## 1. Модель данных и обязательные состояния

Приложение не должно объединять локальные opened-файлы и shelved-файлы в один список. Shelf — серверный снимок, который продолжает существовать независимо от дальнейших правок или revert в workspace.

Для каждого pending changelist интерфейс обязан различать:

| Состояние | Локальные opened-файлы | Shelf | Основное действие |
|---|---:|---:|---|
| Пустой numbered changelist | 0 | 0 | Редактировать или удалить changelist |
| Только локальная работа | >0 | 0 | Submit local или создать shelf |
| Только shelf | 0 | >0 | Submit shelf или unshelve |
| Локальная работа и shelf | >0 | >0 | Явно выбрать версию для submit |
| Default changelist | 0..N | невозможен | Submit local; для shelf сначала создать numbered changelist |
| Чужой или restricted shelf | неизвестно | 0..N | Только действия, разрешённые сервером; ошибки прав не маскировать |

Одинаковый depot path в локальном списке и shelf также означает две версии. Они могут совпадать или отличаться.

## 2. Обязательная структура представления

- Список pending changelists выбранного workspace, включая Default.
- Явные признаки: номер, описание, количество локальных файлов, наличие shelf, дата.
- Внутри выбранного changelist — два самостоятельных раздела: `Opened files` и `Shelved files`.
- Shelf загружается лениво для выбранного changelist, чтобы не делать до 200 запросов `p4 files` при каждом refresh.
- Выбранный файл показывает depot path, action, revision, type и источник `LOCAL`/`SHELF`.
- Обновление при возврате фокуса и ручной Refresh обновляют локальный список, shelves и содержимое открытого shelf.
- Частые действия находятся в основном потоке. Редкие и разрушительные действия находятся в контекстном меню и всегда вызывают подтверждение.
- Заголовки `Opened files` и `Shelved files` имеют контекстное меню для операций сразу над всей секцией: select all, move/shelve/revert all или unshelve/delete shelf.
- Пустые, loading, permission denied, resolve required и out-of-date состояния должны быть отличимы друг от друга.
- Numbered changelist можно косметически перенести в сворачиваемую секцию `Unactual` и вернуть обратно через контекстное меню или drag-and-drop строки между актуальным списком и секцией. Это локальная классификация по server/user/workspace: changelist остаётся selectable/editable и не меняется на сервере; Default не draggable/не архивируется, stale IDs удаляются после refresh.
- Список changelist поддерживает single, Ctrl/Cmd-toggle и Shift-range. Drag-and-drop и перенос в/из `Unactual` применяются к выбранной группе одной секции; Default исключается из batch-переноса.

## 3. Полный каталог действий

### 3.1 Changelist

| Действие | Условия | UX | Статус |
|---|---|---|---|
| Создать numbered changelist | Есть подключение и описание | Основное действие | Реализовано |
| Изменить описание | Numbered pending, есть права владельца | Контекстное меню | Реализовано |
| Перенести в/из Unactual | Numbered pending | Контекстное меню или DnD между актуальным списком и локальной сворачиваемой секцией | Реализовано; server state не меняется |
| Удалить | Нет opened-файлов, shelf, jobs и stream spec | Контекстное меню + confirm | Реализовано; сервер проверяет инварианты |
| Переместить один локальный файл | Файл opened в текущем workspace | Drag-and-drop или inspector | Реализовано |
| Переместить несколько/все локальные файлы | То же | Multi-select / inspector / drag-and-drop | Реализовано |
| Shelve выбранные файлы | Numbered CL, файлы opened в нём | Drop в Shelf / context | Реализовано для multi-select |
| Shelve все / полностью обновить shelf | Есть локальные файлы | Контекстное меню + confirm | Реализовано через `p4 shelve -r` |
| Unshelve выбранные/все | Shelf доступен, target CL выбран | Drag-and-drop / context + target | Реализовано |
| Удалить выбранные/все shelved-копии | Пользователь владелец shelf | Контекстное меню + confirm | Реализовано |
| Submit local / shelf / конфликт | См. раздел 5 | Submit dialog | Реализовано |
| Revert выбранных локальных файлов | Файлы opened | Multi-select + server preview + destructive confirm | Реализовано; для `add` есть сохраняемая настройка удаления файла с диска |
| Revert unchanged / всего CL | Нужны выбор и preview | Context / selection | Реализовано для unchanged и всего CL |
| Resolve | Есть unresolved files | Отдельный preview/resolve workflow | Базовые keep workspace / accept server / auto modes реализованы в Workspace; full merge editor не закрыт |
| Lock / unlock | Тип/права допускают | Контекстное меню для selected/all opened | Реализовано |
| Связать/отвязать jobs | Job subsystem доступен | Jobs inspector | Реализовано через `p4 fix`; прямое редактирование из CL details не закрыто |
| Сменить owner/workspace | Есть права; важно для handoff | Контекстное меню | Следующий инкремент |
| Public/restricted | Есть права владельца | Edit dialog | Следующий инкремент |
| Promote shelf | Commit-edge topology | Advanced context | Показывать только после определения topology |
| Copy/reshelve в другой CL | Доступен shelf | Shelves inspector + confirm | Реализовано через `p4 reshelve -s -c` для выбранных файлов |
| Создать/обновить code review | Настроен P4 Code Review | Integration action | Не показывать без интеграции |

### 3.2 Локальный opened-файл

- Просмотреть diff local ↔ have revision — реализовано.
- Переместить один или несколько файлов в другой changelist — реализовано через multi-select, inspector и drag-and-drop.
- Shelve/update одного или нескольких выбранных файлов — реализовано.
- Revert одного или нескольких файлов с server-backed preview и предупреждением о потере несохранённой в shelf версии — реализовано. Для opened-for-add флаг удаления файла соответствует `p4 revert -w` и сохраняется в `settings.json`; без него файл остаётся на диске.
- Сравнить local ↔ shelf при наличии соответствующего shelved path — реализовано.
- History, annotate, time-lapse, open in file manager/editor — относятся к общему file workflow и должны переиспользовать будущие экраны, а не дублироваться внутри changelist.
- Resolve, accept yours/theirs/merge — нельзя сводить к одной опасной кнопке; необходимы preview и состояние unresolved.

### 3.3 Shelved-файл

- Просмотреть имя, depot path, action, revision и type — реализовано.
- Сравнить shelf ↔ depot head — реализовано.
- Сравнить local ↔ shelf — реализовано, когда локальная версия доступна в workspace.
- Unshelve одного или нескольких выбранных файлов в Default или numbered changelist — реализовано.
- Если shelved `add` конфликтует с существующим неотслеживаемым локальным файлом, preflight показывает сразу все коллизии. По умолчанию они пропускаются; для выделенного поднабора через ПКМ можно явно разрешить перезапись `p4 unshelve -f`.
- Удалить один или несколько выбранных файлов из shelf — реализовано с подтверждением.
- Просмотреть содержимое бинарного файла — общий viewer показывает безопасное binary state; полноценный metadata/image preview остаётся будущим расширением.
- Скачать shelved content без unshelve — реализован экспорт одного выбранного файла через `p4 print path@=change` только в новый output path; batch/native picker не закрыты.

## 4. Drag-and-drop

| Источник | Цель | Команда/семантика |
|---|---|---|
| Local file(s) | Другой changelist | `p4 reopen -c target files...` — перемещение всего выбранного набора |
| Local file(s) | Shelf текущего numbered CL | `p4 shelve -f -c change -Af files...` — создать/обновить копии |
| Local file(s) | Shelf другого numbered CL | Сначала batch `reopen`, затем batch `shelve`; при ошибке shelve приложение пытается вернуть весь набор в исходный CL |
| Shelved file(s) | Default/numbered changelist | `p4 unshelve -s source -c target -Af files...` — копирование, shelf сохраняется; перед выполнением проверяются конфликты shelved-add |
| Shelved file | Shelf | Нет неявного действия; для server-to-server copy нужен явный `reshelve` workflow |

Курсор должен показывать copy для unshelve и move для reopen. Внешние и повреждённые drag payload игнорируются. Drop в Default Shelf запрещён. После успешного drop выполняется серверный refresh, а не только оптимистическое изменение UI. Кэш содержимого shelf очищается при каждом refresh и никогда не отображается, если свежий список changelist больше не сообщает о наличии shelf.

## 5. Submit и конфликт непустого shelf

Perforce не разрешает обычный submit changelist, пока в нём остаются shelved-файлы. Прямой submit shelf, в свою очередь, требует, чтобы в changelist не было локальных non-shelved opened-файлов. Поэтому при одновременном наличии local и shelf пользователь получает три честных варианта:

### 5.1 Отправить shelf

1. Создать recovery changelist.
2. Переместить туда все локальные opened-файлы исходного CL.
3. Выполнить `p4 submit -e source`.
4. Оставить локальную работу в recovery CL и показать его номер.
5. Если submit shelf не прошёл, попытаться вернуть файлы в исходный CL и удалить пустой recovery CL.

Так shelf становится submitted-версией, а более новые локальные правки не теряются.

### 5.2 Отправить локальные и удалить shelf

1. Явно предупредить, что старый shelf восстановить нельзя.
2. Выполнить `p4 shelve -d -c change`.
3. Выполнить `p4 submit -c change`.

Это точное, быстрое, но более рискованное действие пользователя.

### 5.3 Обновить shelf и отправить локальные

1. Заменить shelf полным текущим набором local через `p4 shelve -r -c change -Af`.
2. Удалить shelf, потому что обычный `submit -c` иначе запрещён.
3. Выполнить `p4 submit -c change`.
4. Если submit не прошёл, автоматически заново создать обновлённый shelf из оставшихся opened-файлов.

Этот режим использует shelf как серверную контрольную точку на время рискованной операции. После успешного submit shelf закономерно исчезает вместе с pending change.

### 5.4 Общие требования submit

- Не применять `-f` к unshelve неявно. Флаг разрешён только для конкретных конфликтующих файлов, которые пользователь выделил и явно назначил на перезапись; безопасное начальное решение — пропуск.
- После success и failure всегда перечитывать состояние: сервер может перенумеровать changelist или оставить его pending.
- Показывать server diagnostics и отдельно сообщать результат compensation/rollback.
- Не обещать submit shelf из task stream или на чужом edge server: серверное ограничение должно быть показано пользователю.
- Submit остаётся атомарным на стороне P4 Server; составные подготовительные операции приложения имеют явный rollback или предупреждение.

## 6. Контекстное меню

Changelist: Edit, Shelve/Update all, Unshelve all, Delete shelf, Delete empty changelist, Submit.

Local file selection: Diff для одного файла, Shelve/update и Revert для всего выбранного набора.

Shelved file selection: Diff/Compare для одного файла, Unshelve selected и Delete selected from shelf для всего выбранного набора. В окне конфликтов отдельное ПКМ назначает Skip или Overwrite from shelf выделенным строкам.

Пункты не отображаются, если действие невозможно по локально известному состоянию. Сервер остаётся источником истины для прав и race conditions.

## 7. Надёжность, масштаб и доступность

- Все depot paths и changelist IDs валидируются до передачи в CLI; shell interpolation не используется.
- Лимит текстового diff — 2 MiB с явным признаком truncation.
- Multi-select поддерживает обычный клик, Ctrl/Cmd-toggle и Shift-range; все batch-операции передают массивы путей без shell interpolation. Виртуализация остаётся отдельной задачей для очень больших changelist.
- Разрушительные действия требуют отдельного общего confirmation dialog с описанием того, что сохраняется и что удаляется; browser-native `confirm` не используется.
- Context menu доступно с focused row через системную клавишу `ContextMenu` и `Shift+F10`; все его пункты являются нативными button.
- Drag-and-drop имеет эквивалентные команды через inspector/context menu.
- Строки UI хранятся во внешних locale JSON; новые языки не требуют пересборки.
- Предупреждения и ошибки, реально полученные от `p4` в текущей workspace-сессии, складываются в ограниченный сессионный журнал. Индикатор закреплён справа внизу; журнал показывает время и технические детали и может быть очищен пользователем.

## 8. Проверки

- Unit: группировка default/numbered/shelf-only; single/toggle/range selection; кодирование multi-file drag payload; матрица drop intent.
- Rust unit: JSON records opened/shelved/where; безопасные IDs/paths; аргументы revert с `-w` и без него; изменение Description без потери остальных полей changelist; submit-mode state helpers.
- Integration с тестовым P4 Server: partial shelf delete, unshelve selected, shelf/local diff, каждый submit mode и compensation при искусственной ошибке submit.
- Visual QA: empty/local-only/shelf-only/both, длинные paths, RU/EN, 100%/125% scale, узкое окно, context menu у правого и нижнего края.

Официальные источники и исходный расширенный каталог сохранены в [`research/P4_FEATURE_CATALOG_AND_STORIES.md`](research/P4_FEATURE_CATALOG_AND_STORIES.md).
