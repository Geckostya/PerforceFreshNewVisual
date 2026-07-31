use crate::{
    diagnostics, locales,
    models::{
        AnnotationLine, AppError, AppSettings, AuthStage, ChangeExportResult,
        ChangeIdentityPreflight, ChangeIdentityPreflightInput, ChangeIdentityState,
        ChangeIdentityUpdateInput, CherryPickPreviewItem, CliLogEntry, ConnectionInput,
        CreateChangeInput, CreateStreamInput, CreateStreamPreview, DateSyncPreview,
        DeleteChangeInput, DeleteShelfInput, DepotDirectory, DepotFile, DepotStateComparison,
        DepotSummary, DiffInput, EditChangeInput, ErrorKind, FileDiff, FileOperationInput,
        FileRevision, Fix, HistoryPage, Job, JobForm, JobFormInput, Label, LabelInput, LabelSpec,
        LabelTagInput, LabelTagPreview, LabelTagResult, LocaleCatalog, MoveInput, OpenedFile,
        OperationCompensationStatus, OperationDiagnostic, OperationEvent, OperationEventKind,
        OperationItemResult, OperationItemStatus, OperationReadBack, OperationReadBackStatus,
        P4Detection, P4Info, PendingChange, PreviewUnshelveInput, ReconcileItem, ReopenInput,
        ReshelveInput, ResolveApplyResult, ResolveContent, ResolveInput, ResolveResultInput,
        RevertInput, RevertPreviewItem, SaveChangeFilesInput, SaveJobInput, SaveRevisionInput,
        SaveShelvedFilesInput, SaveShelvedInput, ShelfDiffInput, ShelfFilesInput, ShelveInput,
        ShelvedFile, SpecializedResolveInput, StreamDetail, StreamIntegrationInput,
        StreamIntegrationPreview, StreamSummary, SubmitInput, SubmitMode, SubmitOutcome,
        SubmitPreflightSummary, SubmitReadBack, SubmitStepResult, SubmitTerminalOutcome,
        SubmittedChangeDetail, SubmittedFilterOptions, SubmittedHistoryPageInput,
        SwitchStreamInput, SyncPreview, ThemeMode, TrustChallenge, TrustEntry, UndoPreviewItem,
        UnshelveInput, UnshelvePreview, WorkspaceCreateInput, WorkspaceFile, WorkspaceLocalBatch,
        WorkspaceMappingApplyInput, WorkspaceMappingBatch, WorkspaceMappingEditor,
        WorkspaceMappingPreview, WorkspaceMappingPreviewInput, WorkspaceScanCandidate,
        WorkspaceScanCoverage, WorkspaceScanCoverageState, WorkspaceScanIdentity,
        WorkspaceScanPartialReason, WorkspaceScanRoot, WorkspaceScanSnapshot,
        WorkspaceSearchResult, WorkspaceSpec, WorkspaceSummary, WorkspaceUpdateInput,
    },
    operations::{
        OperationHandle, OperationRegistry, wait_for_process, wait_for_process_with_cancellation,
    },
    p4, settings,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex, atomic::Ordering, mpsc},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct WorkspaceRootRegistry {
    roots: Mutex<BTreeMap<String, PathBuf>>,
}

#[derive(Clone, Default)]
pub struct WorkspaceScanRegistry {
    snapshot: Arc<Mutex<Option<WorkspaceScanSnapshot>>>,
}

impl WorkspaceScanRegistry {
    fn reset(&self, input: &ConnectionInput, info: &P4Info) -> Result<(), AppError> {
        let workspace = info
            .client_name
            .as_deref()
            .or(input.client.as_deref())
            .map(str::trim)
            .filter(|workspace| !workspace.is_empty())
            .ok_or_else(|| AppError::new(ErrorKind::CommandFailed, "Не выбран workspace."))?;
        let identity = WorkspaceScanIdentity {
            server: input.port.clone(),
            user: input.user.clone(),
            workspace: workspace.to_owned(),
            stream: info.client_stream.clone(),
        };
        self.replace(empty_workspace_scan_snapshot(identity))
    }

    fn reset_stream(&self, input: &ConnectionInput, stream: &str) -> Result<(), AppError> {
        let workspace = input
            .client
            .as_deref()
            .map(str::trim)
            .filter(|workspace| !workspace.is_empty())
            .ok_or_else(|| AppError::new(ErrorKind::CommandFailed, "Не выбран workspace."))?;
        let identity = WorkspaceScanIdentity {
            server: input.port.clone(),
            user: input.user.clone(),
            workspace: workspace.to_owned(),
            stream: Some(stream.to_owned()),
        };
        let mut snapshot = empty_workspace_scan_snapshot(identity);
        snapshot.coverage.state = WorkspaceScanCoverageState::Stale;
        self.replace(snapshot)
    }

    fn identity(&self, input: &ConnectionInput) -> Result<WorkspaceScanIdentity, AppError> {
        let snapshot = self.snapshot.lock().map_err(workspace_scan_lock_error)?;
        let snapshot = snapshot.as_ref().ok_or_else(workspace_scan_not_open)?;
        if !workspace_scan_connection_matches(&snapshot.identity, input) {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Состояние сканера относится к другому workspace.",
            ));
        }
        Ok(snapshot.identity.clone())
    }

    fn configure(
        &self,
        expected_identity: &WorkspaceScanIdentity,
        roots: Vec<WorkspaceScanRoot>,
        exclusions: Vec<String>,
        partial_reasons: Vec<WorkspaceScanPartialReason>,
    ) -> Result<WorkspaceScanSnapshot, AppError> {
        let mut snapshot = self.snapshot.lock().map_err(workspace_scan_lock_error)?;
        let current = snapshot.as_ref().ok_or_else(workspace_scan_not_open)?;
        if &current.identity != expected_identity {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Workspace изменился во время настройки сканера.",
            ));
        }
        let state = if partial_reasons.is_empty() {
            WorkspaceScanCoverageState::NotStarted
        } else {
            WorkspaceScanCoverageState::Partial
        };
        let configured = WorkspaceScanSnapshot {
            scope_id: workspace_scan_scope_id(expected_identity, &roots, &exclusions),
            identity: expected_identity.clone(),
            coverage: WorkspaceScanCoverage {
                state,
                completed_roots: 0,
                total_roots: roots.len(),
                candidate_count: 0,
                candidate_limit: p4::MAX_WORKSPACE_SCAN_CANDIDATES,
                partial_reasons,
            },
            roots,
            exclusions,
            candidates: Vec::new(),
            generated_at_ms: operation_started_at_ms(),
        };
        *snapshot = Some(configured.clone());
        Ok(configured)
    }

    fn get(&self, input: &ConnectionInput) -> Result<WorkspaceScanSnapshot, AppError> {
        let snapshot = self.snapshot.lock().map_err(workspace_scan_lock_error)?;
        let snapshot = snapshot.as_ref().ok_or_else(workspace_scan_not_open)?;
        if !workspace_scan_connection_matches(&snapshot.identity, input) {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Состояние сканера относится к другому workspace.",
            ));
        }
        Ok(snapshot.clone())
    }

    fn publish_results(
        &self,
        expected_scope_id: &str,
        mut candidates: Vec<WorkspaceScanCandidate>,
        completed_roots: usize,
        failed_roots: usize,
        reasons: &[WorkspaceScanPartialReason],
    ) -> Result<WorkspaceScanSnapshot, AppError> {
        let mut snapshot = self.snapshot.lock().map_err(workspace_scan_lock_error)?;
        let current = snapshot.as_ref().ok_or_else(workspace_scan_not_open)?;
        if current.scope_id != expected_scope_id {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Результат сканирования относится к устаревшему scope.",
            ));
        }
        let mut partial_reasons = current
            .coverage
            .partial_reasons
            .iter()
            .filter(|reason| **reason == WorkspaceScanPartialReason::IgnoreRulesUnavailable)
            .cloned()
            .collect::<Vec<_>>();
        for reason in reasons {
            if !partial_reasons.contains(reason) {
                partial_reasons.push(reason.clone());
            }
        }
        candidates.sort_by(|left, right| left.stable_id.cmp(&right.stable_id));
        candidates.dedup_by(|left, right| left.stable_id == right.stable_id);
        if candidates.len() > p4::MAX_WORKSPACE_SCAN_CANDIDATES {
            candidates.truncate(p4::MAX_WORKSPACE_SCAN_CANDIDATES);
            if !partial_reasons.contains(&WorkspaceScanPartialReason::CandidateLimit) {
                partial_reasons.push(WorkspaceScanPartialReason::CandidateLimit);
            }
        }
        let total_roots = current.roots.len();
        if failed_roots > 0 && !partial_reasons.contains(&WorkspaceScanPartialReason::RootError) {
            partial_reasons.push(WorkspaceScanPartialReason::RootError);
        }
        let mut published = current.clone();
        published.coverage = WorkspaceScanCoverage {
            state: if partial_reasons.is_empty() && completed_roots >= total_roots {
                WorkspaceScanCoverageState::Complete
            } else {
                WorkspaceScanCoverageState::Partial
            },
            completed_roots: completed_roots.min(total_roots),
            total_roots,
            candidate_count: candidates.len(),
            candidate_limit: p4::MAX_WORKSPACE_SCAN_CANDIDATES,
            partial_reasons,
        };
        published.candidates = candidates;
        published.generated_at_ms = operation_started_at_ms();
        *snapshot = Some(published.clone());
        Ok(published)
    }

    fn pause(
        &self,
        expected_scope_id: &str,
        reason: WorkspaceScanPartialReason,
    ) -> Result<(), AppError> {
        let mut snapshot = self.snapshot.lock().map_err(workspace_scan_lock_error)?;
        let current = snapshot.as_mut().ok_or_else(workspace_scan_not_open)?;
        if current.scope_id != expected_scope_id {
            return Err(AppError::new(
                ErrorKind::Stale,
                "Состояние сканера относится к устаревшему scope.",
            ));
        }
        current.coverage.state = WorkspaceScanCoverageState::Paused;
        if !current.coverage.partial_reasons.contains(&reason) {
            current.coverage.partial_reasons.push(reason);
        }
        current.generated_at_ms = operation_started_at_ms();
        Ok(())
    }

    fn replace(&self, replacement: WorkspaceScanSnapshot) -> Result<(), AppError> {
        *self.snapshot.lock().map_err(workspace_scan_lock_error)? = Some(replacement);
        Ok(())
    }
}

fn empty_workspace_scan_snapshot(identity: WorkspaceScanIdentity) -> WorkspaceScanSnapshot {
    WorkspaceScanSnapshot {
        scope_id: workspace_scan_scope_id(&identity, &[], &[]),
        identity,
        roots: Vec::new(),
        exclusions: Vec::new(),
        candidates: Vec::new(),
        coverage: WorkspaceScanCoverage {
            state: WorkspaceScanCoverageState::NotStarted,
            completed_roots: 0,
            total_roots: 0,
            candidate_count: 0,
            candidate_limit: p4::MAX_WORKSPACE_SCAN_CANDIDATES,
            partial_reasons: Vec::new(),
        },
        generated_at_ms: operation_started_at_ms(),
    }
}

fn workspace_scan_scope_id(
    identity: &WorkspaceScanIdentity,
    roots: &[WorkspaceScanRoot],
    exclusions: &[String],
) -> String {
    let mut hasher = DefaultHasher::new();
    identity.server.hash(&mut hasher);
    identity.user.hash(&mut hasher);
    identity.workspace.hash(&mut hasher);
    identity.stream.hash(&mut hasher);
    for root in roots {
        root.local_scope.hash(&mut hasher);
        root.client_scope.hash(&mut hasher);
        root.depot_scope.hash(&mut hasher);
    }
    exclusions.hash(&mut hasher);
    format!("workspace-scan-{:016x}", hasher.finish())
}

fn workspace_scan_connection_matches(
    identity: &WorkspaceScanIdentity,
    input: &ConnectionInput,
) -> bool {
    identity.server.eq_ignore_ascii_case(input.port.trim())
        && identity.user.eq_ignore_ascii_case(input.user.trim())
        && input
            .client
            .as_deref()
            .is_some_and(|client| identity.workspace.eq_ignore_ascii_case(client.trim()))
}

fn workspace_scan_not_open() -> AppError {
    AppError::new(
        ErrorKind::CommandFailed,
        "Workspace для сканирования ещё не открыт.",
    )
    .with_hint("Переоткройте workspace и повторите операцию.")
}

fn workspace_scan_lock_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        ErrorKind::CommandFailed,
        "Не удалось прочитать состояние сканера workspace.",
    )
    .with_diagnostics(error.to_string())
}

