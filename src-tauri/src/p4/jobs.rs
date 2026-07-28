use serde_json::{Map, Value};

use crate::models::{AppError, ConnectionInput, ErrorKind, Fix, Job};

use super::{
    MAX_RECORDS, configured_command, is_message_record, optional_field, required_client,
    required_field, run_json, validate_form_value, validate_numbered_change,
};

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
