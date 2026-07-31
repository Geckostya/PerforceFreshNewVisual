use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::models::{
    CapabilityCommand, CapabilityEvidence, CapabilityFact, CapabilityFlag, CapabilityName,
    CapabilitySnapshot, CapabilityState, ConnectionInput, P4Info, TopologyService, WorkspaceKind,
};

use super::runner::{
    combined_output, configured_command, p4_command, parse_json_lines, perforce_error,
    resolve_executable,
};

const MAX_CAPABILITY_TEXT_CHARS: usize = 512;
const MAX_TOPOLOGY_SERVICES: usize = 20;
const MAX_DEPOT_MODES: usize = 200;

pub(super) fn build(input: &ConnectionInput, info: &P4Info) -> CapabilitySnapshot {
    let cli_version = cli_version(input);
    let mut commands = BTreeMap::new();
    let mut flags = BTreeMap::new();
    for (command, command_name, command_flags) in [
        (
            CapabilityCommand::Login2,
            "login2",
            &[(CapabilityFlag::Login2State, "-S")][..],
        ),
        (
            CapabilityCommand::Topology,
            "topology",
            &[(CapabilityFlag::TopologyFields, "-T")][..],
        ),
        (
            CapabilityCommand::Trust,
            "trust",
            &[(CapabilityFlag::TrustInstall, "-i")][..],
        ),
        (
            CapabilityCommand::Integrate,
            "integrate",
            &[
                (CapabilityFlag::IntegrateStream, "-S"),
                (CapabilityFlag::IntegrateParent, "-P"),
                (CapabilityFlag::IntegrateForceBranch, "-Af"),
                (CapabilityFlag::IntegrateReverse, "-r"),
            ][..],
        ),
        (
            CapabilityCommand::Copy,
            "copy",
            &[
                (CapabilityFlag::CopyStream, "-S"),
                (CapabilityFlag::CopyForceBranch, "-Af"),
            ][..],
        ),
        (
            CapabilityCommand::Istat,
            "istat",
            &[
                (CapabilityFlag::IstatForceBranch, "-Af"),
                (CapabilityFlag::IstatReverse, "-r"),
            ][..],
        ),
        (
            CapabilityCommand::Streamlog,
            "streamlog",
            &[(CapabilityFlag::StreamlogLimit, "-m")][..],
        ),
        (CapabilityCommand::Reshelve, "reshelve", &[][..]),
        (
            CapabilityCommand::Change,
            "change",
            &[
                (CapabilityFlag::ChangeUser, "-U"),
                (CapabilityFlag::ChangeType, "-t"),
            ][..],
        ),
        (CapabilityCommand::Protects, "protects", &[][..]),
    ] {
        let (command_fact, help) = probe_help(input, command_name);
        for (flag_name, flag) in command_flags {
            flags.insert(
                *flag_name,
                classify_help_flag(&command_fact, help.as_deref(), flag),
            );
        }
        commands.insert(command, command_fact);
    }

    let (topology, topology_fact) = probe_topology(input);
    let (depot_modes, depots_fact) = probe_depot_modes(input);
    let workspace_kind = match (&info.client_name, &info.client_stream) {
        (_, Some(_)) => WorkspaceKind::Stream,
        (Some(client), None)
            if !client.trim().is_empty() && !client.to_ascii_lowercase().contains("unknown") =>
        {
            WorkspaceKind::Classic
        }
        _ => WorkspaceKind::Unknown,
    };

    let mut facts = BTreeMap::new();
    facts.insert(
        CapabilityName::CliVersion,
        reported_fact(
            cli_version.as_deref(),
            "cli_version_reported",
            CapabilityEvidence::Client,
        ),
    );
    facts.insert(
        CapabilityName::ServerVersion,
        reported_fact(
            info.server_version.as_deref(),
            "server_version_reported",
            CapabilityEvidence::Server,
        ),
    );
    facts.insert(
        CapabilityName::ServerServices,
        reported_fact(
            info.server_services.as_deref(),
            "server_services_reported",
            CapabilityEvidence::Server,
        ),
    );
    facts.insert(CapabilityName::Topology, topology_fact);
    facts.insert(CapabilityName::Depots, depots_fact);
    facts.insert(
        CapabilityName::UnicodeServer,
        match normalized(info.unicode.as_deref()).as_deref() {
            Some("enabled") => fact(
                CapabilityState::Supported,
                "unicode_enabled",
                CapabilityEvidence::Server,
            ),
            Some("disabled") => fact(
                CapabilityState::Unsupported,
                "unicode_disabled",
                CapabilityEvidence::Server,
            ),
            _ => unknown("unicode_unknown", CapabilityEvidence::Unavailable),
        },
    );
    facts.insert(
        CapabilityName::StreamWorkspace,
        match workspace_kind {
            WorkspaceKind::Stream => fact(
                CapabilityState::Supported,
                "workspace_stream",
                CapabilityEvidence::Workspace,
            ),
            WorkspaceKind::Classic => fact(
                CapabilityState::Unsupported,
                "workspace_classic",
                CapabilityEvidence::Workspace,
            ),
            WorkspaceKind::Unknown => fact(
                CapabilityState::Unknown,
                "workspace_unknown",
                CapabilityEvidence::Unavailable,
            ),
        },
    );
    facts.insert(
        CapabilityName::CaseSensitiveMapping,
        match normalized(info.case_handling.as_deref()).as_deref() {
            Some("sensitive") => fact(
                CapabilityState::Supported,
                "case_sensitive",
                CapabilityEvidence::Server,
            ),
            Some("insensitive" | "hybrid") => fact(
                CapabilityState::Unsupported,
                "case_insensitive",
                CapabilityEvidence::Server,
            ),
            _ => fact(
                CapabilityState::Unknown,
                "case_unknown",
                CapabilityEvidence::Unavailable,
            ),
        },
    );
    for name in [
        CapabilityName::TaskStreamSubmit,
        CapabilityName::PromotedShelves,
        CapabilityName::GlobalLocks,
    ] {
        facts.insert(
            name,
            fact(
                CapabilityState::Unknown,
                if topology.is_empty() {
                    "topology_unknown"
                } else {
                    "topology_server_authoritative"
                },
                if topology.is_empty() {
                    CapabilityEvidence::Unavailable
                } else {
                    CapabilityEvidence::Topology
                },
            ),
        );
    }

    CapabilitySnapshot {
        cli_version,
        server_version: bounded_optional(info.server_version.as_deref()),
        server_services: bounded_optional(info.server_services.as_deref()),
        server_id: bounded_optional(info.server_id.as_deref()),
        topology,
        unicode: bounded_optional(info.unicode.as_deref()),
        case_handling: bounded_optional(info.case_handling.as_deref()),
        security: bounded_optional(info.security.as_deref()),
        workspace_kind,
        depot_modes,
        commands,
        flags,
        facts,
    }
}

