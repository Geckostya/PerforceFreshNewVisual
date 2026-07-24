# UI/UX research и исходная спецификация P4FNV

> Research snapshot. Актуальные правила реализации находятся в [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md).

Статус: базовый продуктовый документ<br>
Дата исследования: 21 июля 2026 года<br>
Область: desktop-клиент Helix Core для ежедневной работы программиста

## 1. Назначение документа

Этот документ определяет информационную архитектуру, структуру экранов, поведение ключевых сценариев и визуальные принципы P4FNV. Он является источником истины для проектирования интерфейса и дополняет техническую архитектуру из `ARCHITECTURE.md`.

Цель продукта — дать пользователю функциональную полноту, необходимую для работы с Perforce, но не заставлять его мыслить командами CLI или разбираться в структуре P4V. Интерфейс должен одновременно:

- быстро осваиваться разработчиком, знакомым с Git-клиентами;
- корректно отражать модель Helix Core;
- оставлять достаточно плотности для больших workspace и changelist;
- не скрывать последствия потенциально разрушительных операций;
- быть приятным при ежедневной работе по несколько часов.

В документе используются слова:

- **обязательно** — требование для первой реализации соответствующего экрана;
- **следует** — решение по умолчанию, от которого можно отойти только с понятной причиной;
- **позже** — осознанно не входит в MVP.

## 2. Что изучено

Исследование основано на официальной документации и актуальных материалах следующих клиентов:

| Продукт | Что изучалось | Что полезно для P4FNV |
|---|---|---|
| Unity Version Control / Plastic SCM | Pending Changes, Incoming Changes, Branch Explorer, merge, Gluon | task-based навигация, branch visualization, разделение локальных и внешних изменений, сценарии больших бинарных файлов |
| P4V | главное окно, Depot/Workspace, changelists, Stream Graph, Revision Graph | функциональный baseline и корректная модель Perforce |
| GitKraken Desktop | commit graph, WIP node, contextual Commit Panel, command palette, undo/redo | сильная визуальная история, контекстная панель, быстрые действия |
| Fork | commit list, changes, diff, conflict resolver, repository tabs | высокая информационная плотность без перегруженности |
| Sublime Merge | Overview/Details, line and hunk actions, search, command palette | скорость, keyboard-first workflow, хороший diff |
| GitHub Desktop | Changes/History, простой commit flow, восстановление discarded changes | ясность, хорошие формулировки действий и безопасные defaults |
| Tower | Working Copy, sidebar, Quick Actions, undo, snapshots | уверенность пользователя, предсказуемое undo, быстрый переход к объектам |

Это не попытка собрать все возможности конкурентов. Мы берём проверенные паттерны, но сохраняем семантику Perforce.

## 3. Главные выводы конкурентного анализа

### 3.1 Plastic SCM / Unity Version Control

Сильные стороны:

- основная навигация построена вокруг рабочих задач: workspace, pending changes, changesets, branches;
- текущий workspace и branch постоянно видимы;
- Pending Changes совмещает описание check-in, дерево/таблицу файлов и preview;
- изменения можно группировать по типу или changelist;
- Incoming Changes явно отделены от локальной работы;
- Branch Explorer показывает ветки на временной шкале и делает merge-связи осязаемыми;
- Gluon доказывает ценность упрощённого workflow для пользователей больших бинарных файлов: выбрать, скачать, заблокировать, изменить, отправить.

Слабые стороны, которые нельзя повторять:

- много маленьких иконок без подписей;
- важные операции спрятаны в длинных context menu;
- source/destination в merge легко перепутать;
- большое число настроек визуализации переносит ответственность дизайна на пользователя;
- Branch Explorer при сложной истории требует значительных усилий для чтения;
- различие между Plastic, Gluon и интеграцией в Unity дробит ментальную модель.

Вывод для P4FNV: используем task-based навигацию и сильный экран изменений, но не создаём отдельные режимы приложения. Сложность раскрывается контекстно.

### 3.2 P4V

Сильные стороны:

- покрывает почти всю модель Helix Core;
- честно разделяет Depot Tree и Workspace Tree;
- предоставляет Pending/Submitted Changelists, Streams, Stream Graph и Revision Graph;
- допускает настройку колонок, фильтров и больших рабочих наборов;
- состояние операций и лог доступны в нижней панели.

Слабые стороны, которые являются основной продуктовой возможностью P4FNV:

- навигация организована вокруг сущностей и инструментов, а не намерений пользователя;
- три панели и множество вкладок создают высокий визуальный шум;
- основные действия часто доступны только через правый клик;
- toolbar содержит много похожих иконок и disabled-состояний;
- отдельные окна графов нарушают рабочий контекст;
- терминология корректна, но редко объясняет последствия действия.

Вывод для P4FNV: P4V — checklist функциональности, но не макет интерфейса.

### 3.3 GitKraken Desktop

Сильные стороны:

- трёхзонная модель `navigation → graph → context panel` хорошо масштабируется;
- WIP является частью истории и потому визуально связан с будущим commit;
- выбор commit немедленно меняет правую панель на его детали;
- панели изменяемого размера и сохраняют настройки;
- Undo/Redo заметны и объясняют, какое действие будет отменено;
- command palette позволяет не искать редкие действия в меню;
- graph highlighting снижает шум от нерелевантных веток.

Слабые стороны:

- центральный граф доминирует даже тогда, когда пользователь работает с файлами;
- sidebar перегружен интеграциями, issues, PR, actions и служебными сущностями;
- цветной graph легко становится декоративным шумом;
- большое количество toolbar actions требует изучения.

Вывод для P4FNV: контекстная панель и command palette обязательны, но история не должна доминировать на экране Workspace или Changes.

### 3.4 Fork

Сильные стороны:

