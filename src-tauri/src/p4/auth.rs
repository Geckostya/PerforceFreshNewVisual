use std::process::Output;

use serde_json::Value;

use crate::models::{AppError, AuthStage, AuthStageKind, ConnectionInput, ErrorKind};

use super::runner::{combined_output, configured_command, launch_error, run_output_with_stdin};
use super::validation::validate_password;

pub(super) const MAX_POLLING_ATTEMPTS: u8 = 20;

pub(super) struct AuthStepResult {
    pub stage: AuthStage,
    pub browser_url: Option<String>,
}

pub(super) fn password_login(input: &ConnectionInput, password: &str) -> Result<(), AppError> {
    validate_password(password)?;
    if password.len() > 4096 || password.contains('\0') {
        return Err(AppError::new(ErrorKind::Auth, "The password is too long."));
    }
    let (path, mut command) = configured_command(input)?;
    command.arg("login");
    let output = run_output_with_stdin(&path, &mut command, format!("{password}\n").as_bytes())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(redacted_auth_error())
    }
}

pub(super) fn begin(input: &ConnectionInput) -> Result<AuthStage, AppError> {
    let output = run_sensitive(input, begin_arguments(), None)?;
    let text = combined_output(&output);
    if is_unsupported(&text) {
        return Ok(stage(AuthStageKind::Unsupported, Vec::new(), 0));
    }
    let methods = parse_methods(&text);
    if !output.status.success() && methods.is_empty() {
        return Err(redacted_auth_error());
    }
    if methods.is_empty() {
        return Ok(stage(AuthStageKind::PasswordRequired, Vec::new(), 0));
    }
    Ok(stage(AuthStageKind::MethodSelection, methods, 0))
}

pub(super) fn select_method(
    input: &ConnectionInput,
    requested_method: &str,
) -> Result<AuthStepResult, AppError> {
    let available = begin(input)?;
    if matches!(
        &available.kind,
        AuthStageKind::Unsupported | AuthStageKind::PasswordRequired
    ) {
        return Ok(AuthStepResult {
            stage: available,
            browser_url: None,
        });
    }
    let method = requested_method.trim();
    if method.is_empty()
        || method.len() > 128
        || method.contains(['\r', '\n', '\0'])
        || !available
            .methods
            .iter()
            .any(|candidate| candidate == method)
    {
        return Err(AppError::new(
            ErrorKind::Auth,
            "The selected authentication method is not available.",
        ));
    }
    let (path, mut command) = configured_command(input)?;
    command.args(init_arguments(method));
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    let text = combined_output(&output);
    let browser_url = extract_http_url(&text);
    let kind = if browser_url.is_some() {
        AuthStageKind::ExternalBrowser
    } else if requests_response(&text) {
        AuthStageKind::SecondFactor
    } else if indicates_success(&text) {
        AuthStageKind::Success
    } else if output.status.success() || indicates_waiting(&text) {
        AuthStageKind::Waiting
    } else {
        AuthStageKind::Failed
    };
    Ok(AuthStepResult {
        stage: stage(kind, Vec::new(), 0),
        browser_url,
    })
}

pub(super) fn check(
    input: &ConnectionInput,
    response: Option<&str>,
    polling_attempt: u8,
) -> Result<AuthStage, AppError> {
    if polling_attempt >= MAX_POLLING_ATTEMPTS {
        return Ok(stage(
            AuthStageKind::Expired,
            Vec::new(),
            MAX_POLLING_ATTEMPTS,
        ));
    }
    if let Some(response) = response {
        validate_secret(response, "authentication response")?;
    }
    let stdin = response.map(|value| format!("{value}\n"));
    let output = run_sensitive(input, check_arguments(), stdin.as_deref())?;
    let text = combined_output(&output);
    let next_attempt = polling_attempt.saturating_add(1);
    let kind = if indicates_success(&text) {
        AuthStageKind::Success
    } else if indicates_expired(&text) {
        AuthStageKind::Expired
    } else if indicates_cancelled(&text) {
        AuthStageKind::Cancelled
    } else if requests_response(&text) {
        AuthStageKind::SecondFactor
    } else if output.status.success() || indicates_waiting(&text) {
        AuthStageKind::Waiting
    } else {
        AuthStageKind::Failed
    };
    Ok(stage(kind, Vec::new(), next_attempt))
}

