# Toolchain разработки

## Требования

- Windows 10/11 x64.
- Visual Studio 2022 Build Tools/Community с MSVC и Windows SDK.
- WebView2 Runtime.
- Установленный `p4.exe` для ручной работы с сервером.
- Node `24.16.0` из `.node-version`.
- Rust `1.97.1` с rustfmt/Clippy из `rust-toolchain.toml`.

В текущем workspace Node, Rust и npm cache находятся в ignored-каталоге `.toolchain`. Глобальный Tauri CLI, pnpm/yarn, C++ P4API, Docker и локальный P4 Server для обычной сборки не нужны.

## Активация и установка зависимостей

Каждую PowerShell-сессию начинать из корня проекта:

```powershell
. .\scripts\toolchain.ps1
```

Точка и пробел обязательны: скрипт изменяет environment текущей сессии. Затем:

```powershell
npm ci
```

Быстрая проверка:

```powershell
node --version
rustc --version
cargo clippy --version
p4 -V
```

## Разработка

```powershell
npm run dev       # Tauri application
npm run dev:web   # только Vite UI; Tauri IPC недоступен
```

Для низкоуровневой read-only диагностики snapshot bridge без MCP задайте абсолютный путь перед запуском:

```powershell
$env:P4FNV_UI_SNAPSHOT_PATH = "C:\Temp\p4fnv-ui.json"
npm run dev
Get-Content -Raw $env:P4FNV_UI_SNAPSHOT_PATH
```

Файл обновляется атомарно после изменения DOM/form state или viewport. Без переменной наблюдатель и запись не запускаются. Password values в snapshot редактируются. Для обычной агентной проверки используйте основной MCP workflow ниже; ручная переменная нужна только для диагностики самого bridge.

### Agent MCP

Project-scoped STDIO MCP зарегистрирован в `.codex/config.toml`. После первого checkout или изменения MCP-конфигурации:

```powershell
. .\scripts\toolchain.ps1
npm ci
npm run build:agent
```

Затем перезапустите Codex и доверьте проект. Codex сам запускает bundled Node с `tools/p4fnv-agent/start.mjs`; вручную держать server process или локальный HTTP-порт не нужно. Launcher сохраняет STDIO в одном процессе и при необходимости сам вызывает TypeScript compiler. Для ручной protocol-диагностики доступен `npm run mcp:agent`, но его stdout зарезервирован за MCP JSON-RPC.

Основной verification flow: `app_start` → `ui_snapshot` → UI actions с текущим `stateVersion` → `ui_wait` → `app_stop`. На текущем Windows WebView2 native session требует обычное окно (`visible: true`, default): hidden/offscreen/background window приостанавливает JavaScript. `visible: false` отклоняется до запуска. Подробный контракт находится в [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md).

## Проверки

Для небольшого изменения сначала запускать ближайший тест. Перед передачей изменения выполнять полный gate:

```powershell
. .\scripts\toolchain.ps1
npm test -- --run
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
npm run build
```

`npm run build` включает TypeScript check, Vite production build, Rust release build и копирование language packs.

## Shipping artifact

```text
src-tauri\target\release\p4fnv.exe
src-tauri\target\release\locales\en.json
src-tauri\target\release\locales\ru.json
```

Перед передачей проверить наличие locale files и получить hash:

```powershell
Get-FileHash .\src-tauri\target\release\p4fnv.exe -Algorithm SHA256
```

Если `.exe` заблокирован, сначала проверить путь процесса и завершать только экземпляр `p4fnv.exe` из этого repository. Не завершать `p4`, `p4d` или другие процессы Perforce.

## Обновление версий

Node/Rust/Tauri обновляются отдельным изменением вместе с version files, lockfile и полным gate. Не использовать плавающий `latest`. Tauri desktop bundle собирается на native runner каждой ОС; cross-compilation не является целью проекта.

История первоначальной настройки и ссылки на installers сохранены в [`research/TOOLCHAIN_BOOTSTRAP.md`](research/TOOLCHAIN_BOOTSTRAP.md).
