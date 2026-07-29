use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::models::{
    CapabilityEvidence, CapabilityFact, CapabilitySnapshot, CapabilityState, ConnectionInput,
    P4Info, WorkspaceKind,
};

use super::runner::{
    combined_output, configured_command, p4_command, parse_json_lines, resolve_executable,
};

pub(super) fn build(input: &ConnectionInput, info: &P4Info) -> CapabilitySnapshot {
    let cli_version = cli_version(input);
    let mut commands = BTreeMap::new();
    for command in ["login2", "topology", "trust"] {
        commands.insert(command.to_owned(), probe_help(input, command));
    }
    for (key, command, flag) in [
        ("login2:-S", "login2", "-S"),
        ("topology:-m", "topology", "-m"),
        ("trust:-i", "trust", "-i"),
    ] {
        commands.insert(key.to_owned(), probe_help_flag(input, command, flag));
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
    facts.insert("topology".to_owned(), topology_fact);
    facts.insert("depots".to_owned(), depots_fact);
    facts.insert(
        "streamWorkspace".to_owned(),
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
        "caseSensitiveMapping".to_owned(),
        match info.case_handling.as_deref().map(str::to_ascii_lowercase) {
            Some(value) if value.contains("sensitive") && !value.contains("insensitive") => fact(
                CapabilityState::Supported,
                "case_sensitive",
                CapabilityEvidence::Server,
            ),
            Some(_) => fact(
                CapabilityState::Unsupported,
                "case_insensitive",
                CapabilityEvidence::Server,
            ),
            None => fact(
                CapabilityState::Unknown,
                "case_unknown",
                CapabilityEvidence::Unavailable,
            ),
        },
    );
    for name in ["taskStreamSubmit", "promotedShelves", "globalLocks"] {
        facts.insert(
            name.to_owned(),
            fact(
                CapabilityState::Unknown,
                if topology.is_some() {
                    "topology_server_authoritative"
                } else {
                    "topology_unknown"
                },
                if topology.is_some() {
                    CapabilityEvidence::Topology
                } else {
                    CapabilityEvidence::Unavailable
                },
            ),
        );
    }

    CapabilitySnapshot {
        cli_version,
        server_version: info.server_version.clone(),
        server_services: info.server_services.clone(),
        server_id: info.server_id.clone(),
        topology,
        unicode: info.unicode.clone(),
        case_handling: info.case_handling.clone(),
        security: info.security.clone(),
        workspace_kind,
        depot_modes,
        commands,
        facts,
    }
}

fn cli_version(input: &ConnectionInput) -> Option<String> {
    let path = resolve_executable(input.p4_path.as_deref()).ok()?;
    let output = p4_command(&path).arg("-V").output().ok()?;
    output.status.success().then(|| {
        combined_output(&output)
            .lines()
            .find(|line| line.contains("Rev.") || line.contains("Perforce"))
            .unwrap_or("p4 CLI")
            .trim()
            .to_owned()
    })
}

fn probe_help(input: &ConnectionInput, command_name: &str) -> CapabilityFact {
    let Ok((_path, mut command)) = configured_command(input) else {
        return unknown("probe_unavailable", CapabilityEvidence::Unavailable);
    };
    let Ok(output) = command.args(help_arguments(command_name)).output() else {
        return unknown("probe_unavailable", CapabilityEvidence::Unavailable);
    };
    classify_help_output(output.status.success(), &combined_output(&output))
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
    } else if success {
        fact(
            CapabilityState::Supported,
            "verified_help",
            CapabilityEvidence::Client,
        )
    } else {
        unknown("probe_unavailable", CapabilityEvidence::Unavailable)
    }
}