const WORKSPACE_SCAN_DEBOUNCE: Duration = Duration::from_millis(300);
const WORKSPACE_SCAN_BUDGET: Duration = Duration::from_millis(1_500);
const WORKSPACE_SCAN_FOREGROUND_RETRY: Duration = Duration::from_millis(500);
const WORKSPACE_SCAN_INTERVAL: Duration = Duration::from_secs(30);
const WORKSPACE_SCAN_MAX_BACKOFF: Duration = Duration::from_secs(60);

#[derive(Clone)]
struct WorkspaceScanRequest {
    input: ConnectionInput,
    workspace_root: PathBuf,
    scope_id: String,
    roots: Vec<WorkspaceScanRoot>,
    exclusions: Vec<String>,
    workspace: String,
    next_add_root: usize,
    cached_candidates: Vec<WorkspaceScanCandidate>,
}

impl WorkspaceScanRequest {
    fn new(
        input: ConnectionInput,
        workspace_root: PathBuf,
        snapshot: &WorkspaceScanSnapshot,
    ) -> Self {
        Self {
            workspace: operation_workspace(&input),
            input,
            workspace_root,
            scope_id: snapshot.scope_id.clone(),
            roots: snapshot.roots.clone(),
            exclusions: snapshot.exclusions.clone(),
            next_add_root: 0,
            cached_candidates: snapshot.candidates.clone(),
        }
    }
}

enum WorkspaceScanSchedulerMessage {
    Schedule(Box<WorkspaceScanRequest>, Duration),
    Cancel(mpsc::Sender<()>),
}

struct ScheduledWorkspaceScan {
    request: WorkspaceScanRequest,
    due: Instant,
}

#[derive(Clone)]
pub struct WorkspaceScanScheduler {
    sender: mpsc::Sender<WorkspaceScanSchedulerMessage>,
}

impl WorkspaceScanScheduler {
    pub fn new(scans: WorkspaceScanRegistry, operations: OperationRegistry) -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || workspace_scan_scheduler_loop(receiver, scans, operations));
        Self { sender }
    }

    fn schedule(&self, request: WorkspaceScanRequest, delay: Duration) -> Result<(), AppError> {
        self.sender
            .send(WorkspaceScanSchedulerMessage::Schedule(
                Box::new(request),
                delay,
            ))
            .map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Не удалось запланировать фоновое сканирование.",
                )
                .with_diagnostics(error.to_string())
            })
    }

    fn cancel_and_wait(&self) -> Result<(), AppError> {
        let (acknowledge, acknowledged) = mpsc::channel();
        self.sender
            .send(WorkspaceScanSchedulerMessage::Cancel(acknowledge))
            .map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Не удалось отменить фоновое сканирование.",
                )
                .with_diagnostics(error.to_string())
            })?;
        acknowledged
            .recv_timeout(Duration::from_secs(5))
            .map_err(|error| {
                AppError::new(
                    ErrorKind::Timeout,
                    "Фоновое сканирование не завершилось вовремя.",
                )
                .with_diagnostics(error.to_string())
            })
    }
}

enum WorkspaceScanRunOutcome {
    Finished {
        candidates: Vec<WorkspaceScanCandidate>,
        completed_roots: usize,
        failed_roots: usize,
        reason: Option<WorkspaceScanPartialReason>,
    },
    Foreground,
    Message(WorkspaceScanSchedulerMessage),
}

impl WorkspaceScanRunOutcome {
    fn partial(
        candidates: Vec<WorkspaceScanCandidate>,
        completed_roots: usize,
        reason: WorkspaceScanPartialReason,
    ) -> Self {
        let failed_roots = usize::from(reason == WorkspaceScanPartialReason::CommandFailed);
        Self::Finished {
            candidates,
            completed_roots,
            failed_roots,
            reason: Some(reason),
        }
    }
}

fn workspace_scan_scheduler_loop(
    receiver: mpsc::Receiver<WorkspaceScanSchedulerMessage>,
    scans: WorkspaceScanRegistry,
    operations: OperationRegistry,
) {
    let mut pending: Option<ScheduledWorkspaceScan> = None;
    let mut failures = 0_u32;
    loop {
        let message = match pending.as_ref() {
            Some(scheduled) => {
                let wait = scheduled.due.saturating_duration_since(Instant::now());
                match receiver.recv_timeout(wait) {
                    Ok(message) => Some(message),
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            None => match receiver.recv() {
                Ok(message) => Some(message),
                Err(_) => return,
            },
        };
        if let Some(message) = message {
            match message {
                WorkspaceScanSchedulerMessage::Schedule(request, delay) => {
                    pending = Some(ScheduledWorkspaceScan {
                        request: *request,
                        due: Instant::now() + delay,
                    });
                    failures = 0;
                }
                WorkspaceScanSchedulerMessage::Cancel(acknowledge) => {
                    if let Some(scheduled) = pending.take() {
                        let _ = scans.pause(
                            &scheduled.request.scope_id,
                            WorkspaceScanPartialReason::Cancelled,
                        );
                    }
                    let _ = acknowledge.send(());
                }
            }
            continue;
        }

        let Some(scheduled) = pending.take() else {
            continue;
        };
        let mut request = scheduled.request;
        if operations.has_active_workspace_operation(&request.workspace) {
            let _ = scans.pause(
                &request.scope_id,
                WorkspaceScanPartialReason::ForegroundActive,
            );
            pending = Some(ScheduledWorkspaceScan {
                request,
                due: Instant::now() + WORKSPACE_SCAN_FOREGROUND_RETRY,
            });
            continue;
        }
        match run_workspace_scan(&receiver, &operations, &mut request) {
            WorkspaceScanRunOutcome::Finished {
                candidates,
                completed_roots,
                failed_roots,
                reason,
            } => {
                let reasons = reason.into_iter().collect::<Vec<_>>();
                let published = scans.publish_results(
                    &request.scope_id,
                    candidates,
                    completed_roots,
                    failed_roots,
                    &reasons,
                );
                if published.is_err() {
                    continue;
                }
                let failed = failed_roots > 0
                    || reasons.contains(&WorkspaceScanPartialReason::CommandFailed);
                failures = if failed {
                    failures.saturating_add(1)
                } else {
                    0
                };
                let delay = if failed {
                    workspace_scan_backoff(failures)
                } else if reasons.contains(&WorkspaceScanPartialReason::BudgetExceeded) {
                    WORKSPACE_SCAN_DEBOUNCE
                } else {
                    WORKSPACE_SCAN_INTERVAL
                };
                pending = Some(ScheduledWorkspaceScan {
                    request,
                    due: Instant::now() + delay,
                });
            }
            WorkspaceScanRunOutcome::Foreground => {
                let _ = scans.pause(
                    &request.scope_id,
                    WorkspaceScanPartialReason::ForegroundActive,
                );
                pending = Some(ScheduledWorkspaceScan {
                    request,
                    due: Instant::now() + WORKSPACE_SCAN_FOREGROUND_RETRY,
                });
            }
            WorkspaceScanRunOutcome::Message(message) => match message {
                WorkspaceScanSchedulerMessage::Schedule(next, delay) => {
                    pending = Some(ScheduledWorkspaceScan {
                        request: *next,
                        due: Instant::now() + delay,
                    });
                    failures = 0;
                }
                WorkspaceScanSchedulerMessage::Cancel(acknowledge) => {
                    let _ = scans.pause(&request.scope_id, WorkspaceScanPartialReason::Cancelled);
                    let _ = acknowledge.send(());
                }
            },
        }
    }
}

fn workspace_scan_backoff(failures: u32) -> Duration {
    let exponent = failures.saturating_sub(1).min(6);
    Duration::from_secs(1_u64 << exponent).min(WORKSPACE_SCAN_MAX_BACKOFF)
}

fn workspace_scan_budget_exhausted(elapsed: Duration) -> bool {
    elapsed >= WORKSPACE_SCAN_BUDGET
}

fn run_workspace_scan(
    receiver: &mpsc::Receiver<WorkspaceScanSchedulerMessage>,
    operations: &OperationRegistry,
    request: &mut WorkspaceScanRequest,
) -> WorkspaceScanRunOutcome {
    let started = Instant::now();
    let mut candidates = request.cached_candidates.clone();
    let mut completed_roots = 0;
    for root in &request.roots {
        if workspace_scan_budget_exhausted(started.elapsed()) {
            return WorkspaceScanRunOutcome::partial(
                candidates,
                completed_roots,
                WorkspaceScanPartialReason::BudgetExceeded,
            );
        }
        let command =
            match p4::workspace_scan_command(&request.input, &request.workspace_root, root) {
                Ok((_, command)) => command,
                Err(_) => {
                    return WorkspaceScanRunOutcome::partial(
                        candidates,
                        completed_roots,
                        WorkspaceScanPartialReason::CommandFailed,
                    );
                }
            };
        let (parsed, retained_candidates) = match workspace_scan_child_result(
            run_workspace_scan_child(
                command,
                p4::parse_workspace_scan_output,
                receiver,
                operations,
                &request.workspace,
                started,
            ),
            candidates,
            completed_roots,
        ) {
            Ok(result) => result,
            Err(outcome) => return outcome,
        };
        candidates = retained_candidates;
        if parsed.failed || !parsed.diagnostics.is_empty() {
            return WorkspaceScanRunOutcome::partial(
                candidates,
                completed_roots,
                WorkspaceScanPartialReason::CommandFailed,
            );
        }
        candidates.retain(|candidate| {
            candidate.action == "add"
                || !workspace_scan_path_is_inside(&candidate.local_path, &root.local_path)
        });
        candidates.extend(parsed.candidates.into_iter().filter(|candidate| {
            !workspace_scan_path_is_excluded(&candidate.local_path, &request.exclusions)
        }));
        completed_roots += 1;
    }
    if !request.roots.is_empty() {
        let add_root_index = request.next_add_root % request.roots.len();
        let add_root = &request.roots[add_root_index];
        if workspace_scan_budget_exhausted(started.elapsed()) {
            return WorkspaceScanRunOutcome::partial(
                candidates,
                completed_roots,
                WorkspaceScanPartialReason::BudgetExceeded,
            );
        }
        let command =
            match p4::workspace_scan_add_command(&request.input, &request.workspace_root, add_root)
            {
                Ok((_, command)) => command,
                Err(_) => {
                    return WorkspaceScanRunOutcome::partial(
                        candidates,
                        completed_roots,
                        WorkspaceScanPartialReason::CommandFailed,
                    );
                }
            };
        let (parsed, retained_candidates) = match workspace_scan_child_result(
            run_workspace_scan_child(
                command,
                p4::parse_workspace_scan_add_output,
                receiver,
                operations,
                &request.workspace,
                started,
            ),
            candidates,
            completed_roots,
        ) {
            Ok(result) => result,
            Err(outcome) => return outcome,
        };
        candidates = retained_candidates;
        if parsed.failed || !parsed.diagnostics.is_empty() {
            return WorkspaceScanRunOutcome::partial(
                candidates,
                completed_roots,
                WorkspaceScanPartialReason::CommandFailed,
            );
        }
        candidates.retain(|candidate| {
            candidate.action != "add"
                || !workspace_scan_path_is_inside(&candidate.local_path, &add_root.local_path)
        });
        candidates.extend(parsed.candidates.into_iter().filter(|candidate| {
            !workspace_scan_path_is_excluded(&candidate.local_path, &request.exclusions)
        }));
        request.cached_candidates.clone_from(&candidates);
        request.next_add_root = (add_root_index + 1) % request.roots.len();
    }
    request.cached_candidates.clone_from(&candidates);
    WorkspaceScanRunOutcome::Finished {
        candidates,
        completed_roots,
        failed_roots: 0,
        reason: None,
    }
}

enum WorkspaceScanChildOutcome {
    Completed(p4::WorkspaceScanCommandOutput),
    Budget,
    Foreground,
    Message(WorkspaceScanSchedulerMessage),
    Failed,
}

fn workspace_scan_child_result(
    outcome: WorkspaceScanChildOutcome,
    candidates: Vec<WorkspaceScanCandidate>,
    completed_roots: usize,
) -> Result<(p4::WorkspaceScanCommandOutput, Vec<WorkspaceScanCandidate>), WorkspaceScanRunOutcome>
{
    match outcome {
        WorkspaceScanChildOutcome::Completed(output) => Ok((output, candidates)),
        WorkspaceScanChildOutcome::Budget => Err(WorkspaceScanRunOutcome::partial(
            candidates,
            completed_roots,
            WorkspaceScanPartialReason::BudgetExceeded,
        )),
        WorkspaceScanChildOutcome::Foreground => Err(WorkspaceScanRunOutcome::Foreground),
        WorkspaceScanChildOutcome::Message(message) => {
            Err(WorkspaceScanRunOutcome::Message(message))
        }
        WorkspaceScanChildOutcome::Failed => Err(WorkspaceScanRunOutcome::partial(
            candidates,
            completed_roots,
            WorkspaceScanPartialReason::CommandFailed,
        )),
    }
}

fn run_workspace_scan_child(
    mut command: Command,
    parse: fn(&str) -> Result<p4::WorkspaceScanCommandOutput, AppError>,
    receiver: &mpsc::Receiver<WorkspaceScanSchedulerMessage>,
    operations: &OperationRegistry,
    workspace: &str,
    scan_started: Instant,
) -> WorkspaceScanChildOutcome {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let Ok(mut child) = command.spawn() else {
        return WorkspaceScanChildOutcome::Failed;
    };
    let mut stdout = child.stdout.take().map(|mut stdout| {
        thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stdout.read_to_end(&mut output);
            output
        })
    });
    let mut stderr = child.stderr.take().map(|mut stderr| {
        thread::spawn(move || {
            let mut output = Vec::new();
            let _ = stderr.read_to_end(&mut output);
            output
        })
    });
    loop {
        let interruption = if workspace_scan_budget_exhausted(scan_started.elapsed()) {
            Some(WorkspaceScanChildOutcome::Budget)
        } else if operations.has_active_workspace_operation(workspace) {
            Some(WorkspaceScanChildOutcome::Foreground)
        } else {
            match receiver.try_recv() {
                Ok(message) => Some(WorkspaceScanChildOutcome::Message(message)),
                Err(mpsc::TryRecvError::Empty) => None,
                Err(mpsc::TryRecvError::Disconnected) => Some(WorkspaceScanChildOutcome::Failed),
            }
        };
        if let Some(interruption) = interruption {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout.take().and_then(|reader| reader.join().ok());
            let _ = stderr.take().and_then(|reader| reader.join().ok());
            return interruption;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout
                    .take()
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                let stderr = stderr
                    .take()
                    .and_then(|reader| reader.join().ok())
                    .unwrap_or_default();
                if status.success() {
                    return parse(&String::from_utf8_lossy(&stdout))
                        .map(WorkspaceScanChildOutcome::Completed)
                        .unwrap_or(WorkspaceScanChildOutcome::Failed);
                }
                let _ = stderr;
                return WorkspaceScanChildOutcome::Failed;
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout.take().and_then(|reader| reader.join().ok());
                let _ = stderr.take().and_then(|reader| reader.join().ok());
                return WorkspaceScanChildOutcome::Failed;
            }
        }
    }
}

