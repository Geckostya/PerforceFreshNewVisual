use crate::{
    diagnostics, locales,
    models::{
        AnnotationLine, AppError, AppSettings, ChangeExportResult, CliLogEntry, ConnectionInput,
        CreateChangeInput, DeleteChangeInput, DeleteShelfInput, DepotDirectory, DepotFile,
        DepotSummary, DiffInput, EditChangeInput, ErrorKind, FileDiff, FileOperationInput,
        FileRevision, Fix, Job, Label, LocaleCatalog, MoveInput, OpenedFile, OperationEvent,
        OperationEventKind, P4Detection, P4Info, PendingChange, PreviewUnshelveInput,
        ReconcileItem, ReopenInput, ReshelveInput, ResolveInput, RevertInput, RevertPreviewItem,
        SaveChangeFilesInput, SaveRevisionInput, SaveShelvedInput, ShelfDiffInput, ShelfFilesInput,
        ShelveInput, ShelvedFile, StreamSummary, SubmitInput, SubmitMode, SubmitOutcome,
        SubmitPreflightSummary, SubmittedChangeDetail, SwitchStreamInput, SyncPreview, TrustEntry,
        UndoPreviewItem, UnshelveInput, UnshelvePreview, WorkspaceCreateInput, WorkspaceFile,
        WorkspaceLocalBatch, WorkspaceSpec, WorkspaceSummary, WorkspaceUpdateInput,
    },
    operations::{OperationHandle, OperationRegistry, wait_for_process},
    p4, settings,
};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex, atomic::Ordering, mpsc},
    thread,
};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct WorkspaceRootRegistry {
    roots: Mutex<BTreeMap<String, PathBuf>>,
}

impl WorkspaceRootRegistry {
    fn key(input: &ConnectionInput) -> String {
        format!("{}\0{}", input.port, input.user)
    }

    fn remember(&self, input: &ConnectionInput, info: &P4Info) -> Result<(), AppError> {
        let mut roots = self.roots.lock().map_err(|error| {
            AppError::new(
                ErrorKind::CommandFailed,
                "Не удалось сохранить root workspace.",
            )
            .with_diagnostics(error.to_string())
        })?;
        let key = Self::key(input);
        match info
            .client_root
            .as_deref()
            .filter(|root| !root.eq_ignore_ascii_case("null"))
        {
            Some(root) => {
                roots.insert(key, PathBuf::from(root));
            }
            None => {
                roots.remove(&key);
            }
        }
        Ok(())
    }

    fn root(&self, input: &ConnectionInput) -> Result<PathBuf, AppError> {
        self.roots
            .lock()
            .map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Не удалось прочитать root workspace.",
                )
                .with_diagnostics(error.to_string())
            })?
            .get(&Self::key(input))
            .cloned()
            .ok_or_else(|| {
                AppError::new(ErrorKind::CommandFailed, "Root workspace ещё не открыт.")
                    .with_hint("Переоткройте workspace и повторите операцию.")
            })
    }
}

fn validate_reveal_path(path: &str) -> Result<&str, AppError> {
    let path = path.trim();
    if path.is_empty() || path.contains(['\r', '\n']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Не указан корректный локальный путь.",
        ));
    }
    Ok(path)
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), AppError> {
    let path = validate_reveal_path(&path)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Не удалось открыть путь в Explorer.",
                )
                .with_diagnostics(error.to_string())
            })?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(AppError::new(
            ErrorKind::CommandFailed,
            "Открытие пути поддерживается только в Windows build.",
        ))
    }
}