fn run_sensitive<const N: usize>(
    input: &ConnectionInput,
    arguments: [&str; N],
    stdin: Option<&str>,
) -> Result<Output, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(arguments);
    match stdin {
        Some(value) => run_output_with_stdin(&path, &mut command, value.as_bytes()),
        None => command.output().map_err(|error| launch_error(&path, error)),
    }
}

fn begin_arguments() -> [&'static str; 5] {
    ["-ztag", "-Mj", "login2", "-S", "list-methods"]
}

fn init_arguments(method: &str) -> Vec<String> {
    ["-ztag", "-Mj", "login2", "-S", "init-auth", "-m", method]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

fn check_arguments() -> [&'static str; 5] {
    ["-ztag", "-Mj", "login2", "-S", "check-auth"]
}

fn stage(kind: AuthStageKind, methods: Vec<String>, polling_attempt: u8) -> AuthStage {
    AuthStage {
        kind,
        methods,
        polling_attempt,
        max_polling_attempts: MAX_POLLING_ATTEMPTS,
    }
}

fn validate_secret(value: &str, name: &str) -> Result<(), AppError> {
    if value.is_empty() || value.len() > 4096 || value.contains(['\r', '\n', '\0']) {
        Err(AppError::new(
            ErrorKind::Auth,
            format!("The {name} is empty or too long."),
        ))
    } else {
        Ok(())
    }
}

fn redacted_auth_error() -> AppError {
    AppError::new(ErrorKind::Auth, "Authentication was not completed.")
        .with_hint("Retry the server-provided authentication flow or use password sign-in.")
}

fn parse_methods(text: &str) -> Vec<String> {
    let mut methods = Vec::new();
    for line in text.lines() {
        if let Ok(record) = serde_json::from_str::<serde_json::Map<String, Value>>(line) {
            for (key, value) in record {
                if key.to_ascii_lowercase().starts_with("method")
                    && let Some(value) = value.as_str()
                    && valid_method_label(value)
                {
                    methods.push(value.trim().to_owned());
                } else if matches!(key.as_str(), "data" | "message")
                    && let Some(value) = value.as_str()
                {
                    methods.extend(parse_plain_methods(value));
                }
            }
            continue;
        }
        methods.extend(parse_plain_methods(line));
    }
    methods.sort();
    methods.dedup();
    methods
}

fn parse_plain_methods(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let candidate = trimmed
                .strip_prefix("Method:")
                .or_else(|| trimmed.strip_prefix("method:"))
                .map(str::trim)
                .or_else(|| {
                    trimmed
                        .strip_prefix('-')
                        .or_else(|| trimmed.strip_prefix('*'))
                        .map(str::trim)
                })
                .or_else(|| {
                    let (number, value) = trimmed.split_once(':')?;
                    number
                        .chars()
                        .all(|character| character.is_ascii_digit())
                        .then_some(value.trim())
                });
            candidate
                .filter(|candidate| valid_method_label(candidate))
                .map(str::to_owned)
        })
        .collect()
}

fn valid_method_label(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 128
        && !value.contains(['\r', '\n', '\0'])
        && !value.starts_with("http://")
        && !value.starts_with("https://")
}

fn extract_http_url(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Ok(record) = serde_json::from_str::<serde_json::Map<String, Value>>(line) {
            for value in record.values().filter_map(Value::as_str) {
                if let Some(url) = extract_http_url_tokens(value) {
                    return Some(url);
                }
            }
        }
    }
    extract_http_url_tokens(text)
}

fn extract_http_url_tokens(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|value| {
            value.trim_matches(|character: char| {
                matches!(character, '\'' | '"' | '(' | ')' | ',' | ';')
            })
        })
        .find(|value| valid_http_url(value))
        .map(str::to_owned)
}