fn workspace_scan_path_is_excluded(path: &str, exclusions: &[String]) -> bool {
    exclusions
        .iter()
        .any(|exclusion| workspace_scan_path_is_inside(path, exclusion))
}

fn workspace_scan_path_is_inside(path: &str, directory: &str) -> bool {
    let path = path.replace('/', "\\").to_lowercase();
    let directory = directory
        .trim_end_matches(['/', '\\'])
        .replace('/', "\\")
        .to_lowercase();
    path == directory || path.starts_with(&format!("{directory}\\"))
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

fn validate_reveal_path(path: &str) -> Result<PathBuf, AppError> {
    let path = path.trim();
    if path.is_empty() || path.contains(['\r', '\n', '\0']) {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Не указан корректный локальный путь.",
        ));
    }
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).map_err(|error| {
        AppError::new(ErrorKind::CommandFailed, "Локальный путь не существует.")
            .with_diagnostics(error.to_string())
    })?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Локальный путь не является файлом или папкой.",
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось проверить локальный путь.",
        )
        .with_diagnostics(error.to_string())
    })
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), AppError> {
    let path = validate_reveal_path(&path)?;
    #[cfg(windows)]
    {
        let explorer = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .map(|directory| directory.join("explorer.exe"))
            .filter(|candidate| candidate.is_file())
            .ok_or_else(|| {
                AppError::new(ErrorKind::CommandFailed, "Не найден Windows Explorer.")
            })?;
        std::process::Command::new(explorer)
            .arg({
                let mut select_argument = std::ffi::OsString::from("/select,");
                select_argument.push(path);
                select_argument
            })
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
    scans: State<'_, WorkspaceScanRegistry>,
    scheduler: State<'_, WorkspaceScanScheduler>,
) -> Result<P4Info, AppError> {
    scheduler.cancel_and_wait()?;
    let registry_input = input.clone();
    let info = tauri::async_runtime::spawn_blocking(move || p4::open_workspace(&input))
        .await
        .map_err(task_error)??;
    roots.remember(&registry_input, &info)?;
    scans.reset(&registry_input, &info)?;
    Ok(info)
}

#[tauri::command]
pub async fn login(input: ConnectionInput, password: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::login(&input, &password))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn begin_auth(input: ConnectionInput) -> Result<AuthStage, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::begin_auth(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn select_auth_method(
    app: tauri::AppHandle,
    input: ConnectionInput,
    method: String,
) -> Result<AuthStage, AppError> {
    let (stage, browser_url) =
        tauri::async_runtime::spawn_blocking(move || p4::select_auth_method(&input, &method))
            .await
            .map_err(task_error)??;
    if let Some(url) = browser_url {
        app.opener().open_url(url, None::<String>).map_err(|_| {
            AppError::new(
                ErrorKind::Auth,
                "The system browser could not be opened for authentication.",
            )
            .with_hint("Retry the authentication handoff or use password sign-in.")
        })?;
    }
    Ok(stage)
}

#[tauri::command]
pub async fn check_auth(
    input: ConnectionInput,
    response: Option<String>,
    polling_attempt: u8,
) -> Result<AuthStage, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::check_auth(&input, response.as_deref(), polling_attempt)
    })
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
pub async fn inspect_trust(input: ConnectionInput) -> Result<TrustChallenge, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::inspect_trust(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn confirm_trust(
    input: ConnectionInput,
    fingerprint: String,
) -> Result<TrustEntry, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::confirm_trust(&input, &fingerprint))
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
pub async fn save_theme(app: tauri::AppHandle, theme: ThemeMode) -> Result<(), AppError> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || settings::save_theme(&path, theme))
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
pub async fn update_workspace(input: WorkspaceUpdateInput) -> Result<WorkspaceSpec, AppError> {
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
pub async fn inspect_workspace_mapping_editor(
    input: ConnectionInput,
    workspace: String,
) -> Result<WorkspaceMappingEditor, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::inspect_workspace_mapping_editor(&input, &workspace)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_workspace_mappings(
    input: WorkspaceMappingPreviewInput,
) -> Result<WorkspaceMappingPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_workspace_mappings(&input.connection, &input.workspace, &input.entries)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn apply_workspace_mappings(
    input: WorkspaceMappingApplyInput,
) -> Result<WorkspaceSpec, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::apply_workspace_mappings(
            &input.connection,
            &input.workspace,
            &input.entries,
            &input.preview_token,
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
pub async fn inspect_stream(
    input: ConnectionInput,
    stream_path: String,
) -> Result<StreamDetail, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::inspect_stream(&input, &stream_path))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_stream_integration(
    input: StreamIntegrationInput,
) -> Result<StreamIntegrationPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_stream_integration(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_create_stream(
    input: CreateStreamInput,
) -> Result<CreateStreamPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_create_stream(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn create_stream(input: CreateStreamInput) -> Result<StreamSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::create_stream(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn stream_view_paths_from_local_directories(
    input: ConnectionInput,
    directories: Vec<String>,
    roots: State<'_, WorkspaceRootRegistry>,
) -> Result<Vec<String>, AppError> {
    let root = roots.root(&input)?;
    tauri::async_runtime::spawn_blocking(move || workspace_stream_view_paths(&root, &directories))
        .await
        .map_err(task_error)?
}

fn workspace_stream_view_paths(
    root: &Path,
    directories: &[String],
) -> Result<Vec<String>, AppError> {
    if directories.is_empty() || directories.len() > 100 {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Выберите от 1 до 100 папок workspace.",
        ));
    }
    let root = fs::canonicalize(root).map_err(|error| {
        AppError::new(
            ErrorKind::CommandFailed,
            "Не удалось прочитать root workspace.",
        )
        .with_diagnostics(error.to_string())
    })?;
    let mut view_paths = Vec::new();
    for directory in directories {
        let directory = directory.trim();
        if directory.is_empty() || directory.contains(['\r', '\n']) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Не указан корректный путь папки workspace.",
            ));
        }
        let directory = fs::canonicalize(directory).map_err(|error| {
            AppError::new(
                ErrorKind::CommandFailed,
                "Выбранная папка не существует или недоступна.",
            )
            .with_diagnostics(error.to_string())
        })?;
        if !directory.is_dir() || !directory.starts_with(&root) {
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Можно выбирать только существующие папки текущего workspace.",
            ));
        }
        let relative = directory
            .strip_prefix(&root)
            .map_err(|error| {
                AppError::new(
                    ErrorKind::CommandFailed,
                    "Выбранная папка находится вне текущего workspace.",
                )
                .with_diagnostics(error.to_string())
            })?
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let view_path = if relative.is_empty() {
            "...".to_owned()
        } else {
            format!("{relative}/...")
        };
        if !view_paths.contains(&view_path) {
            view_paths.push(view_path);
        }
    }
    Ok(view_paths)
}

#[tauri::command]
pub async fn switch_stream(
    input: SwitchStreamInput,
    scans: State<'_, WorkspaceScanRegistry>,
    scheduler: State<'_, WorkspaceScanScheduler>,
) -> Result<(), AppError> {
    scheduler.cancel_and_wait()?;
    let registry_input = input.connection.clone();
    let stream = input.stream.clone();
    tauri::async_runtime::spawn_blocking(move || {
        p4::switch_stream(&input.connection, &input.stream, &input.local_strategy)
    })
    .await
    .map_err(task_error)??;
    scans.reset_stream(&registry_input, &stream)
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
pub async fn compare_depot_states(
    input: ConnectionInput,
    scope: String,
    base_change: String,
    target_change: Option<String>,
) -> Result<DepotStateComparison, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::compare_depot_states(&input, &scope, &base_change, target_change.as_deref())
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
pub async fn inspect_job_form(input: JobFormInput) -> Result<JobForm, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::inspect_job_form(&input.connection, input.job.as_deref())
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn save_job(input: SaveJobInput) -> Result<Job, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_job(
            &input.connection,
            input.job.as_deref(),
            &input.fields,
            &input.form_token,
        )
    })
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
pub async fn inspect_label(input: ConnectionInput, name: String) -> Result<LabelSpec, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::inspect_label(&input, &name))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn create_label(
    input: ConnectionInput,
    draft: LabelInput,
) -> Result<LabelSpec, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::create_label(&input, &draft))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn update_label(
    input: ConnectionInput,
    draft: LabelInput,
) -> Result<LabelSpec, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::update_label(&input, &draft))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn delete_label(input: ConnectionInput, name: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::delete_label(&input, &name))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn preview_label_tag(
    input: ConnectionInput,
    tag: LabelTagInput,
) -> Result<LabelTagPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::preview_label_tag(&input, &tag))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn apply_label_tag(
    input: ConnectionInput,
    tag: LabelTagInput,
) -> Result<LabelTagResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::apply_label_tag(&input, &tag))
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
    user: Option<String>,
    client: Option<String>,
    include_streams: Option<bool>,
) -> Result<Vec<PendingChange>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::list_submitted_changes(
            &input,
            &scope,
            limit,
            job.as_deref(),
            user.as_deref(),
            client.as_deref(),
            include_streams.unwrap_or(false),
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn list_submitted_history_page(
    request: SubmittedHistoryPageInput,
) -> Result<HistoryPage<PendingChange>, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_submitted_history_page(request))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn list_submitted_filter_options(
    input: ConnectionInput,
) -> Result<SubmittedFilterOptions, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::list_submitted_filter_options(&input))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn describe_change(
    input: ConnectionInput,
    change: String,
    max_files: Option<u32>,
) -> Result<SubmittedChangeDetail, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::describe_change_with_file_limit(&input, &change, max_files)
    })
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
pub async fn preview_cherry_pick(
    input: ConnectionInput,
    source_change: String,
    source_stream: String,
    target_stream: String,
    target_change: String,
) -> Result<Vec<CherryPickPreviewItem>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_cherry_pick(
            &input,
            &source_change,
            &source_stream,
            &target_stream,
            &target_change,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn cherry_pick_change(
    input: ConnectionInput,
    source_change: String,
    source_stream: String,
    target_stream: String,
    target_change: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::cherry_pick_change(
            &input,
            &source_change,
            &source_stream,
            &target_stream,
            &target_change,
        )
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
pub async fn search_workspace_files(
    input: ConnectionInput,
    scope: String,
    query: String,
) -> Result<WorkspaceSearchResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::search_workspace_files(&input, &scope, &query))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn map_workspace_paths(
    input: ConnectionInput,
    paths: Vec<String>,
) -> Result<WorkspaceMappingBatch, AppError> {
    tauri::async_runtime::spawn_blocking(move || p4::map_workspace_paths(&input, &paths))
        .await
        .map_err(task_error)?
}

#[tauri::command]
pub async fn configure_workspace_scan(
    input: ConnectionInput,
    roots: Vec<String>,
    exclusions: Vec<String>,
    workspace_roots: State<'_, WorkspaceRootRegistry>,
    scans: State<'_, WorkspaceScanRegistry>,
    scheduler: State<'_, WorkspaceScanScheduler>,
) -> Result<WorkspaceScanSnapshot, AppError> {
    scheduler.cancel_and_wait()?;
    let workspace_root = workspace_roots.root(&input)?;
    let request_workspace_root = workspace_root.clone();
    let identity = scans.identity(&input)?;
    let scan_input = input.clone();
    let configuration = tauri::async_runtime::spawn_blocking(move || {
        p4::configure_workspace_scan(&scan_input, &workspace_root, &roots, &exclusions)
    })
    .await
    .map_err(task_error)??;
    let snapshot = scans.configure(
        &identity,
        configuration.roots,
        configuration.exclusions,
        configuration.partial_reasons,
    )?;
    scheduler.schedule(
        WorkspaceScanRequest::new(input, request_workspace_root, &snapshot),
        WORKSPACE_SCAN_DEBOUNCE,
    )?;
    Ok(snapshot)
}

#[tauri::command]
pub fn get_workspace_scan_snapshot(
    input: ConnectionInput,
    scans: State<'_, WorkspaceScanRegistry>,
) -> Result<WorkspaceScanSnapshot, AppError> {
    scans.get(&input)
}

#[tauri::command]
pub fn refresh_workspace_scan(
    input: ConnectionInput,
    workspace_roots: State<'_, WorkspaceRootRegistry>,
    scans: State<'_, WorkspaceScanRegistry>,
    scheduler: State<'_, WorkspaceScanScheduler>,
) -> Result<(), AppError> {
    let workspace_root = workspace_roots.root(&input)?;
    let snapshot = scans.get(&input)?;
    if snapshot.roots.is_empty() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Корни фонового сканирования ещё не настроены.",
        ));
    }
    scheduler.schedule(
        WorkspaceScanRequest::new(input, workspace_root, &snapshot),
        Duration::ZERO,
    )
}