#[tauri::command]
pub async fn detect_p4(p4_path: Option<String>) -> Result<P4Detection, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::detect(p4_path.as_deref()))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn test_connection(input: ConnectionInput) -> Result<P4Info, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::info(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn open_workspace(
    input: ConnectionInput,
    roots: State<'_, WorkspaceRootRegistry>,
) -> Result<P4Info, AppError> {
    let registry_input = input.clone();
    let info = tauri::async_runtime::spawn_blocking(move || p4::open_workspace(&input))
        .await
        .map_err(task_error)??;
    roots.remember(&registry_input, &info)?;
    Ok(info)
}

#[tauri::command]
pub async fn login(input: ConnectionInput, password: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::login(&input, &password))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn login_status(input: ConnectionInput) -> Result<crate::models::LoginStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::login_status(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn logout(input: ConnectionInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::logout(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_trust(input: ConnectionInput) -> Result<Vec<TrustEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_trust(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn load_settings(app: tauri::AppHandle) -> Result<AppSettings, AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || settings::load(&path))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn save_language(app: tauri::AppHandle, language: String) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || settings::save_language(&path, language))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn save_revert_preference(
    app: tauri::AppHandle,
    delete_added_files: bool,
) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        settings::save_revert_preference(&path, delete_added_files)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn load_locales(app: tauri::AppHandle) -> Result<LocaleCatalog, AppError> {
    let directories = locale_directories(&app)?;
    tauri::async_runtime::spawn_blocking(move || locales::load(&directories))
        .await
        .map_err(task_error)
}

#[tauri::command]
pub async fn remember_connection(
    app: tauri::AppHandle,
    input: ConnectionInput,
) -> Result<AppSettings, AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || settings::remember_connection(&path, input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn toggle_favorite_connection(
    app: tauri::AppHandle,
    input: ConnectionInput,
) -> Result<AppSettings, AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || settings::toggle_favorite_connection(&path, input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_workspaces(input: ConnectionInput) -> Result<Vec<WorkspaceSummary>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_workspaces(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn inspect_workspace(input: ConnectionInput) -> Result<WorkspaceSpec, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::inspect_workspace(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn update_workspace(input: WorkspaceUpdateInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::update_workspace(
            &input.connection,
            &input.name,
            &input.root,
            input.stream.as_deref(),
            &input.description,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn create_workspace(input: WorkspaceCreateInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::create_workspace(
            &input.connection,
            &input.name,
            &input.root,
            input.stream.as_deref(),
            &input.description,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn delete_workspace(input: ConnectionInput, name: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::delete_workspace(&input, &name))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn rename_workspace(
    input: ConnectionInput,
    from: String,
    to: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::rename_workspace(&input, &from, &to))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_streams(input: ConnectionInput) -> Result<Vec<StreamSummary>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_streams(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn switch_stream(input: SwitchStreamInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::switch_stream(&input.connection, &input.stream, &input.local_strategy)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn list_depot_directories(
    input: ConnectionInput,
    scope: String,
) -> Result<Vec<DepotDirectory>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_depot_directories(&input, &scope))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_depots(input: ConnectionInput) -> Result<Vec<DepotSummary>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_depots(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_depot_files(
    input: ConnectionInput,
    scope: String,
    include_deleted: Option<bool>,
) -> Result<Vec<DepotFile>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_depot_files(&input, &scope, include_deleted.unwrap_or(false))
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn list_pending_changes(input: ConnectionInput) -> Result<Vec<PendingChange>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_pending_changes(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_jobs(
    input: ConnectionInput,
    search: Option<String>,
) -> Result<Vec<Job>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_jobs(&input, search.as_deref()))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_labels(
    input: ConnectionInput,
    search: Option<String>,
) -> Result<Vec<Label>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_labels(&input, search.as_deref()))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_fixes(input: ConnectionInput, job: String) -> Result<Vec<Fix>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_fixes(&input, &job))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn fix_job(
    input: ConnectionInput,
    change: String,
    job: String,
) -> Result<Vec<Fix>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::fix_job(&input, &change, &job, false))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn unfix_job(
    input: ConnectionInput,
    change: String,
    job: String,
) -> Result<Vec<Fix>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::fix_job(&input, &change, &job, true))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_submitted_changes(
    input: ConnectionInput,
    scope: String,
    limit: u32,
    job: Option<String>,
) -> Result<Vec<PendingChange>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_submitted_changes(&input, &scope, limit, job.as_deref())
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn describe_change(
    input: ConnectionInput,
    change: String,
) -> Result<SubmittedChangeDetail, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::describe_change(&input, &change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_undo(
    input: ConnectionInput,
    source_change: String,
) -> Result<Vec<UndoPreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_undo(&input, &source_change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn undo_change(
    input: ConnectionInput,
    source_change: String,
    target_change: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::undo_change(&input, &source_change, &target_change)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn list_shelved_changes(input: ConnectionInput) -> Result<Vec<PendingChange>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_shelved_changes(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_opened_files(input: ConnectionInput) -> Result<Vec<OpenedFile>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_opened_files(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_workspace_files(
    input: ConnectionInput,
    scope: Option<String>,
    include_untracked: Option<bool>,
) -> Result<Vec<WorkspaceFile>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_workspace_files(&input, scope.as_deref(), include_untracked.unwrap_or(false))
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn list_local_workspace_directory(
    input: ConnectionInput,
    directory: String,
    roots: State<'_, WorkspaceRootRegistry>,
) -> Result<WorkspaceLocalBatch, AppError> {
    let root = roots.root(&input)?;
    let client = input
        .client
        .as_deref()
        .map(str::trim)
        .filter(|client| !client.is_empty())
        .ok_or_else(|| AppError::new(ErrorKind::CommandFailed, "Не выбран workspace."))?
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_local_workspace_directory(&input, &root, &client, &directory)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn ignore_local_file(input: ConnectionInput, local_path: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::ignore_local_file(&input, &local_path))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn delete_local_file(input: ConnectionInput, local_path: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::delete_local_file(&input, &local_path))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_sync(
    input: ConnectionInput,
    scopes: Vec<String>,
) -> Result<SyncPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_sync_scopes(&input, &scopes))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn repair_sync_have_list(
    input: ConnectionInput,
    paths: Vec<String>,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::repair_sync_have_list(&input, &paths))
        .await
        .map_err(task_error)?
}

struct SyncOutputRecord {
    current_path: String,
    file_size: u64,
    total_files: Option<u64>,
    total_bytes: Option<u64>,
}

fn parse_sync_output_record(line: &str) -> Option<SyncOutputRecord> {
    let record = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(line).ok()?;
    let number = |key: &str| {
        record
            .get(key)
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
    };
    let current_path = ["depotFile", "clientFile", "path"].iter().find_map(|key| {
        record
            .get(*key)
            .and_then(|value| value.as_str())
            .map(str::to_owned)
    })?;
    Some(SyncOutputRecord {
        current_path,
        file_size: number("fileSize").unwrap_or_default(),
        total_files: number("totalFileCount"),
        total_bytes: number("totalFileSize"),
    })
}

fn sync_operation_succeeded(force: bool, process_success: bool, readback_current: bool) -> bool {
    if force {
        readback_current
    } else {
        process_success || readback_current
    }
}

#[tauri::command]
pub async fn start_sync(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: ConnectionInput,
    scopes: Vec<String>,
    force: Option<bool>,
) -> Result<String, AppError> {
    let force = force.unwrap_or(false);
    let recovery_scopes = scopes.clone();
    let force_preview = force
        .then(|| p4::preview_sync_items(&input, &recovery_scopes))
        .transpose()?;
    let (path, mut command) = p4::sync_command_scopes(&input, &scopes, true, force)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let operation_scope = Some(scopes.join(", "));
    let retry_scopes = Some(scopes);
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "sync",
            cancel,
            cancelled: cancelled.clone(),
        },
    ) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            "A sync operation is already running.",
        ));
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            registry.remove(&operation_id);
            return Err(
                AppError::new(ErrorKind::CommandFailed, "Не удалось запустить sync.")
                    .with_diagnostics(format!("{}: {error}", path.display())),
            );
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            operation_id: operation_id.clone(),
            operation_kind: "sync".to_owned(),
            kind: OperationEventKind::Started,
            processed: 0,
            total_files: None,
            processed_bytes: 0,
            total_bytes: None,
            current_path: None,
            message: None,
            scope: operation_scope.clone(),
            scopes: retry_scopes.clone(),
            retryable: !force,
        },
    );

    let stderr_thread = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        })
    });
    let stdout_thread = stdout.map(|stdout| {
        let app_for_output = app.clone();
        let id_for_output = operation_id.clone();
        let progress_scope = operation_scope.clone();
        let progress_scopes = retry_scopes.clone();
        thread::spawn(move || {
            let mut processed = 0;
            let mut processed_bytes = 0;
            let mut total_files = None;
            let mut total_bytes = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let Some(record) = parse_sync_output_record(&line) else {
                    continue;
                };
                total_files = total_files.or(record.total_files);
                total_bytes = total_bytes.or(record.total_bytes);
                processed += 1;
                processed_bytes += record.file_size;
                let _ = app_for_output.emit(
                    "operation-event",
                    OperationEvent {
                        operation_id: id_for_output.clone(),
                        operation_kind: "sync".to_owned(),
                        kind: OperationEventKind::Progress,
                        processed,
                        total_files,
                        processed_bytes,
                        total_bytes,
                        current_path: Some(record.current_path),
                        message: None,
                        scope: progress_scope.clone(),
                        scopes: progress_scopes.clone(),
                        retryable: !force,
                    },
                );
            }
            (processed, processed_bytes, total_files, total_bytes)
        })
    });

    let app_for_wait = app.clone();
    let registry_for_wait = registry.inner().clone();
    let id_for_wait = operation_id.clone();
    let completion_scope = operation_scope.clone();
    let completion_scopes = retry_scopes;
    let recovery_input = input;
    thread::spawn(move || {
        let process_success = wait_for_process(child, cancellation);
        let was_cancelled = cancelled.load(Ordering::Acquire);
        let readback_current = if was_cancelled {
            false
        } else {
            p4::repair_sync_after_readback(
                &recovery_input,
                &recovery_scopes,
                force_preview.as_ref(),
            )
            .unwrap_or(false)
        };
        let success = sync_operation_succeeded(force, process_success, readback_current);
        let kind = if was_cancelled {
            OperationEventKind::Cancelled
        } else if success {
            OperationEventKind::Completed
        } else {
            OperationEventKind::Failed
        };
        let (processed, processed_bytes, total_files, total_bytes) = stdout_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let stderr_text = stderr_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let message = (!success && !was_cancelled).then(|| {
            let detail = stderr_text.trim();
            if detail.is_empty() {
                "p4 sync завершился с ошибкой.".to_owned()
            } else {
                detail.to_owned()
            }
        });
        let _ = app_for_wait.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_wait.clone(),
                operation_kind: "sync".to_owned(),
                kind,
                processed,
                total_files,
                processed_bytes,
                total_bytes,
                current_path: None,
                message,
                scope: completion_scope,
                scopes: completion_scopes,
                retryable: !force,
            },
        );
        registry_for_wait.remove(&id_for_wait);
    });
    Ok(operation_id)
}