fn cli_version(input: &ConnectionInput) -> Option<String> {
    let path = resolve_executable(input.p4_path.as_deref()).ok()?;
    let output = p4_command(&path).arg("-V").output().ok()?;
    output.status.success().then_some(())?;
    combined_output(&output)
        .lines()
        .find(|line| line.contains("Rev.") || line.contains("Perforce"))
        .and_then(|line| bounded_optional(Some(line)))
}

fn probe_help(input: &ConnectionInput, command_name: &str) -> (CapabilityFact, Option<String>) {
    let Ok((_path, mut command)) = configured_command(input) else {
        return (
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
            None,
        );
    };
    let Ok(output) = command.args(help_arguments(command_name)).output() else {
        return (
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
            None,
        );
    };
    let text = combined_output(&output);
    let command_fact = classify_help_output(output.status.success(), &text);
    let help = (command_fact.state == CapabilityState::Supported).then_some(text);
    (command_fact, help)
}

fn classify_help_output(success: bool, text: &str) -> CapabilityFact {
    let text = text.to_ascii_lowercase();
    if text.contains("unknown command") || text.contains("no help for") {
        fact(
            CapabilityState::Unsupported,
            "command_missing",
            CapabilityEvidence::Client,
        )
    } else if text.contains("permission") || text.contains("protections") {
        unknown("permission_denied", CapabilityEvidence::Permission)
    } else if success && !text.trim().is_empty() {
        fact(
            CapabilityState::Supported,
            "verified_help",
            CapabilityEvidence::Client,
        )
    } else {
        unknown("probe_unavailable", CapabilityEvidence::Unavailable)
    }
}

fn classify_help_flag(
    command_fact: &CapabilityFact,
    help: Option<&str>,
    flag: &str,
) -> CapabilityFact {
    if command_fact.state != CapabilityState::Supported {
        return command_fact.clone();
    }
    let Some(help) = help else {
        return unknown("probe_unavailable", CapabilityEvidence::Unavailable);
    };
    if help_contains_flag(help, flag) {
        fact(
            CapabilityState::Supported,
            "verified_help",
            CapabilityEvidence::Client,
        )
    } else {
        fact(
            CapabilityState::Unsupported,
            "flag_missing",
            CapabilityEvidence::Client,
        )
    }
}

fn help_arguments(command_name: &str) -> Vec<String> {
    if command_name == "trust" {
        vec!["trust".to_owned(), "-h".to_owned()]
    } else {
        vec!["help".to_owned(), command_name.to_owned()]
    }
}

fn help_contains_flag(text: &str, flag: &str) -> bool {
    text.split(|character: char| {
        character.is_whitespace() || matches!(character, '[' | ']' | ',' | '(' | ')' | '|' | '=')
    })
    .map(str::trim)
    .any(|token| token == flag)
}

