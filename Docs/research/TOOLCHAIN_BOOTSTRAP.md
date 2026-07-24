# Исходная настройка toolchain разработки

> Research snapshot. Актуальные команды находятся в [`../TOOLCHAIN.md`](../TOOLCHAIN.md).

## Текущее состояние Windows-машины

Проверено 21 июля 2026 года:

| Компонент | Версия / состояние | Расположение |
|---|---|---|
| Windows | 10.0.26200, x64 | system |
| Visual Studio | Community 2022 17.13.5 | `C:\Tools\Visual Studio\2022\Community` |
| MSVC | 14.38 и 14.43, x64 tools | Visual Studio |
| Windows SDK | 10.0.22621.0 | system |
| WebView2 Runtime | 150.0.4078.83 | system |
| Git | 2.51.0.windows.1 | `C:\Tools\Git` |
| Perforce CLI | P4/NTX64/2025.1/2831954 | `C:\Program Files\Perforce\p4.exe` |
| Node.js LTS | 24.16.0 | `.toolchain/node` |
| npm | 11.13.0 | `.toolchain/node` |
| Rust | 1.97.1 stable-msvc | `.toolchain/rustup` |
| Cargo, rustfmt, Clippy | из Rust 1.97.1 | `.toolchain/cargo/bin` |

Системные зависимости Tauri для Windows уже были установлены. Node.js и Rust скачаны из официальных источников в локальный ignored-каталог `.toolchain`, потому что текущая сессия не имеет административного токена для system-wide MSI.

## Активация

В новом PowerShell из корня проекта выполнить:

```powershell
. .\scripts\toolchain.ps1
```

Точка и пробел в начале важны: скрипт должен изменить environment текущей PowerShell-сессии. После этого доступны `node`, `npm`, `rustup`, `rustc`, `cargo`, `rustfmt` и `clippy`. Кэш npm также остаётся в ignored-каталоге `.toolchain/npm-cache`.

Проверка:

```powershell
node --version
npm --version
rustc --version
cargo --version
cargo clippy --version
p4 -V
```

## Зафиксированные версии

- `.node-version` фиксирует Node.js `24.16.0`.
- `rust-toolchain.toml` фиксирует Rust `1.97.1`, rustfmt и Clippy.
- После создания frontend `package-lock.json` фиксирует npm-зависимости.
- Tauri CLI должен быть `devDependency`, запуск — `npm run tauri`, не глобальная установка.

## Создание приложения на следующем этапе

После активации окружения проект можно инициализировать Tauri-шаблоном React + TypeScript в текущей папке. Перед выполнением нужно сохранить существующие `Docs`, `scripts` и version files; автоматический генератор не должен их перезаписывать.

Предпочтительный набор npm scripts после инициализации:

```json
{
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "tauri": "tauri"
  }
}
```

Vitest добавляется вместе с первым нетривиальным frontend-тестом, не заранее. Rust использует встроенный test runner Cargo.

## Что не требуется

- Глобальный Tauri CLI: версия должна жить в проекте.
- pnpm/yarn: npm уже поставляется с Node и создаёт lockfile.
- C++ P4API: интеграция идёт через установленный `p4`.
- Docker и локальный Helix Server для обычной сборки: fake executable покрывает integration tests; реальный сервер нужен только smoke-тестам.
- Android/iOS toolchain: приложение desktop-only до отдельного продуктового решения.

## Обновление

Обновлять Node или Rust следует отдельным изменением вместе с version files, lockfile и полной проверкой:

```powershell
npm ci
npm run typecheck
npm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Не использовать плавающий `latest` в CI. Каждая ОС собирает свой Tauri installer на native runner; кросс-компиляция desktop bundle с Windows на macOS/Linux не является целью.

## Источники установки

- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Rust: https://www.rust-lang.org/tools/install
- Node.js LTS: https://nodejs.org/en/download
- Perforce CLI: https://www.perforce.com/downloads/helix-command-line-client-p4

Архив Node.js проверен по официальному `SHASUMS256.txt`. `rustup-init.exe` получен по официальному HTTPS endpoint `https://win.rustup.rs/x86_64`; Windows-бинарник rustup не содержит Authenticode-подписи, поэтому источник и TLS endpoint принципиальны.
