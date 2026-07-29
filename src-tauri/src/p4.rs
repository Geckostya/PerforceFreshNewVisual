use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    thread,
};

use serde_json::{Map, Value};

use crate::models::{
    AnnotationLine, AppError, ChangeExportResult, CherryPickPreviewItem, CliLogLevel,
    ConnectionInput, DepotDirectory, DepotFile, DepotSummary, DiffMode, ErrorKind, FileDiff,
    FileRevision, LoginStatus, OpenedFile, P4Detection, P4Info, PendingChange, ReconcileItem,
    ResolveMode, ResolvePreviewItem, RevertPreviewItem, ShelvedFile, StreamLocalStrategy,
    StreamSummary, SubmitMode, SubmitOutcome, SubmitPreflightIssue, SubmitPreflightJob,
    SubmitPreflightSummary, SubmittedChangeDetail, SubmittedFile, SubmittedFilterOptions,
    SyncPreview, SyncPreviewItem, TrustEntry, UndoPreviewItem, UnshelveConflict, UnshelvePreview,
    WorkspaceFile, WorkspaceLocalBatch, WorkspaceSpec, WorkspaceSummary,
};

mod jobs;
mod labels;
mod runner;
mod validation;

use jobs::parse_fixes;
#[cfg(test)]
use jobs::parse_jobs;
pub use jobs::{fix_job, list_fixes, list_jobs};
pub use labels::list_labels;
#[cfg(test)]
use labels::parse_labels;
use runner::*;
pub use runner::{clear_cli_log, cli_log};
use validation::*;

const MAX_RECORDS: &str = "200";
const MAX_HISTORY_RECORDS: &str = "5000";
const MAX_SUBMITTED_DETAIL_PREVIEW_FILES: u32 = 1000;
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
const MAX_RECOVERY_WORKERS: usize = 4;
const IGNORE_DIRECTORY_PROBE: &str = "__p4fnv_ignore_probe__";
static RECOVERY_TEMP_ID: AtomicU64 = AtomicU64::new(1);

pub fn detect(explicit_path: Option<&str>) -> Result<P4Detection, AppError> {
    let path = resolve_executable(explicit_path)?;
    let output = p4_command(&path)
        .arg("-V")
        .output()
        .map_err(|error| launch_error(&path, error))?;

    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 -V вернул предупреждение.");

    let version = combined_output(&output)
        .lines()
        .find(|line| line.contains("Rev.") || line.contains("Perforce"))
        .unwrap_or("p4 CLI")
        .trim()
        .to_owned();

    Ok(P4Detection {
        path: path.to_string_lossy().into_owned(),
        version,
    })
}

pub fn info(input: &ConnectionInput) -> Result<P4Info, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "info"]);
    let records = run_json(&path, &mut command)?;
    parse_info_records(&records)
}

pub fn open_workspace(input: &ConnectionInput) -> Result<P4Info, AppError> {
    let info = info(input)?;
    required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "login", "-s"]);
    run_json(&path, &mut command)?;
    Ok(info)
}

pub fn login(input: &ConnectionInput, password: &str) -> Result<(), AppError> {
    validate_password(password)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["login"]);
    let output = run_output_with_stdin(&path, &mut command, format!("{password}\n").as_bytes())?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 login вернул предупреждение.");
    Ok(())
}

pub fn login_status(input: &ConnectionInput) -> Result<LoginStatus, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "login", "-s"]);
    let records = run_json(&path, &mut command)?;
    let message = records
        .iter()
        .find_map(|record| field(record, &["data", "message"]))
        .unwrap_or_else(|| "Ticket is valid.".to_owned());
    Ok(LoginStatus {
        logged_in: true,
        expires_in_minutes: parse_expiry_minutes(&message),
        message,
    })
}

pub fn logout(input: &ConnectionInput) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["logout"]);
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 logout вернул предупреждение.");
    Ok(())
}

pub fn list_trust(input: &ConnectionInput) -> Result<Vec<TrustEntry>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["trust", "-l"]);
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 trust -l вернул предупреждение.");
    Ok(parse_trust_entries(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

pub fn list_workspaces(input: &ConnectionInput) -> Result<Vec<WorkspaceSummary>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "clients",
        "-u",
        input.user.trim(),
        "-m",
        MAX_RECORDS,
    ]);
    parse_workspaces(&run_json(&path, &mut command)?)
}

pub fn inspect_workspace(input: &ConnectionInput) -> Result<WorkspaceSpec, AppError> {
    let client = required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "client", "-o", client]);
    parse_workspace_spec(&run_json(&path, &mut command)?, client)
}

pub fn update_workspace(
    input: &ConnectionInput,
    name: &str,
    root: &str,
    stream: Option<&str>,
    description: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    let name = validate_form_value(name.trim(), "workspace")?;
    let root = validate_form_value(root.trim(), "workspace root")?;
    let stream = stream.unwrap_or_default().trim();
    if stream.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный stream.",
        ));
    }
    let description = validate_description(Some(description))?;
    let (path, mut output_command) = configured_command(input)?;
    output_command.args(["client", "-o", name]);
    let output = output_command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    let original = String::from_utf8_lossy(&output.stdout);
    let updated = replace_workspace_fields(&original, root, stream, description)?;
    let (_, mut input_command) = configured_command(input)?;
    input_command.args(["client", "-i"]);
    let applied = run_output_with_stdin(&path, &mut input_command, updated.as_bytes())?;
    if !applied.status.success() {
        return Err(command_error(&applied));
    }
    Ok(())
}

pub fn create_workspace(
    input: &ConnectionInput,
    name: &str,
    root: &str,
    stream: Option<&str>,
    description: &str,
) -> Result<(), AppError> {
    let name = validate_form_value(name.trim(), "workspace")?;
    let root = validate_form_value(root.trim(), "workspace root")?;
    let stream = stream.unwrap_or_default().trim();
    if stream.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный stream.",
        ));
    }
    let description = validate_description(Some(description))?;
    let (path, mut output_command) = configured_command(input)?;
    output_command.args(["client", "-o", name]);
    let output = output_command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    let original = String::from_utf8_lossy(&output.stdout);
    let updated = replace_workspace_fields(&original, root, stream, description)?;
    let (_, mut input_command) = configured_command(input)?;
    input_command.args(["client", "-i"]);
    let applied = run_output_with_stdin(&path, &mut input_command, updated.as_bytes())?;
    if !applied.status.success() {
        return Err(command_error(&applied));
    }
    Ok(())
}

pub fn delete_workspace(input: &ConnectionInput, name: &str) -> Result<(), AppError> {
    let name = validate_form_value(name.trim(), "workspace")?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "client", "-d", name]);
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn rename_workspace(input: &ConnectionInput, from: &str, to: &str) -> Result<(), AppError> {
    let from = validate_form_value(from.trim(), "workspace")?;
    let to = validate_form_value(to.trim(), "new workspace")?;
    if from == to {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Новое имя workspace должно отличаться от текущего.",
        ));
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["renameclient", "--from", from, "--to", to]);
    let output = command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 renameclient вернул предупреждение.");
    Ok(())
}

pub fn list_streams(input: &ConnectionInput) -> Result<Vec<StreamSummary>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "streams",
        "-m",
        MAX_RECORDS,
        "-T",
        "Stream,Name,Parent,Type,Description,Owner,Update",
    ]);
    parse_streams(&run_json(&path, &mut command)?)
}

pub fn switch_stream(
    input: &ConnectionInput,
    stream: &str,
    local_strategy: &StreamLocalStrategy,
) -> Result<(), AppError> {
    let client = required_client(input)?;
    validate_stream_path(stream)?;
    match local_strategy {
        StreamLocalStrategy::Keep => {
            let (path, mut command) = configured_command(input)?;
            command.args(switch_stream_arguments(stream, client, local_strategy));
            run_json(&path, &mut command)?;
        }
        StreamLocalStrategy::Shelve => {
            let opened = list_opened_files(input)?;
            let changes = opened
                .iter()
                .filter(|file| file.change != "default")
                .map(|file| file.change.clone())
                .collect::<BTreeSet<_>>();
            for (index, change) in changes.iter().enumerate() {
                if let Err(mut error) = shelve_files(input, change, &[], true, true, true) {
                    if index > 0 {
                        error.hints.insert(
                            0,
                            format!("{index} changelist уже сохранено в shelf и очищено локально."),
                        );
                    }
                    return Err(error);
                }
            }
            let (path, mut command) = configured_command(input)?;
            command.args(switch_stream_arguments(stream, client, local_strategy));
            run_json(&path, &mut command)?;
        }
    }
    Ok(())
}

pub fn ignore_local_file(input: &ConnectionInput, local_path: &str) -> Result<(), AppError> {
    let (root, target) = validated_workspace_file(input, local_path)?;
    let relative = target.strip_prefix(&root).map_err(|error| {
        AppError::new(ErrorKind::CommandFailed, "Файл находится вне workspace.")
            .with_diagnostics(error.to_string())
    })?;
    let rule = relative.to_string_lossy().replace('\\', "/");
    if rule.is_empty() || rule.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось построить безопасное ignore-правило.",
        ));
    }
    let ignore_path = root.join(".p4ignore");
    let existing = fs::read_to_string(&ignore_path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == rule) {
        return Ok(());
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ignore_path)
        .map_err(|error| local_file_error("Не удалось открыть .p4ignore.", error))?;
    if !existing.is_empty() && !existing.ends_with(['\r', '\n']) {
        writeln!(file)
            .map_err(|error| local_file_error("Не удалось обновить .p4ignore.", error))?;
    }
    writeln!(file, "{rule}")
        .map_err(|error| local_file_error("Не удалось обновить .p4ignore.", error))
}

pub fn delete_local_file(input: &ConnectionInput, local_path: &str) -> Result<(), AppError> {
    let (_, target) = validated_workspace_file(input, local_path)?;
    if !target.is_file() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Можно удалить только выбранный локальный файл.",
        ));
    }
    fs::remove_file(&target)
        .map_err(|error| local_file_error("Не удалось удалить локальный файл.", error))
}

fn validated_workspace_file(
    input: &ConnectionInput,
    local_path: &str,
) -> Result<(PathBuf, PathBuf), AppError> {
    let local_path = local_path.trim();
    if local_path.is_empty() || local_path.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Не указан корректный локальный путь.",
        ));
    }
    let root = info(input)?
        .client_root
        .filter(|root| !root.eq_ignore_ascii_case("null"))
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::CommandFailed,
                "Для workspace с Root null локальная операция недоступна.",
            )
        })?;
    let root = fs::canonicalize(root)
        .map_err(|error| local_file_error("Не удалось проверить root workspace.", error))?;
    let target = fs::canonicalize(local_path)
        .map_err(|error| local_file_error("Не удалось проверить локальный файл.", error))?;
    if !target.starts_with(&root) || target == root {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Файл находится вне workspace.",
        ));
    }
    Ok((root, target))
}

fn local_file_error(message: &str, error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::CommandFailed, message).with_diagnostics(error.to_string())
}

fn switch_stream_arguments(
    stream: &str,
    client: &str,
    strategy: &StreamLocalStrategy,
) -> Vec<String> {
    match strategy {
        StreamLocalStrategy::Keep => ["-ztag", "-Mj", "client", "-s", "-f", "-S", stream, client]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        StreamLocalStrategy::Shelve => ["-ztag", "-Mj", "switch", "--no-sync", stream]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
}

fn replace_workspace_fields(
    spec: &str,
    root: &str,
    stream: &str,
    description: &str,
) -> Result<String, AppError> {
    let mut lines = spec.lines().map(str::to_owned).collect::<Vec<_>>();
    replace_single_form_field(&mut lines, "Root", root)?;
    replace_single_form_field(&mut lines, "Stream", stream)?;
    replace_multiline_form_field(&mut lines, "Description", description)?;
    Ok(format!("{}\n", lines.join("\n")))
}

fn replace_single_form_field(
    lines: &mut [String],
    field: &str,
    value: &str,
) -> Result<(), AppError> {
    let prefix = format!("{field}:");
    let line = lines
        .iter_mut()
        .find(|line| line.starts_with(&prefix))
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidOutput,
                format!("В client form отсутствует поле {field}."),
            )
        })?;
    *line = format!("{field}:\t{value}");
    Ok(())
}

fn replace_multiline_form_field(
    lines: &mut Vec<String>,
    field: &str,
    value: &str,
) -> Result<(), AppError> {
    let prefix = format!("{field}:");
    let start = lines
        .iter()
        .position(|line| line.starts_with(&prefix))
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidOutput,
                format!("В client form отсутствует поле {field}."),
            )
        })?;
    let end = lines[start + 1..]
        .iter()
        .position(|line| !line.starts_with([' ', '\t']))
        .map(|offset| start + 1 + offset)
        .unwrap_or(lines.len());
    let replacement = if value.is_empty() {
        vec![format!("{field}:")]
    } else {
        std::iter::once(format!("{field}:"))
            .chain(value.lines().map(|line| format!("\t{line}")))
            .collect()
    };
    lines.splice(start..end, replacement);
    Ok(())
}

pub fn list_depot_directories(
    input: &ConnectionInput,
    scope: &str,
) -> Result<Vec<DepotDirectory>, AppError> {
    validate_depot_path(scope)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "dirs", scope]);
    parse_depot_directories(&run_json_allowing_empty_match(&path, &mut command)?)
}

pub fn list_depots(input: &ConnectionInput) -> Result<Vec<DepotSummary>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "depots"]);
    parse_depots(&run_json(&path, &mut command)?)
}

pub fn list_depot_files(
    input: &ConnectionInput,
    scope: &str,
    include_deleted: bool,
) -> Result<Vec<DepotFile>, AppError> {
    validate_depot_path(scope)?;
    let (path, mut command) = configured_command(input)?;
    command.args(depot_file_arguments(scope, include_deleted));
    parse_depot_files(&run_json_allowing_empty_match(&path, &mut command)?)
}

fn depot_file_arguments(scope: &str, include_deleted: bool) -> Vec<String> {
    let mut arguments = vec!["-ztag", "-Mj", "files"]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
    if !include_deleted {
        arguments.push("-e".to_owned());
    }
    arguments.extend(["-m".to_owned(), MAX_RECORDS.to_owned(), scope.to_owned()]);
    arguments
}

pub fn list_pending_changes(input: &ConnectionInput) -> Result<Vec<PendingChange>, AppError> {
    let client = required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "changes",
        "-s",
        "pending",
        "-c",
        client,
        "-u",
        input.user.trim(),
        "-l",
        "-m",
        MAX_RECORDS,
    ]);
    parse_pending_changes(&run_json(&path, &mut command)?)
}

pub fn list_submitted_changes(
    input: &ConnectionInput,
    scope: &str,
    limit: u32,
    job: Option<&str>,
    user: Option<&str>,
    client: Option<&str>,
    include_streams: bool,
) -> Result<Vec<PendingChange>, AppError> {
    required_client(input)?;
    validate_depot_path(scope)?;
    if !(1..=5000).contains(&limit) {
        return Err(AppError::new(
            ErrorKind::InvalidOutput,
            "History limit must be between 1 and 5000.",
        ));
    }
    let job_change_ids = job
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|job| {
            list_fixes(input, job).map(|fixes| {
                fixes
                    .into_iter()
                    .map(|fix| fix.change)
                    .collect::<BTreeSet<_>>()
            })
        })
        .transpose()?;
    let (path, mut command) = configured_command(input)?;
    let requested_limit = limit as usize;
    let limit = limit.to_string();
    let query_limit = if job_change_ids.is_some() {
        MAX_HISTORY_RECORDS
    } else {
        &limit
    };
    command.args(submitted_change_arguments(
        scope,
        query_limit,
        user,
        client,
    )?);
    let changes = parse_pending_changes(&run_json(&path, &mut command)?)?;
    let mut changes = match job_change_ids {
        Some(ids) => filter_changes_by_ids(changes, &ids, requested_limit),
        None => changes,
    };
    if include_streams && !changes.is_empty() {
        enrich_submitted_streams(input, &mut changes)?;
    }
    Ok(changes)
}

fn enrich_submitted_streams(
    input: &ConnectionInput,
    changes: &mut [PendingChange],
) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    let mut arguments = ["-ztag", "-Mj", "describe", "-s", "-m", "1"]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    arguments.extend(changes.iter().map(|change| change.id.clone()));
    command.args(arguments);
    let first_paths = first_submitted_paths(&run_json(&path, &mut command)?);
    let streams = list_streams(input)?;
    for change in changes {
        change.stream = first_paths
            .get(&change.id)
            .and_then(|depot_path| stream_for_depot_path(depot_path, &streams))
            .map(|stream| stream.path.clone());
    }
    Ok(())
}

fn first_submitted_paths(records: &[Map<String, Value>]) -> BTreeMap<String, String> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            let change = field(record, &["change", "Change"])?;
            let depot_path = field(record, &["depotFile", "depotFile0"])?;
            Some((change, depot_path))
        })
        .collect()
}

fn stream_for_depot_path<'a>(
    depot_path: &str,
    streams: &'a [StreamSummary],
) -> Option<&'a StreamSummary> {
    streams
        .iter()
        .filter(|stream| depot_path.starts_with(&format!("{}/", stream.path.trim_end_matches('/'))))
        .max_by_key(|stream| stream.path.len())
}

fn submitted_change_arguments(
    scope: &str,
    limit: &str,
    user: Option<&str>,
    client: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let mut arguments = [
        "-ztag",
        "-Mj",
        "changes",
        "-s",
        "submitted",
        "-l",
        "-t",
        "-m",
        limit,
    ]
    .into_iter()
    .map(String::from)
    .collect::<Vec<_>>();
    if let Some(user) = user.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.extend([
            "-u".to_owned(),
            validate_form_value(user, "user")?.to_owned(),
        ]);
    }
    if let Some(client) = client.map(str::trim).filter(|value| !value.is_empty()) {
        arguments.extend([
            "-c".to_owned(),
            validate_form_value(client, "workspace")?.to_owned(),
        ]);
    }
    arguments.push(scope.to_owned());
    Ok(arguments)
}

pub fn list_submitted_filter_options(
    input: &ConnectionInput,
) -> Result<SubmittedFilterOptions, AppError> {
    required_client(input)?;
    let (path, mut users_command) = configured_command(input)?;
    users_command.args(["-ztag", "-Mj", "users", "-m", MAX_RECORDS]);
    let users = run_json(&path, &mut users_command)?
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| field(record, &["User", "user"]))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let (path, mut clients_command) = configured_command(input)?;
    clients_command.args(["-ztag", "-Mj", "clients", "-m", MAX_RECORDS]);
    let clients = run_json(&path, &mut clients_command)?
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| field(record, &["client", "Client"]))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(SubmittedFilterOptions { users, clients })
}

fn filter_changes_by_ids(
    changes: Vec<PendingChange>,
    ids: &BTreeSet<String>,
    limit: usize,
) -> Vec<PendingChange> {
    changes
        .into_iter()
        .filter(|change| ids.contains(&change.id))
        .take(limit)
        .collect()
}

pub fn describe_change(
    input: &ConnectionInput,
    change: &str,
) -> Result<SubmittedChangeDetail, AppError> {
    describe_change_with_file_limit(input, change, None)
}

pub fn describe_change_with_file_limit(
    input: &ConnectionInput,
    change: &str,
    file_limit: Option<u32>,
) -> Result<SubmittedChangeDetail, AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    if file_limit.is_some_and(|limit| limit == 0 || limit > MAX_SUBMITTED_DETAIL_PREVIEW_FILES) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный лимит файлов submitted changelist.",
        ));
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "describe", "-s"]);
    if let Some(limit) = file_limit {
        command.args(["-m", &(limit + 1).to_string()]);
    }
    command.arg(change);
    let detail = parse_change_detail(&run_json(&path, &mut command)?, change)?;
    Ok(limit_change_detail(
        detail,
        file_limit.map(|limit| limit as usize),
    ))
}

pub fn preview_undo(
    input: &ConnectionInput,
    source_change: &str,
) -> Result<Vec<UndoPreviewItem>, AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    let spec = format!("@{source_change}");
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "undo", "-n"]);
    command.arg(spec);
    Ok(parse_undo_preview(&run_json(&path, &mut command)?))
}

pub fn undo_change(
    input: &ConnectionInput,
    source_change: &str,
    target_change: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_change(target_change)?;
    let spec = format!("@{source_change}");
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "undo", "-c", target_change]);
    command.arg(spec);
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn preview_cherry_pick(
    input: &ConnectionInput,
    source_change: &str,
    source_stream: &str,
    target_stream: &str,
    target_change: &str,
) -> Result<Vec<CherryPickPreviewItem>, AppError> {
    validate_cherry_pick(
        input,
        source_change,
        source_stream,
        target_stream,
        target_change,
    )?;
    let (path, mut command) = configured_command(input)?;
    command.args(cherry_pick_arguments(
        source_change,
        source_stream,
        target_stream,
        target_change,
        true,
    ));
    Ok(parse_cherry_pick_preview(&run_json(&path, &mut command)?))
}