- высокая плотность данных с чёткой иерархией;
- tabs позволяют держать несколько репозиториев открытыми;
- commit graph встроен в обычную таблицу истории;
- выбранный commit и его файлы остаются на том же экране;
- встроены image diff, file history и conflict resolver;
- toolbar использует понятные подписи рядом с иконками.

Слабые стороны:

- некоторые hit targets и вторичный текст слишком мелкие;
- возможности частично зависят от context menu;
- Git staging-модель визуально занимает много места и неприменима к Perforce.

Вывод для P4FNV: берём компактность, tabs и inline details, но не копируем Stage/Unstage.

### 3.5 Sublime Merge

Сильные стороны:

- высокая скорость интерфейса является частью UX, а не технической деталью;
- структура Overview/Details предсказуема;
- diff поддерживает работу с файлом, блоком и строками;
- контекст diff можно плавно расширять до полного файла;
- command palette и полная клавиатурная навигация ускоряют power users;
- подпись основной кнопки меняется по состоянию процесса, например продолжение rebase или завершение cherry-pick.

Слабые стороны:

- interface рассчитан на знание Git;
- высокая плотность и keyboard-first подход могут ухудшить первое знакомство;
- редкие функции хуже обнаруживаются без command palette.

Вывод для P4FNV: diff и клавиатурный workflow должны быть первоклассными, но каждое действие остаётся доступным мышью и имеет понятную подпись.

### 3.6 GitHub Desktop

Сильные стороны:

- всего две главные рабочие вкладки — Changes и History;
- commit composer расположен непосредственно рядом со списком изменений;
- кнопка включает объект действия: `Commit to <branch>`;
- destructive flow показывает список затронутых файлов;
- discarded changes перемещаются в Trash, если платформа это позволяет;
- Reset, Revert, Amend и Cherry-pick объясняются как разные намерения.

Слабые стороны:

- сложные графы, интеграции и большие репозитории не являются приоритетом;
- многие advanced-возможности скрыты;
- модель одного удалённого hosting workflow не подходит Perforce.

Вывод для P4FNV: простота формулировок и явный scope действия обязательны, но продукт не должен урезать профессиональные сценарии.

### 3.7 Tower

Сильные стороны:

- sidebar отражает рабочие области, а detail pane — выбранный объект;
- Quick Actions ищет одновременно команды, файлы, ветки и commits;
- Undo/Redo распространяются на широкий набор действий;
- интерфейс различает reset, revert и discard;
- auto-stash/snapshots помогают безопасно менять контекст.

Слабые стороны:

- широкое Undo в Git опирается на локальную модель и не переносится напрямую на серверные операции Perforce;
- множество автоматических страховочных механизмов может скрывать реальное состояние.

Вывод для P4FNV: история действий и компенсационные операции полезны, но интерфейс никогда не обещает Undo там, где серверную операцию можно только компенсировать новым changelist.

## 4. Продуктовая позиция

P4FNV должен находиться между Fork и GitHub Desktop по визуальной сложности:

- понятнее и спокойнее P4V;
- функциональнее GitHub Desktop;
- менее графоцентричен, чем GitKraken;
- дружелюбнее к мыши, чем Sublime Merge;
- честнее к последствиям операций, чем интерфейсы с универсальным Undo.

Ключевая метафора продукта: **рабочее место над изменениями**, а не «панель управления командами Perforce».

## 5. Непереносимые Git-паттерны

### 5.1 Не создавать staging area

В Perforce файл уже принадлежит default или numbered changelist. Checkbox у файла может означать выбор для bulk action, но не «staged». Для перемещения набора файлов в другой changelist используется явное действие `Переместить в список изменений…` или drag-and-drop с подтверждаемым результатом.

### 5.2 Не рисовать ложный commit DAG

Submitted changelists Helix Core не образуют тот же пользовательский DAG, что Git commits. Связи integrations отображаются только там, где сервер предоставляет их достоверно:

- Stream Graph — отношения streams;
- Revision Graph — история конкретного файла;
- Integrations — связи выбранных ревизий/changes;
- History — линейная таблица changelists с маркерами integration, но не декоративный Git graph.

### 5.3 Не называть разные операции Undo

Интерфейс обязан различать:

| Намерение | Название в UI | Семантика |
|---|---|---|
| удалить неподанные локальные изменения | **Отменить локальные изменения** | `p4 revert`; потеря незаписанной работы |
| получить старую ревизию в workspace | **Получить эту версию** | меняет have revision/content, не создаёт server rollback |
| отменить эффект submitted change | **Создать откат изменения** | `p4 undo`; создаёт новые pending changes для review и submit |
| вернуть только выбранные файлы из истории | **Восстановить файлы как новое изменение** | новый pending changelist |

### 5.4 Не скрывать workspace

Любая мутация зависит от `P4CLIENT`. Текущий server, user, workspace и stream должны быть видимы до действия и внутри preview потенциально опасной операции.

## 6. Принципы взаимодействия

### 6.1 Намерение важнее команды

Основные подписи описывают результат:

- `Обновить рабочую область`, а не `Sync`;
- `Перенести изменение…`, а не только `Integrate`;
- `Создать откат`, а не `Undo`;
- `Отменить локальные изменения`, а не `Revert` без уточнения.

Официальный термин или CLI-команда отображаются во secondary text, tooltip или разделе технических деталей.

### 6.2 Контекст всегда видим

В верхней полосе постоянно отображаются:

- connection profile / server;
- user;
- workspace;
- stream или `classic workspace`;
- состояние соединения;
- количество активных/завершившихся операций.

Смена workspace не является простым dropdown side effect: если есть открытые файлы или незавершённая операция, пользователь сначала видит последствия.

### 6.3 Выбор → preview → действие

Все сложные операции используют одну модель:

1. пользователь выбирает объект или scope;
2. приложение показывает вычисленный сервером preview;
3. пользователь видит source, destination, файлы и предупреждения;
4. основная кнопка называет итог и количество объектов;
5. операция уходит в Operations Center и не блокирует всё окно.

