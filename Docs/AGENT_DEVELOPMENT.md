# Агентная разработка P4FNV

## Цель

Агент должен самостоятельно собрать и запустить нативный P4FNV, прочитать настоящий DOM WebView2, выполнить действие тем же React-маршрутом, что пользователь, дождаться устойчивого состояния и завершить только свою тестовую сессию.

MCP — development-only orchestration boundary. Он не является новым API Helix Core и не предоставляет короткий путь к mutation. Любое потенциально разрушительное действие всё так же проходит существующие preview, dialog, explicit confirmation, typed Tauri command и server read-back.

## Подключение

Конфигурация находится в `.codex/config.toml` и запускает локальный STDIO server через bundled Node и `tools/p4fnv-agent/start.mjs`. Проект должен быть trusted; после изменения конфигурации Codex требуется перезапустить. Launcher собирает server на первом запуске, если `dist/server.js` отсутствует или старее TypeScript source, затем загружает его в том же STDIO-процессе.

Project config оставляет write-tool approvals включёнными. Постоянные правила использования и запрет live-server mutation без разрешения находятся в корневом `AGENTS.md`.

Доступные инструменты:

- `app_start`, `app_status`, `app_stop` — lifecycle одного child process;
- `ui_snapshot` — compact snapshot v2, optional sanitized HTML;
- `ui_click`, `ui_input`, `ui_focus`, `ui_key` — allow-listed DOM actions;
- `ui_wait` — ожидание версии, текста, locator и settled/busy state.

Structured `elements` включает `ignored` для строк файлов и папок Files. Папки имеют стабильный locator `agent:workspace-folder:<client-path>`, поэтому ignored-состояние проверяется без разбора HTML.

## Обязательный workflow агента

1. Вызвать `app_start` с `visible: true` (это default).
2. Перед действием получить `ui_snapshot`.
3. Выбрать locator из `elements` и передать текущий `stateVersion`.
4. При stale response перечитать snapshot; не повторять mutation вслепую.
5. После действия вызвать `ui_wait`, затем проверить новый structured snapshot.
6. Для destructive flow отдельно пройти preview и нажать confirm; bridge не принимает `force` или доменную команду.
7. Всегда завершить сессию через `app_stop`.

Индексные `ui:N` locators действуют только в snapshot той же версии. Для часто используемого или семантически важного control следует добавить нелокализованный `data-agent-id`; существующий уникальный HTML `id` автоматически становится `id:<value>`.

## Безопасность и ограничения

- Нет listener/порта: Codex запускает STDIO process, а P4FNV общается только через точные временные файлы.
- Command/response ограничены 64 KiB, snapshot — 8 MiB; записи атомарны.
- Случайный token существует только в environment дочерней сессии и каждом сообщении.
- Password values редактируются; agent response не возвращает введённое значение.
- MCP не принимает executable, working directory, environment, path удаления, selector, JavaScript, shell, Tauri invoke или `p4` arguments.
- `app_stop` хранит child handle и удаляет только проверенный каталог `p4fnv-agent-*` внутри OS temp.
- Windows WebView2 приостанавливает hidden/offscreen/background window даже с diagnostic Chromium flags. Поэтому native agent session требует обычное окно (`visible: true`); `visible: false` отклоняется до запуска. Это ограничение runtime, а не MCP transport.
- Без disposable/fake Helix Core server нельзя автоматически доказывать server mutations. На пользовательском сервере mutating smoke запрещён без явного разрешения.

## Проверка реализации MCP

```powershell
. .\scripts\toolchain.ps1
npm run build:agent
npm test -- --run
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

Native smoke должен как минимум запустить release через `app_start`, получить schema v2 через `ui_snapshot`, выполнить безопасный UI action с текущей версией, увидеть новый `stateVersion` и остановить session.