pub fn cherry_pick_change(
    input: &ConnectionInput,
    source_change: &str,
    source_stream: &str,
    target_stream: &str,
    target_change: &str,
) -> Result<(), AppError> {
    validate_cherry_pick(
        input,
        source_change,
        source_stream,
        target_stream,
        target_change,
    )?;
    let (path, mut command) = configured_command(input)?;
    command.args(cherry_pick_arguments(
        source_change,
        source_stream,
        target_stream,
        target_change,
        false,
    ));
    run_json(&path, &mut command)?;
    Ok(())
}

fn validate_cherry_pick(
    input: &ConnectionInput,
    source_change: &str,
    source_stream: &str,
    target_stream: &str,
    target_change: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_change(target_change)?;
    validate_stream_path(source_stream)?;
    validate_stream_path(target_stream)?;
    if source_stream == target_stream {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Cherry-pick requires a different source stream.",
        ));
    }
    let current_stream = inspect_workspace(input)?.stream.ok_or_else(|| {
        AppError::new(
            ErrorKind::CommandFailed,
            "The current workspace is not associated with a stream.",
        )
    })?;
    if current_stream != target_stream {
        return Err(AppError::new(
            ErrorKind::Stale,
            "The workspace stream changed before cherry-pick.",
        ));
    }
    let detail = describe_change(input, source_change)?;
    let prefix = format!("{}/", source_stream.trim_end_matches('/'));
    if detail.files.is_empty()
        || detail
            .files
            .iter()
            .any(|file| !file.depot_path.starts_with(&prefix))
    {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "The submitted changelist cannot be mapped safely from one source stream.",
        ));
    }
    Ok(())
}

fn cherry_pick_arguments(
    source_change: &str,
    source_stream: &str,
    target_stream: &str,
    target_change: &str,
    preview: bool,
) -> Vec<String> {
    let mut arguments = ["-ztag", "-Mj", "integrate"]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
    if preview {
        arguments.push("-n".to_owned());
    }
    arguments.extend([
        "-c".to_owned(),
        target_change.to_owned(),
        "-S".to_owned(),
        source_stream.to_owned(),
        "-P".to_owned(),
        target_stream.to_owned(),
        "-Af".to_owned(),
        format!(
            "{}/...@={source_change}",
            source_stream.trim_end_matches('/')
        ),
    ]);
    arguments
}

pub fn list_shelved_changes(input: &ConnectionInput) -> Result<Vec<PendingChange>, AppError> {
    let client = required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "changes",
        "-s",
        "shelved",
        "-c",
        client,
        "-u",
        input.user.trim(),
        "-l",
        "-m",
        MAX_RECORDS,
    ]);
    parse_pending_changes(&run_json(&path, &mut command)?)
}

pub fn list_opened_files(input: &ConnectionInput) -> Result<Vec<OpenedFile>, AppError> {
    let client = required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "opened", "-C", client]);
    parse_opened_files(&run_json(&path, &mut command)?)
}

pub fn list_workspace_files(
    input: &ConnectionInput,
    scope: Option<&str>,
    include_untracked: bool,
) -> Result<Vec<WorkspaceFile>, AppError> {
    required_client(input)?;
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("//...");
    validate_depot_path(scope)?;
    let (path, mut command) = configured_command(input)?;
    command.args(workspace_fstat_arguments(scope));
    let mut files = parse_workspace_files(&run_json_allowing_empty_match(&path, &mut command)?)?;
    if include_untracked {
        let visible = preview_reconcile(input, Some(scope))?;
        let with_ignored = preview_reconcile_internal(input, Some(scope), true)?;
        merge_untracked_workspace_files(&mut files, &with_ignored, &visible);
    }
    Ok(files)
}

pub fn list_local_workspace_directory(
    input: &ConnectionInput,
    root: &Path,
    client: &str,
    directory: &str,
) -> Result<WorkspaceLocalBatch, AppError> {
    let mut batch = read_local_workspace_directory(root, client, directory)?;
    mark_ignored_workspace_paths(input, root, client, &mut batch)?;
    Ok(batch)
}

fn read_local_workspace_directory(
    root: &Path,
    client: &str,
    directory: &str,
) -> Result<WorkspaceLocalBatch, AppError> {
    let root = fs::canonicalize(root)
        .map_err(|error| local_file_error("Не удалось прочитать root workspace.", error))?;
    let directory = workspace_local_directory(&root, client, directory)?;
    let directory_client_path = workspace_client_path(&root, &directory, client)?;
    let mut batch = WorkspaceLocalBatch {
        completed_directories: vec![directory_client_path],
        ..WorkspaceLocalBatch::default()
    };
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(batch);
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            batch
                .directories
                .push(workspace_client_path(&root, &path, client)?);
        } else if file_type.is_file() {
            let client_path = workspace_client_path(&root, &path, client)?;
            batch.files.push(WorkspaceFile {
                depot_path: client_path.clone(),
                client_path: Some(client_path),
                local_path: Some(path.to_string_lossy().into_owned()),
                action: String::new(),
                change: None,
                have_revision: None,
                head_revision: None,
                file_type: None,
                mapped: true,
                other_open: false,
                other_lock: false,
                unresolved: false,
                untracked: false,
                ignored: false,
                file_size: entry.metadata().ok().map(|metadata| metadata.len()),
            });
        }
    }
    batch.directories.sort();
    batch.files.sort_by(|left, right| {
        left.client_path
            .as_deref()
            .cmp(&right.client_path.as_deref())
    });
    Ok(batch)
}

fn mark_ignored_workspace_paths(
    input: &ConnectionInput,
    root: &Path,
    client: &str,
    batch: &mut WorkspaceLocalBatch,
) -> Result<(), AppError> {
    let directory_paths = batch
        .directories
        .iter()
        .chain(batch.completed_directories.iter())
        .cloned()
        .collect::<Vec<_>>();
    let directories = resolve_workspace_directories(root, client, &directory_paths)?;
    let directory_probes = directories
        .iter()
        .map(|(directory, path)| (directory.clone(), path.join(IGNORE_DIRECTORY_PROBE)))
        .collect::<Vec<_>>();
    let paths = batch
        .files
        .iter()
        .filter_map(|file| file.local_path.as_deref().map(workspace_cli_path))
        .chain(
            directory_probes
                .iter()
                .map(|(_, path)| workspace_cli_path(&path.to_string_lossy())),
        )
        .collect::<Vec<_>>();
    let workspace_ignore = workspace_ignore_file(root);
    let mut ignored = BTreeSet::new();
    for query in paths {
        let (path, mut command) = configured_command(input)?;
        if let Some(ignore_file) = &workspace_ignore {
            command.env("P4IGNORE", ignore_file);
        }
        if let Some(directory) = Path::new(&query).parent() {
            command.current_dir(directory);
        }
        command.args(ignored_path_arguments(&query));
        ignored.extend(parse_ignored_paths(&String::from_utf8_lossy(&run_binary(
            &path,
            &mut command,
        )?)));
    }
    for file in &mut batch.files {
        file.ignored = file
            .local_path
            .as_deref()
            .is_some_and(|path| ignored.contains(&workspace_path_key(path)));
    }
    batch.ignored_directories = directory_probes
        .into_iter()
        .filter(|(_, path)| ignored.contains(&workspace_path_key(&path.to_string_lossy())))
        .map(|(directory, _)| directory)
        .collect();
    Ok(())
}

fn resolve_workspace_directories(
    root: &Path,
    client: &str,
    directories: &[String],
) -> Result<Vec<(String, PathBuf)>, AppError> {
    let root = fs::canonicalize(root)
        .map_err(|error| local_file_error("Не удалось прочитать root workspace.", error))?;
    directories
        .iter()
        .map(|directory| {
            Ok((
                directory.clone(),
                workspace_local_directory(&root, client, directory)?,
            ))
        })
        .collect()
}

fn parse_ignored_paths(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .filter_map(|line| line.trim().strip_suffix(" ignored"))
        .map(workspace_path_key)
        .collect()
}

fn ignored_path_arguments(query: &str) -> [&str; 3] {
    ["ignores", "-i", query]
}

fn workspace_ignore_file(root: &Path) -> Option<PathBuf> {
    let ignore_file = root.join(".p4ignore");
    ignore_file.is_file().then_some(ignore_file)
}

fn workspace_cli_path(path: &str) -> String {
    if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{path}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(path).to_owned()
    }
}

fn workspace_path_key(path: &str) -> String {
    workspace_cli_path(path).replace('\\', "/").to_lowercase()
}

fn workspace_local_directory(
    root: &Path,
    client: &str,
    directory: &str,
) -> Result<PathBuf, AppError> {
    let prefix = format!("//{}", validate_form_value(client, "workspace")?);
    let directory = directory.trim_end_matches('/');
    let relative = directory.strip_prefix(&prefix).ok_or_else(|| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Каталог находится вне текущего workspace.",
        )
    })?;
    if !relative.is_empty() && !relative.starts_with('/') {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Каталог находится вне текущего workspace.",
        ));
    }
    let mut path = root.to_path_buf();
    for component in relative.trim_start_matches('/').split('/') {
        if component.is_empty() {
            continue;
        }
        if component == "." || component == ".." || component.contains(['\\', ':']) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Некорректный путь каталога workspace.",
            ));
        }
        path.push(component);
    }
    let path = fs::canonicalize(path)
        .map_err(|error| local_file_error("Не удалось прочитать каталог workspace.", error))?;
    if !path.starts_with(root) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Каталог находится вне текущего workspace.",
        ));
    }
    Ok(path)
}

fn workspace_client_path(root: &Path, path: &Path, client: &str) -> Result<String, AppError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|error| local_file_error("Локальный путь находится вне workspace.", error))?
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Ok(if relative.is_empty() {
        format!("//{client}")
    } else {
        format!("//{client}/{relative}")
    })
}

fn workspace_fstat_arguments(scope: &str) -> Vec<String> {
    [
        "-ztag",
        "-Mj",
        "fstat",
        "-Rc",
        "-Ol",
        "-T",
        "depotFile,clientFile,path,action,change,haveRev,headRev,type,fileSize,otherOpen,otherLock,resolveStatus",
        scope,
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn merge_untracked_workspace_files(
    files: &mut Vec<WorkspaceFile>,
    candidates: &[ReconcileItem],
    visible_candidates: &[ReconcileItem],
) {
    let existing = files
        .iter()
        .map(|file| file.depot_path.clone())
        .collect::<BTreeSet<_>>();
    let visible = visible_candidates
        .iter()
        .filter(|item| item.action == "add")
        .map(|item| item.depot_path.as_str())
        .collect::<BTreeSet<_>>();
    files.extend(
        candidates
            .iter()
            .filter(|item| item.action == "add" && !existing.contains(&item.depot_path))
            .map(|item| WorkspaceFile {
                depot_path: item.depot_path.clone(),
                client_path: None,
                local_path: item.local_path.clone(),
                action: String::new(),
                change: None,
                have_revision: None,
                head_revision: None,
                file_type: None,
                mapped: true,
                other_open: false,
                other_lock: false,
                unresolved: false,
                untracked: true,
                ignored: !visible.contains(item.depot_path.as_str()),
                file_size: item
                    .local_path
                    .as_deref()
                    .and_then(|path| fs::metadata(path).ok())
                    .map(|metadata| metadata.len()),
            }),
    );
}

pub fn preview_sync_scopes(
    input: &ConnectionInput,
    scopes: &[String],
) -> Result<SyncPreview, AppError> {
    let mut preview = preview_sync_items(input, scopes)?;
    let workspace_files = modified_workspace_files(input, &preview)?;
    preview.modified_files = workspace_files.modified;
    preview.writable_files = workspace_files.writable;
    preview.missing_have_files = workspace_files.missing_have;
    Ok(preview)
}

pub fn preview_sync_items(
    input: &ConnectionInput,
    scopes: &[String],
) -> Result<SyncPreview, AppError> {
    required_client(input)?;
    if scopes.is_empty() {
        return Err(empty_file_selection());
    }
    validate_depot_paths(scopes)?;
    let stdin = sync_scope_stdin(scopes);
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "-x", "-", "sync", "-n"]);
    if sync_scopes_are_exact_revisions(scopes) {
        command.arg("-L");
    }
    let records = run_json_with_stdin_allowing_empty_match(&path, &mut command, &stdin)?;
    Ok(parse_sync_preview(&records))
}

fn sync_preview_diff_paths(preview: &SyncPreview) -> Vec<String> {
    preview
        .items
        .iter()
        .map(|item| item.depot_path.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

struct ModifiedWorkspaceFiles {
    modified: Vec<String>,
    writable: Vec<String>,
    missing_have: Vec<String>,
}

fn modified_workspace_files(
    input: &ConnectionInput,
    preview: &SyncPreview,
) -> Result<ModifiedWorkspaceFiles, AppError> {
    let paths = sync_preview_diff_paths(preview);
    if paths.is_empty() {
        return Ok(ModifiedWorkspaceFiles {
            modified: Vec::new(),
            writable: Vec::new(),
            missing_have: Vec::new(),
        });
    }
    validate_depot_paths(&paths)?;
    let stdin = format!("{}\n", paths.join("\n"));
    let (path, mut command) = configured_command(input)?;
    command.args(modified_workspace_file_arguments());
    let records = run_json_with_stdin_allowing_empty_match(&path, &mut command, stdin.as_bytes())?;
    let mut files = parse_modified_files(&records)
        .into_iter()
        .collect::<BTreeSet<_>>();
    let missing_have_files = existing_not_on_client_files(preview, &records);
    files.extend(missing_have_files.iter().cloned());
    let files = files.into_iter().collect::<Vec<_>>();
    Ok(ModifiedWorkspaceFiles {
        modified: files.clone(),
        writable: files,
        missing_have: missing_have_files,
    })
}

fn modified_workspace_file_arguments() -> [&'static str; 7] {
    ["-ztag", "-Mj", "-x", "-", "diff", "-f", "-sa"]
}

fn parse_modified_files(records: &[Map<String, Value>]) -> Vec<String> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| field(record, &["depotFile", "clientFile", "path"]))
        .collect()
}

fn parse_not_on_client_files(records: &[Map<String, Value>]) -> Vec<String> {
    records
        .iter()
        .filter(|record| record.get("severity").and_then(Value::as_i64) == Some(2))
        .filter(|record| record.get("generic").and_then(Value::as_i64) == Some(17))
        .filter_map(|record| field(record, &["data"]))
        .filter_map(|message| {
            message
                .trim()
                .strip_suffix(" - file(s) not on client.")
                .map(str::to_owned)
        })
        .collect()
}

fn existing_not_on_client_files(
    preview: &SyncPreview,
    records: &[Map<String, Value>],
) -> Vec<String> {
    parse_not_on_client_files(records)
        .into_iter()
        .filter(|depot_path| {
            preview.items.iter().any(|item| {
                item.depot_path.eq_ignore_ascii_case(depot_path)
                    && item
                        .local_path
                        .as_deref()
                        .is_some_and(|path| fs::metadata(path).is_ok())
            })
        })
        .collect()
}

fn parse_expiry_minutes(message: &str) -> Option<u64> {
    message
        .split_whitespace()
        .collect::<Vec<_>>()
        .windows(2)
        .find_map(|pair| {
            let value = pair[0].parse::<u64>().ok()?;
            let unit = pair[1].trim_matches(|character: char| !character.is_ascii_alphabetic());
            (unit.eq_ignore_ascii_case("minute") || unit.eq_ignore_ascii_case("minutes"))
                .then_some(value)
        })
}

fn parse_undo_preview(records: &[Map<String, Value>]) -> Vec<UndoPreviewItem> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            Some(UndoPreviewItem {
                depot_path: field(record, &["depotFile", "clientFile"])?,
                action: field(record, &["action", "status"]).unwrap_or_else(|| "undo".to_owned()),
                local_path: field(record, &["path", "clientFile"]),
            })
        })
        .collect()
}

fn parse_cherry_pick_preview(records: &[Map<String, Value>]) -> Vec<CherryPickPreviewItem> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            let target_path = field(record, &["depotFile", "toFile"])?;
            Some(CherryPickPreviewItem {
                source_path: field(record, &["fromFile", "sourceFile"]).unwrap_or_default(),
                target_path,
                action: field(record, &["action", "status"])
                    .unwrap_or_else(|| "integrate".to_owned()),
                local_path: field(record, &["path", "clientFile"]),
            })
        })
        .collect()
}

pub fn repair_sync_have_list(input: &ConnectionInput, paths: &[String]) -> Result<(), AppError> {
    required_client(input)?;
    if paths.is_empty() {
        return Ok(());
    }
    validate_depot_paths(paths)?;
    let (path, mut command) = configured_command(input)?;
    command.args(repair_sync_have_list_arguments());
    command.args(paths);
    run_json_allowing_empty_match(&path, &mut command)?;
    Ok(())
}

pub fn repair_sync_after_readback(
    input: &ConnectionInput,
    scopes: &[String],
    force_preview: Option<&SyncPreview>,
) -> Result<bool, AppError> {
    if let Some(preview) = force_preview {
        let restored = download_remaining_from_depot(input, preview, true)?;
        return Ok(restored && preview_sync_items(input, scopes)?.items.is_empty());
    }
    let initial_preview = preview_sync_scopes(input, scopes)?;
    if !initial_preview.missing_have_files.is_empty() {
        let _ = repair_sync_have_list(input, &initial_preview.missing_have_files);
    }
    let repaired_preview = preview_sync_scopes(input, scopes)?;
    if repaired_preview.items.is_empty() {
        return Ok(true);
    }
    download_remaining_from_depot(input, &repaired_preview, false)?;
    Ok(preview_sync_scopes(input, scopes)?.items.is_empty())
}

fn download_remaining_from_depot(
    input: &ConnectionInput,
    preview: &SyncPreview,
    overwrite_remaining: bool,
) -> Result<bool, AppError> {
    let root = info(input)?
        .client_root
        .filter(|root| !root.eq_ignore_ascii_case("null"))
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::CommandFailed,
                "Для workspace с Root null восстановление файлов недоступно.",
            )
        })?;
    let root = fs::canonicalize(root)
        .map_err(|error| local_file_error("Не удалось проверить root workspace.", error))?;
    let items = recovery_download_items(preview, overwrite_remaining);
    let worker_count = recovery_worker_count(items.len());
    if worker_count == 0 {
        return Ok(true);
    }
    let next = AtomicUsize::new(0);
    let restored = AtomicBool::new(true);
    thread::scope(|scope| {
        for _ in 0..worker_count {
            scope.spawn(|| {
                while let Some(item) = items.get(next.fetch_add(1, Ordering::Relaxed)) {
                    if let Err(error) = download_revision_to_workspace(input, &root, item) {
                        restored.store(false, Ordering::Relaxed);
                        push_cli_log(
                            CliLogLevel::Error,
                            format!("Не удалось окончательно восстановить {}.", item.depot_path),
                            Some(format!(
                                "{}\n{}",
                                error.message,
                                error.diagnostics.unwrap_or_default()
                            )),
                        );
                    }
                }
            });
        }
    });
    Ok(restored.load(Ordering::Relaxed))
}

fn recovery_worker_count(item_count: usize) -> usize {
    item_count.min(
        thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            .min(MAX_RECOVERY_WORKERS),
    )
}

fn recovery_download_items(
    preview: &SyncPreview,
    overwrite_remaining: bool,
) -> Vec<&SyncPreviewItem> {
    preview
        .items
        .iter()
        .filter(|item| {
            if overwrite_remaining {
                return true;
            }
            if item.revision.is_none() {
                return false;
            }
            let Some(path) = item.local_path.as_deref() else {
                return false;
            };
            match fs::metadata(path) {
                Ok(metadata) => {
                    metadata.is_file() && (overwrite_remaining || metadata.permissions().readonly())
                }
                Err(error) => error.kind() == std::io::ErrorKind::NotFound,
            }
        })
        .collect()
}