Preview обязателен для sync с риском перезаписи, submit, integrate, переносов изменений, restore/undo и переключения stream с локальной работой.

### 6.4 Основные действия не прячутся

Context menu ускоряет работу, но не является единственным способом выполнить важную команду. Для выбранного объекта основные действия повторяются в contextual toolbar или inspector.

### 6.5 Progressive disclosure

На первом уровне показываются безопасные типичные параметры. Редкие flags находятся в `Дополнительные параметры`, но выбранные нестандартные значения отражаются в summary перед запуском.

Не создавать отдельный `Beginner/Advanced mode`: режимы скрывают возможности и усложняют поддержку. Один интерфейс раскрывает сложность по контексту.

### 6.6 Предсказуемая обратная связь

- действие подтверждается визуально максимум за 100 мс;
- чтение до 300 мс не требует spinner;
- после 300 мс показывается локальный skeleton/progress;
- после 1 с появляется пояснение операции;
- длительная операция показывает количество обработанных файлов, warnings и возможность отмены;
- после mutation данные перечитываются с сервера; UI не предполагает успех по оптимистичной модели.

### 6.7 Сохранение контроля

- если действие обратимо, snackbar предлагает конкретное `Вернуть файл в Default changelist`;
- если требуется компенсационная операция, UI пишет `Создать обратное изменение`, а не `Отменить`;
- необратимые локальные изменения требуют preview и typed scope, но не раздражающего подтверждения каждого отдельного файла;
- disabled control всегда имеет tooltip с причиной.

## 7. Информационная архитектура

### 7.1 Основная навигация

Постоянные разделы:

1. **Рабочая область** — файлы, mapping, status, update, checkout/add/delete/revert.
2. **Мои изменения** — default/numbered changelists, diff, описание, shelve, submit.
3. **История** — submitted changelists, file/folder history, compare, restore/undo.
4. **Ветки** — streams, relationships, merge/integrate, workspace association.
5. **Полки** — shelves и unshelve; появляется после реализации функции.

Служебные entry points:

- глобальный поиск / command palette;
- Operations Center;
- connection/workspace switcher;
- Settings в нижней части sidebar;
- Help/diagnostics через меню профиля.

`Merge`, `Cherry-pick`, `Submit`, `Resolve` и `Sync Preview` — не постоянные пункты навигации. Это контекстные рабочие процессы, запускаемые из выбранного объекта.

### 7.2 Карта экранов

```text
Подключение
  └─ Выбор workspace
      └─ Рабочая область
          ├─ Мои изменения ── Submit / Shelve
          ├─ История ──────── Compare / Restore / Undo
          ├─ Ветки ────────── Merge / Integrate
          └─ Полки ────────── Diff / Unshelve

Любой экран
  ├─ Command palette / Search
  ├─ Operations Center
  ├─ Connection & workspace switcher
  └─ Settings

Merge / Integrate
  └─ Preview
      ├─ Apply to workspace
      ├─ Resolve conflicts
      └─ Pending changelist → Submit
```

## 8. Каркас приложения

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ P4FNV │ server / user │ workspace / stream │ Search ⌘K │ operations │ ● │
├──────────────┬──────────────────────────────────────────┬────────────────┤
│ Workspace    │ Page title                      Actions │ Inspector      │
│ Changes   12 │──────────────────────────────────────────│ selected item  │
│ History      │                                          │ metadata       │
│ Streams      │ Tree / table / graph / diff             │ common actions │
│ Shelves      │                                          │ warnings       │
│              │                                          │                │
│              │                                          │                │
│ Settings     │                                          │                │
├──────────────┴──────────────────────────────────────────┴────────────────┤
│ Operation: Sync 241/920 files                         Cancel │ Details  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Верхняя context bar

Высота около 48 px. Слева направо:

- название приложения / repository context;
- connection profile и user;
- workspace switcher;
- stream badge;
- глобальный search/command field;
- Operations indicator;
- connection status и profile menu.

Path, server и workspace доступны по hover/click полностью. Усечённая строка никогда не является единственным местом, где можно узнать context.

### 8.2 Sidebar

- expanded width: примерно 216–232 px;
- collapsed width: примерно 52–56 px;
- icon + text в expanded состоянии;
- badges показывают только actionable count: pending files, conflicts, failed operations;
- произвольные server entities не добавляются на верхний уровень;
- текущий раздел имеет одновременно background, accent marker и корректный accessible state.

### 8.3 Main surface

Каждый раздел имеет одинаковый каркас:

- title + compact context;
- primary action справа;
- filter/search row;
- основное представление;
- optional inspector справа.

Inspector изменяемого размера, по умолчанию 340–400 px. На ширине меньше 1100 px он превращается в overlay drawer. Настройки размера сохраняются отдельно для каждого раздела.

Текущая базовая реализация унифицирована по эталону My Changes: page heading, компактный toolbar и стабильный list/inspector workbench. Workspace, History, Depot, Shelves, Jobs и Labels не открывают детали как отдельный псевдоэкран и не дублируют основные команды одновременно в header и toolbar. Выбор строки меняет содержимое inspector, а preview остаётся inline либо открывается в общем modal, если перед mutation требуется отдельное подтверждение.

### 8.4 Operations Center

Collapsed strip всегда доступна снизу. При раскрытии показывает queue:

- action и scope;
- server/workspace;
- started time и duration;
- determinate или indeterminate progress;
- текущий файл без утечки credentials;
- warnings/errors;
- Cancel, Retry, Copy diagnostics.

Завершённая операция не исчезает мгновенно. Успешная остаётся кратко в strip, warning/error остаются до просмотра или dismiss.

