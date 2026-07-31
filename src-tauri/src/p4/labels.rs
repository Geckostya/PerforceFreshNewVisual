use serde_json::{Map, Value};

use crate::models::{AppError, ConnectionInput, ErrorKind, Label, LabelInput, LabelSpec, LabelTagInput, LabelTagPreview, LabelTagResult};

use super::{
    MAX_RECORDS, configured_command, is_message_record, optional_field, required_client,
    required_field, run_json, run_json_collecting_diagnostics, run_output_with_stdin,
    validate_depot_paths, validate_form_value,
};

pub fn list_labels(input: &ConnectionInput, search: Option<&str>) -> Result<Vec<Label>, AppError> {
    required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "labels", "-t", "-m", MAX_RECORDS]);
    if let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) {
        if search.contains(['\r', '\n']) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Некорректный label search.",
            ));
        }
        command.args(["-E", search]);
    }
    parse_labels(&run_json(&path, &mut command)?)
}

pub fn inspect_label(input: &ConnectionInput, name: &str) -> Result<LabelSpec, AppError> {
    let name = validate_label_name(name)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["label", "-o", name]);
    let output = command.output().map_err(|error| super::launch_error(&path, error))?;
    if !output.status.success() { return Err(super::command_error(&output)); }
    parse_label_spec(&String::from_utf8_lossy(&output.stdout))
}

pub fn create_label(input: &ConnectionInput, draft: &LabelInput) -> Result<LabelSpec, AppError> {
    let name = validate_label_name(&draft.name)?;
    let spec = label_form(input, name, draft)?;
    submit_label_form(input, &spec)?;
    inspect_label(input, name)
}

pub fn update_label(input: &ConnectionInput, draft: &LabelInput) -> Result<LabelSpec, AppError> {
    let name = validate_label_name(&draft.name)?;
    if inspect_label(input, name)?.locked { return protected_label_error(); }
    let spec = label_form(input, name, draft)?;
    submit_label_form(input, &spec)?;
    inspect_label(input, name)
}

pub fn delete_label(input: &ConnectionInput, name: &str) -> Result<(), AppError> {
    let name = validate_label_name(name)?;
    if inspect_label(input, name)?.locked { return protected_label_error(); }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "label", "-d", name]);
    run_json(&path, &mut command)?;
    Ok(())
}

pub fn preview_label_tag(input: &ConnectionInput, tag: &LabelTagInput) -> Result<LabelTagPreview, AppError> {
    let spec = inspect_label(input, &tag.label)?;
    let scopes = validate_tag_input(tag)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "tag", "-n"]);
    if tag.remove { command.arg("-d"); }
    command.args(["-l", &spec.label.name]);
    command.args(&scopes);
    let (records, _, partial) = run_json_collecting_diagnostics(&path, &mut command)?;
    Ok(LabelTagPreview { label: spec.label.name, remove: tag.remove, scopes, protected: spec.locked, items: tag_items(&records), partial })
}

pub fn apply_label_tag(input: &ConnectionInput, tag: &LabelTagInput) -> Result<LabelTagResult, AppError> {
    let spec = inspect_label(input, &tag.label)?;
    if spec.locked { return protected_label_error(); }
    let scopes = validate_tag_input(tag)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "tag"]);
    if tag.remove { command.arg("-d"); }
    command.args(["-l", &spec.label.name]);
    command.args(&scopes);
    let (records, diagnostics, partial) = run_json_collecting_diagnostics(&path, &mut command)?;
    Ok(LabelTagResult { label: inspect_label(input, &spec.label.name)?, items: tag_items(&records), diagnostics, partial })
}

fn validate_label_name(value: &str) -> Result<&str, AppError> {
    let value = validate_form_value(value, "label")?;
    if value.len() > 128 || value.contains(['@', '#', '*', '%']) { return Err(AppError::new(ErrorKind::CommandFailed, "Некорректное имя label.")); }
    Ok(value)
}

fn validate_tag_input(tag: &LabelTagInput) -> Result<Vec<String>, AppError> {
    if tag.paths.is_empty() || tag.paths.len() > 200 { return Err(AppError::new(ErrorKind::CommandFailed, "Выберите от одного до 200 depot paths.")); }
    let paths = tag.paths.iter().map(|path| path.trim().to_owned()).collect::<Vec<_>>();
    validate_depot_paths(&paths)?;
    Ok(paths)
}

fn protected_label_error<T>() -> Result<T, AppError> { Err(AppError::new(ErrorKind::Permission, "Label защищён или заблокирован сервером.").with_hint("Снимите защиту в Perforce или обратитесь к владельцу label.")) }