fn download_revision_to_workspace(
    input: &ConnectionInput,
    root: &Path,
    item: &SyncPreviewItem,
) -> Result<(), AppError> {
    let local_path = item.local_path.as_deref().ok_or_else(|| {
        AppError::new(
            ErrorKind::CommandFailed,
            "p4 preview не вернул локальный путь файла.",
        )
    })?;
    if sync_preview_item_is_deleted(item) {
        let requested = Path::new(local_path);
        if requested.exists() {
            let target = validated_recovery_target(root, local_path)?;
            let original_permissions = fs::metadata(&target)
                .map_err(|error| local_file_error("Не удалось прочитать атрибуты файла.", error))?
                .permissions();
            make_file_writable(&target)?;
            if let Err(error) = fs::remove_file(&target) {
                let _ = fs::set_permissions(&target, original_permissions);
                return Err(local_file_error(
                    "Не удалось удалить локальную depot-ревизию.",
                    error,
                ));
            }
        }
        return flush_recovery_spec(input, &format!("{}#none", item.depot_path));
    }
    let revision = validate_revision(item.revision.as_deref().unwrap_or_default())?;
    let target = validated_recovery_target(root, local_path)?;
    let temporary = recovery_temporary_path(&target)?;
    let spec = format!("{}#{revision}", item.depot_path);
    let recovery_input = unchecked_utf8_recovery_input(input);
    let result = (|| {
        let (path, mut command) = configured_command(&recovery_input)?;
        if let Some(charset) = recovery_input.charset.as_deref() {
            command.args(["-C", charset]);
        }
        let temporary_arg = temporary.to_string_lossy().into_owned();
        command.args(recovery_print_arguments(
            &temporary_arg,
            &spec,
            recovery_input.charset.as_deref(),
        ));
        let records = run_json(&path, &mut command)?;
        if let Some(message) = warning_record_message(&records) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "p4 print не смог полностью загрузить depot-ревизию.",
            )
            .with_diagnostics(message));
        }
        replace_recovery_file(&temporary, &target)?;
        flush_recovery_spec(input, &spec)
    })();
    if temporary.exists() {
        remove_recovery_temporary(&temporary);
    }
    result
}

fn sync_preview_item_is_deleted(item: &SyncPreviewItem) -> bool {
    matches!(
        item.action.to_ascii_lowercase().as_str(),
        "delete" | "deleted" | "removed"
    )
}

fn flush_recovery_spec(input: &ConnectionInput, spec: &str) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(recovery_flush_arguments(spec));
    run_json(&path, &mut command)?;
    Ok(())
}

fn recovery_print_arguments(output: &str, spec: &str, charset: Option<&str>) -> Vec<String> {
    let mut arguments = ["-ztag", "-Mj", "print", "-q"]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if let Some(charset) = charset {
        arguments.extend(["-Q".to_owned(), charset.to_owned()]);
    }
    arguments.extend(["-o".to_owned(), output.to_owned(), spec.to_owned()]);
    arguments
}

fn recovery_flush_arguments(spec: &str) -> Vec<String> {
    ["-ztag", "-Mj", "flush", "-f", spec]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

fn warning_record_message(records: &[Map<String, Value>]) -> Option<String> {
    records
        .iter()
        .find(|record| {
            record
                .get("severity")
                .and_then(Value::as_i64)
                .is_some_and(|severity| severity >= 2)
        })
        .and_then(|record| record.get("data").or_else(|| record.get("fmt")))
        .and_then(value_text)
}

fn validated_recovery_target(root: &Path, local_path: &str) -> Result<PathBuf, AppError> {
    let requested = PathBuf::from(local_path);
    let target = if requested.exists() {
        let target = fs::canonicalize(&requested)
            .map_err(|error| local_file_error("Не удалось проверить локальный файл.", error))?;
        if !target.is_file() {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Цель восстановления не является файлом.",
            ));
        }
        target
    } else {
        let name = requested.file_name().ok_or_else(|| {
            AppError::new(
                ErrorKind::CommandFailed,
                "Некорректный локальный путь восстановления.",
            )
        })?;
        let parent = requested.parent().ok_or_else(|| {
            AppError::new(
                ErrorKind::CommandFailed,
                "У файла восстановления нет родительского каталога.",
            )
        })?;
        let parent = fs::canonicalize(parent).map_err(|error| {
            local_file_error("Не удалось проверить каталог восстановления.", error)
        })?;
        parent.join(name)
    };
    if !target.starts_with(root) || target == root {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Файл восстановления находится вне workspace.",
        ));
    }
    Ok(target)
}

fn recovery_temporary_path(target: &Path) -> Result<PathBuf, AppError> {
    let name = target.file_name().ok_or_else(|| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось построить временный путь восстановления.",
        )
    })?;
    let id = RECOVERY_TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let mut temporary_name = name.to_os_string();
    temporary_name.push(format!(".p4fnv-{id}.tmp"));
    Ok(target.with_file_name(temporary_name))
}

fn replace_recovery_file(source: &Path, destination: &Path) -> Result<(), AppError> {
    let original_permissions = fs::metadata(destination)
        .ok()
        .map(|metadata| metadata.permissions());
    if original_permissions.is_some() {
        make_file_writable(destination)?;
    }
    if let Err(error) = crate::settings::replace_file(source, destination) {
        if let Some(permissions) = original_permissions {
            let _ = fs::set_permissions(destination, permissions);
        }
        return Err(local_file_error(
            "Не удалось атомарно заменить локальный файл.",
            error,
        ));
    }
    Ok(())
}

#[cfg(windows)]
#[allow(clippy::permissions_set_readonly_false)]
fn make_file_writable(path: &Path) -> Result<(), AppError> {
    let mut permissions = fs::metadata(path)
        .map_err(|error| local_file_error("Не удалось прочитать атрибуты файла.", error))?
        .permissions();
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions)
        .map_err(|error| local_file_error("Не удалось подготовить файл к замене.", error))
}

#[cfg(not(windows))]
fn make_file_writable(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| local_file_error("Не удалось прочитать атрибуты файла.", error))?
        .permissions();
    permissions.set_mode(permissions.mode() | 0o200);
    fs::set_permissions(path, permissions)
        .map_err(|error| local_file_error("Не удалось подготовить файл к замене.", error))
}

fn remove_recovery_temporary(path: &Path) {
    let _ = make_file_writable(path);
    let _ = fs::remove_file(path);
}

fn unchecked_utf8_recovery_input(input: &ConnectionInput) -> ConnectionInput {
    let mut recovery = input.clone();
    recovery.charset = match input.charset.as_deref().map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("utf8") => Some("utf8unchecked".to_owned()),
        Some(value) if value.eq_ignore_ascii_case("utf8-bom") => {
            Some("utf8unchecked-bom".to_owned())
        }
        _ => input.charset.clone(),
    };
    recovery
}

fn repair_sync_have_list_arguments() -> [&'static str; 4] {
    ["-ztag", "-Mj", "reconcile", "-k"]
}

pub fn sync_command_scopes(
    input: &ConnectionInput,
    scopes: &[String],
    include_progress: bool,
    force: bool,
) -> Result<(PathBuf, Command, Vec<u8>), AppError> {
    required_client(input)?;
    if scopes.is_empty() {
        return Err(empty_file_selection());
    }
    validate_depot_paths(scopes)?;
    let (path, mut command) = configured_command(input)?;
    if include_progress {
        command.arg("-I");
    }
    command.args(["-ztag", "-Mj", "-x", "-", "sync", sync_mode_argument(force)]);
    if sync_scopes_are_exact_revisions(scopes) {
        command.arg("-L");
    }
    Ok((path, command, sync_scope_stdin(scopes)))
}

fn sync_scope_stdin(scopes: &[String]) -> Vec<u8> {
    format!("{}\n", scopes.join("\n")).into_bytes()
}

fn sync_scopes_are_exact_revisions(scopes: &[String]) -> bool {
    scopes.iter().all(|scope| {
        scope.starts_with("//")
            && scope.rsplit_once('#').is_some_and(|(_, revision)| {
                !revision.is_empty() && revision.bytes().all(|byte| byte.is_ascii_digit())
            })
    })
}

fn sync_mode_argument(force: bool) -> &'static str {
    if force { "-f" } else { "-s" }
}

pub fn edit_files(input: &ConnectionInput, change: &str, paths: &[String]) -> Result<(), AppError> {
    file_operation(input, "edit", change, paths)
}
pub fn add_files(input: &ConnectionInput, change: &str, paths: &[String]) -> Result<(), AppError> {
    file_operation(input, "add", change, paths)
}
pub fn delete_files(
    input: &ConnectionInput,
    change: &str,
    paths: &[String],
) -> Result<(), AppError> {
    file_operation(input, "delete", change, paths)
}
pub fn lock_files(input: &ConnectionInput, change: &str, paths: &[String]) -> Result<(), AppError> {
    file_operation(input, "lock", change, paths)
}
pub fn unlock_files(
    input: &ConnectionInput,
    change: &str,
    paths: &[String],
) -> Result<(), AppError> {
    file_operation(input, "unlock", change, paths)
}

pub fn resolve_files(
    input: &ConnectionInput,
    paths: &[String],
    mode: &ResolveMode,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_depot_paths(paths)?;
    if paths.is_empty() {
        return Err(empty_file_selection());
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "resolve", resolve_mode_flag(mode)]);
    command.args(paths);
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn preview_resolve(
    input: &ConnectionInput,
    paths: &[String],
) -> Result<Vec<ResolvePreviewItem>, AppError> {
    required_client(input)?;
    validate_depot_paths(paths)?;
    if paths.is_empty() {
        return Err(empty_file_selection());
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "resolve", "-n"]);
    command.args(paths);
    let records = run_json(&path, &mut command)?;
    Ok(parse_resolve_preview(&records))
}

fn parse_resolve_preview(records: &[Map<String, Value>]) -> Vec<ResolvePreviewItem> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            Some(ResolvePreviewItem {
                depot_path: field(record, &["depotFile", "clientFile", "path"])?,
                action: field(record, &["how", "action", "status"])
                    .unwrap_or_else(|| "resolve".to_owned()),
                detail: field(record, &["fromFile", "baseFile", "type"]),
            })
        })
        .collect()
}

fn resolve_mode_flag(mode: &ResolveMode) -> &'static str {
    match mode {
        ResolveMode::Yours => "-ay",
        ResolveMode::Theirs => "-at",
        ResolveMode::AutoSafe => "-as",
        ResolveMode::AutoMerge => "-am",
    }
}

fn file_operation(
    input: &ConnectionInput,
    operation: &str,
    change: &str,
    paths: &[String],
) -> Result<(), AppError> {
    required_client(input)?;
    validate_change(change)?;
    validate_depot_paths(paths)?;
    if paths.is_empty() {
        return Err(empty_file_selection());
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", operation, "-c", change]);
    command.args(paths);
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn reconcile_command(
    input: &ConnectionInput,
    change: Option<&str>,
    paths: &[String],
    preview: bool,
) -> Result<(PathBuf, Command), AppError> {
    required_client(input)?;
    if let Some(change) = change {
        validate_change(change)?;
    } else if !preview {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "A changelist is required when applying reconcile.",
        ));
    }
    if !paths.is_empty() {
        validate_depot_paths(paths)?;
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "reconcile"]);
    if preview {
        command.arg("-n");
    }
    if let Some(change) = change {
        command.args(["-c", change]);
    }
    if paths.is_empty() {
        command.arg("//...");
    } else {
        command.args(paths);
    }
    Ok((path, command))
}

pub fn parse_reconcile_output_record(line: &str) -> Option<ReconcileItem> {
    let record = serde_json::from_str::<Map<String, Value>>(line).ok()?;
    reconcile_item(&record)
}

fn reconcile_item(record: &Map<String, Value>) -> Option<ReconcileItem> {
    Some(ReconcileItem {
        depot_path: field(record, &["depotFile", "clientFile"])?,
        action: field(record, &["action", "status"])?.to_lowercase(),
        local_path: field(record, &["path", "clientFile"]),
    })
}

pub fn move_file(
    input: &ConnectionInput,
    change: &str,
    source: &str,
    destination: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_change(change)?;
    validate_depot_path(source)?;
    validate_depot_path(destination)?;
    if source == destination {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Source and destination must be different.",
        ));
    }
    let (path, mut preview) = configured_command(input)?;
    preview.args(move_arguments(change, source, destination, true));
    run_json(&path, &mut preview)?;
    let (path, mut command) = configured_command(input)?;
    command.args(move_arguments(change, source, destination, false));
    run_json(&path, &mut command)?;
    Ok(())
}

fn move_arguments(change: &str, source: &str, destination: &str, preview: bool) -> Vec<String> {
    let mut args = vec!["-ztag", "-Mj", "move"]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
    if preview {
        args.push("-n".to_owned());
    }
    args.extend([
        "-c".to_owned(),
        change.to_owned(),
        source.to_owned(),
        destination.to_owned(),
    ]);
    args
}

#[cfg(test)]
fn ensure_reconcile_candidates(
    paths: &[String],
    candidates: &[ReconcileItem],
) -> Result<(), AppError> {
    let current = candidates
        .iter()
        .map(|item| item.depot_path.as_str())
        .collect::<BTreeSet<_>>();
    if let Some(path) = paths.iter().find(|path| !current.contains(path.as_str())) {
        return Err(
            AppError::new(ErrorKind::Stale, "Reconcile preview is stale.")
                .with_hint(format!("Refresh the preview before applying {path}.")),
        );
    }
    Ok(())
}

pub fn preview_reconcile(
    input: &ConnectionInput,
    scope: Option<&str>,
) -> Result<Vec<ReconcileItem>, AppError> {
    preview_reconcile_internal(input, scope, false)
}

fn preview_reconcile_internal(
    input: &ConnectionInput,
    scope: Option<&str>,
    include_ignored: bool,
) -> Result<Vec<ReconcileItem>, AppError> {
    required_client(input)?;
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("//...");
    validate_depot_path(scope)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "reconcile", "-n"]);
    if include_ignored {
        command.arg("-I");
    }
    command.arg(scope);
    let records = run_json(&path, &mut command)?;
    Ok(records.iter().filter_map(reconcile_item).collect())
}

pub fn list_shelved_files(
    input: &ConnectionInput,
    change: &str,
) -> Result<Vec<ShelvedFile>, AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    let selector = format!("@={change}");
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "files", &selector]);
    parse_shelved_files(&run_json(&path, &mut command)?)
}

pub fn reopen_files(
    input: &ConnectionInput,
    depot_paths: &[String],
    target_change: &str,
) -> Result<(), AppError> {
    validate_depot_paths(depot_paths)?;
    if depot_paths.is_empty() {
        return Err(empty_file_selection());
    }
    validate_change(target_change)?;
    required_client(input)?;

    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "reopen", "-c", target_change]);
    command.args(depot_paths);
    run_json(&path, &mut command)?;
    Ok(())
}

fn reopen_file(
    input: &ConnectionInput,
    depot_path: &str,
    target_change: &str,
) -> Result<(), AppError> {
    reopen_files(input, &[depot_path.to_owned()], target_change)
}

pub fn diff_file(
    input: &ConnectionInput,
    depot_path: &str,
    mode: &DiffMode,
) -> Result<FileDiff, AppError> {
    validate_depot_path(depot_path)?;
    required_client(input)?;

    let (path, mut command) = configured_command(input)?;
    command.env_remove("P4DIFF");
    command.env_remove("P4DIFFUNICODE");
    command.arg("diff");
    add_diff_args(&mut command, mode);
    command.arg(depot_path);
    run_text_diff(&path, &mut command)
}

pub fn diff_shelved_file(
    input: &ConnectionInput,
    change: &str,
    depot_path: &str,
    against_local: bool,
    mode: &DiffMode,
) -> Result<FileDiff, AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    validate_depot_path(depot_path)?;
    let shelf = format!("{depot_path}@={change}");
    let (path, mut command) = configured_command(input)?;
    command.env_remove("P4DIFF");
    command.env_remove("P4DIFFUNICODE");
    if against_local {
        command.arg("diff");
        add_diff_args(&mut command, mode);
        command.arg(&shelf);
    } else {
        let head = format!("{depot_path}#head");
        command.arg("diff2");
        add_diff_args(&mut command, mode);
        command.args([&head, &shelf]);
    }
    run_text_diff(&path, &mut command)
}

pub fn file_history(
    input: &ConnectionInput,
    depot_path: &str,
    limit: u32,
) -> Result<Vec<FileRevision>, AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    validate_history_limit(limit)?;
    let (path, mut command) = configured_command(input)?;
    let limit = limit.to_string();
    command.args([
        "-ztag", "-Mj", "filelog", "-i", "-l", "-t", "-m", &limit, depot_path,
    ]);
    parse_file_history(&run_json_allowing_empty_match(&path, &mut command)?)
}

pub fn print_revision(
    input: &ConnectionInput,
    depot_path: &str,
    revision: &str,
) -> Result<FileDiff, AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    let revision = validate_revision(revision)?;
    let spec = format!("{depot_path}#{revision}");
    let (path, mut command) = configured_command(input)?;
    command.args(["print", "-q", &spec]);
    run_text_diff(&path, &mut command)
}

pub fn save_revision(
    input: &ConnectionInput,
    depot_path: &str,
    revision: &str,
    output_path: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    let revision = validate_revision(revision)?;
    let output_path = output_path.trim();
    if output_path.is_empty() || output_path.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный путь для сохранения revision.",
        ));
    }
    let destination = PathBuf::from(output_path);
    if destination.exists() {
        return Err(
            AppError::new(ErrorKind::CommandFailed, "Файл назначения уже существует.")
                .with_hint("Укажите новый путь, чтобы не перезаписать существующий файл."),
        );
    }
    let spec = format!("{depot_path}#{revision}");
    let (path, mut command) = configured_command(input)?;
    command.args(["print", "-q", &spec]);
    let bytes = run_binary(&path, &mut command)?;
    fs::write(&destination, bytes).map_err(|error| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось сохранить revision на диск.",
        )
        .with_diagnostics(error.to_string())
    })
}

pub fn save_change_files(
    input: &ConnectionInput,
    change: &str,
    output_directory: &str,
) -> Result<ChangeExportResult, AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    let destination = validated_new_output_directory(output_directory)?;
    let detail = describe_change(input, change)?;
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();

    for file in &detail.files {
        if !submitted_file_is_downloadable(file) {
            continue;
        }
        let revision = validate_revision(file.revision.as_deref().unwrap_or_default())?.to_owned();
        let relative = submitted_export_relative_path(&file.depot_path)?;
        let key = relative.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Несколько depot-файлов совпадают в файловой системе назначения.",
            ));
        }
        files.push((
            file.depot_path.clone(),
            revision,
            destination.join(relative),
        ));
    }

    if files.is_empty() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "В changelist нет доступных для скачивания ревизий файлов.",
        ));
    }

    fs::create_dir_all(&destination).map_err(|error| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось создать каталог для экспорта changelist.",
        )
        .with_diagnostics(error.to_string())
    })?;

    let mut saved_files = 0_u32;
    for (depot_path, revision, output_path) in &files {
        let result = (|| {
            let parent = output_path.parent().ok_or_else(|| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Некорректный путь файла экспорта.",
                )
            })?;
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Не удалось создать подкаталог для экспорта changelist.",
                )
                .with_diagnostics(error.to_string())
            })?;
            save_revision(input, depot_path, revision, &output_path.to_string_lossy())
        })();

        if let Err(error) = result {
            let _ = fs::remove_file(output_path);
            if saved_files == 0 {
                let _ = fs::remove_dir_all(&destination);
                return Err(error);
            }
            return Err(AppError::new(
                ErrorKind::PartialResult,
                format!("Сохранено файлов: {saved_files}. Экспорт changelist завершён частично."),
            )
            .with_hint("Уже сохранённые файлы оставлены в каталоге назначения.")
            .with_diagnostics(format!("{}\n{:?}", output_path.display(), error)));
        }
        saved_files += 1;
    }

    Ok(ChangeExportResult {
        saved_files,
        skipped_files: u32::try_from(detail.files.len() - files.len()).unwrap_or(u32::MAX),
    })
}

fn validated_new_output_directory(output_directory: &str) -> Result<PathBuf, AppError> {
    let output_directory = output_directory.trim();
    if output_directory.is_empty() || output_directory.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный путь каталога для экспорта changelist.",
        ));
    }
    let destination = PathBuf::from(output_directory);
    if destination.exists() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Каталог назначения уже существует.",
        )
        .with_hint("Укажите новый каталог, чтобы не перезаписать существующие файлы."));
    }
    Ok(destination)
}

fn submitted_file_is_downloadable(file: &SubmittedFile) -> bool {
    let action = file.action.to_ascii_lowercase();
    file.revision.is_some() && !action.contains("delete") && action != "purge"
}

fn submitted_export_relative_path(depot_path: &str) -> Result<PathBuf, AppError> {
    validate_depot_path(depot_path)?;
    let mut relative = PathBuf::new();
    for segment in depot_path.trim_start_matches("//").split('/') {
        if segment.is_empty()
            || matches!(segment, "." | "..")
            || segment.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
        {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Depot path нельзя безопасно представить в каталоге экспорта.",
            )
            .with_diagnostics(depot_path));
        }
        relative.push(segment);
    }
    Ok(relative)
}

pub fn save_shelved_file(
    input: &ConnectionInput,
    source_change: &str,
    depot_path: &str,
    output_path: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_depot_path(depot_path)?;
    let destination =
        validated_new_output_path(output_path, "Некорректный путь для сохранения shelf.")?;
    let spec = shelved_revision_spec(depot_path, source_change);
    let (path, mut command) = configured_command(input)?;
    command.args(["print", "-q", &spec]);
    let bytes = run_binary(&path, &mut command)?;
    fs::write(&destination, bytes).map_err(|error| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось сохранить содержимое shelf на диск.",
        )
        .with_diagnostics(error.to_string())
    })
}

