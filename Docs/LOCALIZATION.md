# Language packs

P4FNV loads languages from separate JSON files at startup. Adding a language does not require rebuilding the application.

## File locations

Shipping directory:

```text
p4fnv.exe
locales/
  en.json
  ru.json
  de.json       # additional pack
```

User packs may also be placed in the app config directory:

```text
Windows: %APPDATA%\dev.p4fnv.client\locales
```

The directory is created after the first launch. A pack in the app config directory overrides a pack with the same `code` beside the executable. Restart the application after adding or changing a file.

## Format

```json
{
  "code": "de",
  "name": "Deutsch",
  "translations": {
    "headerSubtitle": "Helix Core Desktop-Client"
  }
}
```

- `code` is a unique code containing ASCII letters, digits, `-`, or `_`, with a maximum of 32 characters;
- `name` is the language's self-name shown in the list;
- `translations` must contain every key from [`locales/en.json`](../locales/en.json).

An incomplete or damaged file is skipped while other languages continue to work. The English dictionary is embedded as an emergency fallback. Additional keys are allowed and do not interfere with loading.

## Changing application strings

1. Add the same key to `locales/en.json` and `locales/ru.json`.
2. Use `t("key")`; the `TranslationKey` type is inferred from the English pack.
3. Do not put user-facing text in Rust diagnostics: the backend returns a stable `ErrorKind`, and the frontend selects a localized string.
4. Run `npm test -- --run` and `cargo test --manifest-path src-tauri\Cargo.toml`; tests verify that the complete pack contracts match.
5. The shipping build runs through `npm run build` and copies `locales` beside the release executable.