#[tauri::command]
pub async fn start_submit(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: SubmitInput,
) -> Result<String, AppError> {
    if !matches!(input.mode, SubmitMode::Local) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "This submit mode uses the compensation-safe workflow.",
        )
        .with_hint("Use the standard submit action for shelf-preserving modes."));
    }
    let (path, mut command) = p4::submit_command(
        &input.connection,
        &input.change,
        input.description.as_deref(),
    )?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        AppError::new(ErrorKind::CommandFailed, "Не удалось запустить submit.")
            .with_diagnostics(format!("{}: {error}", path.display()))
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    registry.insert(
        operation_id.clone(),
        OperationHandle {
            kind: "submit",
            cancel,
            cancelled: cancelled.clone(),
        },
    );
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            operation_id: operation_id.clone(),
            operation_kind: "submit".to_owned(),
            kind: OperationEventKind::Started,
            processed: 0,
            total_files: None,
            processed_bytes: 0,
            total_bytes: None,
            current_path: None,
            message: None,
            scope: None,
            scopes: None,
            retryable: false,
        },
    );
    let stderr_thread = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        })
    });
    let stdout_thread = stdout.map(|stdout| {
        let app_for_output = app.clone();
        let id_for_output = operation_id.clone();
        thread::spawn(move || {
            let mut processed = 0;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                processed += 1;
                let current_path =
                    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&line)
                        .ok()
                        .and_then(|record| {
                            ["depotFile", "clientFile", "path"].iter().find_map(|key| {
                                record
                                    .get(*key)
                                    .and_then(|value| value.as_str())
                                    .map(str::to_owned)
                            })
                        });
                let _ = app_for_output.emit(
                    "operation-event",
                    OperationEvent {
                        operation_id: id_for_output.clone(),
                        operation_kind: "submit".to_owned(),
                        kind: OperationEventKind::Progress,
                        processed,
                        total_files: None,
                        processed_bytes: 0,
                        total_bytes: None,
                        current_path,
                        message: None,
                        scope: None,
                        scopes: None,
                        retryable: false,
                    },
                );
            }
            processed
        })
    });
    let app_for_wait = app.clone();
    let registry_for_wait = registry.inner().clone();
    let id_for_wait = operation_id.clone();
    let connection = input.connection.clone();
    let change = input.change.clone();
    thread::spawn(move || {
        let success = wait_for_process(child, cancellation);
        let was_cancelled = cancelled.load(Ordering::Acquire);
        let kind = if was_cancelled {
            OperationEventKind::Cancelled
        } else if success {
            OperationEventKind::Completed
        } else {
            OperationEventKind::Failed
        };
        let processed = stdout_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let stderr_text = stderr_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let message = (!success && !was_cancelled).then(|| {
            let detail = stderr_text.trim();
            let readback = p4::submit_readback_hint(&connection, &change);
            if detail.is_empty() {
                readback
            } else {
                format!("{detail}\n{readback}")
            }
        });
        let _ = app_for_wait.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_wait.clone(),
                operation_kind: "submit".to_owned(),
                kind,
                processed,
                total_files: None,
                processed_bytes: 0,
                total_bytes: None,
                current_path: None,
                message,
                scope: None,
                scopes: None,
                retryable: false,
            },
        );
        registry_for_wait.remove(&id_for_wait);
    });
    Ok(operation_id)
}