fn validated_new_output_path(
    output_path: &str,
    invalid_message: &str,
) -> Result<PathBuf, AppError> {
    let output_path = output_path.trim();
    if output_path.is_empty() || output_path.contains(['\r', '\n']) {
        return Err(AppError::new(ErrorKind::CommandFailed, invalid_message));
    }
    let destination = PathBuf::from(output_path);
    if destination.exists() {
        return Err(
            AppError::new(ErrorKind::CommandFailed, "Файл назначения уже существует.")
                .with_hint("Укажите новый путь, чтобы не перезаписать существующий файл."),
        );
    }
    Ok(destination)
}

fn shelved_revision_spec(depot_path: &str, source_change: &str) -> String {
    format!("{depot_path}@={source_change}")
}

pub fn diff_revisions(
    input: &ConnectionInput,
    depot_path: &str,
    left: &str,
    right: &str,
    mode: &DiffMode,
) -> Result<FileDiff, AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    let left = validate_revision(left)?;
    let right = validate_revision(right)?;
    let left_spec = format!("{depot_path}#{left}");
    let right_spec = format!("{depot_path}#{right}");
    let (path, mut command) = configured_command(input)?;
    command.env_remove("P4DIFF");
    command.env_remove("P4DIFFUNICODE");
    command.arg("diff2");
    add_diff_args(&mut command, mode);
    command.args([&left_spec, &right_spec]);
    run_text_diff(&path, &mut command)
}

pub fn diff_revision_workspace(
    input: &ConnectionInput,
    depot_path: &str,
    revision: &str,
    mode: &DiffMode,
) -> Result<FileDiff, AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    let revision = validate_revision(revision)?;
    let spec = format!("{depot_path}#{revision}");
    let (path, mut command) = configured_command(input)?;
    command.env_remove("P4DIFF");
    command.env_remove("P4DIFFUNICODE");
    command.arg("diff");
    add_diff_args(&mut command, mode);
    command.arg(spec);
    run_text_diff(&path, &mut command)
}

pub fn annotate_file(
    input: &ConnectionInput,
    depot_path: &str,
) -> Result<Vec<AnnotationLine>, AppError> {
    required_client(input)?;
    validate_depot_path(depot_path)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["annotate", "-c", "-u", depot_path]);
    let output = run_text_diff(&path, &mut command)?;
    Ok(parse_annotation(&output.text))
}

fn add_diff_args(command: &mut Command, mode: &DiffMode) {
    if let Some(flag) = diff_mode_flag(mode) {
        command.arg(flag);
    }
    command.arg("-du");
}

fn parse_annotation(text: &str) -> Vec<AnnotationLine> {
    text.lines()
        .filter_map(|line| {
            if line.trim().is_empty() || line.starts_with("//") {
                return None;
            }
            let mut parts = line
                .splitn(4, char::is_whitespace)
                .filter(|part| !part.is_empty());
            let change = parts.next()?.trim_end_matches(':').to_owned();
            let user = parts.next().map(str::to_owned);
            let date = parts.next().map(str::to_owned);
            let content = parts.next().unwrap_or_default().to_owned();
            Some(AnnotationLine {
                change,
                user,
                date,
                text: content,
            })
        })
        .collect()
}

fn diff_mode_flag(mode: &DiffMode) -> Option<&'static str> {
    match mode {
        DiffMode::Default => None,
        DiffMode::IgnoreWhitespaceChanges => Some("-db"),
        DiffMode::IgnoreWhitespace => Some("-dw"),
        DiffMode::IgnoreLineEndings => Some("-dl"),
    }
}

pub fn submit_change(
    input: &ConnectionInput,
    change: &str,
    description: Option<&str>,
    mode: &SubmitMode,
) -> Result<SubmitOutcome, AppError> {
    required_client(input)?;
    validate_change(change)?;
    match mode {
        SubmitMode::Local => {
            submit_local(input, change, description)?;
            Ok(SubmitOutcome {
                preserved_local_change: None,
            })
        }
        SubmitMode::Shelf => submit_shelf_preserving_local(input, change),
        SubmitMode::LocalDeleteShelf => {
            validate_numbered_change(change)?;
            delete_shelf_files(input, change, &[])?;
            submit_local(input, change, None)?;
            Ok(SubmitOutcome {
                preserved_local_change: None,
            })
        }
        SubmitMode::LocalUpdateShelf => {
            validate_numbered_change(change)?;
            shelve_files(input, change, &[], true, false, false)?;
            delete_shelf_files(input, change, &[])?;
            if let Err(mut error) = submit_local(input, change, None) {
                if let Err(restore_error) = create_shelf_from_all(input, change) {
                    error.hints.push(
                        "Submit не выполнен, и автоматическое восстановление shelf тоже не удалось. Локальные opened-файлы сохранены."
                            .to_owned(),
                    );
                    error.diagnostics = Some(format!(
                        "{}\nShelf restore: {}",
                        error.diagnostics.unwrap_or_default(),
                        restore_error.diagnostics.unwrap_or(restore_error.message)
                    ));
                } else {
                    error.hints.push(
                        "Submit не выполнен; обновлённый shelf автоматически восстановлен."
                            .to_owned(),
                    );
                }
                return Err(error);
            }
            Ok(SubmitOutcome {
                preserved_local_change: None,
            })
        }
    }
}

pub fn submit_readback_hint(input: &ConnectionInput, change: &str) -> String {
    let pending = list_pending_changes(input)
        .ok()
        .is_some_and(|changes| changes.iter().any(|item| item.id == change));
    if pending {
        return format!(
            "Submit read-back: CL {change} remains pending; local work was not confirmed as submitted."
        );
    }
    if change != "default"
        && query_submitted_change(input, change)
            .ok()
            .is_some_and(|changes| changes.iter().any(|item| item.id == change))
    {
        return format!(
            "Submit read-back: CL {change} is visible as submitted; refresh History before retrying."
        );
    }
    format!(
        "Submit read-back: result for CL {change} is unknown; refresh Changes and History before retrying."
    )
}

fn query_submitted_change(
    input: &ConnectionInput,
    change: &str,
) -> Result<Vec<PendingChange>, AppError> {
    validate_numbered_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "changes",
        "-s",
        "submitted",
        "-e",
        change,
        "-m",
        "20",
        "-l",
    ]);
    parse_pending_changes(&run_json(&path, &mut command)?)
}

pub fn submit_preflight(
    input: &ConnectionInput,
    change: &str,
) -> Result<SubmitPreflightSummary, AppError> {
    required_client(input)?;
    validate_change(change)?;
    let opened = list_opened_files(input)?
        .into_iter()
        .filter(|file| file.change == change)
        .collect::<Vec<_>>();
    if opened.is_empty() {
        return Ok(SubmitPreflightSummary {
            issues: Vec::new(),
            jobs: Vec::new(),
            job_details: Vec::new(),
            warnings: Vec::new(),
            total_size: 0,
            stream: inspect_workspace(input).ok().and_then(|spec| spec.stream),
        });
    }

    let paths = opened
        .iter()
        .map(|file| file.depot_path.clone())
        .collect::<Vec<_>>();
    let (path, mut command) = configured_command(input)?;
    command.args([
        "-ztag",
        "-Mj",
        "fstat",
        "-Ro",
        "-Ol",
        "-T",
        "depotFile,clientFile,path,action,haveRev,headRev,headAction,isMapped,resolveStatus,otherOpen,otherLock",
    ]);
    command.args(&paths);
    let records = run_json(&path, &mut command)?;
    let mut issues = parse_submit_preflight(&records);
    let mut warnings = parse_submit_preflight_warnings(&records);
    append_missing_file_issues(&mut issues, &records, &paths);
    let (resolve_path, mut resolve_command) = configured_command(input)?;
    resolve_command.args(["-ztag", "-Mj", "resolve", "-n"]);
    resolve_command.args(&paths);
    let resolve_records = run_json(&resolve_path, &mut resolve_command)?;
    append_resolve_issues(&mut issues, &resolve_records);
    append_bounded_warnings(&mut warnings, &resolve_records);
    let (fix_path, mut fix_command) = configured_command(input)?;
    fix_command.args(["-ztag", "-Mj", "fixes", "-c", change]);
    let fix_records = run_json(&fix_path, &mut fix_command)?;
    append_bounded_warnings(&mut warnings, &fix_records);
    let job_details = parse_fixes(&fix_records)
        .unwrap_or_default()
        .into_iter()
        .take(100)
        .map(|fix| SubmitPreflightJob {
            id: fix.job,
            date: fix.date,
            user: fix.user,
            status: fix.status,
        })
        .collect::<Vec<_>>();
    let jobs = job_details
        .iter()
        .map(|job| job.id.clone())
        .collect::<Vec<_>>();
    let total_size = records
        .iter()
        .filter_map(|record| {
            optional_field(record, &["fileSize", "size"])
                .and_then(|value| value.parse::<u64>().ok())
        })
        .sum();
    Ok(SubmitPreflightSummary {
        issues,
        jobs,
        job_details,
        warnings,
        total_size,
        stream: inspect_workspace(input).ok().and_then(|spec| spec.stream),
    })
}

pub fn shelve_files(
    input: &ConnectionInput,
    change: &str,
    depot_paths: &[String],
    replace_all: bool,
    revert_after: bool,
    delete_added_files: bool,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    validate_depot_paths(depot_paths)?;
    if !replace_all && depot_paths.is_empty() {
        return Err(empty_file_selection());
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "shelve"]);
    if replace_all {
        command.args(["-r", "-c", change, "-Af"]);
    } else {
        command.args(["-f", "-c", change, "-Af"]);
        command.args(depot_paths);
    }
    run_json(&path, &mut command)?;
    if revert_after {
        let paths = if depot_paths.is_empty() {
            list_opened_files(input)?
                .into_iter()
                .filter(|file| file.change == change)
                .map(|file| file.depot_path)
                .collect::<Vec<_>>()
        } else {
            depot_paths.to_vec()
        };
        if !paths.is_empty()
            && let Err(mut error) = revert_files(input, change, &paths, delete_added_files)
        {
            error.hints.insert(
                0,
                "Shelf обновлён, но локальные файлы не удалось ревертнуть.".to_owned(),
            );
            return Err(error);
        }
    }
    Ok(())
}

pub fn preview_unshelve(
    input: &ConnectionInput,
    source_change: &str,
    depot_paths: &[String],
) -> Result<UnshelvePreview, AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_depot_paths(depot_paths)?;

    let selected = depot_paths.iter().cloned().collect::<BTreeSet<_>>();
    let candidates = list_shelved_files(input, source_change)?
        .into_iter()
        .filter(|file| file.action.eq_ignore_ascii_case("add"))
        .filter(|file| selected.is_empty() || selected.contains(&file.depot_path))
        .map(|file| file.depot_path)
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(UnshelvePreview::default());
    }

    let stream_mapping = resolve_unshelve_stream_mapping(input, &candidates)?;
    let mapped_candidates = candidates
        .iter()
        .map(|path| {
            (
                path.clone(),
                stream_mapping
                    .as_ref()
                    .map_or_else(|| path.clone(), |mapping| mapping.map_path(path)),
            )
        })
        .collect::<Vec<_>>();
    let opened = list_opened_files(input)?
        .into_iter()
        .map(|file| file.depot_path)
        .collect::<BTreeSet<_>>();
    let unopened = mapped_candidates
        .into_iter()
        .filter(|(_, target_path)| !opened.contains(target_path))
        .collect::<Vec<_>>();
    if unopened.is_empty() {
        return Ok(UnshelvePreview::default());
    }

    let source_by_target = unopened
        .iter()
        .cloned()
        .map(|(source, target)| (target, source))
        .collect::<BTreeMap<_, _>>();
    let target_paths = unopened
        .into_iter()
        .map(|(_, target)| target)
        .collect::<Vec<_>>();
    let mappings = workspace_paths(input, &target_paths)?;
    Ok(UnshelvePreview {
        conflicts: mappings
            .into_iter()
            .filter(|(_, local_path)| Path::new(local_path).exists())
            .filter_map(|(target_path, local_path)| {
                Some(UnshelveConflict {
                    depot_path: source_by_target.get(&target_path)?.clone(),
                    local_path,
                })
            })
            .collect(),
    })
}

pub fn unshelve_files(
    input: &ConnectionInput,
    source_change: &str,
    target_change: &str,
    depot_paths: &[String],
    force_paths: &[String],
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_change(target_change)?;
    validate_depot_paths(depot_paths)?;
    validate_depot_paths(force_paths)?;
    let mapping_paths = if depot_paths.is_empty() && force_paths.is_empty() {
        list_shelved_files(input, source_change)?
            .into_iter()
            .map(|file| file.depot_path)
            .collect::<Vec<_>>()
    } else {
        depot_paths
            .iter()
            .chain(force_paths)
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
    };
    let stream_mapping = resolve_unshelve_stream_mapping(input, &mapping_paths)?;
    let normal = normal_unshelve_paths(depot_paths, force_paths);
    let normal_applied = !normal.is_empty();
    if depot_paths.is_empty() && force_paths.is_empty() {
        run_unshelve(
            input,
            source_change,
            target_change,
            &[],
            false,
            stream_mapping.as_ref(),
        )?;
    } else {
        if !normal.is_empty() {
            run_unshelve(
                input,
                source_change,
                target_change,
                &normal,
                false,
                stream_mapping.as_ref(),
            )?;
        }
        if !force_paths.is_empty()
            && let Err(mut error) = run_unshelve(
                input,
                source_change,
                target_change,
                force_paths,
                true,
                stream_mapping.as_ref(),
            )
        {
            if normal_applied {
                error.kind = ErrorKind::PartialResult;
                error.hints.insert(
                    0,
                    "Обычные файлы уже unshelved; проверьте состояние workspace перед повтором overwrite.".to_owned(),
                );
            }
            return Err(error);
        }
    }
    Ok(())
}

pub fn reshelve_files(
    input: &ConnectionInput,
    source_change: &str,
    target_change: &str,
    depot_paths: &[String],
    force: bool,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(source_change)?;
    validate_numbered_change(target_change)?;
    validate_depot_paths(depot_paths)?;
    let (path, mut command) = configured_command(input)?;
    command.args(reshelve_arguments(
        source_change,
        target_change,
        depot_paths,
        force,
    ));
    run_json(&path, &mut command)?;
    Ok(())
}

fn reshelve_arguments(
    source_change: &str,
    target_change: &str,
    depot_paths: &[String],
    force: bool,
) -> Vec<String> {
    let mut arguments = vec!["-ztag".to_owned(), "-Mj".to_owned(), "reshelve".to_owned()];
    if force {
        arguments.push("-f".to_owned());
    }
    arguments.extend([
        "-s".to_owned(),
        source_change.to_owned(),
        "-c".to_owned(),
        target_change.to_owned(),
    ]);
    arguments.extend(depot_paths.iter().cloned());
    arguments
}

fn normal_unshelve_paths(depot_paths: &[String], force_paths: &[String]) -> Vec<String> {
    let force = force_paths.iter().collect::<BTreeSet<_>>();
    depot_paths
        .iter()
        .filter(|path| !force.contains(path))
        .cloned()
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UnshelveStreamMapping {
    source_stream: String,
    target_stream: String,
    stream: String,
    parent: Option<String>,
}

impl UnshelveStreamMapping {
    fn map_path(&self, source_path: &str) -> String {
        replace_stream_prefix(source_path, &self.source_stream, &self.target_stream)
            .unwrap_or_else(|| source_path.to_owned())
    }
}

fn resolve_unshelve_stream_mapping(
    input: &ConnectionInput,
    depot_paths: &[String],
) -> Result<Option<UnshelveStreamMapping>, AppError> {
    if depot_paths.is_empty() {
        return Ok(None);
    }

    let direct_mapping = probe_workspace_paths(input, depot_paths);
    if direct_mapping
        .as_ref()
        .is_ok_and(|paths| paths.len() == depot_paths.len())
    {
        return Ok(None);
    }
    let direct_error = direct_mapping.err().unwrap_or_else(|| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не все shelved-файлы входят в view текущего workspace.",
        )
    });

    let target_stream = match inspect_workspace(input)?.stream {
        Some(stream) => stream,
        None => return Err(direct_error),
    };
    let streams = list_streams(input)?;
    let Some(mapping) = infer_unshelve_stream_mapping(&target_stream, &streams, depot_paths) else {
        return Err(direct_error);
    };
    let target_paths = depot_paths
        .iter()
        .map(|path| mapping.map_path(path))
        .collect::<Vec<_>>();
    if probe_workspace_paths(input, &target_paths)
        .is_ok_and(|paths| paths.len() == target_paths.len())
    {
        Ok(Some(mapping))
    } else {
        Err(direct_error)
    }
}

fn infer_unshelve_stream_mapping(
    target_stream: &str,
    streams: &[StreamSummary],
    depot_paths: &[String],
) -> Option<UnshelveStreamMapping> {
    let mut source_streams = depot_paths
        .iter()
        .map(|path| stream_for_depot_path(path, streams).map(|stream| stream.path.as_str()))
        .collect::<Option<BTreeSet<_>>>()?;
    if source_streams.len() != 1 {
        return None;
    }
    let source_stream = source_streams.pop_first()?;
    if source_stream == target_stream {
        return None;
    }

    let source = streams.iter().find(|stream| stream.path == source_stream)?;
    let target = streams.iter().find(|stream| stream.path == target_stream)?;
    let (stream, parent) = if source.parent.as_deref() == Some(target_stream) {
        (source_stream.to_owned(), None)
    } else if target.parent.as_deref() == Some(source_stream) {
        (source_stream.to_owned(), Some(target_stream.to_owned()))
    } else {
        (target_stream.to_owned(), Some(source_stream.to_owned()))
    };
    Some(UnshelveStreamMapping {
        source_stream: source_stream.to_owned(),
        target_stream: target_stream.to_owned(),
        stream,
        parent,
    })
}

fn replace_stream_prefix(path: &str, source_stream: &str, target_stream: &str) -> Option<String> {
    let relative = path.strip_prefix(source_stream.trim_end_matches('/'))?;
    relative
        .starts_with('/')
        .then(|| format!("{}{relative}", target_stream.trim_end_matches('/')))
}

fn run_unshelve(
    input: &ConnectionInput,
    source_change: &str,
    target_change: &str,
    depot_paths: &[String],
    force: bool,
    stream_mapping: Option<&UnshelveStreamMapping>,
) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(unshelve_arguments(
        source_change,
        target_change,
        depot_paths,
        force,
        stream_mapping,
    ));
    run_json(&path, &mut command)?;
    Ok(())
}

fn unshelve_arguments(
    source_change: &str,
    target_change: &str,
    depot_paths: &[String],
    force: bool,
    stream_mapping: Option<&UnshelveStreamMapping>,
) -> Vec<String> {
    let mut arguments = vec!["-ztag".to_owned(), "-Mj".to_owned(), "unshelve".to_owned()];
    if force {
        arguments.push("-f".to_owned());
    }
    arguments.extend([
        "-s".to_owned(),
        source_change.to_owned(),
        "-c".to_owned(),
        target_change.to_owned(),
    ]);
    if let Some(mapping) = stream_mapping {
        arguments.extend(["-S".to_owned(), mapping.stream.clone()]);
        if let Some(parent) = &mapping.parent {
            arguments.extend(["-P".to_owned(), parent.clone()]);
        }
    }
    arguments.push("-Af".to_owned());
    arguments.extend(
        depot_paths.iter().map(|path| {
            stream_mapping.map_or_else(|| path.clone(), |mapping| mapping.map_path(path))
        }),
    );
    arguments
}

fn workspace_paths(
    input: &ConnectionInput,
    depot_paths: &[String],
) -> Result<Vec<(String, String)>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "where"]);
    command.args(depot_paths);
    let records = run_json(&path, &mut command)?;
    Ok(parse_workspace_paths(&records))
}

fn probe_workspace_paths(
    input: &ConnectionInput,
    depot_paths: &[String],
) -> Result<Vec<(String, String)>, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "where"]);
    command.args(depot_paths);
    let records = run_json_probe(&path, &mut command)?;
    Ok(parse_workspace_paths(&records))
}

fn parse_workspace_paths(records: &[Map<String, Value>]) -> Vec<(String, String)> {
    records
        .iter()
        .filter_map(|record| {
            Some((
                record.get("depotFile")?.as_str()?.to_owned(),
                record.get("path")?.as_str()?.to_owned(),
            ))
        })
        .collect()
}

