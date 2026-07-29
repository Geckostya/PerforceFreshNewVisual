use crate::models::{AppError, ConnectionInput, ErrorKind};

pub(super) fn required_client(input: &ConnectionInput) -> Result<&str, AppError> {
    input
        .client
        .as_deref()
        .map(str::trim)
        .filter(|client| !client.is_empty())
        .ok_or_else(|| {
            AppError::new(ErrorKind::CommandFailed, "Не выбран workspace.")
                .with_hint("Выберите workspace и повторите операцию.")
        })
}

pub(super) fn validate_depot_path(path: &str) -> Result<(), AppError> {
    if path.starts_with("//") && !path.contains(['\r', '\n']) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный путь файла в depot.",
        ))
    }
}

pub(super) fn validate_depot_paths(paths: &[String]) -> Result<(), AppError> {
    paths.iter().try_for_each(|path| validate_depot_path(path))
}

pub(super) fn validate_mapping_queries(paths: &[String]) -> Result<(), AppError> {
    if paths.is_empty() || paths.len() > 256 {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Mapping lookup requires between 1 and 256 paths.",
        ));
    }
    if paths.iter().any(|path| {
        let path = path.trim();
        path.is_empty()
            || path.len() > 4096
            || path.contains(['\r', '\n', '\0'])
            || path.chars().any(|character| character.is_control())
    }) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "A mapping path is invalid.",
        ));
    }
    Ok(())
}

pub(super) fn validate_stream_path(stream: &str) -> Result<(), AppError> {
    let stream = stream.trim();
    if stream.starts_with("//")
        && stream.len() > 2
        && !stream.contains(['\r', '\n', '@', '#', '*', '%'])
    {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный путь stream.",
        ))
    }
}

pub(super) fn validate_stream_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    let valid = !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric());
    if valid {
        Ok(name)
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Имя stream должно начинаться с буквы или цифры и содержать только латинские буквы, цифры, точки, дефисы и подчёркивания.",
        ))
    }
}

pub(super) fn validate_stream_description(description: &str) -> Result<&str, AppError> {
    let description = description.trim();
    if description.len() <= 10_000 {
        Ok(description)
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Описание stream не должно превышать 10000 символов.",
        ))
    }
}

pub(super) fn validate_stream_view_path(path: &str) -> Result<&str, AppError> {
    let path = path.trim();
    let valid = !path.is_empty()
        && path.len() <= 1024
        && !path.starts_with(['/', '\\'])
        && !path.split('/').any(|segment| segment == "..")
        && !path.contains(['\\', '"', '\r', '\n', '\t', '@', '#', '%'])
        && path.chars().all(|character| !character.is_control());
    if valid {
        Ok(path)
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный view path в Paths stream.",
        ))
    }
}

pub(super) fn validate_stream_import_path(path: &str) -> Result<&str, AppError> {
    let path = path.trim();
    if path.starts_with("//")
        && path.len() > 2
        && path.len() <= 2048
        && !path.contains(['\r', '\n', '\t', ' '])
        && !path.split('/').any(|segment| segment == "..")
        && !path.contains(['@', '#', '%'])
    {
        Ok(path)
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Для import требуется корректный depot path.",
        ))
    }
}

pub(super) fn empty_file_selection() -> AppError {
    AppError::new(ErrorKind::CommandFailed, "Не выбраны файлы для операции.")
}

pub(super) fn validate_change(change: &str) -> Result<(), AppError> {
    if change == "default"
        || (!change.is_empty() && change.bytes().all(|byte| byte.is_ascii_digit()))
    {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный номер changelist.",
        ))
    }
}

pub(super) fn validate_numbered_change(change: &str) -> Result<(), AppError> {
    validate_change(change)?;
    if change == "default" {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Для этой операции нужен numbered changelist.",
        ))
    } else {
        Ok(())
    }
}

pub(super) fn validate_revision(revision: &str) -> Result<&str, AppError> {
    let revision = revision.trim();
    if revision.is_empty() || !revision.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный номер ревизии.",
        ));
    }
    Ok(revision)
}

pub(super) fn validate_history_limit(limit: u32) -> Result<(), AppError> {
    if (1..=5000).contains(&limit) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Некорректный лимит истории файла.",
        ))
    }
}

pub(super) fn validate_password(password: &str) -> Result<(), AppError> {
    if password.is_empty() || password.contains(['\r', '\n']) {
        Err(AppError::new(
            ErrorKind::Auth,
            "Пароль не может быть пустым или содержать перенос строки.",
        ))
    } else {
        Ok(())
    }
}

pub(super) fn validate_description(description: Option<&str>) -> Result<&str, AppError> {
    let description = description.map(str::trim).unwrap_or_default();
    if description.is_empty() || description.len() > 10_000 {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Описание submit должно содержать от 1 до 10000 символов.",
        ))
    } else {
        Ok(description)
    }
}

pub(super) fn validate_form_value<'a>(value: &'a str, field: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() || value.contains(['\r', '\n']) {
        Err(AppError::new(
            ErrorKind::CommandFailed,
            format!("Некорректное поле changelist: {field}."),
        ))
    } else {
        Ok(value)
    }
}