#[tauri::command]
pub fn cancel_workspace_scan(scheduler: State<'_, WorkspaceScanScheduler>) -> Result<(), AppError> {
    scheduler.cancel_and_wait()
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
pub async fn preview_sync_at_date(
    input: ConnectionInput,
    scopes: Vec<String>,
    target_date_time: String,
) -> Result<DateSyncPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_sync_at_date(&input, &scopes, &target_date_time)
    })
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

const MAX_SYNC_RETRY_SCOPES: usize = 1000;
const MAX_OPERATION_DIAGNOSTIC_CHARS: usize = 2048;

fn operation_started_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn operation_workspace(input: &ConnectionInput) -> String {
    format!(
        "{}/{}/{}",
        input.port.trim().to_lowercase(),
        input.user.trim().to_lowercase(),
        input
            .client
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_lowercase()
    )
}

fn bounded_operation_diagnostics(message: Option<&str>) -> Vec<OperationDiagnostic> {
    message
        .filter(|value| !value.trim().is_empty())
        .map(|value| OperationDiagnostic {
            code: "p4_operation".to_owned(),
            message: value.chars().take(MAX_OPERATION_DIAGNOSTIC_CHARS).collect(),
            item_id: None,
        })
        .into_iter()
        .collect()
}

fn submit_item_results(
    change: &str,
    mode: &SubmitMode,
    outcome: &SubmitOutcome,
) -> Vec<OperationItemResult> {
    outcome
        .steps
        .iter()
        .map(|step| OperationItemResult {
            item_id: step.step.clone(),
            path: None,
            status: match step.status.as_str() {
                "completed" | "succeeded" => OperationItemStatus::Succeeded,
                "skipped" => OperationItemStatus::Skipped,
                _ => OperationItemStatus::Failed,
            },
            reason: step.detail.clone(),
            compensation: if matches!(mode, SubmitMode::Shelf)
                && !matches!(step.status.as_str(), "completed" | "succeeded" | "skipped")
            {
                OperationCompensationStatus::Unknown
            } else {
                OperationCompensationStatus::NotRequired
            },
            recovery_action_id: (!outcome.recovery_actions.is_empty()
                || matches!(outcome.terminal, SubmitTerminalOutcome::Unknown)
                || !matches!(step.status.as_str(), "completed" | "succeeded" | "skipped"))
            .then(|| "refresh_changes".to_owned()),
        })
        .chain((outcome.steps.is_empty()).then(|| OperationItemResult {
            item_id: format!("submit-{change}"),
            path: None,
            status: OperationItemStatus::Skipped,
            reason: Some("Submit returned no completed step details.".to_owned()),
            compensation: OperationCompensationStatus::Unknown,
            recovery_action_id: Some("refresh_changes".to_owned()),
        }))
        .collect()
}

fn submitted_change_from_record(
    record: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    let value = record.get("submittedChange")?;
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|value| value.to_string()))
}

fn operation_event(
    operation_id: &str,
    operation_kind: &str,
    kind: OperationEventKind,
    started_at_ms: u64,
) -> OperationEvent {
    OperationEvent {
        operation_id: operation_id.to_owned(),
        operation_kind: operation_kind.to_owned(),
        kind,
        started_at_ms,
        processed: 0,
        total_files: None,
        processed_bytes: 0,
        total_bytes: None,
        current_path: None,
        message: None,
        scope: None,
        scopes: None,
        phase: None,
        reconcile_items: None,
        submit_outcome: None,
        diagnostics: Vec::new(),
        item_results: Vec::new(),
        read_back: OperationReadBack {
            status: OperationReadBackStatus::NotRequired,
            affected_state: Vec::new(),
            message: None,
        },
        retryable: false,
        cancellable: true,
    }
}

fn integration_output_path(line: &str) -> Option<String> {
    let record = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(line).ok()?;
    ["depotFile", "toFile", "clientFile", "path"]
        .iter()
        .find_map(|key| {
            record
                .get(*key)
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
}

fn confirmed_integration_paths(
    expected: &BTreeSet<String>,
    baseline: &BTreeSet<String>,
    output: &BTreeSet<String>,
    opened: &[OpenedFile],
    target_change: &str,
) -> BTreeSet<String> {
    opened
        .iter()
        .filter(|item| item.change == target_change)
        .map(|item| item.depot_path.to_ascii_lowercase())
        .filter(|path| {
            expected.contains(path) && (!baseline.contains(path) || output.contains(path))
        })
        .collect()
}

fn unexpected_integration_paths(
    expected: &BTreeSet<String>,
    baseline: &BTreeSet<String>,
    output: &BTreeSet<String>,
    opened: &[OpenedFile],
    target_change: &str,
) -> BTreeSet<String> {
    let mut unexpected = output
        .difference(expected)
        .cloned()
        .collect::<BTreeSet<_>>();
    unexpected.extend(
        opened
            .iter()
            .filter(|item| item.change == target_change)
            .map(|item| item.depot_path.to_ascii_lowercase())
            .filter(|path| !baseline.contains(path) && !expected.contains(path)),
    );
    unexpected
}

#[tauri::command]
pub async fn start_stream_integration(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: StreamIntegrationInput,
    preview_identity: String,
) -> Result<String, AppError> {
    let recovery_input = input.clone();
    let (path, mut command, preview) = p4::stream_integration_command(&input, &preview_identity)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let started_at_ms = operation_started_at_ms();
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "integrate",
            workspace: operation_workspace(&input.connection),
            started_at_ms,
            cancel,
            cancelled: cancelled.clone(),
        },
    ) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            "Another workspace mutation is already running.",
        ));
    }
    let baseline_opened = match p4::list_opened_files(&input.connection) {
        Ok(opened) => opened
            .into_iter()
            .filter(|item| item.change == input.target_change)
            .map(|item| item.depot_path.to_ascii_lowercase())
            .collect::<BTreeSet<_>>(),
        Err(error) => {
            registry.remove(&operation_id);
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Could not establish the pre-integration server state.",
            )
            .with_diagnostics(error.message)
            .with_hint("Refresh the pending changelist and retry."));
        }
    };
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            registry.remove(&operation_id);
            return Err(AppError::new(
                ErrorKind::CommandFailed,
                "Could not start the stream integration command.",
            )
            .with_diagnostics(format!("{}: {error}", path.display())));
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let scope = format!("{} → {}", preview.source_stream, preview.target_stream);
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            operation_id: operation_id.clone(),
            operation_kind: "integrate".to_owned(),
            kind: OperationEventKind::Started,
            total_files: Some(preview.items.len() as u64),
            scope: Some(scope.clone()),
            phase: Some("apply".to_owned()),
            ..operation_event(
                &operation_id,
                "integrate",
                OperationEventKind::Started,
                started_at_ms,
            )
        },
    );
    let stdout_thread = stdout.map(|stdout| {
        let app = app.clone();
        let id = operation_id.clone();
        let scope = scope.clone();
        let total = preview.items.len() as u64;
        thread::spawn(move || {
            let mut paths = Vec::new();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(current_path) = integration_output_path(&line) else {
                    continue;
                };
                paths.push(current_path.clone());
                let _ = app.emit(
                    "operation-event",
                    OperationEvent {
                        operation_id: id.clone(),
                        operation_kind: "integrate".to_owned(),
                        kind: OperationEventKind::Progress,
                        processed: paths.len() as u64,
                        total_files: Some(total),
                        current_path: Some(current_path),
                        scope: Some(scope.clone()),
                        phase: Some("apply".to_owned()),
                        ..operation_event(
                            &id,
                            "integrate",
                            OperationEventKind::Progress,
                            started_at_ms,
                        )
                    },
                );
            }
            paths
        })
    });
    let stderr_thread = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        })
    });
    let app_for_wait = app.clone();
    let registry_for_wait = registry.inner().clone();
    let id_for_wait = operation_id.clone();
    thread::spawn(move || {
        let process_success = wait_for_process(child, cancellation);
        let was_cancelled = cancelled.load(Ordering::Acquire);
        let output_paths = stdout_thread
            .and_then(|worker| worker.join().ok())
            .unwrap_or_default();
        let stderr_text = stderr_thread
            .and_then(|worker| worker.join().ok())
            .unwrap_or_default();
        let readback = p4::list_opened_files(&recovery_input.connection);
        let expected = preview
            .items
            .iter()
            .map(|item| item.target_path.to_ascii_lowercase())
            .collect::<BTreeSet<_>>();
        let output_path_set = output_paths
            .iter()
            .map(|path| path.to_ascii_lowercase())
            .collect::<BTreeSet<_>>();
        let confirmed = readback.as_ref().map(|opened| {
            confirmed_integration_paths(
                &expected,
                &baseline_opened,
                &output_path_set,
                opened,
                &recovery_input.target_change,
            )
        });
        let unexpected = readback.as_ref().map(|opened| {
            unexpected_integration_paths(
                &expected,
                &baseline_opened,
                &output_path_set,
                opened,
                &recovery_input.target_change,
            )
        });
        let confirmed_count = confirmed.as_ref().map(BTreeSet::len).unwrap_or_default();
        let has_unexpected = unexpected.as_ref().is_ok_and(|paths| !paths.is_empty());
        let kind = if readback.is_err() || has_unexpected {
            OperationEventKind::Unknown
        } else if was_cancelled && confirmed_count > 0 {
            OperationEventKind::Partial
        } else if was_cancelled {
            OperationEventKind::Cancelled
        } else if process_success && confirmed_count == expected.len() {
            OperationEventKind::Completed
        } else if confirmed_count > 0 {
            OperationEventKind::Partial
        } else {
            OperationEventKind::Failed
        };
        let mut item_results = preview
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let succeeded = confirmed
                    .as_ref()
                    .is_ok_and(|paths| paths.contains(&item.target_path.to_ascii_lowercase()));
                OperationItemResult {
                    item_id: format!("integration-{index}"),
                    path: Some(item.target_path.clone()),
                    status: if succeeded {
                        OperationItemStatus::Succeeded
                    } else if was_cancelled {
                        OperationItemStatus::Skipped
                    } else {
                        OperationItemStatus::Failed
                    },
                    reason: (!succeeded).then(|| {
                        if readback.is_err() {
                            "Authoritative read-back failed."
                        } else {
                            "Target file was not confirmed in the pending changelist."
                        }
                        .to_owned()
                    }),
                    compensation: OperationCompensationStatus::NotRequired,
                    recovery_action_id: Some("refresh_changes".to_owned()),
                }
            })
            .collect::<Vec<_>>();
        if let Ok(paths) = &unexpected {
            item_results.extend(paths.iter().enumerate().map(|(index, path)| {
                OperationItemResult {
                    item_id: format!("integration-unexpected-{index}"),
                    path: Some(path.clone()),
                    status: OperationItemStatus::Failed,
                    reason: Some(
                        "The server changed a path that was not present in the approved preview."
                            .to_owned(),
                    ),
                    compensation: OperationCompensationStatus::NotRequired,
                    recovery_action_id: Some("refresh_changes".to_owned()),
                }
            }));
        }
        let read_back = OperationReadBack {
            status: if readback.is_ok() {
                OperationReadBackStatus::Succeeded
            } else {
                OperationReadBackStatus::Unknown
            },
            affected_state: vec![
                "opened_files".to_owned(),
                "pending_changes".to_owned(),
                "resolve_state".to_owned(),
            ],
            message: Some(match &readback {
                Ok(_) if has_unexpected => format!(
                    "Confirmed {confirmed_count} of {} previewed files, but detected {} unexpected path(s) in CL {}.",
                    expected.len(),
                    unexpected.as_ref().map(BTreeSet::len).unwrap_or_default(),
                    recovery_input.target_change
                ),
                Ok(_) => format!(
                    "Confirmed {confirmed_count} of {} previewed files in CL {}.",
                    expected.len(),
                    recovery_input.target_change
                ),
                Err(error) => format!(
                    "Integration may have changed server state, but read-back failed: {}",
                    error.message
                ),
            }),
        };
        let message = match kind {
            OperationEventKind::Completed => {
                Some("Integration is pending. Resolve and review it before submit.".to_owned())
            }
            OperationEventKind::Cancelled if stderr_text.trim().is_empty() => {
                Some("Integration was cancelled before any target file was confirmed.".to_owned())
            }
            _ if !stderr_text.trim().is_empty() => Some(stderr_text),
            _ => read_back.message.clone(),
        };
        let _ = app_for_wait.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_wait.clone(),
                operation_kind: "integrate".to_owned(),
                kind: kind.clone(),
                processed: confirmed_count as u64,
                total_files: Some(expected.len() as u64),
                message: message.clone(),
                scope: Some(scope),
                phase: Some("read_back".to_owned()),
                diagnostics: bounded_operation_diagnostics(message.as_deref()),
                item_results,
                read_back,
                ..operation_event(&id_for_wait, "integrate", kind, started_at_ms)
            },
        );
        registry_for_wait.remove(&id_for_wait);
    });
    Ok(operation_id)
}