pub fn delete_shelf_files(
    input: &ConnectionInput,
    change: &str,
    depot_paths: &[String],
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    validate_depot_paths(depot_paths)?;
    let (path, mut command) = configured_command(input)?;
    command.args(delete_shelf_arguments(change, depot_paths));
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn revert_files(
    input: &ConnectionInput,
    change: &str,
    depot_paths: &[String],
    delete_added_files: bool,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_change(change)?;
    validate_depot_paths(depot_paths)?;
    if depot_paths.is_empty() {
        return Err(empty_file_selection());
    }
    let (path, mut command) = configured_command(input)?;
    command.args(revert_arguments(change, depot_paths, delete_added_files));
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn preview_revert_unchanged(
    input: &ConnectionInput,
    change: &str,
) -> Result<Vec<RevertPreviewItem>, AppError> {
    preview_revert(input, change, true, &[])
}

pub fn preview_revert_all(
    input: &ConnectionInput,
    change: &str,
) -> Result<Vec<RevertPreviewItem>, AppError> {
    preview_revert(input, change, false, &[])
}

pub fn preview_revert_selected(
    input: &ConnectionInput,
    change: &str,
    depot_paths: &[String],
) -> Result<Vec<RevertPreviewItem>, AppError> {
    if depot_paths.is_empty() {
        return Err(empty_file_selection());
    }
    validate_depot_paths(depot_paths)?;
    preview_revert(input, change, false, depot_paths)
}

fn preview_revert(
    input: &ConnectionInput,
    change: &str,
    unchanged_only: bool,
    depot_paths: &[String],
) -> Result<Vec<RevertPreviewItem>, AppError> {
    required_client(input)?;
    validate_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(revert_preview_arguments(
        change,
        unchanged_only,
        depot_paths,
    ));
    let records = run_json(&path, &mut command)?;
    Ok(records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            Some(RevertPreviewItem {
                depot_path: field(record, &["depotFile", "clientFile"])?,
                action: field(record, &["action", "status"]).unwrap_or_else(|| "revert".to_owned()),
            })
        })
        .collect())
}

pub fn revert_unchanged(input: &ConnectionInput, change: &str) -> Result<(), AppError> {
    required_client(input)?;
    validate_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "revert", "-a", "-c", change]);
    run_json(&path, &mut command)?;
    Ok(())
}

fn revert_arguments(change: &str, depot_paths: &[String], delete_added_files: bool) -> Vec<String> {
    let mut arguments = ["-ztag", "-Mj", "revert"]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if delete_added_files {
        arguments.push("-w".to_owned());
    }
    arguments.extend(["-c".to_owned(), change.to_owned()]);
    arguments.extend(depot_paths.iter().cloned());
    arguments
}

fn revert_preview_arguments(
    change: &str,
    unchanged_only: bool,
    depot_paths: &[String],
) -> Vec<String> {
    let mut arguments = vec![
        "-ztag".to_owned(),
        "-Mj".to_owned(),
        "revert".to_owned(),
        "-n".to_owned(),
    ];
    if unchanged_only {
        arguments.push("-a".to_owned());
    }
    arguments.extend(["-c".to_owned(), change.to_owned()]);
    arguments.extend(depot_paths.iter().cloned());
    arguments
}

pub fn edit_change_description(
    input: &ConnectionInput,
    change: &str,
    description: &str,
) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    let description = validate_description(Some(description))?;
    let (path, mut output_command) = configured_command(input)?;
    output_command.args(["change", "-o", change]);
    let output = output_command
        .output()
        .map_err(|error| launch_error(&path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 change -o вернул предупреждение.");
    let spec = replace_description(&String::from_utf8_lossy(&output.stdout), description)?;
    let (_, mut input_command) = configured_command(input)?;
    input_command.args(["change", "-i"]);
    let output = run_output_with_stdin(&path, &mut input_command, spec.as_bytes())?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 change -i вернул предупреждение.");
    Ok(())
}

pub fn delete_change(input: &ConnectionInput, change: &str) -> Result<(), AppError> {
    required_client(input)?;
    validate_numbered_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "change", "-d", change]);
    run_json(&path, &mut command)?;
    Ok(())
}

fn submit_local(
    input: &ConnectionInput,
    change: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    let (path, mut command) = submit_command(input, change, description)?;
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn submit_command(
    input: &ConnectionInput,
    change: &str,
    description: Option<&str>,
) -> Result<(PathBuf, Command), AppError> {
    required_client(input)?;
    validate_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "submit"]);
    if change == "default" {
        command.args(["-d", validate_description(description)?]);
    } else {
        validate_numbered_change(change)?;
        command.args(["-c", change]);
    }
    Ok((path, command))
}

fn submit_shelf_direct(input: &ConnectionInput, change: &str) -> Result<(), AppError> {
    validate_numbered_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "submit", "-e", change]);
    run_json(&path, &mut command)?;
    Ok(())
}

fn submit_shelf_preserving_local(
    input: &ConnectionInput,
    change: &str,
) -> Result<SubmitOutcome, AppError> {
    validate_numbered_change(change)?;
    let local_files = list_opened_files(input)?
        .into_iter()
        .filter(|file| file.change == change)
        .collect::<Vec<_>>();
    if local_files.is_empty() {
        submit_shelf_direct(input, change)?;
        return Ok(SubmitOutcome {
            preserved_local_change: None,
        });
    }

    let recovery_description = format!("Local work preserved before submitting shelf CL {change}");
    let recovery_change = create_change(input, &recovery_description)?;
    let mut moved: Vec<String> = Vec::new();
    for file in &local_files {
        if let Err(mut error) = reopen_file(input, &file.depot_path, &recovery_change) {
            for path in moved.iter().rev() {
                let _ = reopen_file(input, path, change);
            }
            let _ = delete_change(input, &recovery_change);
            error.hints.push(
                "Локальные файлы не были отправлены; приложение попыталось вернуть их в исходный changelist."
                    .to_owned(),
            );
            return Err(error);
        }
        moved.push(file.depot_path.clone());
    }

    if let Err(mut error) = submit_shelf_direct(input, change) {
        let mut rollback_failed = false;
        for path in moved.iter().rev() {
            rollback_failed |= reopen_file(input, path, change).is_err();
        }
        if !rollback_failed {
            let _ = delete_change(input, &recovery_change);
            error.hints.push(
                "Shelf не отправлен; локальные файлы возвращены в исходный changelist.".to_owned(),
            );
        } else {
            error.hints.push(format!(
                "Shelf не отправлен. Часть локальных файлов осталась в recovery changelist {recovery_change}."
            ));
        }
        return Err(error);
    }

    Ok(SubmitOutcome {
        preserved_local_change: Some(recovery_change),
    })
}

fn create_shelf_from_all(input: &ConnectionInput, change: &str) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "shelve", "-f", "-c", change, "-Af"]);
    run_json(&path, &mut command)?;
    Ok(())
}

fn run_text_diff(path: &Path, command: &mut Command) -> Result<FileDiff, AppError> {
    let output = command
        .output()
        .map_err(|error| launch_error(path, error))?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    log_stderr_warning(&output, "p4 diff вернул предупреждение.");
    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let binary = output.stdout.contains(&0) || is_binary_diff_marker(&output.stdout);
    let bytes = &output.stdout[..output.stdout.len().min(MAX_DIFF_BYTES)];
    Ok(FileDiff {
        text: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
        binary,
    })
}

fn is_binary_diff_marker(bytes: &[u8]) -> bool {
    String::from_utf8_lossy(bytes)
        .lines()
        .any(|line| line.trim_end().ends_with("==== binary"))
}

pub fn create_change(input: &ConnectionInput, description: &str) -> Result<String, AppError> {
    let client = required_client(input)?;
    let user = validate_form_value(&input.user, "user")?;
    let client = validate_form_value(client, "workspace")?;
    let description = validate_description(Some(description))?;
    let spec = format_change_spec(client, user, description);

    let (path, mut command) = configured_command(input)?;
    command.args(["change", "-i"]);
    let output = run_output_with_stdin(&path, &mut command, spec.as_bytes())?;
    if !output.status.success() {
        return Err(command_error(&output));
    }
    let response = combined_output(&output);
    log_stderr_warning(&output, "p4 change -i вернул предупреждение.");
    created_change_id_text(&response).ok_or_else(|| {
        push_cli_log(
            CliLogLevel::Error,
            "p4 не вернул номер созданного changelist.".to_owned(),
            Some(response.clone()),
        );
        AppError::new(
            ErrorKind::InvalidOutput,
            "p4 создал changelist, но не вернул его номер.",
        )
        .with_diagnostics(response)
    })
}

fn delete_shelf_arguments(change: &str, depot_paths: &[String]) -> Vec<String> {
    let mut arguments = ["-ztag", "-Mj", "shelve", "-d", "-c", change]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if !depot_paths.is_empty() {
        arguments.push("-Af".to_owned());
        arguments.extend(depot_paths.iter().cloned());
    }
    arguments
}

fn format_change_spec(client: &str, user: &str, description: &str) -> String {
    let description = description
        .replace("\r\n", "\n")
        .lines()
        .map(|line| format!("\t{line}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Change:\tnew\n\nClient:\t{client}\n\nUser:\t{user}\n\nStatus:\tnew\n\nDescription:\n{description}\n"
    )
}

fn replace_description(spec: &str, description: &str) -> Result<String, AppError> {
    let normalized = spec.replace("\r\n", "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let start = lines
        .iter()
        .position(|line| line.trim_end() == "Description:")
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidOutput,
                "В форме changelist нет поля Description.",
            )
        })?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, line)| {
            !line.is_empty() && !line.starts_with([' ', '\t']) && line.trim_end().ends_with(':')
        })
        .map_or(lines.len(), |(index, _)| index);
    let replacement = description
        .replace("\r\n", "\n")
        .lines()
        .map(|line| format!("\t{line}"))
        .collect::<Vec<_>>();
    let mut result = Vec::with_capacity(lines.len() + replacement.len());
    result.extend(lines[..=start].iter().map(|line| (*line).to_owned()));
    result.extend(replacement);
    result.push(String::new());
    result.extend(lines[end..].iter().map(|line| (*line).to_owned()));
    Ok(format!("{}\n", result.join("\n")))
}

fn created_change_id_text(response: &str) -> Option<String> {
    let created = response.lines().find(|line| {
        let line = line.to_ascii_lowercase();
        line.contains("change") && line.contains("created")
    })?;
    created
        .split(|character: char| !character.is_ascii_digit())
        .find(|part| !part.is_empty())
        .map(str::to_owned)
}

fn parse_info_records(records: &[Map<String, Value>]) -> Result<P4Info, AppError> {
    let mut fields = BTreeMap::new();
    for record in records {
        for (key, value) in record {
            if let Some(value) = value_text(value) {
                fields.insert(key.as_str(), value);
            }
        }
    }

    let info = P4Info {
        server_address: take_field(&fields, &["serverAddress"]),
        server_version: take_field(&fields, &["serverVersion"]),
        user_name: take_field(&fields, &["userName"]),
        client_name: take_field(&fields, &["clientName"]),
        client_root: take_field(&fields, &["clientRoot"]),
        client_stream: take_field(&fields, &["clientStream"]),
        unicode: take_field(&fields, &["unicode", "unicodeEnabled"]),
        case_handling: take_field(&fields, &["caseHandling"]),
        server_services: take_field(&fields, &["serverServices"]),
        server_id: take_field(&fields, &["serverID", "serverId"]),
        security: take_field(&fields, &["security"]),
        client_address: take_field(&fields, &["clientAddress"]),
        user_email: take_field(&fields, &["userEmail"]),
    };

    if info.server_address.is_none() && info.server_version.is_none() {
        return Err(AppError::new(
            ErrorKind::InvalidOutput,
            "В ответе p4 info нет данных о сервере.",
        )
        .with_hint("Откройте технические детали и проверьте версию p4 CLI."));
    }

    Ok(info)
}

fn parse_workspaces(records: &[Map<String, Value>]) -> Result<Vec<WorkspaceSummary>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(WorkspaceSummary {
                name: required_field(record, &["client", "Client"], "workspace name")?,
                owner: optional_field(record, &["Owner", "owner"]).unwrap_or_default(),
                root: optional_field(record, &["Root", "root"]).unwrap_or_default(),
                host: optional_field(record, &["Host", "host"]),
                stream: optional_field(record, &["Stream", "stream"]),
                description: optional_field(record, &["Description", "description"]),
            })
        })
        .collect()
}

fn parse_streams(records: &[Map<String, Value>]) -> Result<Vec<StreamSummary>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            let path = required_field(record, &["Stream", "stream"], "stream path")?;
            Ok(StreamSummary {
                name: optional_field(record, &["Name", "name"])
                    .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(&path).to_owned()),
                path,
                parent: optional_field(record, &["Parent", "parent"])
                    .filter(|parent| parent != "none"),
                stream_type: optional_field(record, &["Type", "type"])
                    .unwrap_or_else(|| "unknown".to_owned()),
                description: optional_field(record, &["Description", "description"])
                    .unwrap_or_default(),
                owner: optional_field(record, &["Owner", "owner"]),
                updated: optional_field(record, &["Update", "update"]),
            })
        })
        .collect()
}

fn parse_workspace_spec(
    records: &[Map<String, Value>],
    requested_client: &str,
) -> Result<WorkspaceSpec, AppError> {
    let record = records
        .iter()
        .find(|record| !is_message_record(record))
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::InvalidOutput,
                "В ответе client нет workspace spec.",
            )
        })?;
    Ok(WorkspaceSpec {
        name: optional_field(record, &["Client", "client"])
            .unwrap_or_else(|| requested_client.to_owned()),
        owner: optional_field(record, &["Owner", "owner"]).unwrap_or_default(),
        root: optional_field(record, &["Root", "root"]).unwrap_or_default(),
        host: optional_field(record, &["Host", "host"]),
        stream: optional_field(record, &["Stream", "stream"]),
        description: optional_field(record, &["Description", "description"]).unwrap_or_default(),
        options: indexed_fields(record, "Options"),
        submit_options: optional_field(record, &["SubmitOptions", "submitOptions"]),
        line_end: optional_field(record, &["LineEnd", "lineEnd"]),
        alt_roots: indexed_fields(record, "AltRoots"),
        mappings: indexed_fields(record, "View"),
    })
}

fn parse_depot_directories(
    records: &[Map<String, Value>],
) -> Result<Vec<DepotDirectory>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(DepotDirectory {
                path: required_field(record, &["dir", "directory", "path"], "depot directory")?,
            })
        })
        .collect()
}

fn parse_depots(records: &[Map<String, Value>]) -> Result<Vec<DepotSummary>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            let name = required_field(record, &["name", "Depot", "depot"], "depot name")?;
            Ok(DepotSummary {
                path: format!("//{name}"),
                name,
                depot_type: optional_field(record, &["type", "Type"])
                    .unwrap_or_else(|| "local".to_owned()),
                description: optional_field(record, &["desc", "description", "Description"])
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
                date: optional_field(record, &["time", "date", "Date"]),
                map: optional_field(record, &["map", "Map"]),
                stream_depth: optional_field(record, &["streamDepth", "StreamDepth"]),
            })
        })
        .collect()
}

fn parse_depot_files(records: &[Map<String, Value>]) -> Result<Vec<DepotFile>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(DepotFile {
                depot_path: required_field(record, &["depotFile", "file"], "depot file")?,
                revision: optional_field(record, &["rev", "revision"]),
                action: optional_field(record, &["action"]),
                change: optional_field(record, &["change"]),
                file_type: optional_field(record, &["type", "filetype"]),
            })
        })
        .collect()
}

fn parse_trust_entries(text: &str) -> Vec<TrustEntry> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let server = fields.next()?.trim();
            let fingerprint = fields.collect::<Vec<_>>().join(" ");
            if !server.starts_with("ssl:") || fingerprint.is_empty() {
                return None;
            }
            Some(TrustEntry {
                server: server.to_owned(),
                fingerprint,
            })
        })
        .collect()
}

fn parse_pending_changes(records: &[Map<String, Value>]) -> Result<Vec<PendingChange>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(PendingChange {
                id: required_field(record, &["change", "Change"], "changelist id")?,
                description: optional_field(record, &["desc", "Description"])
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
                user: optional_field(record, &["user", "User"]).unwrap_or_default(),
                client: optional_field(record, &["client", "Client"]).unwrap_or_default(),
                time: optional_field(record, &["time", "Date"]),
                stream: None,
            })
        })
        .collect()
}

fn parse_change_detail(
    records: &[Map<String, Value>],
    change: &str,
) -> Result<SubmittedChangeDetail, AppError> {
    let data = records
        .iter()
        .filter(|record| !is_message_record(record))
        .collect::<Vec<_>>();
    let metadata = data.first().ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidOutput,
            "В ответе describe нет changelist.",
        )
    })?;
    let mut files = Vec::new();
    for record in &data {
        if let Some(depot_path) = field(record, &["depotFile"]) {
            files.push(SubmittedFile {
                depot_path,
                action: field(record, &["action"]).unwrap_or_default(),
                revision: field(record, &["rev"]),
                file_type: field(record, &["type"]),
            });
            continue;
        }
        for index in indexed_field_indices(record, "depotFile") {
            files.push(SubmittedFile {
                depot_path: numbered_field(record, &["depotFile"], index)
                    .expect("depot file index was collected from this record"),
                action: numbered_field(record, &["action"], index).unwrap_or_default(),
                revision: numbered_field(record, &["rev"], index),
                file_type: numbered_field(record, &["type"], index),
            });
        }
    }
    let mut jobs = Vec::new();
    for record in &data {
        let record_jobs = field(record, &["job", "Job"])
            .into_iter()
            .chain(indexed_fields(record, "job"));
        for job in record_jobs {
            if !jobs.contains(&job) {
                jobs.push(job);
            }
        }
    }
    Ok(SubmittedChangeDetail {
        id: field(metadata, &["change"]).unwrap_or_else(|| change.to_owned()),
        description: field(metadata, &["desc", "description"])
            .unwrap_or_default()
            .trim()
            .to_owned(),
        user: field(metadata, &["user"]).unwrap_or_default(),
        client: field(metadata, &["client"]).unwrap_or_default(),
        time: field(metadata, &["time"]),
        jobs,
        files,
        files_truncated: false,
    })
}

fn limit_change_detail(
    mut detail: SubmittedChangeDetail,
    file_limit: Option<usize>,
) -> SubmittedChangeDetail {
    if let Some(limit) = file_limit {
        detail.files_truncated = detail.files.len() > limit;
        detail.files.truncate(limit);
    }
    detail
}

fn parse_file_history(records: &[Map<String, Value>]) -> Result<Vec<FileRevision>, AppError> {
    let mut revisions = Vec::new();
    for record in records.iter().filter(|record| !is_message_record(record)) {
        if let Some(revision) = optional_field(record, &["rev", "revision"]) {
            let integrations = ["how", "srev", "erev", "sfile"]
                .iter()
                .filter_map(|name| optional_field(record, &[*name]))
                .collect();
            revisions.push(FileRevision {
                revision,
                change: optional_field(record, &["change"]).unwrap_or_default(),
                action: optional_field(record, &["action"]).unwrap_or_default(),
                user: optional_field(record, &["user"]).unwrap_or_default(),
                time: optional_field(record, &["time"]),
                file_type: optional_field(record, &["type"]),
                client: optional_field(record, &["client"]),
                size: optional_field(record, &["fileSize", "size"]),
                description: optional_field(record, &["desc", "description"]),
                integrations,
                labels: ["label", "labelName"]
                    .iter()
                    .filter_map(|name| optional_field(record, &[*name]))
                    .collect(),
            });
            continue;
        }

        let indices = indexed_field_indices(record, "rev");
        if indices.is_empty() {
            return Err(required_field(record, &["rev", "revision"], "revision").unwrap_err());
        }
        for index in indices {
            let revision = numbered_field(record, &["rev", "revision"], index)
                .expect("revision index was collected from this record");
            let integrations = ["how", "srev", "erev", "sfile", "file"]
                .iter()
                .flat_map(|name| numbered_fields(record, name, index))
                .collect();
            revisions.push(FileRevision {
                revision,
                change: numbered_field(record, &["change"], index).unwrap_or_default(),
                action: numbered_field(record, &["action"], index).unwrap_or_default(),
                user: numbered_field(record, &["user"], index).unwrap_or_default(),
                time: numbered_field(record, &["time"], index),
                file_type: numbered_field(record, &["type"], index),
                client: numbered_field(record, &["client"], index),
                size: numbered_field(record, &["fileSize", "size"], index),
                description: numbered_field(record, &["desc", "description"], index),
                integrations,
                labels: ["label", "labelName"]
                    .iter()
                    .flat_map(|name| numbered_fields(record, name, index))
                    .collect(),
            });
        }
    }
    Ok(revisions)
}

fn parse_opened_files(records: &[Map<String, Value>]) -> Result<Vec<OpenedFile>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(OpenedFile {
                depot_path: required_field(record, &["depotFile"], "depot file")?,
                client_path: optional_field(record, &["clientFile"]),
                action: optional_field(record, &["action"]).unwrap_or_else(|| "edit".to_owned()),
                change: optional_field(record, &["change"]).unwrap_or_else(|| "default".to_owned()),
                revision: optional_field(record, &["rev"]),
                file_type: optional_field(record, &["type"]),
            })
        })
        .collect()
}