fn probe_help_flag(input: &ConnectionInput, command_name: &str, flag: &str) -> CapabilityFact {
    let Ok((_path, mut command)) = configured_command(input) else {
        return unknown("probe_unavailable", CapabilityEvidence::Unavailable);
    };
    let Ok(output) = command.args(help_arguments(command_name)).output() else {
        return unknown("probe_unavailable", CapabilityEvidence::Unavailable);
    };
    let text = combined_output(&output);
    let command_fact = classify_help_output(output.status.success(), &text);
    if command_fact.state != CapabilityState::Supported {
        return command_fact;
    }
    if help_contains_flag(&text, flag) {
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
    text.split_whitespace()
        .map(|token| {
            token.trim_matches(|character: char| matches!(character, '[' | ']' | ',' | '(' | ')'))
        })
        .any(|token| token == flag)
}

fn probe_topology(input: &ConnectionInput) -> (Option<String>, CapabilityFact) {
    let Ok((_path, mut command)) = configured_command(input) else {
        return (
            None,
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let Ok(output) = command
        .args(["-ztag", "-Mj", "topology", "-m", "20"])
        .output()
    else {
        return (
            None,
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let text = combined_output(&output);
    if !output.status.success() {
        let lower = text.to_ascii_lowercase();
        return if lower.contains("permission") || lower.contains("protections") {
            (
                None,
                unknown("permission_denied", CapabilityEvidence::Permission),
            )
        } else if lower.contains("unknown command") {
            (
                None,
                fact(
                    CapabilityState::Unsupported,
                    "command_missing",
                    CapabilityEvidence::Server,
                ),
            )
        } else {
            (
                None,
                unknown("probe_unavailable", CapabilityEvidence::Unavailable),
            )
        };
    }
    let summary = parse_topology_summary(&String::from_utf8_lossy(&output.stdout));
    (
        summary,
        fact(
            CapabilityState::Supported,
            "topology_verified",
            CapabilityEvidence::Topology,
        ),
    )
}

fn parse_topology_summary(text: &str) -> Option<String> {
    let records = parse_json_lines(text).ok()?;
    let services = records
        .iter()
        .filter_map(|record| {
            ["ServerServices", "serverServices", "services", "type"]
                .iter()
                .find_map(|key| record.get(*key).and_then(Value::as_str))
        })
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    (!services.is_empty()).then(|| services.into_iter().collect::<Vec<_>>().join(", "))
}

fn probe_depot_modes(input: &ConnectionInput) -> (Vec<String>, CapabilityFact) {
    let Ok((_path, mut command)) = configured_command(input) else {
        return (
            Vec::new(),
            unknown("probe_unavailable", CapabilityEvidence::Unavailable),
        );
    };
    let Ok(output) = command.args(["-ztag", "-Mj", "depots"]).output() else {
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
    let modes = parse_json_lines(&String::from_utf8_lossy(&output.stdout))
        .unwrap_or_default()
        .iter()
        .filter_map(|record| {
            record
                .get("type")
                .or_else(|| record.get("Type"))
                .and_then(Value::as_str)
        })
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    (
        modes,
        fact(
            CapabilityState::Supported,
            "depots_verified",
            CapabilityEvidence::Server,
        ),
    )
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
        build, classify_help_output, help_arguments, help_contains_flag, parse_topology_summary,
    };
    use crate::models::{CapabilityState, ConnectionInput, P4Info, WorkspaceKind};

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
            snapshot.facts["caseSensitiveMapping"].reason,
            "case_sensitive"
        );
        assert_eq!(snapshot.commands["login2"].reason, "probe_unavailable");
    }

    #[test]
    fn help_and_topology_probes_preserve_unknown_and_partial_results() {
        assert_eq!(
            classify_help_output(false, "Protections table denies access").state,
            CapabilityState::Unknown
        );
        assert_eq!(
            classify_help_output(false, "Unknown command login2").state,
            CapabilityState::Unsupported
        );
        assert_eq!(
            parse_topology_summary(
                "{\"serverServices\":\"edge-server\"}\n{\"serverServices\":\"commit-server\"}"
            ),
            Some("commit-server, edge-server".to_owned())
        );
        assert_eq!(parse_topology_summary("{malformed"), None);
        assert!(help_contains_flag("p4 login2 [ -p -S state ]", "-S"));
        assert!(!help_contains_flag("p4 login2 [ -p ]", "-S"));
        assert_eq!(help_arguments("trust"), ["trust", "-h"]);
        assert_eq!(help_arguments("login2"), ["help", "login2"]);
    }
}
