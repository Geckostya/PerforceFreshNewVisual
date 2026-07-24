# P4FNV agent MCP

Локальный STDIO MCP-сервер запускает отдельную opt-in сессию release-приложения и управляет настоящим React UI. Он не открывает порт и не предоставляет произвольный JavaScript, filesystem, Tauri invoke, shell или `p4` command.

## Lifecycle

1. Codex запускает bundled Node с `start.mjs` из проектного `.codex/config.toml`.
2. `app_start` при необходимости собирает release и создаёт временный каталог с command/response/snapshot файлами.
3. P4FNV получает точные пути и случайный session token только через environment дочернего процесса.
4. `ui_snapshot` возвращает текущие interactive locators и `stateVersion`.
5. UI tools требуют актуальную версию и проходят через существующие DOM events и React handlers.
6. `app_stop` завершает только запущенный сервером процесс и удаляет его временный каталог.

После первого добавления или изменения `.codex/config.toml` перезапустите Codex. Для ручного запуска сервера используйте `npm run mcp:agent`; stdout зарезервирован за MCP JSON-RPC.

## Verification flow

```text
app_start -> ui_snapshot -> ui_input/ui_click -> ui_wait -> ui_snapshot -> app_stop
```

На текущем Windows WebView2 native session требует обычное окно (`visible: true`, default): hidden/offscreen/background window приостанавливает JavaScript. `visible: false` отклоняется до запуска, но server по-прежнему сам собирает, запускает и закрывает приложение.
