use serde_json::{Map, Value};

use crate::models::{AppError, ConnectionInput, ErrorKind, Label};

use super::{
    MAX_RECORDS, configured_command, is_message_record, optional_field, required_client,
    required_field, run_json,
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
