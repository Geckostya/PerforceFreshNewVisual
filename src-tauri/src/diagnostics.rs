use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde_json::Value;

use crate::{
    models::{AppError, ErrorKind},
    settings,
};

const UI_SNAPSHOT_PATH: &str = "P4FNV_UI_SNAPSHOT_PATH";
const UI_AGENT_COMMAND_PATH: &str = "P4FNV_AGENT_COMMAND_PATH";
const UI_AGENT_RESPONSE_PATH: &str = "P4FNV_AGENT_RESPONSE_PATH";
const UI_AGENT_TOKEN: &str = "P4FNV_AGENT_TOKEN";
const MAX_UI_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
const MAX_UI_AGENT_MESSAGE_BYTES: usize = 64 * 1024;
static UI_SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

pub fn ui_snapshot_enabled() -> bool {
    ui_snapshot_path().is_some()
}

pub fn write_ui_snapshot(snapshot: &Value) -> Result<(), AppError> {
    let Some(path) = ui_snapshot_path() else {
        return Ok(());
    };
    let contents = serde_json::to_vec_pretty(snapshot).map_err(snapshot_error)?;
    if contents.len() > MAX_UI_SNAPSHOT_BYTES {
        return Err(AppError::new(
            ErrorKind::InvalidOutput,
            "UI snapshot превышает допустимый размер.",
        ));
    }
    write_snapshot_file(&path, &contents)
}

pub fn read_ui_agent_command(last_request_id: Option<&str>) -> Result<Option<Value>, AppError> {
    let Some(path) = ui_agent_command_path() else {
        return Ok(None);
    };
    let contents = match fs::read(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(agent_error(error)),
    };
    if contents.len() > MAX_UI_AGENT_MESSAGE_BYTES {
        return Err(AppError::new(
            ErrorKind::InvalidOutput,
            "Команда UI agent превышает допустимый размер.",
        ));
    }
    let command: Value = serde_json::from_slice(&contents).map_err(agent_error)?;
    validate_agent_message(&command, true)?;
    if command.get("id").and_then(Value::as_str) == last_request_id {
        return Ok(None);
    }
    Ok(Some(command))
}

pub fn write_ui_agent_response(response: &Value) -> Result<(), AppError> {
    let Some(path) = ui_agent_response_path() else {
        return Ok(());
    };
    validate_agent_message(response, false)?;
    let contents = serde_json::to_vec_pretty(response).map_err(agent_error)?;
    if contents.len() > MAX_UI_AGENT_MESSAGE_BYTES {
        return Err(AppError::new(
            ErrorKind::InvalidOutput,
            "Ответ UI agent превышает допустимый размер.",
        ));
    }
    write_snapshot_file(&path, &contents)
}

fn ui_snapshot_path() -> Option<PathBuf> {
    std::env::var_os(UI_SNAPSHOT_PATH)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn ui_agent_command_path() -> Option<PathBuf> {
    environment_path(UI_AGENT_COMMAND_PATH)
}

fn ui_agent_response_path() -> Option<PathBuf> {
    environment_path(UI_AGENT_RESPONSE_PATH)
}

fn ui_agent_token() -> Option<String> {
    std::env::var(UI_AGENT_TOKEN)
        .ok()
        .filter(|value| !value.is_empty())
}

fn environment_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn validate_agent_message(value: &Value, command: bool) -> Result<(), AppError> {
    let object = value.as_object().ok_or_else(invalid_agent_message)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(invalid_agent_message)?;
    let token = object
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(invalid_agent_message)?;
    let expected_token = ui_agent_token().ok_or_else(invalid_agent_message)?;
    if token != expected_token || id.chars().any(char::is_control) {
        return Err(invalid_agent_message());
    }
    if command {
        let method = object
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(invalid_agent_message)?;
        if !matches!(method, "ui.click" | "ui.input" | "ui.key" | "ui.focus" | "ui.resize") {
            return Err(invalid_agent_message());
        }
        if object
            .get("expectedStateVersion")
            .and_then(Value::as_u64)
            .is_none()
            || (method != "ui.resize" && object
                .get("target")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 256)
                .is_none())
        {
            return Err(invalid_agent_message());
        }
        if method == "ui.resize" {
            let width = object.get("width").and_then(Value::as_u64).ok_or_else(invalid_agent_message)?;
            let height = object.get("height").and_then(Value::as_u64).ok_or_else(invalid_agent_message)?;
            if !(640..=4_000).contains(&width) || !(480..=3_000).contains(&height) {
                return Err(invalid_agent_message());
            }
        }
    }
    Ok(())
}

fn invalid_agent_message() -> AppError {
    AppError::new(ErrorKind::InvalidOutput, "Некорректная команда UI agent.")
}

fn write_snapshot_file(path: &Path, contents: &[u8]) -> Result<(), AppError> {
    let _guard = UI_SNAPSHOT_LOCK.lock().map_err(snapshot_error)?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| AppError::new(ErrorKind::Settings, "Некорректный путь к UI snapshot."))?;
    fs::create_dir_all(parent).map_err(snapshot_error)?;
    let temporary = temporary_path(path);
    if let Err(error) = fs::write(&temporary, contents) {
        let _ = fs::remove_file(&temporary);
        return Err(snapshot_error(error));
    }
    if let Err(error) = settings::replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(snapshot_error(error));
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut value: OsString = path.as_os_str().to_owned();
    value.push(".tmp");
    PathBuf::from(value)
}

fn snapshot_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Settings, "Не удалось записать UI snapshot.")
        .with_diagnostics(error.to_string())
}

fn agent_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        ErrorKind::Settings,
        "Не удалось обработать сообщение UI agent.",
    )
    .with_diagnostics(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{UI_AGENT_TOKEN, validate_agent_message, write_snapshot_file};
    use serde_json::json;
    use std::{fs, time::SystemTime};

    #[test]
    fn replaces_ui_snapshot_without_leaving_a_partial_file() {
        let directory = std::env::temp_dir().join(format!(
            "p4fnv-ui-snapshot-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = directory.join("ui.json");
        write_snapshot_file(&path, br#"{"screen":"files"}"#).unwrap();
        write_snapshot_file(&path, br#"{"screen":"streams"}"#).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"screen":"streams"}"#
        );
        assert!(!directory.join("ui.json.tmp").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn accepts_only_allow_listed_agent_commands_with_the_session_token() {
        unsafe { std::env::set_var(UI_AGENT_TOKEN, "test-token") };
        let valid = json!({
            "id": "request-1",
            "token": "test-token",
            "method": "ui.click",
            "expectedStateVersion": 4,
            "target": "id:refresh"
        });
        assert!(validate_agent_message(&valid, true).is_ok());

        let arbitrary = json!({
            "id": "request-2",
            "token": "test-token",
            "method": "run_p4",
            "expectedStateVersion": 4,
            "target": "p4 sync -f //..."
        });
        assert!(validate_agent_message(&arbitrary, true).is_err());
        unsafe { std::env::remove_var(UI_AGENT_TOKEN) };
    }
}