fn parse_workspace_files(records: &[Map<String, Value>]) -> Result<Vec<WorkspaceFile>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(WorkspaceFile {
                depot_path: required_field(record, &["depotFile"], "depot path")?,
                client_path: optional_field(record, &["clientFile"]),
                local_path: optional_field(record, &["path"]),
                action: optional_field(record, &["action"]).unwrap_or_default(),
                change: optional_field(record, &["change"]),
                have_revision: optional_field(record, &["haveRev"]),
                head_revision: optional_field(record, &["headRev"]),
                file_type: optional_field(record, &["type"]),
                mapped: optional_field(record, &["path", "clientFile"]).is_some(),
                other_open: has_active_field(record, &["otherOpen", "otherLock"]),
                other_lock: has_active_field(record, &["otherLock"]),
                unresolved: has_active_field(record, &["resolveStatus", "unresolved"]),
                untracked: false,
                ignored: false,
                file_size: optional_field(record, &["fileSize", "size"])
                    .and_then(|value| value.parse::<u64>().ok()),
            })
        })
        .collect()
}

fn parse_sync_preview(records: &[Map<String, Value>]) -> SyncPreview {
    let items = records
        .iter()
        .filter(|record| !is_message_record(record))
        .filter_map(|record| {
            Some(SyncPreviewItem {
                depot_path: field(record, &["depotFile", "clientFile"])?,
                action: field(record, &["action", "status"]).unwrap_or_else(|| "update".to_owned()),
                revision: field(record, &["rev", "revision"]),
                local_path: field(record, &["path", "clientFile"]),
                bytes: field(record, &["fileSize", "size"]),
            })
        })
        .collect::<Vec<_>>();
    let total_bytes = items
        .iter()
        .filter_map(|item| item.bytes.as_deref()?.parse::<u64>().ok())
        .sum();
    SyncPreview {
        items,
        total_bytes,
        modified_files: Vec::new(),
        writable_files: Vec::new(),
        missing_have_files: Vec::new(),
    }
}

fn parse_submit_preflight(records: &[Map<String, Value>]) -> Vec<SubmitPreflightIssue> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .flat_map(|record| {
            let depot_path = match field(record, &["depotFile"]) {
                Some(path) => path,
                None => return Vec::new(),
            };
            let mut issues = Vec::new();
            if has_active_field(record, &["resolveStatus", "unresolved"]) {
                issues.push(SubmitPreflightIssue {
                    depot_path: depot_path.clone(),
                    kind: "unresolved".to_owned(),
                    detail: "File has unresolved content.".to_owned(),
                });
            }
            if has_active_field(record, &["otherOpen"]) || has_active_field(record, &["otherLock"])
            {
                issues.push(SubmitPreflightIssue {
                    depot_path: depot_path.clone(),
                    kind: "locked_or_open_elsewhere".to_owned(),
                    detail: "File is open or locked by another user.".to_owned(),
                });
            }
            let have =
                optional_field(record, &["haveRev"]).and_then(|value| value.parse::<u64>().ok());
            let head =
                optional_field(record, &["headRev"]).and_then(|value| value.parse::<u64>().ok());
            if let (Some(have), Some(head)) = (have, head)
                && have < head
            {
                issues.push(SubmitPreflightIssue {
                    depot_path: depot_path.clone(),
                    kind: "out_of_date".to_owned(),
                    detail: format!("Workspace has revision {have}, depot head is {head}."),
                });
            }
            issues
        })
        .collect()
}

fn parse_submit_preflight_warnings(records: &[Map<String, Value>]) -> Vec<String> {
    let mut warnings = Vec::new();
    append_bounded_warnings(&mut warnings, records);
    warnings
}

fn append_bounded_warnings(warnings: &mut Vec<String>, records: &[Map<String, Value>]) {
    for record in records {
        let severity = record
            .get("severity")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let code = field(record, &["code"]).unwrap_or_default();
        if severity < 2 && !code.eq_ignore_ascii_case("warning") {
            continue;
        }
        let Some(message) =
            field(record, &["data", "fmt"]).filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        if !warnings.iter().any(|item| item == &message) {
            warnings.push(message);
            if warnings.len() >= 50 {
                break;
            }
        }
    }
}

fn append_resolve_issues(issues: &mut Vec<SubmitPreflightIssue>, records: &[Map<String, Value>]) {
    for record in records.iter().filter(|record| !is_message_record(record)) {
        let Some(depot_path) =
            field(record, &["depotFile", "clientFile", "fromFile"]).or_else(|| {
                field(record, &["data", "fmt"]).filter(|value| value.trim_start().starts_with("//"))
            })
        else {
            continue;
        };
        if !issues
            .iter()
            .any(|issue| issue.depot_path == depot_path && issue.kind == "unresolved")
        {
            issues.push(SubmitPreflightIssue {
                depot_path,
                kind: "unresolved".to_owned(),
                detail: "File still has a pending resolve.".to_owned(),
            });
        }
    }
}

fn append_missing_file_issues(
    issues: &mut Vec<SubmitPreflightIssue>,
    records: &[Map<String, Value>],
    expected_paths: &[String],
) {
    for expected_path in expected_paths {
        let Some(record) = records.iter().find(|record| {
            field(record, &["depotFile", "clientFile"]).as_deref() == Some(expected_path)
        }) else {
            issues.push(SubmitPreflightIssue {
                depot_path: expected_path.clone(),
                kind: "missing".to_owned(),
                detail: "Opened file was not returned by fstat.".to_owned(),
            });
            continue;
        };
        let action = field(record, &["action"]).unwrap_or_default();
        let deleted_action = matches!(action.as_str(), "delete" | "move/delete" | "purge");
        let unmapped =
            field(record, &["isMapped"]).is_some() && !has_active_field(record, &["isMapped"]);
        let missing = !deleted_action && (field(record, &["path"]).is_none() || unmapped);
        if missing
            && !issues
                .iter()
                .any(|issue| issue.depot_path == *expected_path && issue.kind == "missing")
        {
            issues.push(SubmitPreflightIssue {
                depot_path: expected_path.clone(),
                kind: "missing".to_owned(),
                detail: "Opened file has no mapped local path.".to_owned(),
            });
        }
    }
}

fn field(record: &Map<String, Value>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| record.get(*name).and_then(value_text))
}

fn has_active_field(record: &Map<String, Value>, names: &[&str]) -> bool {
    field(record, names).is_some_and(|value| {
        !value.trim().is_empty()
            && !matches!(
                value.to_ascii_lowercase().as_str(),
                "0" | "none" | "no" | "false"
            )
    })
}

fn parse_shelved_files(records: &[Map<String, Value>]) -> Result<Vec<ShelvedFile>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(ShelvedFile {
                depot_path: required_field(record, &["depotFile"], "shelved depot file")?,
                action: optional_field(record, &["action"]).unwrap_or_else(|| "edit".to_owned()),
                revision: optional_field(record, &["rev"]),
                file_type: optional_field(record, &["type"]),
            })
        })
        .collect()
}

fn required_field(
    record: &Map<String, Value>,
    names: &[&str],
    field: &str,
) -> Result<String, AppError> {
    optional_field(record, names).ok_or_else(|| {
        AppError::new(ErrorKind::InvalidOutput, "p4 вернул неполные данные.")
            .with_diagnostics(format!("Отсутствует поле: {field}"))
    })
}

fn optional_field(record: &Map<String, Value>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| record.get(*name).and_then(value_text))
}

fn indexed_fields(record: &Map<String, Value>, prefix: &str) -> Vec<String> {
    let mut fields = record
        .iter()
        .filter_map(|(key, value)| {
            key.strip_prefix(prefix)
                .and_then(|suffix| suffix.parse::<usize>().ok())
                .zip(value_text(value))
        })
        .collect::<Vec<_>>();
    fields.sort_by_key(|(index, _)| *index);
    fields.into_iter().map(|(_, value)| value).collect()
}