Feature-экран не рисует второй progress/cancel блок для той же операции. После запуска modal закрывается, Operations Center становится единственным владельцем progress, cancel и retry, а feature только перечитывает server state по terminal event.

## 9. Спецификация экранов

### 9.1 Первое подключение

Цель: довести пользователя от запуска до корректного `p4 info` без знания environment variables.

```text
┌─────────────────────────────────────────────────────────────┐
│ Connect to Helix Core                                      │
│ p4 detected: C:\Program Files\Perforce\p4.exe  2025.1 ✓   │
│                                                             │
│ Server       ssl:perforce.company.net:1666                  │
│ User         alex                                           │
│ Workspace    alex-main                                      │
│ Charset      Automatic                              Advanced │
│                                                             │
│ [Test connection]                    [Open workspace]        │
└─────────────────────────────────────────────────────────────┘
```

Обязательно:

- автоматически найденный `p4` с версией и возможностью изменить path;
- server, user, optional charset;
- inline validation, а не ошибка только после submit;
- отдельные состояния SSL trust, login, SSO/MFA и permission denied;
- `Open workspace` доступна без обязательного предварительного `Test connection`: единое действие проверяет сервер, действующий login ticket и открывает указанный workspace либо оставляет пользователя на форме с точной ошибкой;
- `Test connection` остаётся вспомогательным действием: после успешного info оно загружает список существующих workspaces с owner, host, root и stream;
- последнее успешно открытое подключение с workspace сохраняется; при следующем запуске приложение проверяет ticket через `p4 login -s` и сразу открывает workspace, если сессия действительна;
- из workspace всегда доступно явное `Exit workspace`, возвращающее на начальный экран без удаления профиля и без `p4 logout`;
- создание workspace доступно как secondary action, но не смешивается с выбором;
- профиль подключения сохраняет только несекретные поля.

Нельзя показывать технический stderr вместо пользовательского объяснения. Technical details раскрываются по ссылке.

### 9.2 Рабочая область

Цель: понимать состояние файлов и выполнять ежедневные файловые операции.

```text
┌ Workspace: game_alex_win ─ //Game/dev ───────── [Update workspace] ┐
│ path: C:\work\game   [All] [Open] [Modified] [Outdated]   Filter  │
├──────────────────────────────────────────────┬─────────────────────┤
│ Name                          Status   Head  │ selected file       │
│ ▾ Source                                     │ local/depot path    │
│   Player.cpp                 Modified   ✓    │ changelist          │
│   Player.h                   Open       ✓    │ lock / owner        │
│ ▾ Content                                    │ revision / history  │
│   Hero.fbx                   Outdated   #18  │                     │
│                                              │ [Diff] [History]    │
│                                              │ [More…]             │
└──────────────────────────────────────────────┴─────────────────────┘
```

Структура:

- breadcrumb и local root;
- tree/list toggle, выбор запоминается;
- фильтры `Все`, `Открытые`, `Локально изменённые`, `Требуют обновления`, `Не в depot`;
- columns: name/path, local status, changelist, head/have, lock owner, file type;
- inspector: depot/client/local paths раздельно, revision, changelist, lock, stream, last submitted change;
- contextual actions: Open, Reveal in Explorer, Diff, History, Check out, Add, Mark for delete, Move, Revert, Copy path variants.

`Update workspace` открывает preview, если операция затронет locally modified/open files или большой объём. Для обычного безопасного update допускается one-click запуск с переходом в Operations Center.

Не создавать отдельный глобальный экран `Incoming`, имитирующий DVCS. В Perforce состояние `have < head` отображается как `Требует обновления` в Workspace, banner и фильтре. Отдельная панель возможна позже, если серверные данные дают полезный changeset-oriented preview.

### 9.3 Мои изменения

Это главный экран приложения.

```text
┌ My Changes ───────────────────────────────────── [New changelist] ┐
├ changelists ─────┬ files ───────────────────────┬ diff / details ┤
│ Default       3  │ Modified                     │ Player.cpp     │
│ CL 1042      12  │  M Player.cpp               │ unified/split  │
│   NET-284         │  M Player.h                 │ diff           │
│ CL 1038       1  │ Added                        │                │
│   WIP shaders     │  A NetDriver.cpp            │                │
│                   │ Deleted                      │                │
│                   │  D OldDriver.cpp            │                │
├───────────────────┴──────────────────────────────┴────────────────┤
│ Description: Fix reconnect race...            [Submit 12 files] │
└──────────────────────────────────────────────────────────────────┘
```

Левая колонка:

- Default changelist всегда первый;
- numbered changelists с id, первой строкой description, file count, shelved indicator и conflict/warning badge;
- user может reorder только presentation, не server identity;
- `New changelist` и filter;
- empty changelists скрываются по toggle, но не теряются.

Центральная колонка:

- файлы выбранного changelist;
- группировка по status или folder;
- row selection для bulk actions, без stage checkbox semantics;
- drag-and-drop между changelists вызывает `reopen` и показывает destination highlight;
- keyboard alternative: `Move to changelist…`;
- после move показывается snackbar `3 файла перемещены в CL 1042 — Вернуть`;
- status выражается icon + text/tooltip, не только цветом.

Правая колонка:

- code diff unified/split;
- image diff side-by-side/overlay/blink;
- binary metadata для неподдерживаемого preview;
- quick links History, Open in editor, Reveal, Copy path;
- full-screen diff по `Enter`/double click.

Нижний composer:

- description редактируется inline и имеет saved/unsaved state;
- optional jobs/fixes раскрываются отдельным блоком;
- действия `Shelve`, `Revert…`, `Submit N files`;
- кнопка Submit disabled с конкретной причиной: пустое описание, unresolved files, permissions, empty changelist.

### 9.4 Submit review

Submit открывается как широкая right sheet или focused full-window task, а не маленький modal.

Разделы:

1. changelist id и workspace;
2. description и jobs;
3. files grouped by action;
4. automated checks: unresolved, out-of-date, locks, missing files, server warnings;
5. advanced submit options;
6. итоговая кнопка `Отправить 12 файлов`.

Если preflight чистый, пользователь видит компактное summary. Ошибки раскрывают проблемную группу и дают прямое действие: `Показать 2 unresolved файла`.

После запуска sheet закрывается, операция появляется в Operations Center. При успехе открывается submitted changelist detail. При partial/unknown result приложение перечитывает changelist с сервера.

### 9.5 История изменений

```text
┌ History ─────────────────────────────────────── Search / filters ┐
├ filters ────────┬ submitted changes ───────────┬ change details ┤
│ Path            │ 1048  Fix reconnect race     │ description    │
│ User            │       Alex · 12 files · 5m   │ author / date  │
│ Date            │ 1047  Update hero materials  │ jobs / stream  │
│ Stream          │       Maya · 4 files · 1h    │ changed files  │
│ Has integrations│ 1046  Merge dev → main       │ diff preview   │
└─────────────────┴───────────────────────────────┴────────────────┘
```

Обязательно:

- virtualized chronological list/table;
- query/filter по number, user, description, path, date range, stream;
- saved recent filters;
- selected changelist detail в inspector;
- файлы и diff не требуют нового окна;
- multi-select двух compatible revisions включает `Сравнить`;
- действия `Перенести изменение…`, `Создать откат…`, `Получить файлы этой версии…`, `Открыть file history`;
- integration marker отображается только при наличии серверных данных.

История не рисует декоративные линии между всеми changelists. Для конкретного файла доступен Revision Graph, для streams — Stream Graph.

### 9.6 История файла и Revision Graph

Экран открывается из Workspace, Changes или History и сохраняет обратный путь.

Режимы:

- `Список` — revisions, action, changelist, author, date, type, file size;
- `Граф` — integrations/branches конкретного файла;
- `Blame` — позже;
- `Сравнение` — две выбранные revisions.

Текущие have/head revisions выделяются текстовыми badges. Выбор одной revision показывает preview. Выбор двух включает compare без drag-only interaction.

Основные действия:

- `Получить эту версию`;
- `Сравнить с workspace`;
- `Сравнить с предыдущей`;
- `Восстановить как новое изменение`;
- `Перенести revision…` при поддерживаемом integrate flow.

### 9.7 Ветки (Streams)

```text
┌ Streams ── depot: //Game ───────────────────── [New workspace] ┐
│ [Tree] [Graph]                    Filter owner/type/name        │
├ stream tree ──────────┬ relationship graph ─────┬ details ────┤
│ mainline main         │        main              │ //Game/dev  │
│ ├─ dev  ● workspace   │       /    \             │ parent main │
│ │  ├─ task/net-284    │     dev   release        │ flow rules  │
│ └─ release            │      |                  │ workspace   │
│                       │   task/net-284           │ [Merge…]    │
└───────────────────────┴──────────────────────────┴──────────────┘
```

Принципы:

- tree и graph синхронизируют selection;
- текущий workspace marker виден в обоих представлениях;
- stream type выражается формой/icon + label, а не только цветом;
- focus mode приглушает нерелевантные ветки вместо их полного исчезновения;
- graph имеет zoom/pan и minimap только когда content больше viewport;
- фильтры не скрывают обязательных ancestors: они отображаются muted;
- detail inspector показывает parent, type, owner, paths, flow rules, associated workspaces и last activity;
- merge начинается с явного source/target preview.

Branch Explorer-подобная временная история может появиться позже как `Activity timeline`, но не смешивается с иерархическим Stream Graph.

### 9.8 Merge / Integrate

Главная задача — исключить ошибку направления.

```text
┌ Объединить изменения ──────────────────────────────────────────┐
│                                                               │
│  Источник                       Цель                           │
│  //Game/dev                     //Game/main                    │
│  latest CL 1048       ───────▶  workspace game_alex_main      │
│                                                               │
│  Будет применено: 37 файлов · 4 удаления · 2 возможных конфликта│
│  [View files] [Advanced options]                              │
│                                                               │
│  Результат появится в новом pending changelist CL 1051        │
│                                      [Apply to workspace]      │
└───────────────────────────────────────────────────────────────┘
```

Обязательно:

- source слева, destination справа, крупная направленная стрелка;
- destination включает workspace и stream;
- server-generated preview до применения;
- summary действий и потенциальных conflicts;
- список files with reason/action;
- advanced integration flags свернуты;
- итог не отправляется автоматически: сначала pending changelist, resolve и review;
- step indicator: `Preview → Apply → Resolve → Review → Submit`;
- закрытие task не теряет ongoing merge state.

Кнопки `Keep source`/`Keep destination` не используются без контекста. Формулировки всегда включают понятный объект: `Использовать версию из //Game/dev` и `Оставить версию рабочей области`.

### 9.9 Перенос выбранного изменения (cherry-pick)

Запускается из submitted changelist или нескольких последовательных changes.

Flow похож на Merge, но source card содержит номера changes и список revisions. Primary copy:

- title: `Перенести изменение`;
- subtitle: `Применить содержимое CL 1042 к //Game/release`;
- button: `Применить 8 файлов к рабочей области`.

Если часть revisions уже интегрирована, они выделяются в отдельную группу и по умолчанию не применяются повторно. Пользователь может раскрыть technical explanation.

### 9.10 Resolve conflicts

```text
┌ Resolve 3 conflicts ───────────────────────────────────────────┐
├ files ─────────┬ source ─────────┬ result ────────┬ workspace ┤
│ Player.cpp  2  │ //Game/dev      │ editable       │ destination│
│ Hero.fbx    bin │ changed block   │ merged output  │ local block│
│ Config.json 1  │ [Use source →]  │                │ [← Keep]  │
├────────────────┴─────────────────┴────────────────┴───────────┤
│ 1 of 3 resolved                     [Save] [Next conflict]    │
└───────────────────────────────────────────────────────────────┘
```

