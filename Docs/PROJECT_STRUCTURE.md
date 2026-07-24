# Структура проекта

## Цель структуры

Структура должна помогать быстро найти код пользовательской функции и не вынуждать разработчика поддерживать слои, которые пока ничего не дают. Основная единица организации frontend — пользовательская функция, backend — безопасная операция Perforce.

Проект остаётся одним Tauri-приложением и одним репозиторием. Monorepo, отдельные пакеты, plugin SDK и общий «Perforce SDK» на старте не нужны.

## Целевая структура

```text
P4FNV/
├─ Docs/
│  ├─ README.md                 # входная точка и владельцы контрактов
│  ├─ ARCHITECTURE.md           # границы, потоки данных, решения
│  ├─ PROJECT_STRUCTURE.md      # правила расположения кода
│  ├─ P4_FEATURE_CHECKLIST.md    # приоритетный backlog и статусы реализации
│  ├─ UI_UX_SPECIFICATION.md    # рабочий UI/UX-контракт
│  ├─ CHANGELIST_REQUIREMENTS.md # сложная семантика changes/shelves/submit
│  ├─ TOOLCHAIN.md              # окружение и проверка установки
│  ├─ LOCALIZATION.md           # формат и установка language packs
│  └─ research/                 # история, исследования и полные исходные каталоги
├─ locales/                     # внешние JSON-переводы shipping build
│  ├─ en.json
│  └─ ru.json
├─ scripts/
│  ├─ toolchain.ps1             # локальное окружение разработки
│  └─ copy-locales.mjs          # копирование packs рядом с release exe
├─ tools/
│  └─ p4fnv-agent/              # локальный STDIO MCP и native app lifecycle
├─ .codex/
│  └─ config.toml               # project-scoped MCP registration
├─ src/                         # React + TypeScript frontend
│  ├─ app/
│  │  ├─ App.tsx                # каркас окна и верхняя навигация
│  │  └─ app.css                # тема, сетка и дизайн-токены
│  ├─ features/
│  │  ├─ connection/            # сервер, пользователь, workspace, login
│  │  ├─ changes/               # changelists, shelves, submit, DnD
│  │  ├─ workspace/             # workspace files, sync, reconcile, resolve
│  │  ├─ streams/               # stream tree/graph и switch orchestration
│  │  │  └─ streamPreferences.ts # scoped visibility/collapse preferences
│  │  ├─ depot/                 # read-only depot browser
│  │  ├─ history/               # file/submitted history, compare, undo
│  │  ├─ shelves/               # shelf browser, unshelve, reshelve, export
│  │  ├─ jobs/                  # jobs and fixes
│  │  └─ labels/                # labels and sync preview
│  ├─ shared/
│  │  ├─ api.ts                 # типизированные вызовы Tauri invoke/events
│  │  ├─ i18n.tsx               # загрузка packs, fallback и текущий язык UI
│  │  ├─ models.ts              # DTO, реально общие для нескольких функций
│  │  ├─ operations.ts          # общая подписка и модель длительных операций
│  │  ├─ localArchive.ts        # scoped cosmetic Unactual IDs и validated DnD payload
│  │  ├─ useLocalArchive.ts      # единый lifecycle persistent Unactual state
│  │  ├─ useArchiveDragDrop.ts  # общий WebView-safe DnD между actual/Unactual
│  │  ├─ selection.ts            # единые selection и keyboard interaction rules
│  │  ├─ SafeSync.tsx            # общий safe-sync post-check, preview и conflict UI
│  │  ├─ OperationsCenter.tsx   # единственный progress/cancel/retry surface
│  │  ├─ uiSnapshot.ts          # opt-in DOM snapshot и allow-listed agent actions
│  │  └─ View.tsx               # общий page/dialog/empty/error vocabulary
│  ├─ main.tsx
│  └─ index.css                 # reset и глобальные базовые стили
├─ src-tauri/
│  ├─ capabilities/
│  │  └─ default.json           # минимальные разрешения окна
│  ├─ src/
│  │  ├─ main.rs                # desktop entry point
│  │  ├─ lib.rs                 # сборка Tauri, команды и managed state
│  │  ├─ p4.rs                  # разрешённые доменные операции и parsers
│  │  ├─ p4/
│  │  │  ├─ runner.rs           # process boundary, JSON Lines, ошибки, CLI log
│  │  │  └─ validation.rs       # общая валидация P4 identifiers и form values
│  │  ├─ commands.rs            # разрешённые UI операции
│  │  ├─ diagnostics.rs         # opt-in snapshot и tokenized agent mailbox
│  │  ├─ models.rs              # сериализуемые модели приложения
│  │  └─ settings.rs            # несекретные локальные настройки
│  ├─ Cargo.toml
│  ├─ build.rs
│  └─ tauri.conf.json
├─ .gitignore
├─ .node-version
├─ rust-toolchain.toml
├─ package.json
├─ package-lock.json
├─ tsconfig.json
└─ vite.config.ts
```

