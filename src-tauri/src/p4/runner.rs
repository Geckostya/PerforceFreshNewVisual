use std::{
    env,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Map, Value};

use crate::models::{AppError, CliLogEntry, CliLogLevel, ConnectionInput, ErrorKind};

const MAX_CLI_LOG_ENTRIES: usize = 500;
static CLI_LOG: OnceLock<Mutex<Vec<CliLogEntry>>> = OnceLock::new();
static CLI_LOG_ID: AtomicU64 = AtomicU64::new(1);

pub fn cli_log() -> Vec<CliLogEntry> {
    CLI_LOG
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default()
}

pub fn clear_cli_log() {
    if let Ok(mut entries) = CLI_LOG.get_or_init(|| Mutex::new(Vec::new())).lock() {
        entries.clear();
    }
}

pub(super) fn configured_command(input: &ConnectionInput) -> Result<(PathBuf, Command), AppError> {
    let path = resolve_executable(input.p4_path.as_deref())?;
    let mut command = p4_command(&path);
    set_non_empty_env(&mut command, "P4PORT", Some(&input.port));
    set_non_empty_env(&mut command, "P4USER", Some(&input.user));
    set_non_empty_env(&mut command, "P4CLIENT", input.client.as_deref());
    set_non_empty_env(&mut command, "P4CHARSET", input.charset.as_deref());
    set_non_empty_env(&mut command, "P4CONFIG", input.p4_config.as_deref());
    set_non_empty_env(&mut command, "P4ENVIRO", input.p4_enviro.as_deref());
    Ok((path, command))
}

pub(super) fn run_json(
    path: &Path,
    command: &mut Command,
) -> Result<Vec<Map<String, Value>>, AppError> {
    run_json_with_empty_match_policy(path, command, false)
}

pub(super) fn run_json_allowing_empty_match(
    path: &Path,
    command: &mut Command,
) -> Result<Vec<Map<String, Value>>, AppError> {
    run_json_with_empty_match_policy(path, command, true)
}

pub(super) fn run_json_with_stdin_allowing_empty_match(
    path: &Path,
    command: &mut Command,
    input: &[u8],
) -> Result<Vec<Map<String, Value>>, AppError> {
    run_json_with_stdin_policy(path, command, input, true)
}

fn run_json_with_stdin_policy(
    path: &Path,
    command: &mut Command,
    input: &[u8],
    suppress_empty_match_warning: bool,
) -> Result<Vec<Map<String, Value>>, AppError> {
    let output = run_output_with_stdin(path, command, input)?;
    let records = parse_json_lines(&String::from_utf8_lossy(&output.stdout))?;
    log_record_messages(&records, suppress_empty_match_warning);
    if let Some(message) = perforce_error(&records) {
        return Err(classified_command_error(message, &output));
    }
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(records)
}

fn run_json_with_empty_match_policy(
    path: &Path,
    command: &mut Command,
    suppress_empty_match_warning: bool,
) -> Result<Vec<Map<String, Value>>, AppError> {
    let output = command
        .output()
        .map_err(|error| launch_error(path, error))?;
    let records = parse_json_lines(&String::from_utf8_lossy(&output.stdout))?;
    log_record_messages(&records, suppress_empty_match_warning);
    if let Some(message) = perforce_error(&records) {
        return Err(classified_command_error(message, &output));
    }
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(records)
}

pub(super) fn run_binary(path: &Path, command: &mut Command) -> Result<Vec<u8>, AppError> {
    let output = command
        .output()
        .map_err(|error| launch_error(path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    Ok(output.stdout)
}

pub(super) fn run_output_with_stdin(
    path: &Path,
    command: &mut Command,
    input: &[u8],
) -> Result<Output, AppError> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| launch_error(path, error))?;
    child
        .stdin
        .take()
        .ok_or_else(|| AppError::new(ErrorKind::CommandFailed, "Не удалось открыть stdin p4."))?
        .write_all(input)
        .map_err(|error| {
            AppError::new(ErrorKind::CommandFailed, "Не удалось передать данные в p4.")
                .with_diagnostics(error.to_string())
        })?;
    child.wait_with_output().map_err(|error| {
        AppError::new(ErrorKind::CommandFailed, "Не удалось дождаться ответа p4.")
            .with_diagnostics(error.to_string())
    })
}