Для text conflicts:

- три основных смысла: source, result, workspace/destination;
- base доступна toggle, а не занимает постоянную четвёртую колонку;
- linked scroll и syntax highlighting;
- навигация previous/next conflict;
- take controls расположены у конкретного hunk;
- resolved status сохраняется по файлу;
- перед завершением показываются unresolved count и output validation.

Для binary/directory conflicts:

- не показывать пустой code editor;
- side-by-side metadata/preview;
- file size, author, date, revision, image/3D preview где возможно;
- действия формулируются полным текстом;
- возможность открыть внешний merge tool.

### 9.11 Полки

Экран появляется после MVP:

- список собственных и доступных shelves с owner/date/description/file count;
- filters `Мои`, `Workspace`, `User`, `Date`;
- selected shelf details и diff;
- `Применить к рабочей области…`, `Удалить полку…`, `Сравнить`;
- unshelve всегда показывает destination changelist и collisions preview;
- после shelve UI явно спрашивает/показывает, остаются ли локальные изменения.

### 9.12 Глобальный поиск и command palette

Shortcut: `Ctrl+K` или `Ctrl+P`, окончательный shortcut проверяется на конфликт с platform conventions.

Поиск объединяет:

- команды;
- files/paths;
- changelist numbers;
- streams;
- workspaces;
- users;
- recent destinations.

Results группируются и имеют secondary context. Команда не выполняется сразу, если требует параметров: palette переводит к компактному parameter picker или полноценному preview.

Примеры:

- `1042` → открыть submitted/pending changelist;
- `Player.cpp` → workspace file, file history, depot result;
- `release` → stream и workspace;
- `revert` → `Отменить локальные изменения…`, а не немедленный запуск.

### 9.13 Settings

Полноэкранная страница с ограниченной шириной content. Группы:

- Connections;
- Language (Русский / English, с возможностью добавлять полные словари);
- Perforce executable and environment;
- Appearance and density;
- Diff and merge;
- External tools;
- Notifications;
- Keyboard shortcuts;
- Diagnostics and privacy.

Настройки, которые меняются в ежедневном контексте, остаются рядом с объектом. Settings содержит только устойчивые preferences.

## 10. Сквозные рабочие сценарии

### 10.1 Ежедневный submit

```text
Changes badge → выбрать changelist → просмотреть diff → изменить description
→ Submit review → исправить preflight issues → Submit → submitted details
```

Целевой путь при чистом changelist: не более двух осознанных действий после завершения review — `Submit`, затем подтверждение только если есть warning.

### 10.2 Обновление workspace

```text
Update workspace → быстрый preflight
  ├─ безопасно → operation starts
  └─ есть риск → preview affected files → Update / Cancel
→ progress → refresh statuses → summary
```

### 10.3 Переключение stream/workspace с локальными изменениями

```text
Select destination → detect opened/local files
→ варианты с последствиями:
   Shelve and switch / Move work when supported / Stay here
→ preview → operation → destination context visibly changes
```

Нельзя тихо переносить локальную работу между streams.

### 10.4 Откат submitted change

```text
History → select CL → Create rollback
→ explain new pending change → server preview
→ choose destination changelist → Apply
→ review diff in My Changes → Submit
```

### 10.5 Merge

```text
Streams → choose source → Merge into… → explicit source/target preview
→ Apply → resolve conflicts → review pending changelist → Submit
```

## 11. Правила таблиц, деревьев и selection

- row height: 32 px compact, 38 px comfortable;
- headers sticky;
- resizing/reordering columns доступно и сохраняется per view;
- default columns покрывают 80% сценария; остальные находятся в column chooser;
- сортировка показывает direction и precedence;
- hierarchy раскрывается стрелкой, double click не должен неожиданно выполнять destructive action;
- single click выбирает, Enter открывает primary detail;
- Space toggles checkbox только там, где checkbox имеет реальную семантику;
- Shift/Ctrl selection соответствует platform convention;
- select all относится к текущему filtered scope и явно пишет количество;
- при обновлении данных selection сохраняется по стабильному id, если объект существует;
- virtualized list не ломает keyboard navigation и screen reader semantics.

## 12. Diff UX

Общие возможности:

- unified и side-by-side;
- collapse unchanged regions;
- expand context несколькими строками или до полного файла;
- ignore whitespace toggle с видимым active state;
- syntax highlighting;
- next/previous file и next/previous change;
- sticky file header;
- word-level highlights внутри changed lines;
- copy path, copy selection, open in editor;
- line numbers не являются единственным click target действия;
- large/binary files показывают deliberate fallback, а не зависший blank surface.

Image diff:

- side-by-side;
- overlay opacity slider;
- blink A/B;
- actual size / fit;
- dimensions, format, file size;
- checkerboard для alpha.

3D preview относится к более поздней версии, но layout preview должен позволять добавить renderer без переделки экрана.

## 13. Visual language

### 13.1 Характер

Интерфейс спокойный, точный и «инструментальный». Он не должен выглядеть как игровой launcher, admin panel 2000-х или web-dashboard с чрезмерно большими cards.

Принципы:

- content важнее chrome;
- flat surfaces разделяются тонкими borders и tone, не постоянными shadows;
- accent используется для focus, selection и primary action;
- semantic colors зарезервированы для status;
- gradients, glass и декоративная анимация не используются в рабочих областях;
- плотность высокая, но whitespace сохраняет grouping.

### 13.2 Typography

- UI: системный stack, на Windows в приоритете `Segoe UI Variable` / `Segoe UI`;
- diff/code: `Cascadia Mono`, затем platform monospace;
- body: 13–14 px в desktop scale 100%;
- secondary metadata: не меньше 12 px;
- page title: 20–22 px semibold;
- section title: 14–16 px semibold;
- uppercase не используется для длинных headers и buttons.