fn sync_operation_scope(scopes: &[String]) -> String {
    match scopes {
        [] => String::new(),
        [scope] => scope.clone(),
        [first, rest @ ..] => format!("{first} (+{} more)", rest.len()),
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
    let (path, mut command, scope_input) = p4::sync_command_scopes(&input, &scopes, true, force)?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let started_at_ms = operation_started_at_ms();
    let workspace = operation_workspace(&input);
    let operation_scope = Some(sync_operation_scope(&scopes));
    let retryable = !force && scopes.len() <= MAX_SYNC_RETRY_SCOPES;
    let retry_scopes = retryable.then_some(scopes);
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "sync",
            workspace,
            started_at_ms,
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
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin_thread = stdin.map(|mut stdin| thread::spawn(move || stdin.write_all(&scope_input)));
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
            phase: None,
            reconcile_items: None,
            retryable,
            ..operation_event(
                &operation_id,
                "sync",
                OperationEventKind::Started,
                started_at_ms,
            )
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
                        scopes: None,
                        phase: None,
                        reconcile_items: None,
                        retryable,
                        ..operation_event(
                            &id_for_output,
                            "sync",
                            OperationEventKind::Progress,
                            started_at_ms,
                        )
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
        let stdin_error = stdin_thread.and_then(|writer| match writer.join() {
            Ok(Ok(())) => None,
            Ok(Err(error)) => Some(error.to_string()),
            Err(_) => Some("The p4 argument writer stopped unexpectedly.".to_owned()),
        });
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
        let success = sync_operation_succeeded(
            force,
            process_success && stdin_error.is_none(),
            readback_current,
        );
        let (processed, processed_bytes, total_files, total_bytes) = stdout_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let kind = if was_cancelled && processed > 0 {
            OperationEventKind::Partial
        } else if was_cancelled {
            OperationEventKind::Cancelled
        } else if success {
            OperationEventKind::Completed
        } else if processed > 0 {
            OperationEventKind::Partial
        } else {
            OperationEventKind::Failed
        };
        let stderr_text = stderr_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let message = (!success && !was_cancelled).then(|| {
            let detail = [stdin_error.as_deref(), Some(stderr_text.trim())]
                .into_iter()
                .flatten()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if detail.is_empty() {
                "p4 sync завершился с ошибкой.".to_owned()
            } else {
                detail
            }
        });
        let read_back = OperationReadBack {
            status: if readback_current {
                OperationReadBackStatus::Succeeded
            } else if was_cancelled {
                OperationReadBackStatus::Unknown
            } else {
                OperationReadBackStatus::Failed
            },
            affected_state: vec!["workspace_files".to_owned(), "have_list".to_owned()],
            message: (!readback_current)
                .then(|| "The authoritative workspace read-back did not complete.".to_owned()),
        };
        let diagnostics = bounded_operation_diagnostics(message.as_deref());
        let _ = app_for_wait.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_wait.clone(),
                operation_kind: "sync".to_owned(),
                kind: kind.clone(),
                processed,
                total_files,
                processed_bytes,
                total_bytes,
                current_path: None,
                message,
                scope: completion_scope,
                scopes: completion_scopes,
                phase: None,
                reconcile_items: None,
                diagnostics,
                read_back,
                retryable,
                ..operation_event(&id_for_wait, "sync", kind, started_at_ms)
            },
        );
        registry_for_wait.remove(&id_for_wait);
    });
    Ok(operation_id)
}

fn failed_submit_outcome(readback: &SubmitReadBack, error: &AppError) -> SubmitOutcome {
    SubmitOutcome {
        preserved_local_change: None,
        terminal: readback.outcome,
        affected_change: readback.affected_change.clone(),
        recovery_actions: readback.recovery_actions.clone(),
        steps: vec![SubmitStepResult {
            step: "submit".to_owned(),
            status: "failed".to_owned(),
            detail: Some(error.message.clone()),
        }],
    }
}

fn submit_mode_cancellable(mode: &SubmitMode) -> bool {
    matches!(mode, SubmitMode::Local)
}

#[tauri::command]
pub async fn start_submit(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: SubmitInput,
) -> Result<String, AppError> {
    if !matches!(input.mode, SubmitMode::Local) {
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (cancel, cancellation) = mpsc::channel();
        drop(cancellation);
        let cancellable = submit_mode_cancellable(&input.mode);
        let operation_id = registry.new_id();
        let started_at_ms = operation_started_at_ms();
        if !registry.insert_if_kind_idle(
            operation_id.clone(),
            OperationHandle {
                kind: "submit",
                workspace: operation_workspace(&input.connection),
                started_at_ms,
                cancel,
                cancelled: cancelled.clone(),
            },
        ) {
            return Err(AppError::new(
                ErrorKind::Conflict,
                "A submit operation is already running for this workspace.",
            ));
        }
        let _ = app.emit(
            "operation-event",
            OperationEvent {
                phase: Some("apply".to_owned()),
                cancellable,
                ..operation_event(
                    &operation_id,
                    "submit",
                    OperationEventKind::Started,
                    started_at_ms,
                )
            },
        );
        let app_for_wait = app.clone();
        let registry_for_wait = registry.inner().clone();
        let id_for_wait = operation_id.clone();
        thread::spawn(move || {
            let result = p4::submit_change(
                &input.connection,
                &input.change,
                input.description.as_deref(),
                &input.mode,
            );
            let was_cancelled = cancelled.load(Ordering::Acquire);
            let (kind, message, diagnostics, read_back, submit_outcome, item_results) = match result
            {
                Ok(outcome) => {
                    let item_results = submit_item_results(&input.change, &input.mode, &outcome);
                    let kind = match outcome.terminal {
                        SubmitTerminalOutcome::Submitted => OperationEventKind::Completed,
                        SubmitTerminalOutcome::Pending if was_cancelled => {
                            OperationEventKind::Cancelled
                        }
                        SubmitTerminalOutcome::Pending => OperationEventKind::Partial,
                        SubmitTerminalOutcome::Unknown => OperationEventKind::Unknown,
                    };
                    let message = (!outcome.recovery_actions.is_empty())
                        .then(|| outcome.recovery_actions.join(" "));
                    let diagnostics = bounded_operation_diagnostics(message.as_deref());
                    let status = match outcome.terminal {
                        SubmitTerminalOutcome::Submitted | SubmitTerminalOutcome::Pending => {
                            OperationReadBackStatus::Succeeded
                        }
                        SubmitTerminalOutcome::Unknown => OperationReadBackStatus::Unknown,
                    };
                    (
                        kind,
                        message.clone(),
                        diagnostics,
                        OperationReadBack {
                            status,
                            affected_state: vec![
                                "pending_changes".to_owned(),
                                "submitted_changes".to_owned(),
                                "shelves".to_owned(),
                                "opened_files".to_owned(),
                            ],
                            message,
                        },
                        Some(outcome),
                        item_results,
                    )
                }
                Err(error) => {
                    let readback = p4::submit_readback(&input.connection, &input.change);
                    let outcome = failed_submit_outcome(&readback, &error);
                    let item_results = submit_item_results(&input.change, &input.mode, &outcome);
                    let kind = match readback.outcome {
                        SubmitTerminalOutcome::Submitted => OperationEventKind::Partial,
                        SubmitTerminalOutcome::Pending if was_cancelled => {
                            OperationEventKind::Cancelled
                        }
                        SubmitTerminalOutcome::Pending => OperationEventKind::Failed,
                        SubmitTerminalOutcome::Unknown => OperationEventKind::Unknown,
                    };
                    let message = Some(format!("{}\n{}", error.message, readback.message));
                    (
                        kind,
                        message.clone(),
                        bounded_operation_diagnostics(message.as_deref()),
                        OperationReadBack {
                            status: if matches!(readback.outcome, SubmitTerminalOutcome::Unknown) {
                                OperationReadBackStatus::Unknown
                            } else {
                                OperationReadBackStatus::Succeeded
                            },
                            affected_state: vec![
                                "pending_changes".to_owned(),
                                "submitted_changes".to_owned(),
                                "shelves".to_owned(),
                                "opened_files".to_owned(),
                            ],
                            message: Some(readback.message),
                        },
                        Some(outcome),
                        item_results,
                    )
                }
            };
            let _ = app_for_wait.emit(
                "operation-event",
                OperationEvent {
                    operation_id: id_for_wait.clone(),
                    operation_kind: "submit".to_owned(),
                    kind: kind.clone(),
                    message,
                    phase: Some("validate".to_owned()),
                    diagnostics,
                    item_results,
                    read_back,
                    submit_outcome,
                    cancellable,
                    ..operation_event(&id_for_wait, "submit", kind, started_at_ms)
                },
            );
            registry_for_wait.remove(&id_for_wait);
        });
        return Ok(operation_id);
    }
    let (path, mut command) = p4::submit_command(
        &input.connection,
        &input.change,
        input.description.as_deref(),
    )?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let started_at_ms = operation_started_at_ms();
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "submit",
            workspace: operation_workspace(&input.connection),
            started_at_ms,
            cancel,
            cancelled: cancelled.clone(),
        },
    ) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            "A submit operation is already running for this workspace.",
        ));
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            registry.remove(&operation_id);
            return Err(
                AppError::new(ErrorKind::CommandFailed, "Не удалось запустить submit.")
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
            phase: None,
            reconcile_items: None,
            retryable: false,
            ..operation_event(
                &operation_id,
                "submit",
                OperationEventKind::Started,
                started_at_ms,
            )
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
            let mut submitted_change = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                processed += 1;
                let record =
                    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&line).ok();
                if let Some(value) = record.as_ref().and_then(submitted_change_from_record) {
                    submitted_change = Some(value);
                }
                let current_path = record.and_then(|record| {
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
                        phase: None,
                        reconcile_items: None,
                        retryable: false,
                        ..operation_event(
                            &id_for_output,
                            "submit",
                            OperationEventKind::Progress,
                            started_at_ms,
                        )
                    },
                );
            }
            (processed, submitted_change)
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
        let (processed, submitted_change) = stdout_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let stderr_text = stderr_thread
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default();
        let readback_change = submitted_change.as_deref().unwrap_or(&change);
        let readback = p4::submit_readback(&connection, readback_change);
        let submit_outcome = SubmitOutcome {
            preserved_local_change: None,
            terminal: readback.outcome,
            affected_change: readback.affected_change.clone(),
            recovery_actions: readback.recovery_actions.clone(),
            steps: vec![SubmitStepResult {
                step: "submit_local".to_owned(),
                status: if success { "succeeded" } else { "failed" }.to_owned(),
                detail: (!success).then(|| readback.message.clone()),
            }],
        };
        let item_results = submit_item_results(&change, &SubmitMode::Local, &submit_outcome);
        let message = if !success && !was_cancelled {
            let detail = stderr_text.trim();
            Some(if detail.is_empty() {
                readback.message.clone()
            } else {
                format!("{detail}\n{}", readback.message)
            })
        } else if !matches!(readback.outcome, SubmitTerminalOutcome::Submitted) {
            Some(readback.message.clone())
        } else {
            None
        };
        let kind = match readback.outcome {
            SubmitTerminalOutcome::Submitted => OperationEventKind::Completed,
            SubmitTerminalOutcome::Pending if was_cancelled => OperationEventKind::Cancelled,
            SubmitTerminalOutcome::Pending if !success => OperationEventKind::Failed,
            SubmitTerminalOutcome::Pending => OperationEventKind::Partial,
            SubmitTerminalOutcome::Unknown => OperationEventKind::Unknown,
        };
        let diagnostics = bounded_operation_diagnostics(message.as_deref());
        let _ = app_for_wait.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_wait.clone(),
                operation_kind: "submit".to_owned(),
                kind: kind.clone(),
                processed,
                total_files: None,
                processed_bytes: 0,
                total_bytes: None,
                current_path: None,
                message,
                scope: None,
                scopes: None,
                phase: None,
                reconcile_items: None,
                submit_outcome: Some(submit_outcome),
                diagnostics,
                item_results,
                read_back: OperationReadBack {
                    status: match readback.outcome {
                        SubmitTerminalOutcome::Submitted | SubmitTerminalOutcome::Pending => {
                            OperationReadBackStatus::Succeeded
                        }
                        SubmitTerminalOutcome::Unknown => OperationReadBackStatus::Unknown,
                    },
                    affected_state: vec![
                        "pending_changes".to_owned(),
                        "submitted_changes".to_owned(),
                        "shelves".to_owned(),
                        "opened_files".to_owned(),
                    ],
                    message: Some(readback.message),
                },
                retryable: false,
                ..operation_event(&id_for_wait, "submit", kind, started_at_ms)
            },
        );
        registry_for_wait.remove(&id_for_wait);
    });
    Ok(operation_id)
}

