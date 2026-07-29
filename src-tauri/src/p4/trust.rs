use crate::models::{
    AppError, ConnectionInput, ErrorKind, TrustChallenge, TrustEntry, TrustReason,
};

use super::runner::{combined_output, configured_command, launch_error};

pub(super) fn inspect(input: &ConnectionInput) -> Result<TrustChallenge, AppError> {
    let server = validate_ssl_server(&input.port)?;
    let (path, mut command) = configured_command(input)?;
    command.args(trust_probe_arguments());
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    let presented_fingerprint =
        extract_fingerprint(&combined_output(&output)).ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidOutput,
                "p4 did not provide a complete SSL fingerprint.",
            )
            .with_hint("Retry the connection and verify the server address.")
        })?;
    let existing_fingerprint = list(input)?
        .into_iter()
        .find(|entry| same_server(&entry.server, server))
        .map(|entry| entry.fingerprint);
    let reason = if existing_fingerprint.is_some() {
        TrustReason::Changed
    } else {
        TrustReason::New
    };
    Ok(TrustChallenge {
        server: server.to_owned(),
        presented_fingerprint,
        existing_fingerprint,
        reason,
    })
}

pub(super) fn confirm(
    input: &ConnectionInput,
    expected_fingerprint: &str,
) -> Result<TrustEntry, AppError> {
    let expected_fingerprint = validate_fingerprint(expected_fingerprint)?;
    let challenge = inspect(input)?;
    if challenge.presented_fingerprint != expected_fingerprint {
        return Err(AppError::new(
            ErrorKind::Stale,
            "The server fingerprint changed before confirmation.",
        )
        .with_hint("Review the newly presented fingerprint before trusting it."));
    }

    let (path, mut command) = configured_command(input)?;
    command.args(trust_install_arguments(
        &challenge.presented_fingerprint,
        &challenge.reason,
    ));
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(
            AppError::new(ErrorKind::Trust, "The SSL fingerprint was not installed.")
                .with_hint("Review the fingerprint and retry the explicit confirmation."),
        );
    }

    list(input)?
        .into_iter()
        .find(|entry| {
            same_server(&entry.server, &challenge.server)
                && entry.fingerprint == challenge.presented_fingerprint
        })
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::Trust,
                "The SSL trust write could not be verified.",
            )
            .with_hint("No connection was opened; inspect the local trust list before retrying.")
        })
}

pub(super) fn list(input: &ConnectionInput) -> Result<Vec<TrustEntry>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["trust", "-l"]);
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(AppError::new(
            ErrorKind::Trust,
            "The local SSL trust list could not be read.",
        ));
    }
    Ok(parse_trust_entries(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn validate_ssl_server(server: &str) -> Result<&str, AppError> {
    let server = server.trim();
    if !server.to_ascii_lowercase().starts_with("ssl:")
        || server.len() > 512
        || server.contains(['\r', '\n'])
    {
        return Err(AppError::new(
            ErrorKind::Trust,
            "SSL trust is available only for a validated ssl: server address.",
        ));
    }
    Ok(server)
}

fn validate_fingerprint(value: &str) -> Result<&str, AppError> {
    let value = value.trim();
    if is_valid_fingerprint(value) {
        Ok(value)
    } else {
        Err(AppError::new(
            ErrorKind::Trust,
            "The SSL fingerprint is malformed.",
        ))
    }
}

fn is_valid_fingerprint(value: &str) -> bool {
    let bytes = value
        .split_once(':')
        .filter(|(prefix, _)| {
            prefix.eq_ignore_ascii_case("sha256")
                || prefix.eq_ignore_ascii_case("sha1")
                || prefix.eq_ignore_ascii_case("md5")
        })
        .map_or(value, |(_, bytes)| bytes);
    let segments = bytes.split(':').collect::<Vec<_>>();
    segments.len() >= 16
        && segments.iter().all(|segment| {
            segment.len() == 2
                && segment
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        })
}

fn extract_fingerprint(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|value| {
            value.trim_matches(|character: char| {
                matches!(character, '\'' | '"' | '(' | ')' | ',' | ';' | '.')
            })
        })
        .find(|value| is_valid_fingerprint(value))
        .map(str::to_owned)
}

fn same_server(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn trust_probe_arguments() -> [&'static str; 2] {
    ["trust", "-n"]
}

fn trust_install_arguments(fingerprint: &str, reason: &TrustReason) -> Vec<String> {
    let mut arguments = vec!["trust".to_owned()];
    if matches!(reason, TrustReason::Changed) {
        arguments.push("-f".to_owned());
    }
    arguments.push("-i".to_owned());
    arguments.push(fingerprint.to_owned());
    arguments
}

pub(super) fn parse_trust_entries(text: &str) -> Vec<TrustEntry> {
    text.lines()
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            let server = fields.iter().find(|field| field.starts_with("ssl:"))?;
            let fingerprint = fields.iter().find(|field| is_valid_fingerprint(field))?;
            Some(TrustEntry {
                server: server.trim_matches(['\'', '"', '(', ')']).to_owned(),
                fingerprint: fingerprint
                    .trim_matches(|character: char| {
                        matches!(character, '\'' | '"' | '(' | ')' | ',')
                    })
                    .to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_fingerprint, is_valid_fingerprint, parse_trust_entries, trust_install_arguments,
        trust_probe_arguments,
    };
    use crate::models::TrustReason;

    const SHA256: &str = "SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

    #[test]
    fn parses_only_complete_fingerprints() {
        assert!(is_valid_fingerprint(SHA256));
        assert_eq!(
            extract_fingerprint(&format!("The fingerprint for the key is\n{SHA256}\n")),
            Some(SHA256.to_owned())
        );
        assert!(!is_valid_fingerprint("SHA256:AA:BB"));
    }

    #[test]
    fn uses_refusal_for_probe_and_exact_install_for_confirmation() {
        assert_eq!(trust_probe_arguments(), ["trust", "-n"]);
        assert_eq!(
            trust_install_arguments(SHA256, &TrustReason::New),
            ["trust", "-i", SHA256]
        );
        assert_eq!(
            trust_install_arguments(SHA256, &TrustReason::Changed),
            ["trust", "-f", "-i", SHA256]
        );
    }

    #[test]
    fn reads_server_and_fingerprint_without_truncation() {
        let entries = parse_trust_entries(&format!("ssl:p4.example:1666 {SHA256}\n"));
        assert_eq!(entries[0].server, "ssl:p4.example:1666");
        assert_eq!(entries[0].fingerprint, SHA256);
    }
}