fn valid_http_url(value: &str) -> bool {
    if value.len() > 2048 || value.chars().any(char::is_whitespace) || !value.is_ascii() {
        return false;
    }
    let authority = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    authority.is_some_and(|rest| {
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        !host.is_empty() && host != "." && !host.contains('@')
    })
}

fn normalized(text: &str) -> String {
    text.to_ascii_lowercase()
}

fn is_unsupported(text: &str) -> bool {
    let text = normalized(text);
    text.contains("unknown command")
        || text.contains("invalid option")
        || text.contains("not supported")
}

fn requests_response(text: &str) -> bool {
    let text = normalized(text);
    text.contains("one-time")
        || text.contains("one time")
        || text.contains("otp")
        || text.contains("challenge response")
}

fn indicates_success(text: &str) -> bool {
    let text = normalized(text);
    text.contains("authenticated")
        || text.contains("authentication successful")
        || text.contains("validated")
}

fn indicates_waiting(text: &str) -> bool {
    let text = normalized(text);
    text.contains("waiting") || text.contains("pending") || text.contains("authorize")
}

fn indicates_expired(text: &str) -> bool {
    let text = normalized(text);
    text.contains("expired") || text.contains("timed out") || text.contains("timeout")
}

fn indicates_cancelled(text: &str) -> bool {
    let text = normalized(text);
    text.contains("cancelled") || text.contains("canceled") || text.contains("denied")
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_POLLING_ATTEMPTS, begin_arguments, check_arguments, extract_http_url, init_arguments,
        parse_methods, redacted_auth_error, stage, valid_http_url,
    };
    use crate::models::AuthStageKind;

    #[test]
    fn parses_bounded_server_methods_without_urls() {
        let methods = parse_methods(
            "{\"method0\":\"Authenticator app\",\"method1\":\"Security key\"}\nMethod: Backup code\n1: Push approval\n- Hardware token\nMethod: https://secret.example/token",
        );
        assert_eq!(
            methods,
            [
                "Authenticator app",
                "Backup code",
                "Hardware token",
                "Push approval",
                "Security key"
            ]
        );
    }

    #[test]
    fn accepts_only_http_browser_handoffs_without_userinfo() {
        assert!(valid_http_url(
            "https://auth.example.test/start?id=redacted"
        ));
        assert!(!valid_http_url("file:///tmp/token"));
        assert!(!valid_http_url("https://user:token@example.test/start"));
        assert_eq!(
            extract_http_url("Open https://auth.example.test/start?id=opaque in a browser."),
            Some("https://auth.example.test/start?id=opaque".to_owned())
        );
        assert_eq!(
            extract_http_url("{\"data\":\"Open https://auth.example.test/start?id=opaque now\"}"),
            Some("https://auth.example.test/start?id=opaque".to_owned())
        );
    }

    #[test]
    fn auth_stage_never_contains_challenge_or_url_fields() {
        let value = serde_json::to_value(stage(AuthStageKind::Waiting, Vec::new(), 1)).unwrap();
        assert_eq!(value["maxPollingAttempts"], MAX_POLLING_ATTEMPTS);
        assert!(value.get("url").is_none());
        assert!(value.get("token").is_none());
        assert!(value.get("challenge").is_none());
    }

    #[test]
    fn auth_errors_never_echo_provider_output_or_secrets() {
        let serialized = serde_json::to_string(&redacted_auth_error()).unwrap();
        assert!(!serialized.contains("123456"));
        assert!(!serialized.contains("https://"));
        assert!(!serialized.contains("opaque-token"));
    }

    #[test]
    fn builds_only_the_bounded_login2_stage_commands() {
        assert_eq!(
            begin_arguments(),
            ["-ztag", "-Mj", "login2", "-S", "list-methods"]
        );
        assert_eq!(
            init_arguments("Push"),
            ["-ztag", "-Mj", "login2", "-S", "init-auth", "-m", "Push"]
        );
        assert_eq!(
            check_arguments(),
            ["-ztag", "-Mj", "login2", "-S", "check-auth"]
        );
    }
}