fn topology_arguments() -> [&'static str; 5] {
    ["-ztag", "-Mj", "-m", "20", "topology"]
}

fn depot_arguments() -> [&'static str; 5] {
    ["-ztag", "-Mj", "-m", "200", "depots"]
}

fn probe_topology(input: &ConnectionInput) -> (Vec<TopologyService>, CapabilityFact) {
    let Ok((_path, mut command)) = configured_command(input) else {
        return (
            Vec::new(),
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let Ok(output) = command.args(topology_arguments()).output() else {
        return (
            Vec::new(),
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let text = combined_output(&output);
    if !output.status.success() {
        let lower = text.to_ascii_lowercase();
        return if lower.contains("permission") || lower.contains("protections") {
            (
                Vec::new(),
                unknown("permission_denied", CapabilityEvidence::Permission),
            )
        } else if lower.contains("unknown command") {
            (
                Vec::new(),
                fact(
                    CapabilityState::Unsupported,
                    "command_missing",
                    CapabilityEvidence::Server,
                ),
            )
        } else {
            (
                Vec::new(),
                unknown("probe_unavailable", CapabilityEvidence::Unavailable),
            )
        };
    }
    match parse_topology_services(&String::from_utf8_lossy(&output.stdout)) {
        Some(services) if !services.is_empty() => (
            services,
            fact(
                CapabilityState::Supported,
                "topology_verified",
                CapabilityEvidence::Topology,
            ),
        ),
        _ => (
            Vec::new(),
            unknown("invalid_output", CapabilityEvidence::Unavailable),
        ),
    }
}

fn parse_topology_services(text: &str) -> Option<Vec<TopologyService>> {
    let records = parse_json_lines(text).ok()?;
    if perforce_error(&records).is_some() {
        return None;
    }
    Some(
        records
            .iter()
            .filter_map(|record| {
                let service = TopologyService {
                    server_id: bounded_record_field(record, &["ServerID", "serverID", "serverId"]),
                    server_address: bounded_record_field(
                        record,
                        &["ServerAddress", "serverAddress", "address"],
                    ),
                    services: bounded_record_field(
                        record,
                        &["Services", "ServerServices", "serverServices", "services"],
                    ),
                    server_type: bounded_record_field(record, &["Type", "type"]),
                };
                (service.server_id.is_some()
                    || service.server_address.is_some()
                    || service.services.is_some()
                    || service.server_type.is_some())
                .then_some(service)
            })
            .take(MAX_TOPOLOGY_SERVICES)
            .collect(),
    )
}

fn bounded_record_field(record: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| record.get(*key).and_then(Value::as_str))
        .and_then(|value| bounded_optional(Some(value)))
}

fn parse_depot_modes(text: &str) -> Option<Vec<String>> {
    let records = parse_json_lines(text).ok()?;
    if perforce_error(&records).is_some() {
        return None;
    }
    Some(
        records
            .iter()
            .filter_map(|record| {
                record
                    .get("type")
                    .or_else(|| record.get("Type"))
                    .and_then(Value::as_str)
                    .and_then(|value| bounded_optional(Some(value)))
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(MAX_DEPOT_MODES)
            .collect(),
    )
}

fn normalized(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
}

fn bounded_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_CAPABILITY_TEXT_CHARS).collect())
}

fn reported_fact(
    value: Option<&str>,
    reason: &str,
    evidence: CapabilityEvidence,
) -> CapabilityFact {
    if bounded_optional(value).is_some() {
        fact(CapabilityState::Supported, reason, evidence)
    } else {
        unknown("value_unknown", CapabilityEvidence::Unavailable)
    }
}

fn probe_depot_modes(input: &ConnectionInput) -> (Vec<String>, CapabilityFact) {
    let Ok((_path, mut command)) = configured_command(input) else {
        return (
            Vec::new(),
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let Ok(output) = command.args(depot_arguments()).output() else {
        return (
            Vec::new(),
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let text = combined_output(&output);
    if !output.status.success() {
        let lower = text.to_ascii_lowercase();
        return if lower.contains("permission") || lower.contains("protections") {
            (
                Vec::new(),
                unknown("permission_denied", CapabilityEvidence::Permission),
            )
        } else {
            (
                Vec::new(),
                unknown("probe_unavailable", CapabilityEvidence::Unavailable),
            )
        };
    }
    match parse_depot_modes(&String::from_utf8_lossy(&output.stdout)) {
        Some(modes) => (
            modes,
            fact(
                CapabilityState::Supported,
                "depots_verified",
                CapabilityEvidence::Server,
            ),
        ),
        None => (
            Vec::new(),
            unknown("invalid_output", CapabilityEvidence::Unavailable),
        ),
    }
}

fn fact(state: CapabilityState, reason: &str, evidence: CapabilityEvidence) -> CapabilityFact {
    CapabilityFact {
        state,
        reason: reason.to_owned(),
        evidence,
    }
}

fn unknown(reason: &str, evidence: CapabilityEvidence) -> CapabilityFact {
    fact(CapabilityState::Unknown, reason, evidence)
}

#[cfg(test)]
mod tests {
    use super::{
        build, classify_help_output, depot_arguments, help_arguments, help_contains_flag,
        parse_depot_modes, parse_topology_services, topology_arguments,
    };
    use crate::models::{
        CapabilityCommand, CapabilityName, CapabilityState, ConnectionInput, P4Info, WorkspaceKind,
    };

    #[test]
    fn derives_workspace_and_case_facts_without_assuming_unknown_support() {
        let input = ConnectionInput {
            p4_path: Some("missing-p4".to_owned()),
            port: "localhost:1666".to_owned(),
            user: "alex".to_owned(),
            client: Some("alex-main".to_owned()),
            charset: None,
            p4_config: None,
            p4_enviro: None,
        };
        let info = P4Info {
            client_stream: Some("//Acme/main".to_owned()),
            case_handling: Some("sensitive".to_owned()),
            ..P4Info::default()
        };
        let snapshot = build(&input, &info);
        assert_eq!(snapshot.workspace_kind, WorkspaceKind::Stream);
        assert_eq!(
            snapshot
                .facts
                .get(&CapabilityName::CaseSensitiveMapping)
                .unwrap()
                .reason,
            "case_sensitive"
        );
        assert_eq!(
            snapshot
                .commands
                .get(&CapabilityCommand::Login2)
                .unwrap()
                .reason,
            "probe_unavailable"
        );

        let unknown_info = P4Info {
            case_handling: Some("future-mode".to_owned()),
            unicode: Some("future-mode".to_owned()),
            ..P4Info::default()
        };
        let unknown = build(&input, &unknown_info);
        assert_eq!(
            unknown
                .facts
                .get(&CapabilityName::CaseSensitiveMapping)
                .unwrap()
                .state,
            CapabilityState::Unknown
        );
        assert_eq!(
            unknown
                .facts
                .get(&CapabilityName::UnicodeServer)
                .unwrap()
                .state,
            CapabilityState::Unknown
        );

        let serialized = serde_json::to_value(snapshot).unwrap();
        assert!(serialized["commands"].get("login2").is_some());
        assert!(serialized["flags"].get("integrateForceBranch").is_some());
        assert!(serialized["facts"].get("unicodeServer").is_some());
    }

    #[test]
    fn help_probes_preserve_unknown_and_detect_exact_flags() {
        assert_eq!(
            classify_help_output(false, "Protections table denies access").state,
            CapabilityState::Unknown
        );
        assert_eq!(
            classify_help_output(false, "Unknown command login2").state,
            CapabilityState::Unsupported
        );
        assert_eq!(
            classify_help_output(true, "").state,
            CapabilityState::Unknown
        );
        assert!(help_contains_flag("p4 login2 [ -p -S state ]", "-S"));
        assert!(help_contains_flag("p4 switch [--no-sync]", "--no-sync"));
        assert!(!help_contains_flag("p4 login2 [ -p ]", "-S"));
        assert_eq!(help_arguments("trust"), ["trust", "-h"]);
        assert_eq!(help_arguments("login2"), ["help", "login2"]);
    }

    #[test]
    fn structured_probes_are_bounded_and_reject_malformed_output() {
        let topology = (0..25)
            .map(|index| format!("{{\"ServerID\":\"server-{index}\",\"Type\":\"edge-server\"}}"))
            .collect::<Vec<_>>()
            .join("\n");
        let parsed = parse_topology_services(&topology).unwrap();
        assert_eq!(parsed.len(), 20);
        assert_eq!(parsed[0].server_id.as_deref(), Some("server-0"));
        assert_eq!(parse_topology_services("{malformed"), None);
        assert_eq!(
            parse_topology_services("{\"code\":\"error\",\"severity\":3,\"data\":\"denied\"}"),
            None
        );
        assert_eq!(parse_topology_services("{}"), Some(Vec::new()));
        assert_eq!(parse_depot_modes("{malformed"), None);
        assert_eq!(
            parse_depot_modes("{\"type\":\"stream\"}\n{\"type\":\"local\"}").unwrap(),
            ["local", "stream"]
        );
    }

    #[test]
    fn structured_probe_limits_are_global_options_before_the_command() {
        assert_eq!(
            topology_arguments(),
            ["-ztag", "-Mj", "-m", "20", "topology"]
        );
        assert_eq!(depot_arguments(), ["-ztag", "-Mj", "-m", "200", "depots"]);
    }
}