### 13.3 Spacing and geometry

- базовая сетка 4 px, основные интервалы кратны 8 px;
- border radius 6 px для controls, 8 px для dialogs/drawers;
- primary buttons минимум 32–36 px по высоте;
- icon buttons имеют hit target минимум 28–32 px;
- splitter имеет визуально тонкую линию, но расширенную interactive area;
- content не прижимается к краям pane ближе 12 px, кроме виртуализированных table rows.

### 13.4 Темы

Light и Dark являются равноправными. Не инвертировать цвета механически.

Dark direction:

- background почти нейтральный тёмный, не чистый чёрный;
- surfaces отличаются на небольшую, но заметную luminance;
- основной текст мягче чистого белого;
- diff green/red имеют достаточный contrast и не окрашивают большие площади слишком насыщенно.

Light direction:

- мягкий off-white background;
- borders заметны без тяжёлых shadows;
- selected rows не теряются рядом с diff colors;
- disabled text остаётся читаемым.

Конкретные tokens утверждаются после проверки contrast и на реальных таблицах/diff, а не на изолированной palette board.

### 13.5 Icons

- единый outline set 16/18 px;
- primary toolbar actions получают text label;
- icon-only допустим для общеизвестных действий рядом с контекстом: search, refresh, close, more;
- каждый icon-only control имеет tooltip и accessible name;
- status icon всегда дополняется shape/text/tooltip;
- не использовать разные иконки для одного действия на разных экранах.

### 13.6 Motion

- 120–180 мс для hover, selection, drawer;
- progress отражает работу, а не развлекает;
- graph transitions помогают сохранить spatial context;
- `prefers-reduced-motion` отключает перемещения и оставляет opacity/state changes;
- никакой анимации, задерживающей ввод или navigation.

## 14. Status system

Минимальный словарь файлов:

| Состояние | Иконка/форма | Цветовая роль | Текст |
|---|---|---|---|
| Modified / open for edit | pencil / M | accent-warning | Изменён |
| Added | plus / A | success | Добавлен |
| Deleted | minus/trash / D | danger | Удалён |
| Moved | arrow / R | info | Перемещён |
| Outdated | download arrow | warning | Требует обновления |
| Locked by me | closed lock | accent | Заблокирован вами |
| Locked by other | lock + user | danger/warning | Заблокирован: user |
| Unresolved | conflict diamond | danger | Требует разрешения |
| Shelved | archive | neutral-info | На полке |
| Not in depot | hollow file | neutral | Не отслеживается |

Один цвет не может быть единственным носителем информации. Legend доступна из help tooltip, но нормальная работа не должна требовать её запоминания.

## 15. Тексты и microcopy

### 15.1 Кнопка описывает результат

Хорошо:

- `Отправить 12 файлов`;
- `Применить CL 1042 к //Game/release`;
- `Отменить изменения в 3 файлах`;
- `Создать новый changelist отката`.

Плохо:

- `OK`;
- `Run`;
- `Process`;
- `Undo` без объекта;
- `Merge` без source/target.

### 15.2 Ошибка отвечает на три вопроса

1. Что не получилось?
2. Почему это произошло?
3. Что пользователь может сделать сейчас?

Пример:

> Не удалось отправить CL 1042: два файла требуют resolve. Откройте конфликтующие файлы или оставьте changelist без изменений.

Действия: `Показать конфликты`, `Copy technical details`.

### 15.3 Терминология

Первое появление сложного Perforce-термина может иметь пояснение:

- `Рабочая область (workspace)`;
- `Список изменений (changelist)`;
- `Ветка (stream)`.

После знакомства интерфейс использует короткую форму. Не заменять термины настолько, чтобы документацию Perforce невозможно было найти.

## 16. Accessibility

Базовая цель — WCAG 2.2 AA для webview UI и полноценная desktop keyboard usability.

Обязательно:

- contrast обычного текста не ниже 4.5:1, крупного — 3:1;
- visible focus на каждом interactive control;
- focus не скрывается sticky headers/drawers;
- logical tab order;
- arrow-key navigation внутри tree/table/list;
- минимум 24×24 CSS px для target или достаточный spacing; рабочая цель 28–32 px;
- resize UI до 200% без потери действий;
- screen reader names, roles, selected/expanded/busy states;
- announcements для завершения операций, ошибок и смены selection context;
- status не кодируется только цветом;
- diff additions/deletions имеют символ/текст и доступное описание;
- drag-and-drop всегда имеет keyboard alternative;
- не полагаться только на hover.

Проверки выполняются keyboard-only, Windows Narrator и хотя бы одним дополнительным screen reader на поддерживаемой платформе.

## 17. Empty, loading, error and offline states

Каждый экран проектируется минимум в шести состояниях:

1. normal data;
2. loading;
3. empty expected;
4. empty because of filter;
5. permission/connection error;
6. partial/stale data.

Примеры:

- Changes empty: `В рабочей области нет открытых файлов` + `Refresh`;
- Filter empty: `Ничего не найдено по текущим фильтрам` + `Сбросить фильтры`;
- Connection lost: данные остаются видимы с badge `Устаревшие`, mutations disabled с причиной;
- Partial result: показываем полученные rows и non-blocking warning;
- First run: объясняем следующее действие, а не показываем пустую таблицу.

Skeleton повторяет будущую структуру rows и не используется для неизвестно долгой server operation. Для длительных запросов Operations Center показывает реальный статус.

## 18. Keyboard model

Минимальный набор:

| Действие | Shortcut |
|---|---|
| Command palette / global search | `Ctrl+K` или финально выбранный единый shortcut |
| Refresh current view | `F5` |
| Open selected item | `Enter` |
| Close detail/task | `Esc` |
| Find/filter in current view | `Ctrl+F` |
| New changelist | `Ctrl+N` в контексте Changes |
| Submit selected changelist | `Ctrl+Enter` после review |
| Navigate panes | `F6` / `Shift+F6` |
| Next/previous diff change | configurable standard shortcuts |

Все shortcuts отображаются в menu/tooltips/command palette. Нельзя назначать destructive action на одиночную легко нажатую клавишу без preview.

## 19. Производительность как часть UX

- window становится usable до завершения фонового refresh;
- большие списки виртуализируются;
- expand folder загружает только необходимый scope;
- search имеет debounce и возможность отмены;
- stale data не очищается при refresh — rows остаются с progress state;
- возврат фокуса в desktop-окно запускает throttled background refresh текущего экрана; постоянный polling и filesystem watcher для этого не используются;
- diff больших файлов загружается по частям;
- переключение selection не запускает необязательные тяжёлые запросы до короткой задержки;
- background refresh не крадёт focus и не сбрасывает scroll;
- операция одного pane не блокирует navigation по cached/read-only данным в другом;
- пользователь может отменить долгий `sync`, `fstat`, history и integrate preview.

Целевые UX-бюджеты уточняются на реальных серверах, но измеряются как time-to-first-row, time-to-interactive и сохранение 60 FPS при scroll, а не только общее время команды.

## 20. Персонализация без перекладывания дизайна на пользователя

Разрешено:

- Light/Dark/System;
- Compact/Comfortable density;
- column visibility/order/width;
- pane sizes and collapsed state;
- unified/split diff;
- external editor/merge tool;
- shortcuts;
- сохранённые filters.

Не следует добавлять:

- произвольное окрашивание каждого status;
- десятки toolbar layouts;
- отдельные beginner/expert modes;
- плагины UI до устойчивого core workflow;
- настройку, исправляющую плохой default вместо изменения default.

## 21. Проверка дизайна

### 21.1 Прототипы до реализации

Для каждого core screen создаётся кликабельный prototype минимум в состояниях normal, empty, loading и error. Прототипы проверяются на 1024×720, 1280×800, 1440×900 и 200% scale.

### 21.2 Пользовательские тесты

Минимальная выборка на крупную итерацию:

- 3–4 программиста с опытом Perforce/P4V;
- 2 программиста с опытом Git GUI, но без Perforce;
- 1 build/release engineer или технический художник для больших файлов/locks.

Задания:

1. найти изменённый файл и определить его changelist;
2. перенести файлы в новый changelist и submit;
3. найти, кто и когда изменил строку/файл;
4. получить старую revision, не создавая server rollback;
5. создать rollback submitted changelist;
6. перенести выбранное изменение в release stream;
7. объяснить направление merge до запуска;
8. отменить длительный sync и понять итоговое состояние.

Измеряем:

- task success без подсказок;
- time to completion;
- число неверных запусков/возвратов;
- понимание source/destination;
- понимание различия Get Revision / Revert Local / Create Rollback;
- субъективную уверенность перед Submit/Merge/Undo;
- discoverability keyboard and mouse paths.

### 21.3 UX acceptance criteria

Экран не считается готовым, если:

- primary action доступен только через context menu;
- неизвестны loading/error/empty states;
- keyboard user не может завершить основной сценарий;
- source/target или workspace скрыты в destructive flow;
- status понятен только по цвету;
- после cancel/error невозможно понять, что реально изменилось;
- screen reader не получает selection, progress и error state;
- scroll/selection сбрасываются после обычного refresh.

## 22. Приоритет реализации

### Этап UI-0 — Design foundation

- application shell;
- themes, typography, spacing, status icons;
- table/tree primitives;
- inspector and split panes;
- dialog/sheet and Operations Center;
- focus/keyboard model.

### Этап UI-1 — первый вертикальный сценарий

- connection;
- workspace context bar;
- My Changes с opened files и pending changelists;
- file move between changelists;
- basic diff;
- error and loading states.

### Этап UI-2

- Workspace tree/status;
- update preview and operation progress;
- edit/add/delete/revert;
- Submit review.

### Этап UI-3

- History and file history;
- compare;
- Get Revision;
- Create Rollback.

### Этап UI-4

- Streams tree/graph;
- integrate/cherry-pick preview;
- conflict resolver.

### Этап UI-5

- Shelves;
- image diff improvements;
- advanced search, saved filters and personalization.

## 23. Источники

Официальные продуктовые источники:

- [Unity Version Control: Pending Changes](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/pending-changes-tab)
- [Unity Version Control: Merge reference](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/merge-reference)
- [Unity Version Control: Settings](https://docs.unity.com/en-us/unity-version-control/vcs-plugins/unityeditor-plugin/settings-window)
- [Unity Version Control: Gluon](https://docs.unity.com/en-us/unity-version-control/gluon/gluon)
- [P4V navigation and layout](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/using.navigating.html)
- [P4V Stream Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/streams.graph.html)
- [P4V Revision Graph](https://help.perforce.com/helix-core/server-apps/p4v/current/Content/P4V/advanced_files.revgraph.html)
- [GitKraken interface](https://help.gitkraken.com/gitkraken-desktop/interface/)
- [Fork](https://fork.dev/)
- [Sublime Merge getting started](https://www.sublimemerge.com/docs/getting_started)
- [Sublime Merge diff context](https://www.sublimemerge.com/docs/diff_context)
- [GitHub Desktop changes and commits](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)
- [Tower interface overview](https://www.git-tower.com/help/guides/first-steps/tower-overview/mac)
- [Tower undo](https://www.git-tower.com/features/undo)

Design and accessibility references:

- [Microsoft Windows app design guidelines](https://learn.microsoft.com/en-us/windows/apps/design/guidelines-overview)
- [Microsoft commanding guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/commanding)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Apple Human Interface Guidelines: Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