pub(super) fn resolve_executable(explicit_path: Option<&str>) -> Result<PathBuf, AppError> {
    if let Some(value) = explicit_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }

        return Err(AppError::new(
            ErrorKind::ExecutableNotFound,
            "По указанному пути нет p4 CLI.",
        )
        .with_hint("Проверьте путь к p4.exe и повторите поиск.")
        .with_diagnostics(path.to_string_lossy()));
    }

    let executable = if cfg!(windows) { "p4.exe" } else { "p4" };
    let found = env::var_os("PATH")
        .into_iter()
        .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file());

    found.ok_or_else(|| {
        AppError::new(ErrorKind::ExecutableNotFound, "p4 CLI не найден в PATH.")
            .with_hint("Установите Helix Core Command-Line Client или укажите путь вручную.")
    })
}

pub(super) fn p4_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub(super) fn set_non_empty_env(command: &mut Command, name: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        command.env(name, value);
    }
}

pub(super) fn parse_json_lines(text: &str) -> Result<Vec<Map<String, Value>>, AppError> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str::<Map<String, Value>>(line).map_err(|error| {
                push_cli_log(
                    CliLogLevel::Error,
                    "p4 вернул ответ в неизвестном формате.".to_owned(),
                    Some(format!("Строка {}: {error}", index + 1)),
                );
                AppError::new(
                    ErrorKind::InvalidOutput,
                    "p4 вернул ответ в неизвестном формате.",
                )
                .with_hint("Проверьте, что используется современная версия p4 CLI.")
                .with_diagnostics(format!("Строка {}: {error}", index + 1))
            })
        })
        .collect()
}

pub(super) fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn perforce_error(records: &[Map<String, Value>]) -> Option<String> {
    records.iter().find_map(|record| {
        let is_error_code = record
            .get("code")
            .and_then(Value::as_str)
            .is_some_and(|code| code.eq_ignore_ascii_case("error"));
        let is_error_severity = record
            .get("severity")
            .and_then(Value::as_i64)
            .is_some_and(|severity| severity >= 3);

        (is_error_code || is_error_severity)
            .then(|| record.get("data").or_else(|| record.get("fmt")))
            .flatten()
            .and_then(value_text)
    })
}

fn log_record_messages(records: &[Map<String, Value>], suppress_empty_match_warning: bool) {
    for record in records {
        if suppress_empty_match_warning && is_empty_match_record(record) {
            continue;
        }
        let severity = record
            .get("severity")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let code = record
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let level = if severity >= 3 || code.eq_ignore_ascii_case("error") {
            Some(CliLogLevel::Error)
        } else if severity == 2 || code.eq_ignore_ascii_case("warning") {
            Some(CliLogLevel::Warning)
        } else {
            None
        };
        if let Some(level) = level
            && let Some(message) = record
                .get("data")
                .or_else(|| record.get("fmt"))
                .and_then(value_text)
        {
            push_cli_log(level, message, None);
        }
    }
}

fn is_empty_match_record(record: &Map<String, Value>) -> bool {
    record.get("severity").and_then(Value::as_i64) == Some(2)
        && record.get("generic").and_then(Value::as_i64) == Some(17)
}

pub(super) fn push_cli_log(level: CliLogLevel, message: String, details: Option<String>) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let entry = CliLogEntry {
        id: CLI_LOG_ID.fetch_add(1, Ordering::Relaxed),
        level,
        message,
        details,
        timestamp_ms,
    };
    if let Ok(mut entries) = CLI_LOG.get_or_init(|| Mutex::new(Vec::new())).lock() {
        entries.push(entry);
        if entries.len() > MAX_CLI_LOG_ENTRIES {
            let excess = entries.len() - MAX_CLI_LOG_ENTRIES;
            entries.drain(..excess);
        }
    }
}

pub(super) fn launch_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::new(
        ErrorKind::ExecutableNotFound,
        "Не удалось запустить p4 CLI.",
    )
    .with_hint("Проверьте путь и права на запуск файла.")
    .with_diagnostics(format!("{}: {error}", path.display()))
}

pub(super) fn command_error(output: &Output) -> AppError {
    let details = combined_output(output);
    push_cli_log(
        CliLogLevel::Error,
        details.trim().to_owned(),
        Some(format!(
            "Exit code: {}",
            output
                .status
                .code()
                .map_or_else(|| "unknown".to_owned(), |code| code.to_string())
        )),
    );
    classified_command_error(details.trim().to_owned(), output)
}