#[tauri::command]
pub async fn cancel_operation(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    operation_id: String,
) -> Result<bool, AppError> {
    let Some(request) = registry.cancel(&operation_id) else {
        return Ok(false);
    };
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            message: Some(
                "Cancellation requested. Completed server mutations are not rolled back."
                    .to_owned(),
            ),
            scope: Some(request.workspace),
            ..operation_event(
                &operation_id,
                request.kind,
                OperationEventKind::CancelRequested,
                request.started_at_ms,
            )
        },
    );
    Ok(true)
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
pub async fn resolve_files(input: ResolveInput) -> Result<ResolveApplyResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::resolve_files(&input.connection, &input.depot_paths, &input.mode)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn resolve_specialized(
    input: SpecializedResolveInput,
) -> Result<ResolveApplyResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::resolve_specialized(&input.connection, &input.items, &input.mode)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn load_resolve_content(
    input: ConnectionInput,
    depot_path: String,
    roots: State<'_, WorkspaceRootRegistry>,
) -> Result<ResolveContent, AppError> {
    let root = roots.root(&input)?;
    tauri::async_runtime::spawn_blocking(move || {
        p4::load_resolve_content(&input, &root, &depot_path)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn save_resolve_result(
    input: ResolveResultInput,
    roots: State<'_, WorkspaceRootRegistry>,
) -> Result<ResolveApplyResult, AppError> {
    let root = roots.root(&input.connection)?;
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_resolve_result(
            &input.connection,
            &root,
            &input.depot_path,
            &input.local_path,
            &input.preview_token,
            &input.result,
        )
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

#[derive(Default)]
struct ReconcileProcessResult {
    success: bool,
    cancelled: bool,
    processed: u64,
    items: Vec<ReconcileItem>,
    message: Option<String>,
}

struct ReconcileProcessContext {
    app: tauri::AppHandle,
    operation_id: String,
    operation_kind: &'static str,
    phase: &'static str,
    scope: Option<String>,
    total_files: Option<u64>,
    processed_offset: u64,
    started_at_ms: u64,
}

fn reconcile_output_error(line: &str) -> Option<String> {
    let record = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(line).ok()?;
    let severity = record.get("severity").and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
    });
    let is_error = record
        .get("code")
        .and_then(|value| value.as_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("error"))
        || severity.is_some_and(|value| value >= 3);
    is_error.then(|| {
        ["data", "message"]
            .iter()
            .find_map(|key| record.get(*key).and_then(|value| value.as_str()))
            .unwrap_or("p4 reconcile failed.")
            .trim()
            .to_owned()
    })
}

fn run_reconcile_process(
    path: PathBuf,
    mut command: Command,
    cancellation: &mpsc::Receiver<()>,
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    context: ReconcileProcessContext,
) -> ReconcileProcessResult {
    if cancelled.load(Ordering::Acquire) {
        return ReconcileProcessResult {
            cancelled: true,
            ..Default::default()
        };
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return ReconcileProcessResult {
                message: Some(format!(
                    "Could not start p4 reconcile through {}: {error}",
                    path.display()
                )),
                ..Default::default()
            };
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_thread = stdout.map(|stdout| {
        thread::spawn(move || {
            let mut items = Vec::new();
            let mut seen = BTreeSet::new();
            let mut errors = Vec::new();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                if let Some(message) = reconcile_output_error(&line) {
                    errors.push(message);
                    continue;
                }
                let Some(item) = p4::parse_reconcile_output_record(&line) else {
                    continue;
                };
                if !seen.insert(item.stable_id.clone()) {
                    continue;
                }
                let processed = context.processed_offset + seen.len() as u64;
                let current_path = item
                    .local_path
                    .clone()
                    .or_else(|| Some(item.depot_path.clone()));
                items.push(item);
                let _ = context.app.emit(
                    "operation-event",
                    OperationEvent {
                        operation_id: context.operation_id.clone(),
                        operation_kind: context.operation_kind.to_owned(),
                        kind: OperationEventKind::Progress,
                        processed,
                        total_files: context.total_files,
                        processed_bytes: 0,
                        total_bytes: None,
                        current_path,
                        message: None,
                        scope: context.scope.clone(),
                        scopes: None,
                        phase: Some(context.phase.to_owned()),
                        reconcile_items: None,
                        retryable: false,
                        ..operation_event(
                            &context.operation_id,
                            context.operation_kind,
                            OperationEventKind::Progress,
                            context.started_at_ms,
                        )
                    },
                );
            }
            (items, errors)
        })
    });
    let stderr_thread = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
                .join("\n")
        })
    });
    let process_success = wait_for_process_with_cancellation(&mut child, cancellation);
    let was_cancelled = cancelled.load(Ordering::Acquire);
    let (items, errors) = stdout_thread
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr_text = stderr_thread
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let message = if process_success && errors.is_empty() {
        None
    } else {
        let detail = errors
            .into_iter()
            .chain((!stderr_text.trim().is_empty()).then(|| stderr_text.trim().to_owned()))
            .collect::<Vec<_>>()
            .join("\n");
        Some(if detail.is_empty() {
            "p4 reconcile failed.".to_owned()
        } else {
            detail
        })
    };
    ReconcileProcessResult {
        success: process_success && message.is_none(),
        cancelled: was_cancelled,
        processed: items.len() as u64,
        items,
        message,
    }
}

fn reconcile_scope(paths: &[String]) -> Option<String> {
    match paths {
        [] => None,
        [scope] => Some(scope.clone()),
        [first, rest @ ..] => Some(format!("{first} (+{} more)", rest.len())),
    }
}

#[tauri::command]
pub async fn start_reconcile_preview(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: ConnectionInput,
    scope: Option<String>,
) -> Result<String, AppError> {
    let scope = scope
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "//...".to_owned());
    let paths = vec![scope.clone()];
    let (path, command) = p4::reconcile_command(&input, None, &paths, true)?;
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let started_at_ms = operation_started_at_ms();
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "reconcile_preview",
            workspace: operation_workspace(&input),
            started_at_ms,
            cancel,
            cancelled: cancelled.clone(),
        },
    ) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            "A reconcile operation is already running.",
        ));
    }
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            operation_id: operation_id.clone(),
            operation_kind: "reconcile_preview".to_owned(),
            kind: OperationEventKind::Started,
            processed: 0,
            total_files: None,
            processed_bytes: 0,
            total_bytes: None,
            current_path: None,
            message: None,
            scope: Some(scope.clone()),
            scopes: None,
            phase: Some("scan".to_owned()),
            reconcile_items: None,
            retryable: false,
            ..operation_event(
                &operation_id,
                "reconcile_preview",
                OperationEventKind::Started,
                started_at_ms,
            )
        },
    );
    let app_for_run = app.clone();
    let registry_for_run = registry.inner().clone();
    let id_for_run = operation_id.clone();
    let input_for_run = input.clone();
    thread::spawn(move || {
        let mut result = run_reconcile_process(
            path,
            command,
            &cancellation,
            &cancelled,
            ReconcileProcessContext {
                app: app_for_run.clone(),
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile_preview",
                phase: "scan",
                scope: Some(scope.clone()),
                total_files: None,
                processed_offset: 0,
                started_at_ms,
            },
        );
        if result.success {
            let items = std::mem::take(&mut result.items);
            match p4::reconcile_preview_snapshot(&input_for_run, &scope, items) {
                Ok(items) => result.items = items,
                Err(error) => {
                    result.success = false;
                    result.message = Some(error.message);
                }
            }
        }
        let kind = if result.cancelled {
            OperationEventKind::Cancelled
        } else if result.success {
            OperationEventKind::Completed
        } else {
            OperationEventKind::Failed
        };
        let _ = app_for_run.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile_preview".to_owned(),
                kind: kind.clone(),
                processed: result.processed,
                total_files: None,
                processed_bytes: 0,
                total_bytes: None,
                current_path: None,
                message: result.message.clone(),
                scope: Some(scope),
                scopes: None,
                phase: Some("scan".to_owned()),
                reconcile_items: result.success.then_some(result.items.clone()),
                diagnostics: bounded_operation_diagnostics(result.message.as_deref()),
                read_back: OperationReadBack {
                    status: if result.success {
                        OperationReadBackStatus::Succeeded
                    } else {
                        OperationReadBackStatus::Failed
                    },
                    affected_state: vec!["reconcile_preview".to_owned()],
                    message: result.message.clone(),
                },
                retryable: false,
                ..operation_event(&id_for_run, "reconcile_preview", kind, started_at_ms)
            },
        );
        registry_for_run.remove(&id_for_run);
    });
    Ok(operation_id)
}

