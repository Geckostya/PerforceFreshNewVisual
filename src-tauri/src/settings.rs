use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::models::{AppError, AppSettings, ConnectionInput, ErrorKind};

const MAX_RECENT_CONNECTIONS: usize = 10;
const MAX_FAVORITE_CONNECTIONS: usize = 20;
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

pub fn load(path: &Path) -> Result<AppSettings, AppError> {
    let _guard = SETTINGS_LOCK.lock().map_err(lock_error)?;
    load_unlocked(path)
}

pub fn save_language(path: &Path, language: String) -> Result<(), AppError> {
    let _guard = SETTINGS_LOCK.lock().map_err(lock_error)?;
    if !valid_language_code(&language) {
        return Err(AppError::new(
            ErrorKind::Settings,
            "Некорректный код языка.",
        ));
    }
    let mut settings = load_unlocked(path)?;
    settings.language = language;
    save_unlocked(path, &settings)
}

pub fn save_revert_preference(path: &Path, delete_added_files: bool) -> Result<(), AppError> {
    let _guard = SETTINGS_LOCK.lock().map_err(lock_error)?;
    let mut settings = load_unlocked(path)?;
    settings.delete_added_files_on_revert = delete_added_files;
    save_unlocked(path, &settings)
}

fn valid_language_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub fn remember_connection(path: &Path, input: ConnectionInput) -> Result<AppSettings, AppError> {
    let _guard = SETTINGS_LOCK.lock().map_err(lock_error)?;
    let mut settings = load_unlocked(path)?;
    remember(&mut settings, normalize(input));
    save_unlocked(path, &settings)?;
    Ok(settings)
}

pub fn toggle_favorite_connection(
    path: &Path,
    input: ConnectionInput,
) -> Result<AppSettings, AppError> {
    let _guard = SETTINGS_LOCK.lock().map_err(lock_error)?;
    let mut settings = load_unlocked(path)?;
    let input = normalize(input);
    if let Some(index) = settings
        .favorite_connections
        .iter()
        .position(|existing| same_connection(existing, &input))
    {
        settings.favorite_connections.remove(index);
    } else {
        settings.favorite_connections.insert(0, input);
        settings
            .favorite_connections
            .truncate(MAX_FAVORITE_CONNECTIONS);
    }
    save_unlocked(path, &settings)?;
    Ok(settings)
}

fn load_unlocked(path: &Path) -> Result<AppSettings, AppError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
            settings_error("Файл настроек повреждён.", error)
                .with_hint("Исправьте или удалите settings.json вручную.")
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppSettings::default()),
        Err(error) => Err(settings_error("Не удалось прочитать настройки.", error)),
    }
}

fn save_unlocked(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new(ErrorKind::Settings, "Некорректный путь к настройкам."))?;
    fs::create_dir_all(parent)
        .map_err(|error| settings_error("Не удалось создать папку настроек.", error))?;

    let temporary = temporary_path(path);
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|error| settings_error("Не удалось подготовить настройки.", error))?;
    fs::write(&temporary, bytes)
        .map_err(|error| settings_error("Не удалось записать настройки.", error))?;
    replace_file(&temporary, path)
        .map_err(|error| settings_error("Не удалось сохранить настройки.", error))
}

fn remember(settings: &mut AppSettings, input: ConnectionInput) {
    settings.recent_connections.retain(|existing| {
        existing.port != input.port
            || existing.user != input.user
            || existing.client != input.client
    });
    settings.recent_connections.insert(0, input);
    settings.recent_connections.truncate(MAX_RECENT_CONNECTIONS);
}

fn same_connection(left: &ConnectionInput, right: &ConnectionInput) -> bool {
    left.port == right.port
        && left.user == right.user
        && left.client == right.client
        && left.p4_path == right.p4_path
        && left.charset == right.charset
        && left.p4_config == right.p4_config
        && left.p4_enviro == right.p4_enviro
}

fn normalize(mut input: ConnectionInput) -> ConnectionInput {
    input.port = input.port.trim().to_owned();
    input.user = input.user.trim().to_owned();
    input.p4_path = trimmed(input.p4_path);
    input.client = trimmed(input.client);
    input.charset = trimmed(input.charset);
    input.p4_config = trimmed(input.p4_config);
    input.p4_enviro = trimmed(input.p4_enviro);
    input
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    PathBuf::from(name)
}

#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn settings_error(message: &str, error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Settings, message).with_diagnostics(error.to_string())
}

fn lock_error(error: impl std::fmt::Display) -> AppError {
    settings_error("Настройки временно недоступны.", error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(port: &str, user: &str, client: &str) -> ConnectionInput {
        ConnectionInput {
            p4_path: None,
            port: port.to_owned(),
            user: user.to_owned(),
            client: Some(client.to_owned()),
            charset: None,
            p4_config: None,
            p4_enviro: None,
        }
    }

    #[test]
    fn recent_connections_are_deduplicated_and_bounded() {
        let mut settings = AppSettings::default();
        for index in 0..12 {
            remember(
                &mut settings,
                connection("p4:1666", "alex", &format!("workspace-{index}")),
            );
        }
        remember(&mut settings, connection("p4:1666", "alex", "workspace-5"));

        assert_eq!(settings.recent_connections.len(), 10);
        assert_eq!(
            settings.recent_connections[0].client.as_deref(),
            Some("workspace-5")
        );
        assert_eq!(
            settings
                .recent_connections
                .iter()
                .filter(|item| item.client.as_deref() == Some("workspace-5"))
                .count(),
            1
        );
    }

    #[test]
    fn favorite_connections_toggle_and_are_bounded() {
        let mut settings = AppSettings::default();
        let favorite = connection("ssl:p4:1666", "alex", "main");
        let normalized = normalize(favorite.clone());
        settings.favorite_connections.push(normalized.clone());
        assert!(same_connection(
            &settings.favorite_connections[0],
            &normalized
        ));
        settings
            .favorite_connections
            .retain(|item| !same_connection(item, &normalized));
        assert!(settings.favorite_connections.is_empty());
        for index in 0..25 {
            settings.favorite_connections.push(connection(
                "p4:1666",
                "alex",
                &format!("ws-{index}"),
            ));
        }
        settings
            .favorite_connections
            .truncate(MAX_FAVORITE_CONNECTIONS);
        assert_eq!(settings.favorite_connections.len(), 20);
    }

    #[test]
    fn settings_round_trip_through_an_atomic_file() {
        let directory = std::env::temp_dir().join(format!(
            "p4fnv-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = directory.join("settings.json");
        let mut expected = AppSettings {
            language: "en".to_owned(),
            delete_added_files_on_revert: true,
            ..Default::default()
        };
        expected
            .recent_connections
            .push(connection("ssl:p4:1666", "alex", "main"));

        save_unlocked(&path, &expected).unwrap();
        assert_eq!(load_unlocked(&path).unwrap(), expected);
        fs::remove_dir_all(directory).unwrap();
    }
}