#[tauri::command]
pub async fn cancel_operation(
    registry: State<'_, OperationRegistry>,
    operation_id: String,
) -> Result<bool, AppError> {
    Ok(registry.cancel(&operation_id))
}

#[tauri::command]
pub async fn edit_files(input: FileOperationInput) -> Result<(), AppError> {
    run_file_operation(input, p4::edit_files).await
}

#[tauri::command]
pub async fn add_files(input: FileOperationInput) -> Result<(), AppError> {
    run_file_operation(input, p4::add_files).await
}

#[tauri::command]
pub async fn delete_files(input: FileOperationInput) -> Result<(), AppError> {
    run_file_operation(input, p4::delete_files).await
}

#[tauri::command]
pub async fn lock_files(input: FileOperationInput) -> Result<(), AppError> {
    run_file_operation(input, p4::lock_files).await
}

#[tauri::command]
pub async fn unlock_files(input: FileOperationInput) -> Result<(), AppError> {
    run_file_operation(input, p4::unlock_files).await
}

type FileOperation = fn(&ConnectionInput, &str, &[String]) -> Result<(), AppError>;

async fn run_file_operation(
    input: FileOperationInput,
    operation: FileOperation,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        operation(&input.connection, &input.change, &input.depot_paths)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn resolve_files(input: ResolveInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::resolve_files(&input.connection, &input.depot_paths, &input.mode)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_resolve(
    input: ConnectionInput,
    depot_paths: Vec<String>,
) -> Result<Vec<crate::models::ResolvePreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_resolve(&input, &depot_paths))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn move_file(input: MoveInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::move_file(
            &input.connection,
            &input.change,
            &input.source,
            &input.destination,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn reconcile_files(input: crate::models::ReconcileInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::reconcile_guarded(&input.connection, &input.change, &input.depot_paths)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_reconcile(
    input: ConnectionInput,
    scope: Option<String>,
) -> Result<Vec<ReconcileItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_reconcile(&input, scope.as_deref()))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_shelved_files(input: ShelfFilesInput) -> Result<Vec<ShelvedFile>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_shelved_files(&input.connection, &input.change)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn reopen_files(input: ReopenInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::reopen_files(&input.connection, &input.depot_paths, &input.target_change)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn diff_file(input: DiffInput) -> Result<FileDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::diff_file(&input.connection, &input.depot_path, &input.mode)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn file_history(
    input: ConnectionInput,
    depot_path: String,
    limit: Option<u32>,
) -> Result<Vec<FileRevision>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::file_history(&input, &depot_path, limit.unwrap_or(100))
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn print_revision(input: DiffInput, revision: String) -> Result<FileDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::print_revision(&input.connection, &input.depot_path, &revision)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn save_revision(input: SaveRevisionInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_revision(
            &input.connection,
            &input.depot_path,
            &input.revision,
            &input.output_path,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn save_change_files(
    input: SaveChangeFilesInput,
) -> Result<ChangeExportResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_change_files(&input.connection, &input.change, &input.output_directory)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn save_shelved_file(input: SaveShelvedInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_shelved_file(
            &input.connection,
            &input.source_change,
            &input.depot_path,
            &input.output_path,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn diff_revisions(
    input: DiffInput,
    left: String,
    right: String,
) -> Result<FileDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::diff_revisions(
            &input.connection,
            &input.depot_path,
            &left,
            &right,
            &input.mode,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn diff_revision_workspace(
    input: DiffInput,
    revision: String,
) -> Result<FileDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::diff_revision_workspace(&input.connection, &input.depot_path, &revision, &input.mode)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn annotate_file(
    input: crate::models::ConnectionInput,
    depot_path: String,
) -> Result<Vec<AnnotationLine>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::annotate_file(&input, &depot_path))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn diff_shelved_file(input: ShelfDiffInput) -> Result<FileDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::diff_shelved_file(
            &input.connection,
            &input.change,
            &input.depot_path,
            input.against_local,
            &input.mode,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn submit_change(input: SubmitInput) -> Result<SubmitOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        match p4::submit_change(
            &input.connection,
            &input.change,
            input.description.as_deref(),
            &input.mode,
        ) {
            Ok(outcome) => Ok(outcome),
            Err(mut error) => {
                error
                    .hints
                    .push(p4::submit_readback_hint(&input.connection, &input.change));
                Err(error)
            }
        }
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn submit_preflight(
    input: ConnectionInput,
    change: String,
) -> Result<SubmitPreflightSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::submit_preflight(&input, &change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn shelve_file(input: ShelveInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::shelve_files(
            &input.connection,
            &input.change,
            &input.depot_paths,
            input.replace_all,
            input.revert_after,
            input.delete_added_files,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_unshelve(input: PreviewUnshelveInput) -> Result<UnshelvePreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_unshelve(&input.connection, &input.source_change, &input.depot_paths)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn unshelve_files(input: UnshelveInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::unshelve_files(
            &input.connection,
            &input.source_change,
            &input.target_change,
            &input.depot_paths,
            &input.force_paths,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn reshelve_files(input: ReshelveInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::reshelve_files(
            &input.connection,
            &input.source_change,
            &input.target_change,
            &input.depot_paths,
            input.force,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn delete_shelf_files(input: DeleteShelfInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::delete_shelf_files(&input.connection, &input.change, &input.depot_paths)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn revert_files(input: RevertInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::revert_files(
            &input.connection,
            &input.change,
            &input.depot_paths,
            input.delete_added_files,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_revert_unchanged(
    input: ConnectionInput,
    change: String,
) -> Result<Vec<RevertPreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_revert_unchanged(&input, &change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_revert_all(
    input: ConnectionInput,
    change: String,
) -> Result<Vec<RevertPreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_revert_all(&input, &change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_revert_selected(
    input: ConnectionInput,
    change: String,
    depot_paths: Vec<String>,
) -> Result<Vec<RevertPreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_revert_selected(&input, &change, &depot_paths)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn revert_unchanged(input: ConnectionInput, change: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::revert_unchanged(&input, &change))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn edit_change(input: EditChangeInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::edit_change_description(&input.connection, &input.change, &input.description)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn delete_change(input: DeleteChangeInput) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::delete_change(&input.connection, &input.change)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn create_change(input: CreateChangeInput) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::create_change(&input.connection, &input.description)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub fn list_cli_log() -> Vec<CliLogEntry> {
    p4::cli_log()
}

#[tauri::command]
pub fn clear_cli_log() {
    p4::clear_cli_log();
}

#[tauri::command]
pub fn ui_snapshot_enabled() -> bool {
    diagnostics::ui_snapshot_enabled()
}

#[tauri::command]
pub fn write_ui_snapshot(snapshot: serde_json::Value) -> Result<(), AppError> {
    diagnostics::write_ui_snapshot(&snapshot)
}

#[tauri::command]
pub fn read_ui_agent_command(
    last_request_id: Option<String>,
) -> Result<Option<serde_json::Value>, AppError> {
    diagnostics::read_ui_agent_command(last_request_id.as_deref())
}

#[tauri::command]
pub fn write_ui_agent_response(response: serde_json::Value) -> Result<(), AppError> {
    diagnostics::write_ui_agent_response(&response)
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| {
            AppError::new(ErrorKind::Settings, "Не удалось определить папку настроек.")
                .with_diagnostics(error.to_string())
        })
}

fn locale_directories(app: &tauri::AppHandle) -> Result<Vec<std::path::PathBuf>, AppError> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| {
            AppError::new(ErrorKind::Settings, "Не удалось определить папку языков.")
                .with_diagnostics(error.to_string())
        })?
        .join("locales");
    std::fs::create_dir_all(&config).map_err(|error| {
        AppError::new(ErrorKind::Settings, "Не удалось создать папку языков.")
            .with_diagnostics(error.to_string())
    })?;

    let mut directories = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        directories.push(resource.join("locales"));
    }
    if let Ok(executable) = std::env::current_exe()
        && let Some(directory) = executable.parent()
    {
        directories.push(directory.join("locales"));
    }
    #[cfg(debug_assertions)]
    if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        directories.push(root.join("locales"));
    }
    directories.push(config);
    directories.dedup();
    Ok(directories)
}

fn task_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::CommandFailed, "Внутренняя задача была прервана.")
        .with_diagnostics(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_sync_output_record, sync_operation_succeeded, validate_reveal_path};

    #[test]
    fn sync_progress_uses_totals_from_the_first_real_output_record() {
        let record = parse_sync_output_record(
            r#"{"depotFile":"//depot/a.bin","fileSize":"250","totalFileSize":"1000","totalFileCount":"4"}"#,
        )
        .unwrap();
        assert_eq!(record.current_path, "//depot/a.bin");
        assert_eq!(record.file_size, 250);
        assert_eq!(record.total_bytes, Some(1000));
        assert_eq!(record.total_files, Some(4));
        assert!(parse_sync_output_record(r#"{"code":"info","data":"up to date"}"#).is_none());
    }

    #[test]
    fn force_sync_requires_a_clean_final_readback() {
        assert!(!sync_operation_succeeded(true, true, false));
        assert!(sync_operation_succeeded(true, false, true));
        assert!(sync_operation_succeeded(false, true, false));
    }

    #[test]
    fn reveal_path_rejects_empty_and_multiline_values() {
        assert!(validate_reveal_path("  ").is_err());
        assert!(validate_reveal_path("C:\\work\\file.txt\nexplorer.exe").is_err());
        assert_eq!(
            validate_reveal_path(" C:\\work\\file.txt ").unwrap(),
            "C:\\work\\file.txt"
        );
    }
}