#[tauri::command]
pub async fn reconcile_scope_from_local_directory(
    input: ConnectionInput,
    directory: String,
) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::reconcile_scope_from_local_directory(&input, &directory)
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn start_reconcile(
    app: tauri::AppHandle,
    registry: State<'_, OperationRegistry>,
    input: crate::models::ReconcileInput,
) -> Result<String, AppError> {
    if input.items.is_empty() {
        return Err(AppError::new(
            ErrorKind::CommandFailed,
            "Select at least one reconcile candidate.",
        ));
    }
    p4::validate_reconcile_selection(&input.items)?;
    if input.preview_token.trim().is_empty()
        || input
            .items
            .iter()
            .any(|item| item.preview_token != input.preview_token)
    {
        return Err(AppError::new(
            ErrorKind::Stale,
            "Reconcile preview is stale. Refresh the preview.",
        ));
    }
    let depot_paths = input
        .items
        .iter()
        .map(|item| item.depot_path.clone())
        .collect::<Vec<_>>();
    let preview_scope = input.preview_scope.trim().to_owned();
    let (preview_path, preview_command) = p4::reconcile_command(
        &input.connection,
        None,
        std::slice::from_ref(&preview_scope),
        true,
    )?;
    let (apply_path, apply_command) =
        p4::reconcile_command(&input.connection, Some(&input.change), &depot_paths, false)?;
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (cancel, cancellation) = mpsc::channel();
    let operation_id = registry.new_id();
    let started_at_ms = operation_started_at_ms();
    let operation_scope = reconcile_scope(&depot_paths);
    let total_files = depot_paths.len() as u64;
    if !registry.insert_if_kind_idle(
        operation_id.clone(),
        OperationHandle {
            kind: "reconcile",
            workspace: operation_workspace(&input.connection),
            started_at_ms,
            cancel,
            cancelled: cancelled.clone(),
        },
    ) {
        return Err(AppError::new(
            ErrorKind::Conflict,
            "A reconcile operation is already running.",
        ));
    }
    let _ = app.emit(
        "operation-event",
        OperationEvent {
            operation_id: operation_id.clone(),
            operation_kind: "reconcile".to_owned(),
            kind: OperationEventKind::Started,
            processed: 0,
            total_files: Some(total_files),
            processed_bytes: 0,
            total_bytes: None,
            current_path: None,
            message: None,
            scope: operation_scope.clone(),
            scopes: None,
            phase: Some("validate".to_owned()),
            reconcile_items: None,
            retryable: false,
            ..operation_event(
                &operation_id,
                "reconcile",
                OperationEventKind::Started,
                started_at_ms,
            )
        },
    );
    let app_for_run = app.clone();
    let registry_for_run = registry.inner().clone();
    let id_for_run = operation_id.clone();
    thread::spawn(move || {
        let mut validation_message = None;
        let preview = run_reconcile_process(
            preview_path,
            preview_command,
            &cancellation,
            &cancelled,
            ReconcileProcessContext {
                app: app_for_run.clone(),
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile",
                phase: "validate",
                scope: operation_scope.clone(),
                total_files: Some(total_files),
                processed_offset: 0,
                started_at_ms,
            },
        );
        let validation_cancelled = preview.cancelled;
        let checked = preview.processed.min(total_files);
        if !preview.success {
            validation_message = preview.message;
        } else {
            match p4::reconcile_preview_snapshot(&input.connection, &preview_scope, preview.items) {
                Ok(fresh) => {
                    let fresh_token = fresh.first().map(|item| item.preview_token.as_str());
                    let exact_selection = input.items.iter().all(|selected| {
                        fresh
                            .iter()
                            .find(|item| item.stable_id == selected.stable_id)
                            .is_some_and(|item| item == selected)
                    });
                    if fresh_token != Some(input.preview_token.as_str()) || !exact_selection {
                        validation_message =
                            Some("Reconcile preview is stale. Refresh the preview before applying any files.".to_owned());
                    }
                }
                Err(error) => validation_message = Some(error.message),
            }
        }
        if validation_cancelled || validation_message.is_some() {
            let kind = if validation_cancelled {
                OperationEventKind::Cancelled
            } else {
                OperationEventKind::Failed
            };
            let _ = app_for_run.emit(
                "operation-event",
                OperationEvent {
                    operation_id: id_for_run.clone(),
                    operation_kind: "reconcile".to_owned(),
                    kind: kind.clone(),
                    processed: checked,
                    total_files: Some(total_files),
                    processed_bytes: 0,
                    total_bytes: None,
                    current_path: None,
                    message: validation_message.clone(),
                    scope: operation_scope,
                    scopes: None,
                    phase: Some("validate".to_owned()),
                    reconcile_items: None,
                    diagnostics: bounded_operation_diagnostics(validation_message.as_deref()),
                    read_back: OperationReadBack {
                        status: OperationReadBackStatus::NotRequired,
                        affected_state: vec!["reconcile_preview".to_owned()],
                        message: validation_message.clone(),
                    },
                    retryable: false,
                    ..operation_event(&id_for_run, "reconcile", kind, started_at_ms)
                },
            );
            registry_for_run.remove(&id_for_run);
            return;
        }
        let _ = app_for_run.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile".to_owned(),
                kind: OperationEventKind::Progress,
                processed: 0,
                total_files: Some(total_files),
                processed_bytes: 0,
                total_bytes: None,
                current_path: None,
                message: None,
                scope: operation_scope.clone(),
                scopes: None,
                phase: Some("apply".to_owned()),
                reconcile_items: None,
                retryable: false,
                ..operation_event(
                    &id_for_run,
                    "reconcile",
                    OperationEventKind::Progress,
                    started_at_ms,
                )
            },
        );
        let applied = run_reconcile_process(
            apply_path,
            apply_command,
            &cancellation,
            &cancelled,
            ReconcileProcessContext {
                app: app_for_run.clone(),
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile",
                phase: "apply",
                scope: operation_scope.clone(),
                total_files: Some(total_files),
                processed_offset: 0,
                started_at_ms,
            },
        );
        let kind = if applied.cancelled && applied.processed > 0 {
            OperationEventKind::Partial
        } else if applied.cancelled {
            OperationEventKind::Cancelled
        } else if applied.success {
            OperationEventKind::Completed
        } else if applied.processed > 0 {
            OperationEventKind::Partial
        } else {
            OperationEventKind::Failed
        };
        let item_results = applied
            .items
            .iter()
            .map(|item| OperationItemResult {
                item_id: item.depot_path.clone(),
                path: item
                    .local_path
                    .clone()
                    .or_else(|| Some(item.depot_path.clone())),
                status: if applied.success {
                    crate::models::OperationItemStatus::Succeeded
                } else {
                    crate::models::OperationItemStatus::Failed
                },
                reason: (!applied.success)
                    .then(|| applied.message.clone())
                    .flatten(),
                compensation: crate::models::OperationCompensationStatus::NotRequired,
                recovery_action_id: (!applied.success).then(|| "refresh_workspace".to_owned()),
            })
            .collect();
        let diagnostics = bounded_operation_diagnostics(applied.message.as_deref());
        let _ = app_for_run.emit(
            "operation-event",
            OperationEvent {
                operation_id: id_for_run.clone(),
                operation_kind: "reconcile".to_owned(),
                kind: kind.clone(),
                processed: applied.processed,
                total_files: Some(total_files),
                processed_bytes: 0,
                total_bytes: None,
                current_path: None,
                message: applied.message,
                scope: operation_scope,
                scopes: None,
                phase: Some("apply".to_owned()),
                reconcile_items: None,
                diagnostics,
                item_results,
                read_back: OperationReadBack {
                    status: OperationReadBackStatus::Unknown,
                    affected_state: vec![
                        "workspace_files".to_owned(),
                        "pending_changes".to_owned(),
                    ],
                    message: Some(
                        "Refresh Workspace and My Changes before another mutation.".to_owned(),
                    ),
                },
                retryable: false,
                ..operation_event(&id_for_run, "reconcile", kind, started_at_ms)
            },
        );
        registry_for_run.remove(&id_for_run);
    });
    Ok(operation_id)
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
pub async fn file_history_page(
    input: ConnectionInput,
    depot_path: String,
    limit: u32,
    cursor: Option<String>,
) -> Result<HistoryPage<FileRevision>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::file_history_page(&input, &depot_path, limit, cursor.as_deref())
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
pub async fn save_shelved_files(
    input: SaveShelvedFilesInput,
) -> Result<ChangeExportResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::save_shelved_files(
            &input.connection,
            &input.source_change,
            &input.depot_paths,
            &input.output_directory,
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
pub async fn preview_change_identity(
    input: ChangeIdentityPreflightInput,
) -> Result<ChangeIdentityPreflight, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::preview_change_identity(
            &input.connection,
            &input.change,
            &input.owner,
            &input.client,
            input.visibility,
        )
    })
    .await
    .map_err(task_error)?
}

