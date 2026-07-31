use std::{
    collections::{BTreeMap, BTreeSet},
    hash::{DefaultHasher, Hash, Hasher},
};

use serde_json::{Map, Value};

use crate::models::{AppError, ConnectionInput, ErrorKind, Fix, Job, JobForm, JobFormField};

use super::{
    MAX_RECORDS, configured_command, is_message_record, optional_field, required_client,
    required_field, run_json, run_output_with_stdin, validate_form_value, validate_numbered_change,
};

const MAX_JOB_FORM_FIELDS: usize = 100;
const MAX_JOB_FIELD_CHARS: usize = 10_000;

pub fn list_jobs(input: &ConnectionInput, search: Option<&str>) -> Result<Vec<Job>, AppError> {
    required_client(input)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "jobs", "-l", "-m", MAX_RECORDS]);
    if let Some(search) = search.map(str::trim).filter(|value| !value.is_empty()) {
        if search.contains(['\r', '\n']) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Некорректный job search.",
            ));
        }
        command.args(["-e", search]);
    }
    parse_jobs(&run_json(&path, &mut command)?)
}

pub fn list_fixes(input: &ConnectionInput, job: &str) -> Result<Vec<Fix>, AppError> {
    required_client(input)?;
    if job.trim().is_empty() || job.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный job id.",
        ));
    }
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "fixes", "-m", MAX_RECORDS, "-j", job.trim()]);
    parse_fixes(&run_json(&path, &mut command)?)
}

pub fn fix_job(
    input: &ConnectionInput,
    change: &str,
    job: &str,
    remove: bool,
) -> Result<Vec<Fix>, AppError> {
    validate_numbered_change(change)?;
    let job = validate_form_value(job.trim(), "job")?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "fix"]);
    if remove {
        command.arg("-d");
    }
    command.args(["-c", change, job]);
    run_json(&path, &mut command)?;
    list_fixes_for_change(input, change)
}

pub fn inspect_job_form(input: &ConnectionInput, job: Option<&str>) -> Result<JobForm, AppError> {
    required_client(input)?;
    let job = job
        .map(|value| validate_form_value(value, "job id").map(str::to_owned))
        .transpose()?;
    let spec = read_job_form(input, job.as_deref())?;
    Ok(JobForm {
        job,
        fields: parse_job_form(&spec)?,
        form_token: job_form_token(&spec),
    })
}

pub fn save_job(
    input: &ConnectionInput,
    job: Option<&str>,
    fields: &[JobFormField],
    form_token: &str,
) -> Result<Job, AppError> {
    required_client(input)?;
    let job = job
        .map(|value| validate_form_value(value, "job id").map(str::to_owned))
        .transpose()?;
    let original = read_job_form(input, job.as_deref())?;
    if form_token.trim().is_empty() || job_form_token(&original) != form_token {
        return Err(AppError::new(ErrorKind::Stale, "Job form is stale.")
            .with_hint("Reload the job before saving."));
    }
    let known = parse_job_form(&original)?
        .into_iter()
        .map(|field| field.name)
        .collect::<BTreeSet<_>>();
    let mut changes = BTreeMap::new();
    for field in fields {
        if !known.contains(&field.name)
            || !valid_field_name(&field.name)
            || field.value.contains('\r')
            || field.value.chars().count() > MAX_JOB_FIELD_CHARS
            || changes
                .insert(field.name.clone(), field.value.clone())
                .is_some()
        {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Job field is invalid or not present in the server form.",
            ));
        }
    }
    let updated = replace_job_fields(&original, &changes)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["job", "-i"]);
    let output = run_output_with_stdin(&path, &mut command, updated.as_bytes())?;
    if !output.status.success() {
        return Err(super::command_error(&output));
    }
    let generated_id = field_value(&parse_job_form(&updated)?, "Job");
    let id = job
        .or(generated_id)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new(ErrorKind::InvalidOutput, "Job form has no Job id."))?;
    let saved = parse_job_form(&read_job_form(input, Some(&id))?)?;
    for (name, value) in changes {
        if field_value(&saved, &name).as_deref() != Some(value.as_str()) {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Server read-back did not match the saved job fields.",
            ));
        }
    }
    job_from_form(&saved)
}

fn read_job_form(input: &ConnectionInput, job: Option<&str>) -> Result<String, AppError> {
    let (path, mut command) = configured_command(input)?;
    command.args(["job", "-o"]);
    if let Some(job) = job {
        command.arg(job);
    }
    let output = command
        .output()
        .map_err(|error| super::launch_error(&path, error))?;
    if !output.status.success() {
        return Err(super::command_error(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_job_form(spec: &str) -> Result<Vec<JobFormField>, AppError> {
    let lines = spec.lines().collect::<Vec<_>>();
    let mut fields = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let Some((name, inline)) = lines[index].split_once(':') else {
            index += 1;
            continue;
        };
        if !valid_field_name(name) {
            index += 1;
            continue;
        }
        let mut values = (!inline.trim().is_empty())
            .then(|| inline.trim().to_owned())
            .into_iter()
            .collect::<Vec<_>>();
        let mut next = index + 1;
        while next < lines.len() && lines[next].starts_with([' ', '\t']) {
            values.push(lines[next].trim_start().to_owned());
            next += 1;
        }
        let value = values.join("\n");
        if value.chars().count() > MAX_JOB_FIELD_CHARS || fields.len() == MAX_JOB_FORM_FIELDS {
            return Err(AppError::new(
                ErrorKind::InvalidOutput,
                "Job form exceeds the supported size.",
            ));
        }
        fields.push(JobFormField {
            name: name.to_owned(),
            value,
        });
        index = next;
    }
    (!fields.is_empty()).then_some(fields).ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidOutput,
            "Server returned an invalid job form.",
        )
    })
}