fn label_form(input: &ConnectionInput, name: &str, draft: &LabelInput) -> Result<String, AppError> {
    if draft.description.len() > 10_000 || draft.view.len() > 200 || draft.view.iter().any(|line| line.trim().is_empty() || line.contains(['\r', '\n', '\0'])) { return Err(AppError::new(ErrorKind::CommandFailed, "Некорректные поля label.")); }
    validate_depot_paths(&draft.view.iter().map(|line| line.trim().to_owned()).collect::<Vec<_>>())?;
    let (path, mut command) = configured_command(input)?;
    command.args(["label", "-o", name]);
    let output = command.output().map_err(|error| super::launch_error(&path, error))?;
    if !output.status.success() { return Err(super::command_error(&output)); }
    let mut lines = String::from_utf8_lossy(&output.stdout).lines().map(str::to_owned).collect::<Vec<_>>();
    replace_single(&mut lines, "Label", name)?;
    replace_multiline(&mut lines, "Description", &draft.description)?;
    replace_multiline(&mut lines, "View", &draft.view.join("\n"))?;
    Ok(format!("{}\n", lines.join("\n")))
}

fn submit_label_form(input: &ConnectionInput, spec: &str) -> Result<(), AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["label", "-i"]);
    let output = run_output_with_stdin(&path, &mut command, spec.as_bytes())?;
    if output.status.success() { Ok(()) } else { Err(super::command_error(&output)) }
}

fn parse_label_spec(spec: &str) -> Result<LabelSpec, AppError> {
    let lines = spec.lines().collect::<Vec<_>>();
    let name = form_value(&lines, "Label").ok_or_else(|| AppError::new(ErrorKind::InvalidOutput, "В label form отсутствует Label."))?;
    let owner = form_value(&lines, "Owner");
    let update = form_value(&lines, "Update");
    let description = form_multiline(&lines, "Description");
    let view = form_multiline(&lines, "View").lines().map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned).collect();
    let locked = form_value(&lines, "Options").is_some_and(|value| value.split_whitespace().any(|option| option.eq_ignore_ascii_case("locked")));
    Ok(LabelSpec { label: Label { name, owner, update, description }, view, locked })
}

fn form_value(lines: &[&str], field: &str) -> Option<String> { lines.iter().find_map(|line| line.strip_prefix(&format!("{field}:"))).map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned) }
fn form_multiline(lines: &[&str], field: &str) -> String { let Some(start) = lines.iter().position(|line| line.starts_with(&format!("{field}:"))) else { return String::new(); }; lines[start + 1..].iter().take_while(|line| line.starts_with([' ', '\t'])).map(|line| line.trim()).collect::<Vec<_>>().join("\n") }
fn replace_single(lines: &mut [String], field: &str, value: &str) -> Result<(), AppError> { let line = lines.iter_mut().find(|line| line.starts_with(&format!("{field}:"))).ok_or_else(|| AppError::new(ErrorKind::InvalidOutput, format!("В label form отсутствует {field}.")))?; *line = format!("{field}:\t{value}"); Ok(()) }
fn replace_multiline(lines: &mut Vec<String>, field: &str, value: &str) -> Result<(), AppError> { let start = lines.iter().position(|line| line.starts_with(&format!("{field}:"))).ok_or_else(|| AppError::new(ErrorKind::InvalidOutput, format!("В label form отсутствует {field}.")))?; let end = lines[start + 1..].iter().position(|line| !line.starts_with([' ', '\t'])).map(|offset| start + 1 + offset).unwrap_or(lines.len()); let replacement = std::iter::once(format!("{field}:")) .chain(value.lines().filter(|line| !line.is_empty()).map(|line| format!("\t{line}"))).collect::<Vec<_>>(); lines.splice(start..end, replacement); Ok(()) }
fn tag_items(records: &[Map<String, Value>]) -> Vec<String> { records.iter().filter(|record| !is_message_record(record)).filter_map(|record| optional_field(record, &["depotFile", "clientFile", "path", "data"])).collect() }

pub(super) fn parse_labels(records: &[Map<String, Value>]) -> Result<Vec<Label>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(Label {
                name: required_field(record, &["label", "Label"], "label name")?,
                owner: optional_field(record, &["Owner", "owner"]),
                update: optional_field(record, &["Update", "update"]),
                description: optional_field(record, &["Description", "desc"])
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            })
        })
        .collect()
}