#[tauri::command]
pub async fn update_change_identity(
    input: ChangeIdentityUpdateInput,
) -> Result<ChangeIdentityState, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        p4::update_change_identity(
            &input.connection,
            &input.change,
            &input.owner,
            &input.client,
            input.visibility,
            &input.preview_token,
        )
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
    use super::{
        WORKSPACE_SCAN_BUDGET, WorkspaceScanRegistry, WorkspaceScanRequest, WorkspaceScanScheduler,
        bounded_operation_diagnostics, confirmed_integration_paths, failed_submit_outcome,
        operation_event, operation_workspace, parse_sync_output_record, submit_item_results,
        submit_mode_cancellable, submitted_change_from_record, sync_operation_scope,
        sync_operation_succeeded, unexpected_integration_paths, validate_reveal_path,
        workspace_scan_backoff, workspace_scan_budget_exhausted, workspace_scan_path_is_excluded,
        workspace_stream_view_paths,
    };
    use crate::models::{
        AppError, ConnectionInput, ErrorKind, OpenedFile, OperationCompensationStatus,
        OperationEventKind, OperationItemStatus, P4Info, SubmitMode, SubmitOutcome, SubmitReadBack,
        SubmitStepResult, SubmitTerminalOutcome, WorkspaceScanCandidate,
        WorkspaceScanCoverageState, WorkspaceScanPartialReason, WorkspaceScanRoot,
    };
    use crate::operations::{OperationHandle, OperationRegistry};
    use std::{
        collections::BTreeSet,
        fs,
        path::PathBuf,
        process::Command,
        sync::{Arc, atomic::AtomicBool, mpsc},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

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
    fn integration_readback_uses_delta_or_command_output_and_detects_expansion() {
        let expected =
            BTreeSet::from(["//acme/dev/a.txt".to_owned(), "//acme/dev/b.txt".to_owned()]);
        let baseline = BTreeSet::from(["//acme/dev/a.txt".to_owned()]);
        let output = BTreeSet::from(["//acme/dev/a.txt".to_owned()]);
        let opened = [
            opened_file("//Acme/dev/a.txt"),
            opened_file("//Acme/dev/b.txt"),
            opened_file("//Acme/dev/unexpected.txt"),
        ];

        assert_eq!(
            confirmed_integration_paths(&expected, &baseline, &output, &opened, "123"),
            expected
        );
        assert_eq!(
            unexpected_integration_paths(&expected, &baseline, &output, &opened, "123"),
            BTreeSet::from(["//acme/dev/unexpected.txt".to_owned()])
        );
    }

    #[test]
    fn integration_readback_does_not_claim_an_unchanged_preopened_file() {
        let path = "//acme/dev/a.txt".to_owned();
        let expected = BTreeSet::from([path.clone()]);
        let baseline = BTreeSet::from([path]);
        assert!(
            confirmed_integration_paths(
                &expected,
                &baseline,
                &BTreeSet::new(),
                &[opened_file("//Acme/dev/a.txt")],
                "123",
            )
            .is_empty()
        );
    }

    #[test]
    fn integration_readback_ignores_opened_files_from_another_changelist() {
        let expected = BTreeSet::from(["//acme/dev/a.txt".to_owned()]);
        let opened = OpenedFile {
            change: "456".to_owned(),
            ..opened_file("//Acme/dev/a.txt")
        };

        assert!(
            confirmed_integration_paths(&expected, &BTreeSet::new(), &expected, &[opened], "123",)
                .is_empty()
        );
    }

    fn opened_file(path: &str) -> OpenedFile {
        OpenedFile {
            depot_path: path.to_owned(),
            client_path: None,
            action: "integrate".to_owned(),
            change: "123".to_owned(),
            revision: None,
            file_type: None,
        }
    }

    #[test]
    fn large_sync_operation_scope_stays_bounded() {
        let scopes = (0..87_246)
            .map(|index| format!("//Acme/main/{index}.bin#{index}"))
            .collect::<Vec<_>>();
        assert_eq!(
            sync_operation_scope(&scopes),
            "//Acme/main/0.bin#0 (+87245 more)"
        );
    }

    #[test]
    fn operation_diagnostics_are_structured_and_bounded() {
        let diagnostics = bounded_operation_diagnostics(Some(&"x".repeat(10_000)));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, "p4_operation");
        assert_eq!(diagnostics[0].message.chars().count(), 2048);
        assert!(bounded_operation_diagnostics(None).is_empty());
    }

    #[test]
    fn unknown_terminal_event_serializes_readback_and_disables_retry() {
        let event = operation_event("op-7", "submit", OperationEventKind::Unknown, 42);
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["kind"], "unknown");
        assert_eq!(value["startedAtMs"], 42);
        assert_eq!(value["readBack"]["status"], "not_required");
        assert_eq!(value["retryable"], false);
    }

    #[test]
    fn unknown_submit_failure_keeps_recovery_and_never_exposes_retry() {
        let readback = SubmitReadBack {
            outcome: SubmitTerminalOutcome::Unknown,
            affected_change: None,
            message: "unknown".to_owned(),
            recovery_actions: vec!["refresh and rerun preflight".to_owned()],
        };
        let outcome = failed_submit_outcome(
            &readback,
            &AppError::new(ErrorKind::Offline, "connection lost"),
        );
        let items = submit_item_results("42", &SubmitMode::Local, &outcome);

        assert_eq!(outcome.terminal, SubmitTerminalOutcome::Unknown);
        assert_eq!(outcome.recovery_actions, ["refresh and rerun preflight"]);
        assert_eq!(outcome.steps[0].status, "failed");
        assert_eq!(
            items[0].recovery_action_id.as_deref(),
            Some("refresh_changes")
        );
    }

    #[test]
    fn shelf_submit_exposes_step_and_compensation_outcomes() {
        let outcome = SubmitOutcome {
            preserved_local_change: Some("205".to_owned()),
            terminal: SubmitTerminalOutcome::Submitted,
            affected_change: Some("104".to_owned()),
            recovery_actions: Vec::new(),
            steps: vec![SubmitStepResult {
                step: "move_local_files".to_owned(),
                status: "completed".to_owned(),
                detail: None,
            }],
        };

        let results = submit_item_results("104", &SubmitMode::Shelf, &outcome);
        assert_eq!(results[0].item_id, "move_local_files");
        assert_eq!(results[0].status, OperationItemStatus::Succeeded);
        assert_eq!(
            results[0].compensation,
            OperationCompensationStatus::NotRequired
        );

        let failure_outcome = SubmitOutcome {
            steps: vec![SubmitStepResult {
                step: "submit_shelf".to_owned(),
                status: "failed".to_owned(),
                detail: Some("submit failed".to_owned()),
            }],
            ..outcome
        };
        let failure = submit_item_results("104", &SubmitMode::Shelf, &failure_outcome);
        assert_eq!(failure[0].status, OperationItemStatus::Failed);
        assert_eq!(
            failure[0].compensation,
            OperationCompensationStatus::Unknown
        );
        assert_eq!(
            failure[0].recovery_action_id.as_deref(),
            Some("refresh_changes")
        );
    }

    #[test]
    fn only_process_backed_local_submit_claims_cancellation_support() {
        assert!(submit_mode_cancellable(&SubmitMode::Local));
        assert!(!submit_mode_cancellable(&SubmitMode::Shelf));
        assert!(!submit_mode_cancellable(&SubmitMode::LocalDeleteShelf));
        assert!(!submit_mode_cancellable(&SubmitMode::LocalUpdateShelf));
    }

    #[test]
    fn submit_output_uses_only_the_server_returned_change_id() {
        let string_record = serde_json::json!({ "submittedChange": "104" });
        let number_record = serde_json::json!({ "submittedChange": 105 });
        let unrelated = serde_json::json!({ "change": "106" });
        assert_eq!(
            submitted_change_from_record(string_record.as_object().unwrap()).as_deref(),
            Some("104")
        );
        assert_eq!(
            submitted_change_from_record(number_record.as_object().unwrap()).as_deref(),
            Some("105")
        );
        assert_eq!(
            submitted_change_from_record(unrelated.as_object().unwrap()),
            None
        );
    }

    #[test]
    fn reveal_path_rejects_empty_and_multiline_values() {
        assert!(validate_reveal_path("  ").is_err());
        assert!(validate_reveal_path("C:\\work\\file.txt\nexplorer.exe").is_err());
        assert!(validate_reveal_path("C:\\work\\missing.txt").is_err());
    }

    #[test]
    fn reveal_path_requires_an_existing_file_or_directory() {
        let directory = std::env::temp_dir().join(format!(
            "p4fnv-reveal-path-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        assert_eq!(
            validate_reveal_path(directory.to_str().unwrap()).unwrap(),
            fs::canonicalize(&directory).unwrap()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn selected_workspace_directories_become_relative_stream_view_paths() {
        let fixture =
            std::env::temp_dir().join(format!("p4fnv-stream-folders-{}", std::process::id()));
        let root = fixture.join("workspace");
        let source = root.join("Source").join("Game");
        let outside = fixture.join("outside");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let paths = workspace_stream_view_paths(
            &root,
            &[
                root.to_string_lossy().into_owned(),
                source.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        assert_eq!(paths, vec!["...", "Source/Game/..."]);
        assert!(
            workspace_stream_view_paths(&root, &[outside.to_string_lossy().into_owned()]).is_err()
        );

        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn workspace_scan_reports_partial_coverage_and_resets_on_stream_change() {
        let input = ConnectionInput {
            p4_path: None,
            port: "perforce:1666".to_owned(),
            user: "alex".to_owned(),
            client: Some("alex-main".to_owned()),
            charset: None,
            p4_config: None,
            p4_enviro: None,
        };
        let registry = WorkspaceScanRegistry::default();
        registry
            .reset(
                &input,
                &P4Info {
                    client_name: Some("alex-main".to_owned()),
                    client_stream: Some("//Acme/main".to_owned()),
                    ..P4Info::default()
                },
            )
            .unwrap();
        let identity = registry.identity(&input).unwrap();
        let configured = registry
            .configure(
                &identity,
                vec![WorkspaceScanRoot {
                    local_path: r"C:\work\Source".to_owned(),
                    local_scope: r"C:\work\Source\...".to_owned(),
                    client_scope: "//alex-main/Source/...".to_owned(),
                    depot_scope: "//Acme/main/Source/...".to_owned(),
                    ignore_sources: Vec::new(),
                }],
                Vec::new(),
                vec![WorkspaceScanPartialReason::IgnoreRulesUnavailable],
            )
            .unwrap();
        assert_eq!(
            configured.coverage.state,
            WorkspaceScanCoverageState::Partial
        );
        assert_eq!(configured.coverage.total_roots, 1);
        assert!(configured.candidates.is_empty());

        let limited = registry
            .publish_results(
                &configured.scope_id,
                (0..=crate::p4::MAX_WORKSPACE_SCAN_CANDIDATES)
                    .map(|index| WorkspaceScanCandidate {
                        stable_id: format!("candidate-{index}"),
                        action: "add".to_owned(),
                        depot_path: None,
                        client_path: None,
                        local_path: format!(r"C:\work\Source\{index}.txt"),
                    })
                    .collect(),
                0,
                1,
                &[],
            )
            .unwrap();
        assert_eq!(
            limited.candidates.len(),
            crate::p4::MAX_WORKSPACE_SCAN_CANDIDATES
        );
        assert!(
            limited
                .coverage
                .partial_reasons
                .contains(&WorkspaceScanPartialReason::CandidateLimit)
        );
        assert!(
            limited
                .coverage
                .partial_reasons
                .contains(&WorkspaceScanPartialReason::RootError)
        );

        registry.reset_stream(&input, "//Acme/dev").unwrap();
        let reset = registry.get(&input).unwrap();
        assert_eq!(reset.identity.stream.as_deref(), Some("//Acme/dev"));
        assert_eq!(reset.coverage.state, WorkspaceScanCoverageState::Stale);
        assert!(reset.roots.is_empty());
        assert!(reset.candidates.is_empty());
        assert_ne!(reset.scope_id, configured.scope_id);
        assert_eq!(
            registry
                .publish_results(&configured.scope_id, Vec::new(), 0, 0, &[])
                .unwrap_err()
                .kind,
            ErrorKind::Stale
        );

        let mut other_workspace = input;
        other_workspace.client = Some("alex-release".to_owned());
        registry
            .reset(
                &other_workspace,
                &P4Info {
                    client_name: Some("alex-release".to_owned()),
                    client_stream: Some("//Acme/release".to_owned()),
                    ..P4Info::default()
                },
            )
            .unwrap();
        let workspace_reset = registry.get(&other_workspace).unwrap();
        assert_eq!(workspace_reset.identity.workspace, "alex-release");
        assert_eq!(
            workspace_reset.coverage.state,
            WorkspaceScanCoverageState::NotStarted
        );
        assert!(workspace_reset.roots.is_empty());
    }

    #[test]
    fn workspace_scan_scheduler_has_bounded_budget_backoff_and_exclusions() {
        assert!(!workspace_scan_budget_exhausted(Duration::from_millis(
            1499
        )));
        assert!(workspace_scan_budget_exhausted(Duration::from_millis(1500)));
        assert_eq!(workspace_scan_backoff(1), Duration::from_secs(1));
        assert_eq!(workspace_scan_backoff(2), Duration::from_secs(2));
        assert_eq!(workspace_scan_backoff(99), Duration::from_secs(60));
        assert!(workspace_scan_path_is_excluded(
            r"C:\work\Generated\a.txt",
            &[r"c:\WORK\generated".to_owned()]
        ));
        assert!(!workspace_scan_path_is_excluded(
            r"C:\work\Source\a.txt",
            &[r"C:\work\Generated".to_owned()]
        ));
        assert!(!workspace_scan_path_is_excluded(
            r"C:\work\GeneratedFiles\a.txt",
            &[r"C:\work\Generated".to_owned()]
        ));
    }

    #[test]
    fn workspace_scan_scheduler_yields_to_foreground_and_cancels_pending_retry() {
        let input = ConnectionInput {
            p4_path: None,
            port: "perforce:1666".to_owned(),
            user: "alex".to_owned(),
            client: Some("alex-main".to_owned()),
            charset: None,
            p4_config: None,
            p4_enviro: None,
        };
        let scans = WorkspaceScanRegistry::default();
        scans
            .reset(
                &input,
                &P4Info {
                    client_name: Some("alex-main".to_owned()),
                    client_stream: Some("//Acme/main".to_owned()),
                    ..P4Info::default()
                },
            )
            .unwrap();
        let identity = scans.identity(&input).unwrap();
        let configured = scans
            .configure(
                &identity,
                vec![WorkspaceScanRoot {
                    local_path: r"C:\work\Source".to_owned(),
                    local_scope: r"C:\work\Source\...".to_owned(),
                    client_scope: "//alex-main/Source/...".to_owned(),
                    depot_scope: "//Acme/main/Source/...".to_owned(),
                    ignore_sources: Vec::new(),
                }],
                Vec::new(),
                Vec::new(),
            )
            .unwrap();
        let operations = OperationRegistry::default();
        let (cancel, _) = mpsc::channel();
        assert!(operations.insert_if_kind_idle(
            "op-foreground".to_owned(),
            OperationHandle {
                kind: "sync",
                workspace: operation_workspace(&input),
                started_at_ms: 42,
                cancel,
                cancelled: Arc::new(AtomicBool::new(false)),
            }
        ));
        let scheduler = WorkspaceScanScheduler::new(scans.clone(), operations.clone());
        scheduler
            .schedule(
                WorkspaceScanRequest::new(input.clone(), PathBuf::from(r"C:\work"), &configured),
                Duration::ZERO,
            )
            .unwrap();
        for _ in 0..50 {
            if scans
                .get(&input)
                .is_ok_and(|snapshot| snapshot.coverage.state == WorkspaceScanCoverageState::Paused)
            {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let paused = scans.get(&input).unwrap();
        assert_eq!(paused.coverage.state, WorkspaceScanCoverageState::Paused);
        assert!(
            paused
                .coverage
                .partial_reasons
                .contains(&WorkspaceScanPartialReason::ForegroundActive)
        );
        scheduler.cancel_and_wait().unwrap();
        operations.remove("op-foreground");
        assert!(
            scans
                .get(&input)
                .unwrap()
                .coverage
                .partial_reasons
                .contains(&WorkspaceScanPartialReason::Cancelled)
        );
    }

    #[test]
    fn workspace_scan_budget_and_cancel_kill_the_active_child() {
        let sleeping_command = || {
            let mut command = Command::new(std::env::current_exe().unwrap());
            command.args([
                "commands::tests::workspace_scan_sleeping_child_fixture",
                "--ignored",
                "--exact",
            ]);
            command
        };
        let operations = OperationRegistry::default();
        let (_sender, receiver) = mpsc::channel();
        assert!(matches!(
            super::run_workspace_scan_child(
                sleeping_command(),
                crate::p4::parse_workspace_scan_output,
                &receiver,
                &operations,
                "server/alex/main",
                Instant::now() - WORKSPACE_SCAN_BUDGET,
            ),
            super::WorkspaceScanChildOutcome::Budget
        ));

        let (sender, receiver) = mpsc::channel();
        let (acknowledge, _acknowledged) = mpsc::channel();
        sender
            .send(super::WorkspaceScanSchedulerMessage::Cancel(acknowledge))
            .unwrap();
        assert!(matches!(
            super::run_workspace_scan_child(
                sleeping_command(),
                crate::p4::parse_workspace_scan_output,
                &receiver,
                &operations,
                "server/alex/main",
                Instant::now(),
            ),
            super::WorkspaceScanChildOutcome::Message(
                super::WorkspaceScanSchedulerMessage::Cancel(_)
            )
        ));
    }

    #[test]
    fn workspace_scan_active_child_yields_to_new_foreground_work() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args([
            "commands::tests::workspace_scan_sleeping_child_fixture",
            "--ignored",
            "--exact",
        ]);
        let operations = OperationRegistry::default();
        let foreground_operations = operations.clone();
        let foreground = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            let (cancel, _) = mpsc::channel();
            assert!(foreground_operations.insert_if_kind_idle(
                "op-foreground".to_owned(),
                OperationHandle {
                    kind: "sync",
                    workspace: "server/alex/main".to_owned(),
                    started_at_ms: 42,
                    cancel,
                    cancelled: Arc::new(AtomicBool::new(false)),
                }
            ));
        });
        let (_sender, receiver) = mpsc::channel();

        assert!(matches!(
            super::run_workspace_scan_child(
                command,
                crate::p4::parse_workspace_scan_output,
                &receiver,
                &operations,
                "server/alex/main",
                Instant::now(),
            ),
            super::WorkspaceScanChildOutcome::Foreground
        ));
        foreground.join().unwrap();
        operations.remove("op-foreground");
    }

    #[test]
    #[ignore]
    fn workspace_scan_sleeping_child_fixture() {
        thread::sleep(Duration::from_secs(10));
    }
}
