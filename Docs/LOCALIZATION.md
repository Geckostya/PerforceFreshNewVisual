# Language packs

P4FNV загружает языки из отдельных JSON-файлов при запуске. Для добавления языка не требуется пересобирать приложение.

## Где лежат файлы

Shipping-каталог:

```text
p4fnv.exe
locales/
  en.json
  ru.json
  de.json       # дополнительный пакет
```

Пользовательские пакеты также можно положить в app config directory:

```text
Windows: %APPDATA%\dev.p4fnv.client\locales
```

Папка создаётся после первого запуска. Пакет из app config directory переопределяет пакет с тем же `code` рядом с executable. После добавления или изменения файла приложение нужно перезапустить.

## Формат

```json
{
  "code": "de",
  "name": "Deutsch",
  "translations": {
    "headerSubtitle": "Helix Core Desktop-Client"
  }
}
```

- `code` — уникальный код из ASCII-букв, цифр, `-` или `_`, максимум 32 символа;
- `name` — самоназвание языка, которое показывается в списке;
- `translations` должен содержать все ключи из [`locales/en.json`](../locales/en.json).

Неполный или повреждённый файл пропускается, остальные языки продолжают работать. Английский словарь встроен как аварийный fallback. Дополнительные ключи разрешены и не мешают загрузке.

## Изменение строк приложения

1. Добавить один и тот же key в `locales/en.json` и `locales/ru.json`.
2. Использовать `t("key")`; тип `TranslationKey` выводится из English pack.
3. Не помещать пользовательский текст в Rust diagnostics: backend возвращает стабильный `ErrorKind`, frontend выбирает локализованную строку.
4. Запустить `npm test -- --run` и `cargo test --manifest-path src-tauri\Cargo.toml`; тесты проверяют совпадение полного контракта packs.
5. Shipping build выполняется через `npm run build` и копирует `locales` рядом с release executable.