fn indexed_field_indices(record: &Map<String, Value>, prefix: &str) -> Vec<usize> {
    record
        .keys()
        .filter_map(|key| key.strip_prefix(prefix)?.parse::<usize>().ok())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn numbered_field(record: &Map<String, Value>, names: &[&str], index: usize) -> Option<String> {
    names
        .iter()
        .find_map(|name| record.get(&format!("{name}{index}")).and_then(value_text))
}

fn numbered_fields(record: &Map<String, Value>, prefix: &str, index: usize) -> Vec<String> {
    let exact = format!("{prefix}{index}");
    let nested = format!("{exact},");
    let mut fields = record
        .iter()
        .filter_map(|(key, value)| {
            let order = if key == &exact {
                Some(0)
            } else {
                key.strip_prefix(&nested)
                    .and_then(|suffix| suffix.parse::<usize>().ok())
            }?;
            Some((order, value_text(value)?))
        })
        .collect::<Vec<_>>();
    fields.sort_by_key(|(order, _)| *order);
    fields.into_iter().map(|(_, value)| value).collect()
}

fn is_message_record(record: &Map<String, Value>) -> bool {
    (record.get("code").and_then(Value::as_str) == Some("info")
        || (record.contains_key("data")
            && (record.contains_key("severity") || record.contains_key("generic"))))
        && !record.keys().any(|key| {
            matches!(
                key.as_str(),
                "client" | "Client" | "change" | "Change" | "depotFile"
            )
        })
}

fn take_field(fields: &BTreeMap<&str, String>, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| fields.get(name).cloned())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;

    #[test]
    fn parses_info_from_multiple_json_records() {
        let records = parse_json_lines(
            r#"{"serverAddress":"ssl:p4.example:1666","serverVersion":"P4D/NTX64/2025.1"}
{"userName":"alex","clientName":"alex-main","clientRoot":"C:\\work","caseHandling":"insensitive","serverServices":"commit-server","serverID":"commit-1","security":"3","clientAddress":"10.0.0.8:5000","userEmail":"alex@example.test"}"#,
        )
        .unwrap();

        let info = parse_info_records(&records).unwrap();
        assert_eq!(info.server_address.as_deref(), Some("ssl:p4.example:1666"));
        assert_eq!(info.client_name.as_deref(), Some("alex-main"));
        assert_eq!(info.client_root.as_deref(), Some("C:\\work"));
        assert_eq!(info.case_handling.as_deref(), Some("insensitive"));
        assert_eq!(info.server_services.as_deref(), Some("commit-server"));
        assert_eq!(info.server_id.as_deref(), Some("commit-1"));
        assert_eq!(info.security.as_deref(), Some("3"));
        assert_eq!(info.client_address.as_deref(), Some("10.0.0.8:5000"));
        assert_eq!(info.user_email.as_deref(), Some("alex@example.test"));
    }

    #[test]
    fn reports_the_bad_json_line_without_leaking_the_payload() {
        let error = parse_json_lines("{\"serverAddress\":\"p4:1666\"}\nnot-json").unwrap_err();

        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert!(error.diagnostics.unwrap().starts_with("Строка 2:"));
    }

    #[test]
    fn recognizes_structured_perforce_errors() {
        let records = parse_json_lines(
            r#"{"code":"error","severity":3,"data":"Perforce password invalid or unset."}"#,
        )
        .unwrap();

        assert_eq!(
            perforce_error(&records).as_deref(),
            Some("Perforce password invalid or unset.")
        );
    }

    #[test]
    fn rejects_info_without_server_identity() {
        let records = parse_json_lines(r#"{"userName":"alex"}"#).unwrap();
        let error = parse_info_records(&records).unwrap_err();

        assert_eq!(error.kind, ErrorKind::InvalidOutput);
    }

    #[test]
    fn rejects_a_missing_explicit_executable() {
        let error = resolve_executable(Some("Z:\\definitely-missing\\p4.exe")).unwrap_err();

        assert_eq!(error.kind, ErrorKind::ExecutableNotFound);
    }

    #[test]
    fn sets_only_non_empty_connection_environment() {
        let mut command = Command::new(OsStr::new("p4"));
        set_non_empty_env(&mut command, "P4PORT", Some("  ssl:p4:1666  "));
        set_non_empty_env(&mut command, "P4USER", Some("   "));
        set_non_empty_env(&mut command, "P4CONFIG", Some("  P4CONFIG  "));
        set_non_empty_env(&mut command, "P4ENVIRO", Some("   "));
        let environment: Vec<_> = command.get_envs().collect();

        assert_eq!(environment.len(), 2);
        assert!(environment.contains(&(OsStr::new("P4PORT"), Some(OsStr::new("ssl:p4:1666")))));
        assert!(environment.contains(&(OsStr::new("P4CONFIG"), Some(OsStr::new("P4CONFIG")))));
    }

    #[test]
    fn parses_workspace_change_and_opened_file_records() {
        let workspaces = parse_workspaces(
            &parse_json_lines(
                r#"{"client":"alex-main","Owner":"alex","Root":"C:\\work","Stream":"//Acme/main"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(workspaces[0].name, "alex-main");
        assert_eq!(workspaces[0].stream.as_deref(), Some("//Acme/main"));

        let changes = parse_pending_changes(&parse_json_lines(
            r#"{"change":"42","time":"1750000000","user":"alex","client":"alex-main","desc":"Fix menu\n"}"#,
        ).unwrap()).unwrap();
        assert_eq!(changes[0].id, "42");
        assert_eq!(changes[0].description, "Fix menu");

        let files = parse_opened_files(&parse_json_lines(
            r#"{"depotFile":"//Acme/main/menu.rs","clientFile":"//alex-main/menu.rs","rev":"7","action":"edit","change":"42","type":"text"}"#,
        ).unwrap()).unwrap();
        assert_eq!(files[0].depot_path, "//Acme/main/menu.rs");
        assert_eq!(files[0].revision.as_deref(), Some("7"));

        let shelf = parse_shelved_files(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/menu.rs","rev":"8","action":"edit","type":"text"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(shelf[0].depot_path, "//Acme/main/menu.rs");
        assert_eq!(shelf[0].action, "edit");
    }

    #[test]
    fn accepts_only_safe_change_and_depot_arguments() {
        assert!(validate_change("default").is_ok());
        assert!(validate_change("1234").is_ok());
        assert!(validate_change("12 --force").is_err());
        assert!(validate_depot_path("//Acme/main/file.rs").is_ok());
        assert!(validate_depot_path("C:\\work\\file.rs").is_err());
        assert!(validate_depot_path("//Acme/file\nother").is_err());
        assert!(validate_numbered_change("42").is_ok());
        assert!(validate_numbered_change("default").is_err());
        assert_eq!(
            validate_description(Some("  Fix menu  ")).unwrap(),
            "Fix menu"
        );
        assert!(validate_description(Some("  ")).is_err());
    }

    #[test]
    fn shelf_export_uses_shelved_revision_selector_and_new_output_validation() {
        assert_eq!(
            shelved_revision_spec("//Acme/main/file.bin", "42"),
            "//Acme/main/file.bin@=42"
        );
        assert!(validated_new_output_path("", "invalid").is_err());
        assert!(validated_new_output_path("C:\\tmp\\out\n.bin", "invalid").is_err());
    }

    #[test]
    fn submitted_change_export_paths_stay_below_the_new_directory() {
        assert_eq!(
            submitted_export_relative_path("//Acme/main/src/file.txt").unwrap(),
            PathBuf::from("Acme")
                .join("main")
                .join("src")
                .join("file.txt")
        );
        assert!(submitted_export_relative_path("//Acme/main/../secret.txt").is_err());
        assert!(submitted_export_relative_path("//Acme/main/C:\\secret.txt").is_err());
    }

    #[test]
    fn submitted_change_export_skips_revisions_without_content() {
        let edit = SubmittedFile {
            depot_path: "//Acme/main/a.txt".to_owned(),
            action: "edit".to_owned(),
            revision: Some("4".to_owned()),
            file_type: Some("text".to_owned()),
        };
        assert!(submitted_file_is_downloadable(&edit));
        assert!(!submitted_file_is_downloadable(&SubmittedFile {
            action: "delete".to_owned(),
            ..edit.clone()
        }));
        assert!(!submitted_file_is_downloadable(&SubmittedFile {
            revision: None,
            ..edit
        }));
    }

    #[test]
    fn reshelve_arguments_keep_source_target_and_force_explicit() {
        let paths = vec!["//Acme/a.txt".to_owned(), "//Acme/b.txt".to_owned()];
        assert_eq!(
            reshelve_arguments("42", "77", &paths, false),
            [
                "-ztag",
                "-Mj",
                "reshelve",
                "-s",
                "42",
                "-c",
                "77",
                "//Acme/a.txt",
                "//Acme/b.txt"
            ]
        );
        assert_eq!(
            reshelve_arguments("42", "77", &paths[..1], true),
            [
                "-ztag",
                "-Mj",
                "reshelve",
                "-f",
                "-s",
                "42",
                "-c",
                "77",
                "//Acme/a.txt"
            ]
        );
    }

    #[test]
    fn depot_file_listing_excludes_deleted_by_default() {
        assert_eq!(
            depot_file_arguments("//Acme/main/...", false),
            vec![
                "-ztag",
                "-Mj",
                "files",
                "-e",
                "-m",
                MAX_RECORDS,
                "//Acme/main/..."
            ],
        );
        assert_eq!(
            depot_file_arguments("//Acme/main/...", true),
            vec![
                "-ztag",
                "-Mj",
                "files",
                "-m",
                MAX_RECORDS,
                "//Acme/main/..."
            ],
        );
    }

    #[test]
    fn parses_client_spec_with_ordered_mappings_and_roots() {
        let spec = parse_workspace_spec(
            &parse_json_lines(
                r#"{"Client":"alex-main","Owner":"alex","Root":"C:\\work","Host":"build01","Stream":"//Acme/main","Description":"Main workspace","Options":"noallwrite","SubmitOptions":"submitunchanged","LineEnd":"local","AltRoots0":"D:\\work","View1":"//Acme/main/... //alex-main/main/...","View0":"//Acme/lib/... //alex-main/lib/..."}"#,
            )
            .unwrap(),
            "alex-main",
        )
        .unwrap();

        assert_eq!(spec.name, "alex-main");
        assert_eq!(spec.alt_roots, vec!["D:\\work"]);
        assert_eq!(
            spec.mappings,
            vec![
                "//Acme/lib/... //alex-main/lib/...",
                "//Acme/main/... //alex-main/main/...",
            ]
        );
    }

    #[test]
    fn parses_depot_directories_and_head_file_metadata() {
        let depots = parse_depots(
            &parse_json_lines(
                r#"{"name":"Acme","time":"1764000000","type":"stream","map":"Acme/...","desc":"Product streams","streamDepth":"3"}
{"name":"Shared","type":"local","map":"Shared/..."}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(depots[0].path, "//Acme");
        assert_eq!(depots[0].depot_type, "stream");
        assert_eq!(depots[0].description, "Product streams");
        assert_eq!(depots[0].stream_depth.as_deref(), Some("3"));
        assert_eq!(depots[1].depot_type, "local");

        let directories = parse_depot_directories(
            &parse_json_lines(
                r#"{"dir":"//Acme/main/src"}
{"dir":"//Acme/main/test"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(directories[0].path, "//Acme/main/src");

        let files = parse_depot_files(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/src/lib.rs","rev":"8","action":"edit","change":"42","type":"text"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(files[0].depot_path, "//Acme/main/src/lib.rs");
        assert_eq!(files[0].revision.as_deref(), Some("8"));
        assert_eq!(files[0].change.as_deref(), Some("42"));
    }

    #[test]
    fn parses_only_ssl_trust_lines_and_preserves_fingerprint_text() {
        let entries = parse_trust_entries(
            "ssl:p4.example:1666  SHA256:AA:BB:CC\nnot-a-server informational line\nssl:other:1666 MD5:11:22",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].server, "ssl:p4.example:1666");
        assert_eq!(entries[0].fingerprint, "SHA256:AA:BB:CC");
    }

    #[test]
    fn builds_a_safe_changelist_form_and_reads_the_created_id() {
        let spec = format_change_spec("alex-main", "alex", "Fix menu\nand tests");
        assert!(spec.contains("Client:\talex-main"));
        assert!(spec.contains("Description:\n\tFix menu\n\tand tests"));
        assert!(validate_form_value("bad\nclient", "workspace").is_err());

        assert_eq!(
            created_change_id_text("Change 142 created.").as_deref(),
            Some("142")
        );
    }

    #[test]
    fn replaces_only_the_description_in_a_change_form() {
        let original = "Change:\t42\n\nClient:\talex-main\n\nDescription:\n\tOld line\n\tSecond line\n\nJobs:\n\tBUG-7\n\nFiles:\n\t//Acme/main/menu.rs\t# edit\n";
        let updated = replace_description(original, "New line\nand details").unwrap();

        assert!(updated.contains("Description:\n\tNew line\n\tand details\n"));
        assert!(updated.contains("Jobs:\n\tBUG-7"));
        assert!(updated.contains("Files:\n\t//Acme/main/menu.rs"));
        assert!(!updated.contains("Old line"));
    }

    #[test]
    fn updates_workspace_fields_without_dropping_unknown_form_sections() {
        let original = "Client:\talex-main\n\nRoot:\tC:\\work\n\nDescription:\n\tOld workspace\n\nStream:\t//Acme/main\n\nView:\n\t//Acme/main/... //alex-main/...\n\nCustomField:\tkeep\n";
        let updated =
            replace_workspace_fields(original, "D:\\new-work", "//Acme/dev", "New workspace")
                .unwrap();
        assert!(updated.contains("Root:\tD:\\new-work"));
        assert!(updated.contains("Stream:\t//Acme/dev"));
        assert!(updated.contains("Description:\n\tNew workspace"));
        assert!(updated.contains("View:\n\t//Acme/main/... //alex-main/..."));
        assert!(updated.contains("CustomField:\tkeep"));
    }

    #[test]
    fn deletes_a_whole_or_partial_shelf_with_distinct_valid_syntax() {
        assert_eq!(
            delete_shelf_arguments("42", &[]),
            ["-ztag", "-Mj", "shelve", "-d", "-c", "42"]
        );
        assert_eq!(
            delete_shelf_arguments("42", &["//Acme/main/menu.rs".to_owned()]),
            [
                "-ztag",
                "-Mj",
                "shelve",
                "-d",
                "-c",
                "42",
                "-Af",
                "//Acme/main/menu.rs"
            ]
        );
    }

    #[test]
    fn revert_deletes_added_files_only_when_explicitly_requested() {
        let paths = ["//Acme/main/new.txt".to_owned()];
        assert_eq!(
            revert_arguments("42", &paths, false),
            ["-ztag", "-Mj", "revert", "-c", "42", "//Acme/main/new.txt"]
        );
        assert_eq!(
            revert_arguments("42", &paths, true),
            [
                "-ztag",
                "-Mj",
                "revert",
                "-w",
                "-c",
                "42",
                "//Acme/main/new.txt"
            ]
        );
    }

    #[test]
    fn revert_preview_distinguishes_all_files_from_unchanged_only() {
        assert_eq!(
            revert_preview_arguments("42", false, &[]),
            ["-ztag", "-Mj", "revert", "-n", "-c", "42"]
        );
        assert_eq!(
            revert_preview_arguments("42", true, &[]),
            ["-ztag", "-Mj", "revert", "-n", "-a", "-c", "42"]
        );
        assert_eq!(
            revert_preview_arguments("42", false, &["//Acme/a.txt".to_owned()]),
            ["-ztag", "-Mj", "revert", "-n", "-c", "42", "//Acme/a.txt"]
        );
    }

    #[test]
    fn reads_depot_to_workspace_mappings_for_unshelve_preflight() {
        let records = parse_json_lines(
            r#"{"depotFile":"//Acme/main/new.txt","clientFile":"//alex-main/new.txt","path":"C:\\work\\new.txt"}
{"code":"info","data":"ignored"}"#,
        )
        .unwrap();
        assert_eq!(
            parse_workspace_paths(&records),
            [(
                "//Acme/main/new.txt".to_owned(),
                "C:\\work\\new.txt".to_owned()
            )]
        );
    }

    #[test]
    fn unshelve_normal_batch_excludes_only_explicit_force_paths() {
        let paths = vec!["//Acme/a.txt".to_owned(), "//Acme/b.txt".to_owned()];
        let force = vec!["//Acme/a.txt".to_owned()];
        assert_eq!(normal_unshelve_paths(&paths, &force), ["//Acme/b.txt"]);
        assert_eq!(normal_unshelve_paths(&paths, &[]), paths);
    }

    #[test]
    fn maps_unshelve_from_child_stream_to_current_parent() {
        let streams = unshelve_test_streams();
        let mapping = infer_unshelve_stream_mapping(
            "//Acme/main",
            &streams,
            &["//Acme/dev/Source/a.cpp".to_owned()],
        )
        .unwrap();

        assert_eq!(mapping.stream, "//Acme/dev");
        assert_eq!(mapping.parent, None);
        assert_eq!(
            mapping.map_path("//Acme/dev/Source/a.cpp"),
            "//Acme/main/Source/a.cpp"
        );
        assert_eq!(
            unshelve_arguments("42", "default", &[], false, Some(&mapping)),
            [
                "-ztag",
                "-Mj",
                "unshelve",
                "-s",
                "42",
                "-c",
                "default",
                "-S",
                "//Acme/dev",
                "-Af"
            ]
        );
    }

    #[test]
    fn maps_unshelve_from_parent_stream_to_current_child() {
        let streams = unshelve_test_streams();
        let mapping = infer_unshelve_stream_mapping(
            "//Acme/dev",
            &streams,
            &["//Acme/main/Source/a.cpp".to_owned()],
        )
        .unwrap();

        assert_eq!(mapping.stream, "//Acme/main");
        assert_eq!(mapping.parent.as_deref(), Some("//Acme/dev"));
        assert_eq!(
            unshelve_arguments(
                "42",
                "77",
                &["//Acme/main/Source/a.cpp".to_owned()],
                true,
                Some(&mapping),
            ),
            [
                "-ztag",
                "-Mj",
                "unshelve",
                "-f",
                "-s",
                "42",
                "-c",
                "77",
                "-S",
                "//Acme/main",
                "-P",
                "//Acme/dev",
                "-Af",
                "//Acme/dev/Source/a.cpp"
            ]
        );
    }

    #[test]
    fn maps_unshelve_between_sibling_streams() {
        let streams = unshelve_test_streams();
        let mapping = infer_unshelve_stream_mapping(
            "//Acme/release",
            &streams,
            &["//Acme/dev/Source/a.cpp".to_owned()],
        )
        .unwrap();

        assert_eq!(mapping.stream, "//Acme/release");
        assert_eq!(mapping.parent.as_deref(), Some("//Acme/dev"));
        assert_eq!(
            mapping.map_path("//Acme/dev/Source/a.cpp"),
            "//Acme/release/Source/a.cpp"
        );
    }

    fn unshelve_test_streams() -> Vec<StreamSummary> {
        vec![
            StreamSummary {
                path: "//Acme/main".to_owned(),
                name: "main".to_owned(),
                parent: None,
                stream_type: "mainline".to_owned(),
                description: String::new(),
                owner: None,
                updated: None,
            },
            StreamSummary {
                path: "//Acme/dev".to_owned(),
                name: "dev".to_owned(),
                parent: Some("//Acme/main".to_owned()),
                stream_type: "development".to_owned(),
                description: String::new(),
                owner: None,
                updated: None,
            },
            StreamSummary {
                path: "//Acme/release".to_owned(),
                name: "release".to_owned(),
                parent: Some("//Acme/main".to_owned()),
                stream_type: "release".to_owned(),
                description: String::new(),
                owner: None,
                updated: None,
            },
        ]
    }

    #[test]
    fn parses_workspace_status_without_collapsing_paths_or_revisions() {
        let files = parse_workspace_files(&parse_json_lines(
            r#"{"depotFile":"//Acme/main/a.txt","clientFile":"//alex-main/a.txt","path":"C:\\work\\a.txt","action":"edit","change":"42","haveRev":"7","headRev":"9","type":"text","otherOpen":"sam","resolveStatus":"unresolved"}"#,
        ).unwrap()).unwrap();
        assert_eq!(files[0].depot_path, "//Acme/main/a.txt");
        assert_eq!(files[0].local_path.as_deref(), Some("C:\\work\\a.txt"));
        assert_eq!(files[0].have_revision.as_deref(), Some("7"));
        assert_eq!(files[0].head_revision.as_deref(), Some("9"));
        assert!(files[0].other_open);
        assert!(!files[0].other_lock);
        assert!(files[0].unresolved);
    }

    #[test]
    fn treats_fstat_client_file_as_a_valid_workspace_mapping_without_path_field() {
        let files = parse_workspace_files(
            &parse_json_lines(
                r#"{"clientFile":"C:\\work\\Source\\a.txt","depotFile":"//Acme/main/Source/a.txt","haveRev":"1","headRev":"1"}"#,
            )
            .unwrap(),
        )
        .unwrap();

        assert!(files[0].mapped);
        assert_eq!(
            files[0].client_path.as_deref(),
            Some("C:\\work\\Source\\a.txt")
        );
    }

    #[test]
    fn treats_empty_fstat_diagnostic_as_an_empty_workspace_directory() {
        let records = parse_json_lines(
            r#"{"data":"//alex-main/.agents/* - no such file(s).\n","generic":17,"severity":2}"#,
        )
        .unwrap();

        assert!(parse_workspace_files(&records).unwrap().is_empty());
    }

    #[test]
    fn workspace_listing_includes_all_mapped_files_not_only_opened_files() {
        let arguments = workspace_fstat_arguments("//...");
        assert!(arguments.iter().any(|argument| argument == "-Rc"));
        assert!(!arguments.iter().any(|argument| argument == "-Ro"));
    }

    #[test]
    fn lists_only_the_requested_local_workspace_directory_without_contacting_p4() {
        let root = std::env::temp_dir().join(format!("p4fnv-local-files-{}", std::process::id()));
        let nested = root.join("Source");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(root.join("Empty")).unwrap();
        fs::write(nested.join("main.rs"), b"fn main() {}").unwrap();
        assert_eq!(workspace_ignore_file(&root), None);
        let ignore_file = root.join(".p4ignore");
        fs::write(&ignore_file, b"/Saved/\n").unwrap();
        assert_eq!(workspace_ignore_file(&root), Some(ignore_file.clone()));
        let root_batch = read_local_workspace_directory(&root, "alex-main", "//alex-main").unwrap();
        assert_eq!(root_batch.files.len(), 1);
        assert_eq!(
            workspace_path_key(root_batch.files[0].local_path.as_deref().unwrap()),
            workspace_path_key(&ignore_file.to_string_lossy())
        );
        assert_eq!(
            root_batch.directories,
            ["//alex-main/Empty", "//alex-main/Source"]
        );
        assert_eq!(root_batch.completed_directories, ["//alex-main"]);
        assert_eq!(
            resolve_workspace_directories(&root, "alex-main", &["//alex-main/Empty".to_owned()])
                .unwrap()[0]
                .1,
            fs::canonicalize(root.join("Empty")).unwrap()
        );

        let source_batch =
            read_local_workspace_directory(&root, "alex-main", "//alex-main/Source").unwrap();
        assert_eq!(source_batch.files.len(), 1);
        assert_eq!(
            source_batch.files[0].depot_path,
            "//alex-main/Source/main.rs"
        );
        assert_eq!(source_batch.files[0].file_size, Some(12));
        assert!(source_batch.directories.is_empty());
        assert_eq!(source_batch.completed_directories, ["//alex-main/Source"]);
        assert!(
            read_local_workspace_directory(&root, "alex-main", "//alex-main/../outside").is_err()
        );
        assert!(read_local_workspace_directory(&root, "alex-main", "//other/Source").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_ignored_paths_and_normalizes_windows_extended_prefixes() {
        let ignored = parse_ignored_paths(
            "c:\\work\\build\\output.log ignored\nC:\\WORK\\Saved\\__p4fnv_ignore_probe__ ignored\nC:\\WORK\\readme.md not ignored\n",
        );

        assert!(ignored.contains(&workspace_path_key(r"\\?\C:\work\build\output.log")));
        assert!(ignored.contains(&workspace_path_key(r"C:\work\Saved\__p4fnv_ignore_probe__")));
        assert!(!ignored.contains(&workspace_path_key(r"C:\work\readme.md")));
        assert_eq!(
            workspace_cli_path(r"\\?\C:\work\build\output.log"),
            r"C:\work\build\output.log"
        );
        assert_eq!(
            ignored_path_arguments(r"C:\work\Saved\__p4fnv_ignore_probe__"),
            ["ignores", "-i", r"C:\work\Saved\__p4fnv_ignore_probe__"]
        );
    }

    #[test]
    fn parses_sync_preview_and_sums_only_numeric_sizes() {
        let preview = parse_sync_preview(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/a.txt","action":"update","fileSize":"12","rev":"7"}
{"depotFile":"//Acme/main/b.bin","action":"add","fileSize":"not-known"}
{"code":"info","data":"File(s) up-to-date."}"#,
            )
            .unwrap(),
        );
        assert_eq!(preview.items.len(), 2);
        assert_eq!(preview.items[0].revision.as_deref(), Some("7"));
        assert_eq!(preview.total_bytes, 12);
        assert_eq!(
            sync_preview_diff_paths(&preview),
            ["//Acme/main/a.txt", "//Acme/main/b.bin"]
        );

        let added = parse_sync_preview(
            &parse_json_lines(r#"{"depotFile":"//Acme/main/new.txt","action":"added"}"#).unwrap(),
        );
        assert_eq!(sync_preview_diff_paths(&added), ["//Acme/main/new.txt"]);
    }

    #[test]
    fn parses_modified_workspace_files_without_message_records() {
        let files = parse_modified_files(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/a.txt"}
{"code":"error","data":"ignored"}
{"clientFile":"//Acme/main/b.txt"}"#,
            )
            .unwrap(),
        );
        assert_eq!(files, vec!["//Acme/main/a.txt", "//Acme/main/b.txt"]);
        assert_eq!(
            modified_workspace_file_arguments(),
            ["-ztag", "-Mj", "-x", "-", "diff", "-f", "-sa"]
        );
        assert_eq!(sync_mode_argument(false), "-s");
        assert_eq!(sync_mode_argument(true), "-f");
    }

    #[test]
    fn streams_large_exact_sync_scopes_through_stdin() {
        let exact = vec![
            "//Acme/main/a.txt#7".to_owned(),
            "//Acme/main/b.bin#12".to_owned(),
        ];
        assert!(sync_scopes_are_exact_revisions(&exact));
        assert_eq!(
            String::from_utf8(sync_scope_stdin(&exact)).unwrap(),
            "//Acme/main/a.txt#7\n//Acme/main/b.bin#12\n"
        );
        assert!(!sync_scopes_are_exact_revisions(&[
            "//Acme/main/...".to_owned()
        ]));
        assert!(!sync_scopes_are_exact_revisions(&[
            "//Acme/main/a.txt#head".to_owned()
        ]));
    }

    #[test]
    fn treats_existing_files_without_have_revision_as_safe_sync_conflicts() {
        let local_path =
            std::env::temp_dir().join(format!("p4fnv-no-have-conflict-{}", std::process::id()));
        fs::write(&local_path, b"local content").unwrap();
        let preview = SyncPreview {
            items: vec![crate::models::SyncPreviewItem {
                depot_path: "//Acme/main/existing.txt".to_owned(),
                action: "replaced".to_owned(),
                revision: Some("12".to_owned()),
                local_path: Some(local_path.to_string_lossy().into_owned()),
                bytes: None,
            }],
            total_bytes: 0,
            modified_files: Vec::new(),
            writable_files: Vec::new(),
            missing_have_files: Vec::new(),
        };
        let records = parse_json_lines(
            r#"{"data":"//Acme/main/existing.txt - file(s) not on client.\n","generic":17,"severity":2}"#,
        )
        .unwrap();

        assert_eq!(
            existing_not_on_client_files(&preview, &records),
            ["//Acme/main/existing.txt"]
        );
        let original_permissions = fs::metadata(&local_path).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&local_path, permissions).unwrap();
        let mut preview_with_missing_have = preview.clone();
        preview_with_missing_have.missing_have_files = vec!["//Acme/main/existing.txt".to_owned()];
        assert_eq!(
            recovery_download_items(&preview_with_missing_have, false).len(),
            1
        );
        assert_eq!(recovery_worker_count(0), 0);
        assert_eq!(recovery_worker_count(1), 1);
        assert!(recovery_worker_count(100) <= MAX_RECOVERY_WORKERS);
        let replacement = local_path.with_extension("downloaded");
        fs::write(&replacement, b"depot content").unwrap();
        let mut replacement_permissions = fs::metadata(&replacement).unwrap().permissions();
        replacement_permissions.set_readonly(true);
        fs::set_permissions(&replacement, replacement_permissions).unwrap();
        replace_recovery_file(&replacement, &local_path).unwrap();
        assert_eq!(fs::read(&local_path).unwrap(), b"depot content");
        assert!(fs::metadata(&local_path).unwrap().permissions().readonly());
        fs::set_permissions(&local_path, original_permissions).unwrap();
        assert!(recovery_download_items(&preview_with_missing_have, false).is_empty());
        assert_eq!(
            recovery_download_items(&preview_with_missing_have, true).len(),
            1
        );
        let missing_path = local_path.with_extension("missing");
        let missing_source = local_path.with_extension("new");
        let mut missing_preview = preview.clone();
        missing_preview.items[0].local_path = Some(missing_path.to_string_lossy().into_owned());
        assert_eq!(recovery_download_items(&missing_preview, false).len(), 1);
        let root = fs::canonicalize(local_path.parent().unwrap()).unwrap();
        assert_eq!(
            workspace_path_key(
                &validated_recovery_target(&root, missing_path.to_str().unwrap())
                    .unwrap()
                    .to_string_lossy()
            ),
            workspace_path_key(&missing_path.to_string_lossy())
        );
        fs::write(&missing_source, b"new depot content").unwrap();
        replace_recovery_file(&missing_source, &missing_path).unwrap();
        assert_eq!(fs::read(&missing_path).unwrap(), b"new depot content");
        fs::remove_file(&missing_path).unwrap();
        assert_eq!(
            warning_record_message(
                &parse_json_lines(
                    r#"{"data":"Translation of file content failed","generic":4,"severity":2}"#
                )
                .unwrap()
            )
            .as_deref(),
            Some("Translation of file content failed")
        );
        assert_eq!(
            repair_sync_have_list_arguments(),
            ["-ztag", "-Mj", "reconcile", "-k"]
        );
        assert_eq!(
            recovery_print_arguments(
                r"C:\work\a.tmp",
                "//Acme/main/a.txt#12",
                Some("utf8unchecked"),
            ),
            [
                "-ztag",
                "-Mj",
                "print",
                "-q",
                "-Q",
                "utf8unchecked",
                "-o",
                r"C:\work\a.tmp",
                "//Acme/main/a.txt#12"
            ]
        );
        assert_eq!(
            recovery_flush_arguments("//Acme/main/a.txt#12"),
            ["-ztag", "-Mj", "flush", "-f", "//Acme/main/a.txt#12"]
        );
        let mut deleted = preview.items[0].clone();
        deleted.action = "deleted".to_owned();
        assert!(sync_preview_item_is_deleted(&deleted));
        assert_eq!(
            recovery_flush_arguments("//Acme/main/a.txt#none"),
            ["-ztag", "-Mj", "flush", "-f", "//Acme/main/a.txt#none"]
        );
        let connection = ConnectionInput {
            p4_path: None,
            port: "perforce:1666".to_owned(),
            user: "alex".to_owned(),
            client: Some("alex-main".to_owned()),
            charset: Some("utf8".to_owned()),
            p4_config: None,
            p4_enviro: None,
        };
        assert_eq!(
            unchecked_utf8_recovery_input(&connection)
                .charset
                .as_deref(),
            Some("utf8unchecked")
        );
        let mut bom_connection = connection.clone();
        bom_connection.charset = Some("utf8-bom".to_owned());
        assert_eq!(
            unchecked_utf8_recovery_input(&bom_connection)
                .charset
                .as_deref(),
            Some("utf8unchecked-bom")
        );
        let mut automatic_connection = connection;
        automatic_connection.charset = None;
        assert_eq!(
            unchecked_utf8_recovery_input(&automatic_connection).charset,
            None
        );
        fs::remove_file(&local_path).unwrap();
        assert!(existing_not_on_client_files(&preview, &records).is_empty());
    }

    #[test]
    fn parses_undo_preview_items_and_defaults_action() {
        let items = parse_undo_preview(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/a.txt","action":"edit","path":"C:/ws/a.txt"}
{"depotFile":"//Acme/main/b.txt"}
{"code":"info","data":"ignored"}"#,
            )
            .unwrap(),
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].action, "edit");
        assert_eq!(items[1].action, "undo");
        assert_eq!(items[0].local_path.as_deref(), Some("C:/ws/a.txt"));
    }

    #[test]
    fn resolve_modes_map_to_explicit_safe_flags() {
        assert_eq!(resolve_mode_flag(&ResolveMode::Yours), "-ay");
        assert_eq!(resolve_mode_flag(&ResolveMode::Theirs), "-at");
        assert_eq!(resolve_mode_flag(&ResolveMode::AutoSafe), "-as");
        assert_eq!(resolve_mode_flag(&ResolveMode::AutoMerge), "-am");
    }

    #[test]
    fn move_arguments_keep_preview_separate_from_apply() {
        assert_eq!(
            move_arguments("42", "//Acme/main/a.txt", "//Acme/main/b.txt", true),
            vec![
                "-ztag",
                "-Mj",
                "move",
                "-n",
                "-c",
                "42",
                "//Acme/main/a.txt",
                "//Acme/main/b.txt"
            ],
        );
        assert!(
            !move_arguments("42", "//Acme/main/a.txt", "//Acme/main/b.txt", false)
                .contains(&"-n".to_owned())
        );
    }

    #[test]
    fn parses_resolve_preview_candidates_and_details() {
        let items = parse_resolve_preview(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/a.txt","how":"vs","fromFile":"//Acme/main/a.txt#8"}
{"depotFile":"//Acme/main/b.txt","action":"copy"}"#,
            )
            .unwrap(),
        );
        assert_eq!(items[0].depot_path, "//Acme/main/a.txt");
        assert_eq!(items[0].action, "vs");
        assert_eq!(items[0].detail.as_deref(), Some("//Acme/main/a.txt#8"));
        assert_eq!(items[1].action, "copy");
    }

    #[test]
    fn diff_modes_map_to_explicit_p4_flags() {
        assert_eq!(diff_mode_flag(&DiffMode::Default), None);
        assert_eq!(
            diff_mode_flag(&DiffMode::IgnoreWhitespaceChanges),
            Some("-db")
        );
        assert_eq!(diff_mode_flag(&DiffMode::IgnoreWhitespace), Some("-dw"));
        assert_eq!(diff_mode_flag(&DiffMode::IgnoreLineEndings), Some("-dl"));
    }

    #[test]
    fn recognizes_binary_diff_markers_without_treating_them_as_text() {
        assert!(is_binary_diff_marker(
            b"==== //depot/a.png#1 - //depot/a.png#2 ==== binary\n"
        ));
        assert!(!is_binary_diff_marker(b"@@ -1 +1 @@\n-old\n+new\n"));
    }

    #[test]
    fn parses_filelog_revisions_and_keeps_integration_records() {
        let revisions = parse_file_history(&parse_json_lines(
            r#"{"rev":"4","change":"88","action":"edit","user":"alex","time":"1750000000","type":"text","client":"alex-main","fileSize":"128","label":"release_1","desc":"Fix parser","how":"merge","srev":"3","erev":"4","sfile":"//Acme/dev/a.txt"}"#,
        ).unwrap()).unwrap();
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].revision, "4");
        assert_eq!(revisions[0].description.as_deref(), Some("Fix parser"));
        assert_eq!(revisions[0].client.as_deref(), Some("alex-main"));
        assert_eq!(revisions[0].size.as_deref(), Some("128"));
        assert_eq!(revisions[0].labels, ["release_1"]);
        assert_eq!(
            revisions[0].integrations,
            ["merge", "3", "4", "//Acme/dev/a.txt"]
        );
    }

    #[test]
    fn parses_indexed_filelog_revisions_from_real_json_shape() {
        let revisions = parse_file_history(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/a.txt","rev0":"5","rev1":"4","change0":"20","change1":"19","action0":"edit","action1":"add","user0":"alex","user1":"sam","desc0":"Latest","desc1":"Initial","how0,0":"branch into","file0,0":"//Acme/release/a.txt"}"#,
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[0].revision, "5");
        assert_eq!(revisions[0].change, "20");
        assert_eq!(revisions[0].description.as_deref(), Some("Latest"));
        assert_eq!(
            revisions[0].integrations,
            ["branch into", "//Acme/release/a.txt"]
        );
        assert_eq!(revisions[1].revision, "4");
        assert_eq!(revisions[1].action, "add");
    }

    #[test]
    fn parses_annotate_lines_and_skips_header() {
        let lines = parse_annotation(
            "//Acme/main/a.txt#4 - edit change 88 (text)\n88: alex 2026/07/22 Fix parser\n77: sam 2026/07/21 Previous line\n",
        );
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].change, "88");
        assert_eq!(lines[0].user.as_deref(), Some("alex"));
        assert_eq!(lines[0].date.as_deref(), Some("2026/07/22"));
        assert_eq!(lines[0].text, "Fix parser");
    }

    #[test]
    fn parses_jobs_with_optional_metadata_and_full_description() {
        let jobs = parse_jobs(
            &parse_json_lines(
                r#"{"Job":"job00042","Status":"open","User":"alex","Date":"2026/07/22","Description":"Fix depot browser\nwith full details"}
{"Job":"job00043","Description":"No optional fields"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(jobs[0].id, "job00042");
        assert_eq!(jobs[0].status.as_deref(), Some("open"));
        assert_eq!(jobs[0].description, "Fix depot browser\nwith full details");
        assert!(jobs[1].user.is_none());
    }

    #[test]
    fn parses_labels_with_owner_update_and_description() {
        let labels = parse_labels(
            &parse_json_lines(
                r#"{"Label":"release_1","Owner":"alex","Update":"2026/07/22 10:00:00","Description":"Stable release"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(labels[0].name, "release_1");
        assert_eq!(labels[0].owner.as_deref(), Some("alex"));
        assert_eq!(labels[0].update.as_deref(), Some("2026/07/22 10:00:00"));
    }

    #[test]
    fn parses_job_fixes_with_change_metadata() {
        let fixes = parse_fixes(
            &parse_json_lines(
                r#"{"Job":"job00042","Change":"123","Date":"2026/07/22","User":"alex","Status":"closed"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(fixes[0].job, "job00042");
        assert_eq!(fixes[0].change, "123");
        assert_eq!(fixes[0].status.as_deref(), Some("closed"));
    }

    #[test]
    fn parses_submitted_change_detail_with_affected_files() {
        let detail = parse_change_detail(
            &parse_json_lines(
                r#"{"change":"88","user":"alex","client":"alex-main","time":"1750000000","desc":"Ship parser"}
{"change":"88","depotFile":"//Acme/main/a.txt","action":"edit","rev":"4","type":"text"}
{"change":"88","job":"BUG-42"}
{"change":"88","job":"BUG-42"}
{"change":"88","depotFile":"//Acme/main/new.txt","action":"add","rev":"1","type":"text"}"#,
            )
            .unwrap(),
            "88",
        )
        .unwrap();
        assert_eq!(detail.id, "88");
        assert_eq!(detail.description, "Ship parser");
        assert_eq!(detail.jobs, ["BUG-42"]);
        assert_eq!(detail.files.len(), 2);
        assert_eq!(detail.files[1].action, "add");
        assert!(!detail.files_truncated);
    }

    #[test]
    fn truncates_submitted_detail_only_when_more_files_exist() {
        let detail = parse_change_detail(
            &parse_json_lines(
                r#"{"change":"88","depotFile0":"//Acme/main/a.txt","depotFile1":"//Acme/main/b.txt","depotFile2":"//Acme/main/c.txt"}"#,
            )
            .unwrap(),
            "88",
        )
        .unwrap();
        let limited = limit_change_detail(detail.clone(), Some(2));
        assert_eq!(limited.files.len(), 2);
        assert!(limited.files_truncated);

        let exact = limit_change_detail(detail, Some(3));
        assert_eq!(exact.files.len(), 3);
        assert!(!exact.files_truncated);
    }

    #[test]
    fn parses_indexed_submitted_change_files_from_real_json_shape() {
        let detail = parse_change_detail(
            &parse_json_lines(
                r#"{"change":"88","user":"alex","client":"alex-main","desc":"Ship parser","depotFile0":"//Acme/main/a.txt","action0":"edit","rev0":"4","type0":"text","depotFile1":"//Acme/main/new.txt","action1":"add","rev1":"1","type1":"text","job0":"BUG-42"}"#,
            )
            .unwrap(),
            "88",
        )
        .unwrap();
        assert_eq!(detail.files.len(), 2);
        assert_eq!(detail.files[0].depot_path, "//Acme/main/a.txt");
        assert_eq!(detail.files[1].revision.as_deref(), Some("1"));
        assert_eq!(detail.jobs, ["BUG-42"]);
    }

    #[test]
    fn builds_submitted_filters_as_server_side_change_arguments() {
        assert_eq!(
            submitted_change_arguments("//...", "100", Some("Gecko"), Some("gecko-main")).unwrap(),
            vec![
                "-ztag",
                "-Mj",
                "changes",
                "-s",
                "submitted",
                "-l",
                "-t",
                "-m",
                "100",
                "-u",
                "Gecko",
                "-c",
                "gecko-main",
                "//...",
            ]
        );
    }

    #[test]
    fn maps_submitted_changes_to_the_longest_matching_stream() {
        let records = parse_json_lines(
            r#"{"change":"101","depotFile0":"//Acme/dev/tools/a.txt"}
{"change":"102","depotFile":"//Acme/main/b.txt"}"#,
        )
        .unwrap();
        let paths = first_submitted_paths(&records);
        assert_eq!(
            paths.get("101").map(String::as_str),
            Some("//Acme/dev/tools/a.txt")
        );

        let streams = vec![
            StreamSummary {
                path: "//Acme/dev".to_owned(),
                name: "dev".to_owned(),
                parent: None,
                stream_type: "development".to_owned(),
                description: String::new(),
                owner: None,
                updated: None,
            },
            StreamSummary {
                path: "//Acme/dev/tools".to_owned(),
                name: "tools".to_owned(),
                parent: Some("//Acme/dev".to_owned()),
                stream_type: "development".to_owned(),
                description: String::new(),
                owner: None,
                updated: None,
            },
        ];
        assert_eq!(
            stream_for_depot_path(paths.get("101").unwrap(), &streams)
                .map(|stream| stream.path.as_str()),
            Some("//Acme/dev/tools")
        );
    }

    #[test]
    fn builds_exact_stream_cherry_pick_preview_arguments() {
        assert_eq!(
            cherry_pick_arguments("88", "//Acme/dev", "//Acme/main", "default", true),
            vec![
                "-ztag",
                "-Mj",
                "integrate",
                "-n",
                "-c",
                "default",
                "-S",
                "//Acme/dev",
                "-P",
                "//Acme/main",
                "-Af",
                "//Acme/dev/...@=88",
            ]
        );
    }

    #[test]
    fn parses_cherry_pick_preview_paths() {
        let items = parse_cherry_pick_preview(
            &parse_json_lines(
                r#"{"fromFile":"//Acme/dev/a.txt","depotFile":"//Acme/main/a.txt","clientFile":"C:\\\\ws\\a.txt","action":"integrate"}"#,
            )
            .unwrap(),
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source_path, "//Acme/dev/a.txt");
        assert_eq!(items[0].target_path, "//Acme/main/a.txt");
    }

    #[test]
    fn filters_submitted_changes_by_bounded_job_ids() {
        let changes = vec![
            PendingChange {
                id: "101".to_owned(),
                description: "first".to_owned(),
                user: "alex".to_owned(),
                client: "main".to_owned(),
                time: None,
                stream: None,
            },
            PendingChange {
                id: "102".to_owned(),
                description: "second".to_owned(),
                user: "alex".to_owned(),
                client: "main".to_owned(),
                time: None,
                stream: None,
            },
            PendingChange {
                id: "103".to_owned(),
                description: "third".to_owned(),
                user: "alex".to_owned(),
                client: "main".to_owned(),
                time: None,
                stream: None,
            },
        ];
        let ids = BTreeSet::from(["102".to_owned(), "103".to_owned()]);
        assert_eq!(
            filter_changes_by_ids(changes, &ids, 1)
                .iter()
                .map(|change| change.id.as_str())
                .collect::<Vec<_>>(),
            ["102"]
        );
    }

    #[test]
    fn resolve_preview_adds_pending_resolve_without_duplicate_issue() {
        let records = parse_json_lines(
            r#"{"depotFile":"//Acme/main/a.txt","data":"needs resolve"}
{"depotFile":"//Acme/main/b.txt","data":"needs resolve"}"#,
        )
        .unwrap();
        let mut issues = vec![SubmitPreflightIssue {
            depot_path: "//Acme/main/a.txt".to_owned(),
            kind: "unresolved".to_owned(),
            detail: "existing".to_owned(),
        }];
        append_resolve_issues(&mut issues, &records);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[1].depot_path, "//Acme/main/b.txt");
    }

    #[test]
    fn revision_validation_rejects_shell_like_specs() {
        assert!(validate_revision("12").is_ok());
        assert!(validate_revision("head").is_err());
        assert!(validate_revision("12;delete").is_err());
        assert!(validate_depot_path("//Acme/main/file.txt").is_ok());
    }

    #[test]
    fn history_limit_is_bounded_for_filelog_requests() {
        assert!(validate_history_limit(1).is_ok());
        assert!(validate_history_limit(5000).is_ok());
        assert!(validate_history_limit(0).is_err());
        assert!(validate_history_limit(5001).is_err());
    }

    #[test]
    fn password_validation_never_allows_newline_in_stdin_payload() {
        assert!(validate_password("secret").is_ok());
        assert!(validate_password("").is_err());
        assert!(validate_password("secret\nnext").is_err());
    }

    #[test]
    fn parses_login_expiry_minutes_without_logging_ticket_data() {
        assert_eq!(
            parse_expiry_minutes("User alex ticket expires in 45 minutes."),
            Some(45)
        );
        assert_eq!(parse_expiry_minutes("Ticket is valid."), None);
    }

    #[test]
    fn revert_unchanged_preview_parses_only_file_records() {
        let records = parse_json_lines(
            r#"{"depotFile":"//Acme/main/a.txt","action":"edit"}
{"code":"info","data":"//Acme/main/a.txt - reverted."}"#,
        )
        .unwrap();
        let items = records
            .iter()
            .filter(|record| !is_message_record(record))
            .filter_map(|record| {
                Some(RevertPreviewItem {
                    depot_path: field(record, &["depotFile", "clientFile"])?,
                    action: field(record, &["action", "status"])
                        .unwrap_or_else(|| "revert".to_owned()),
                })
            })
            .collect::<Vec<_>>();
        assert_eq!(
            items,
            [RevertPreviewItem {
                depot_path: "//Acme/main/a.txt".to_owned(),
                action: "edit".to_owned()
            }]
        );
    }

    #[test]
    fn submit_preflight_reports_all_server_risks_but_ignores_empty_flags() {
        let issues = parse_submit_preflight(&parse_json_lines(
            r#"{"depotFile":"//Acme/main/a.txt","resolveStatus":"unresolved","otherOpen":"sam","haveRev":"7","headRev":"9"}
{"depotFile":"//Acme/main/b.txt","resolveStatus":"none","otherOpen":"0","otherLock":"false","haveRev":"4","headRev":"4"}"#,
        ).unwrap());
        assert_eq!(issues.len(), 3);
        assert!(issues.iter().any(|issue| issue.kind == "unresolved"));
        assert!(
            issues
                .iter()
                .any(|issue| issue.kind == "locked_or_open_elsewhere")
        );
        assert!(issues.iter().any(|issue| issue.kind == "out_of_date"));
        assert!(
            issues
                .iter()
                .all(|issue| issue.depot_path == "//Acme/main/a.txt")
        );
    }

    #[test]
    fn submit_preflight_collects_bounded_structured_warnings_without_errors() {
        let warnings = parse_submit_preflight_warnings(
            &parse_json_lines(
                r#"{"code":"warning","data":"Trigger will run after submit."}
{"severity":2,"data":"Some metadata is incomplete."}
{"code":"info","data":"not a warning"}
{"code":"warning","data":"Trigger will run after submit."}"#,
            )
            .unwrap(),
        );
        assert_eq!(
            warnings,
            [
                "Trigger will run after submit.",
                "Some metadata is incomplete."
            ]
        );
    }

    #[test]
    fn submit_preflight_marks_missing_files_but_not_expected_deletes() {
        let records = parse_json_lines(
            r#"{"depotFile":"//Acme/main/missing.txt","action":"edit","isMapped":"0"}
{"depotFile":"//Acme/main/deleted.txt","action":"delete"}
{"depotFile":"//Acme/main/ok.txt","action":"edit","path":"C:\\work\\ok.txt","isMapped":"1"}"#,
        )
        .unwrap();
        let expected = vec![
            "//Acme/main/missing.txt".to_owned(),
            "//Acme/main/deleted.txt".to_owned(),
            "//Acme/main/ok.txt".to_owned(),
            "//Acme/main/no-record.txt".to_owned(),
        ];
        let mut issues = parse_submit_preflight(&records);
        append_missing_file_issues(&mut issues, &records, &expected);
        assert_eq!(
            issues
                .iter()
                .filter(|issue| issue.kind == "missing")
                .map(|issue| issue.depot_path.as_str())
                .collect::<Vec<_>>(),
            vec!["//Acme/main/missing.txt", "//Acme/main/no-record.txt"]
        );
    }

    #[test]
    fn reconcile_preview_keeps_action_and_local_mapping() {
        let records = parse_json_lines(
            r#"{"depotFile":"//Acme/main/new.txt","action":"add","path":"C:\\work\\new.txt"}
{"depotFile":"//Acme/main/old.txt","action":"delete"}"#,
        )
        .unwrap();
        let items = records
            .iter()
            .filter_map(|record| {
                Some(ReconcileItem {
                    depot_path: field(record, &["depotFile", "clientFile"])?,
                    action: field(record, &["action", "status"])?.to_lowercase(),
                    local_path: field(record, &["path", "clientFile"]),
                })
            })
            .collect::<Vec<_>>();
        assert_eq!(items[0].action, "add");
        assert_eq!(items[0].local_path.as_deref(), Some("C:\\work\\new.txt"));
        assert_eq!(items[1].action, "delete");
    }

    #[test]
    fn streamed_reconcile_output_ignores_non_file_records() {
        let item = parse_reconcile_output_record(
            r#"{"depotFile":"//Acme/main/new.txt","action":"add","path":"C:/work/new.txt"}"#,
        )
        .unwrap();
        assert_eq!(item.depot_path, "//Acme/main/new.txt");
        assert_eq!(item.local_path.as_deref(), Some("C:/work/new.txt"));
        assert!(parse_reconcile_output_record(r#"{"code":"info","data":"checking"}"#).is_none());
    }

    #[test]
    fn guarded_reconcile_rejects_paths_missing_from_fresh_preview() {
        let candidates = vec![ReconcileItem {
            depot_path: "//Acme/main/kept.txt".to_owned(),
            action: "edit".to_owned(),
            local_path: None,
        }];
        assert!(
            ensure_reconcile_candidates(&["//Acme/main/kept.txt".to_owned()], &candidates,).is_ok()
        );
        let error = ensure_reconcile_candidates(&["//Acme/main/gone.txt".to_owned()], &candidates)
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Stale);
        assert!(error.message.contains("stale"));
    }

    #[test]
    fn merges_only_new_reconcile_adds_as_untracked_workspace_files() {
        let mut files = parse_workspace_files(
            &parse_json_lines(
                r#"{"depotFile":"//Acme/main/existing.txt","path":"C:\\work\\existing.txt"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        let candidates = vec![
            ReconcileItem {
                depot_path: "//Acme/main/new.txt".to_owned(),
                action: "add".to_owned(),
                local_path: Some("C:\\work\\new.txt".to_owned()),
            },
            ReconcileItem {
                depot_path: "//Acme/main/existing.txt".to_owned(),
                action: "add".to_owned(),
                local_path: None,
            },
            ReconcileItem {
                depot_path: "//Acme/main/missing.txt".to_owned(),
                action: "delete".to_owned(),
                local_path: None,
            },
        ];
        merge_untracked_workspace_files(&mut files, &candidates, &candidates[..1]);
        assert_eq!(files.len(), 2);
        assert!(
            files
                .iter()
                .any(|file| file.depot_path == "//Acme/main/new.txt" && file.untracked)
        );
        assert!(
            !files
                .iter()
                .find(|file| file.depot_path == "//Acme/main/new.txt")
                .unwrap()
                .ignored
        );
    }

    #[test]
    fn parses_stream_hierarchy_and_builds_safe_switch_arguments() {
        let streams = parse_streams(
            &parse_json_lines(
                r#"{"Stream":"//Acme/main","Name":"main","Parent":"none","Type":"mainline"}
{"Stream":"//Acme/dev","Name":"dev","Parent":"//Acme/main","Type":"development","Description":"Work"}"#,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(streams[0].parent, None);
        assert_eq!(streams[1].parent.as_deref(), Some("//Acme/main"));
        assert_eq!(streams[1].description, "Work");
        assert_eq!(
            switch_stream_arguments("//Acme/dev", "alex-main", &StreamLocalStrategy::Keep),
            [
                "-ztag",
                "-Mj",
                "client",
                "-s",
                "-f",
                "-S",
                "//Acme/dev",
                "alex-main"
            ]
        );
        assert!(validate_stream_path("//Acme/dev").is_ok());
        assert!(validate_stream_path("//Acme/dev@42").is_err());
    }
}