`tools/p4fnv-agent` является development-only процессом и не входит в Tauri process boundary. Он умеет собрать/запустить release, обмениваться только allow-listed UI-событиями через opt-in bridge и остановить собственный child process. Доменная Perforce-логика, connection environment и mutations остаются внутри существующих React → typed Tauri command → Rust → `p4` границ.

Папки функций в `src/features` — карта реализованного продукта, а не будущий scaffold. Новая папка появляется вместе с первым законченным пользовательским сценарием.

## Что лежит внутри frontend-функции

Минимальный пример:

```text
features/changes/
├─ ChangesView.tsx          # orchestration пользовательских сценариев
├─ ChangeComponents.tsx     # специфичные для changes диалоги и context menu
├─ useChangesData.ts        # server snapshot, shelves, refresh-on-focus
├─ useFileSelection.ts      # согласованный opened/shelved multiselect
├─ useChangeDragDrop.ts     # browser drag-and-drop boundary
├─ changes.ts               # чистые преобразования и матрица drop-действий
└─ changes.test.ts          # regression tests чистой логики
```

Компоненты, запросы и тесты одной функции находятся рядом. Не создавать отдельные глобальные папки `components`, `hooks`, `services`, `utils` и `types`: они быстро превращаются в свалку без понятного владельца.

Файл переносится в `shared` только когда им действительно пользуются минимум две функции. Общий UI-примитив должен описывать поведение (`View`, `ActionDialog`, `EmptyState`), а не конкретный экран (`SubmitDialog`). Ресурсные экраны используют один каркас «заголовок → компактный toolbar → list/inspector workbench»; отличие домена остаётся внутри feature.

## Когда делить Rust-файлы

Начать с плоских `p4.rs`, `commands.rs`, `models.rs` и `settings.rs`. Делить файл следует по ответственности, когда в нём стало трудно ориентироваться, а не по числу строк само по себе.

Текущее разделение:

```text
src-tauri/src/
├─ p4.rs                # validated Perforce operations и DTO parsers
├─ p4/
│  ├─ runner.rs         # executable/process/JSON/error/log boundary
│  └─ validation.rs     # единая trust-boundary validation для P4 операций
├─ commands.rs          # allow-listed Tauri IPC
├─ models.rs
├─ settings.rs
└─ locales.rs
```

Следующее деление `p4.rs` или `commands.rs` выполняется по законченной пользовательской области (`changes`, `history`, `integration`), когда появляется соответствующая вертикаль. `runner.rs` не должен знать о submit/unshelve/revert и не предоставляет frontend универсальный запуск команды.

Не создавать trait с единственной реализацией, repository/service/controller на каждую сущность или отдельный crate до появления второй реальной реализации либо независимого повторного использования.

## Направление зависимостей

```text
React feature -> shared/api.ts -> конкретная Tauri command
                                      |
                                      v
                              Rust command handler
                                      |
                                      v
                         domain operation / parser
                                      |
                                      v
                                 P4 runner -> p4 CLI
```

- Frontend-функции не импортируют друг друга. Совместный сценарий собирает `app` либо небольшой общий модуль.
- `shared` ничего не импортирует из `features`.
- Rust command handler знает пользовательское намерение; доменная функция `p4.rs` знает безопасную Perforce-команду и преобразует DTO; `p4/runner.rs` знает только процесс, JSON Lines, диагностику и CLI log.
- Frontend никогда не передаёт произвольную командную строку, имя executable или переменные окружения.

## Именование

- В коде — английские термины Helix Core: `workspace`, `changelist`, `revision`, `stream`, `integrate`.
- В интерфейсе — понятное действие, при необходимости с официальным термином во вторичной подписи.
- Компоненты — существительные (`ChangeList`, `FileHistory`), обработчики — действия (`submit_change`, `revert_files`).
- Tauri commands описывают намерение: `list_pending_changes`, а не `run_p4_changes`.

Рекомендуемый словарь интерфейса:

| Термин Helix Core | Название в интерфейсе |
|---|---|
| Workspace / client | Рабочая область |
| Pending changelist | Мои изменения |
| Submitted changelist | История изменений |
| Sync | Обновить файлы |
| Revert | Отменить локальные изменения |
| Stream | Ветка (Stream) |
| Integrate / merge | Объединить изменения |
| Cherry-pick | Перенести выбранные изменения |
| Get revision | Получить эту версию |
| Undo | Создать откат этой версии |

Последние две операции нельзя объединять одной кнопкой: получение старой ревизии меняет содержимое workspace, а `p4 undo` создаёт новые открытые изменения для последующего submit.

## Правила роста

1. Каждый этап заканчивается рабочим вертикальным сценарием UI → Rust → `p4` → UI.
2. Новая зависимость добавляется только для уже существующей задачи, которую сложнее и рискованнее решить платформой или стандартной библиотекой.
3. Настройки хранятся в небольшом JSON-файле. База данных нужна только при доказанной необходимости локального индекса или офлайн-поиска.
4. Не дублировать модели «на всякий случай». DTO разделяется на transport/domain/view только когда их формы реально расходятся.
5. Архитектурное решение фиксируется в `Docs/ARCHITECTURE.md`; отдельный каталог ADR появляется, когда решений станет достаточно много, чтобы один документ мешал навигации.