fn valid_field_name(name: &str) -> bool {
    name.chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn field_value(fields: &[JobFormField], name: &str) -> Option<String> {
    fields
        .iter()
        .find(|field| field.name.eq_ignore_ascii_case(name))
        .map(|field| field.value.clone())
}

fn job_form_token(spec: &str) -> String {
    let mut hasher = DefaultHasher::new();
    spec.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn replace_job_fields(spec: &str, changes: &BTreeMap<String, String>) -> Result<String, AppError> {
    let mut lines = spec.lines().map(str::to_owned).collect::<Vec<_>>();
    for (name, value) in changes {
        let prefix = format!("{name}:");
        let start = lines
            .iter()
            .position(|line| line.starts_with(&prefix))
            .ok_or_else(|| {
                AppError::new(
                    ErrorKind::InvalidOutput,
                    "Job field disappeared from the server form.",
                )
            })?;
        let end = lines[start + 1..]
            .iter()
            .position(|line| !line.starts_with([' ', '\t']))
            .map(|offset| start + 1 + offset)
            .unwrap_or(lines.len());
        let replacement = if value.contains('\n') {
            std::iter::once(format!("{name}:"))
                .chain(value.lines().map(|line| format!("\t{line}")))
                .collect()
        } else {
            vec![format!("{name}:\t{value}")]
        };
        lines.splice(start..end, replacement);
    }
    Ok(format!("{}\n", lines.join("\n")))
}

fn job_from_form(fields: &[JobFormField]) -> Result<Job, AppError> {
    Ok(Job {
        id: field_value(fields, "Job")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::new(ErrorKind::InvalidOutput, "Saved job form has no Job field.")
            })?,
        status: field_value(fields, "Status"),
        user: field_value(fields, "User"),
        date: field_value(fields, "Date"),
        description: field_value(fields, "Description").unwrap_or_default(),
    })
}

fn list_fixes_for_change(input: &ConnectionInput, change: &str) -> Result<Vec<Fix>, AppError> {
    validate_numbered_change(change)?;
    let (path, mut command) = configured_command(input)?;
    command.args(["-ztag", "-Mj", "fixes", "-c", change]);
    parse_fixes(&run_json(&path, &mut command)?)
}

pub(super) fn parse_jobs(records: &[Map<String, Value>]) -> Result<Vec<Job>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(Job {
                id: required_field(record, &["job", "Job"], "job id")?,
                status: optional_field(record, &["status", "Status"]),
                user: optional_field(record, &["user", "User"]),
                date: optional_field(record, &["date", "Date"]),
                description: optional_field(record, &["description", "Description"])
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            })
        })
        .collect()
}

pub(super) fn parse_fixes(records: &[Map<String, Value>]) -> Result<Vec<Fix>, AppError> {
    records
        .iter()
        .filter(|record| !is_message_record(record))
        .map(|record| {
            Ok(Fix {
                job: required_field(record, &["job", "Job"], "job id")?,
                change: required_field(record, &["change", "Change"], "fix changelist")?,
                date: optional_field(record, &["date", "Date"]),
                user: optional_field(record, &["user", "User"]),
                status: optional_field(record, &["status", "Status"]),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{parse_job_form, replace_job_fields};
    use std::collections::BTreeMap;

    #[test]
    fn custom_jobspec_form_keeps_unknown_fields_and_multiline_values() {
        let form = "Job:\tjob0001\nStatus:\treview\nCustom_Field:\talpha\nDescription:\n\tFirst line\n\tSecond line\n";
        let fields = parse_job_form(form).unwrap();
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "Status")
                .unwrap()
                .value,
            "review"
        );
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "Custom_Field")
                .unwrap()
                .value,
            "alpha"
        );
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "Description")
                .unwrap()
                .value,
            "First line\nSecond line"
        );
    }

    #[test]
    fn save_replaces_only_submitted_server_fields() {
        let form = "Job:\tjob0001\nStatus:\topen\nCustom_Field:\tkeep\nDescription:\n\tOld\n";
        let updated = replace_job_fields(
            form,
            &BTreeMap::from([
                ("Status".to_owned(), "triage".to_owned()),
                ("Description".to_owned(), "New\nDetails".to_owned()),
            ]),
        )
        .unwrap();
        assert!(updated.contains("Status:\ttriage"));
        assert!(updated.contains("Custom_Field:\tkeep"));
        assert!(updated.contains("Description:\n\tNew\n\tDetails"));
    }
}
