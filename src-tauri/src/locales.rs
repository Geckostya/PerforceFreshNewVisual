use std::{collections::BTreeMap, fs, path::PathBuf};

use crate::models::{LocaleBundle, LocaleCatalog};

const ENGLISH: &str = include_str!("../../locales/en.json");
const RUSSIAN: &str = include_str!("../../locales/ru.json");

pub fn load(directories: &[PathBuf]) -> LocaleCatalog {
    let english: LocaleBundle =
        serde_json::from_str(ENGLISH).expect("invalid built-in English locale");
    let required_keys: Vec<String> = english.translations.keys().cloned().collect();
    let mut locales = BTreeMap::from([(english.code.clone(), english)]);
    let mut warnings = Vec::new();

    add_locale(
        RUSSIAN.as_bytes(),
        "built-in ru",
        &required_keys,
        &mut locales,
        &mut warnings,
    );
    for directory in directories {
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                warnings.push(format!("{}: {error}", directory.display()));
                continue;
            }
        };
        let mut paths: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
            })
            .collect();
        paths.sort();
        for path in paths {
            match fs::read(&path) {
                Ok(bytes) => add_locale(
                    &bytes,
                    &path.display().to_string(),
                    &required_keys,
                    &mut locales,
                    &mut warnings,
                ),
                Err(error) => warnings.push(format!("{}: {error}", path.display())),
            }
        }
    }

    LocaleCatalog {
        locales: locales.into_values().collect(),
        warnings,
    }
}

fn add_locale(
    bytes: &[u8],
    source: &str,
    required_keys: &[String],
    locales: &mut BTreeMap<String, LocaleBundle>,
    warnings: &mut Vec<String>,
) {
    let locale = match serde_json::from_slice::<LocaleBundle>(bytes) {
        Ok(locale) => locale,
        Err(error) => {
            warnings.push(format!("{source}: {error}"));
            return;
        }
    };
    if !valid_code(&locale.code) || locale.name.trim().is_empty() {
        warnings.push(format!("{source}: invalid code or name"));
        return;
    }
    let missing: Vec<_> = required_keys
        .iter()
        .filter(|key| !locale.translations.contains_key(*key))
        .collect();
    if !missing.is_empty() {
        warnings.push(format!(
            "{source}: {} missing translation keys",
            missing.len()
        ));
        return;
    }
    locales.insert(locale.code.clone(), locale);
}

fn valid_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_locales_have_the_same_complete_contract() {
        let catalog = load(&[]);

        assert!(catalog.warnings.is_empty());
        assert_eq!(catalog.locales.len(), 2);
        assert_eq!(catalog.locales[0].code, "en");
        assert_eq!(catalog.locales[1].code, "ru");
    }

    #[test]
    fn incomplete_external_locale_is_ignored_without_breaking_fallbacks() {
        let mut locales = BTreeMap::new();
        let mut warnings = Vec::new();
        add_locale(
            br#"{"code":"de","name":"Deutsch","translations":{"title":"Verbinden"}}"#,
            "de.json",
            &["title".to_owned(), "intro".to_owned()],
            &mut locales,
            &mut warnings,
        );

        assert!(locales.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn complete_external_locale_is_discovered_without_rebuilding() {
        let directory = std::env::temp_dir().join(format!(
            "p4fnv-locales-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let mut locale: LocaleBundle = serde_json::from_str(ENGLISH).unwrap();
        locale.code = "test".to_owned();
        locale.name = "Test language".to_owned();
        fs::write(
            directory.join("test.json"),
            serde_json::to_vec(&locale).unwrap(),
        )
        .unwrap();

        let catalog = load(std::slice::from_ref(&directory));

        assert!(catalog.warnings.is_empty());
        assert!(catalog.locales.iter().any(|item| item.code == "test"));
        fs::remove_dir_all(directory).unwrap();
    }
}