pub(super) fn log_stderr_warning(output: &Output, message: &str) {
    let details = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !details.is_empty() {
        push_cli_log(CliLogLevel::Warning, message.to_owned(), Some(details));
    }
}

fn classified_command_error(message: String, output: &Output) -> AppError {
    let (kind, user_message, hint) = classify_error_message(&message);

    AppError::new(kind, user_message)
        .with_hint(hint)
        .with_diagnostics(format!(
            "Код завершения: {}\n{}",
            output
                .status
                .code()
                .map_or_else(|| "нет".to_owned(), |code| code.to_string()),
            message.trim()
        ))
}

fn classify_error_message(message: &str) -> (ErrorKind, &'static str, &'static str) {
    let normalized = message.to_lowercase();
    if normalized.contains("cancelled") || normalized.contains("canceled") {
        (
            ErrorKind::Cancelled,
            "Операция отменена.",
            "Состояние workspace перечитано; при необходимости повторите операцию.",
        )
    } else if normalized.contains("stale") || normalized.contains("preview expired") {
        (
            ErrorKind::Stale,
            "Предварительный результат устарел.",
            "Обновите данные и повторите preview перед применением.",
        )
    } else if normalized.contains("maxresults")
        || normalized.contains("maxscan")
        || normalized.contains("maxlocktime")
        || normalized.contains("output truncated")
    {
        (
            ErrorKind::PartialResult,
            "Perforce вернул неполный результат.",
            "Сузьте область или фильтр и повторите запрос.",
        )
    } else if normalized.contains("authenticity")
        || normalized.contains("p4 trust")
        || normalized.contains("fingerprint")
    {
        (
            ErrorKind::Trust,
            "Сертификат сервера ещё не подтверждён.",
            "Проверка SSL trust будет предложена отдельным безопасным шагом.",
        )
    } else if normalized.contains("password")
        || normalized.contains("not logged in")
        || normalized.contains("ticket")
    {
        (
            ErrorKind::Auth,
            "Сервер требует вход.",
            "Войдите в Helix Core и повторите проверку.",
        )
    } else if normalized.contains("resolve")
        || normalized.contains("out of date")
        || normalized.contains("out-of-date")
        || normalized.contains("locked")
        || normalized.contains("other user")
    {
        (
            ErrorKind::Conflict,
            "Операция конфликтует с текущим состоянием файлов.",
            "Обновите состояние, выполните resolve или устраните lock/open conflict.",
        )
    } else if normalized.contains("permission") || normalized.contains("protections") {
        (
            ErrorKind::Permission,
            "Недостаточно прав для этой операции.",
            "Проверьте пользователя и доступ к серверу.",
        )
    } else if normalized.contains("connect to server failed")
        || normalized.contains("tcp connect")
        || normalized.contains("network is unreachable")
        || normalized.contains("connection refused")
        || normalized.contains("name resolution")
    {
        (
            ErrorKind::Offline,
            "p4 не смог подключиться к серверу.",
            "Проверьте адрес сервера, сеть и параметры подключения.",
        )
    } else {
        (
            ErrorKind::CommandFailed,
            "Perforce отклонил операцию.",
            "Откройте технические детали, чтобы увидеть точную причину.",
        )
    }
}

pub(super) fn combined_output(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{}\n{}", stdout.trim(), stderr.trim()),
        (false, true) => stdout.into_owned(),
        (true, false) => stderr.into_owned(),
        (true, true) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_error_message, is_empty_match_record, parse_json_lines};
    use crate::models::ErrorKind;

    #[test]
    fn classifies_recovery_relevant_error_kinds() {
        assert_eq!(
            classify_error_message("operation cancelled").0,
            ErrorKind::Cancelled
        );
        assert_eq!(
            classify_error_message("preview expired").0,
            ErrorKind::Stale
        );
        assert_eq!(
            classify_error_message("maxscan limit reached").0,
            ErrorKind::PartialResult
        );
    }

    #[test]
    fn recognizes_only_the_expected_empty_match_diagnostic() {
        let records = parse_json_lines(
            r#"{"data":"//alex-main/Campfire/* - no such file(s).\n","generic":17,"severity":2}
{"data":"//alex-main/.p4config - file(s) not on client.\n","generic":17,"severity":2}
{"code":"warning","data":"A real warning.","severity":2}"#,
        )
        .unwrap();

        assert!(is_empty_match_record(&records[0]));
        assert!(is_empty_match_record(&records[1]));
        assert!(!is_empty_match_record(&records[2]));
    }
}
