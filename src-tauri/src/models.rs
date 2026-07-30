use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    ExecutableNotFound,
    Auth,
    Trust,
    Permission,
    Conflict,
    Offline,
    Timeout,
    UnsupportedCapability,
    ServerLimit,
    Cancelled,
    Stale,
    PartialResult,
    InvalidOutput,
    Settings,
    CommandFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub hints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliLogLevel {
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliLogEntry {
    pub id: u64,
    pub level: CliLogLevel,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    pub timestamp_ms: u64,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            hints: Vec::new(),
            diagnostics: None,
        }
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hints.push(hint.into());
        self
    }

    pub fn with_diagnostics(mut self, diagnostics: impl Into<String>) -> Self {
        let diagnostics = diagnostics.into();
        if !diagnostics.trim().is_empty() {
            self.diagnostics = Some(diagnostics);
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct P4Detection {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub logged_in: bool,
    pub expires_in_minutes: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityState {
    Supported,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityEvidence {
    Client,
    Server,
    Workspace,
    Topology,
    Permission,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFact {
    pub state: CapabilityState,
    pub reason: String,
    pub evidence: CapabilityEvidence,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Stream,
    Classic,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_services: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unicode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_handling: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<String>,
    pub workspace_kind: WorkspaceKind,
    pub depot_modes: Vec<String>,
    pub commands: BTreeMap<String, CapabilityFact>,
    pub facts: BTreeMap<String, CapabilityFact>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustChallenge {
    pub server: String,
    pub presented_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_fingerprint: Option<String>,
    pub reason: TrustReason,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustReason {
    New,
    Changed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthStageKind {
    PasswordRequired,
    MethodSelection,
    SecondFactor,
    ExternalBrowser,
    Waiting,
    Success,
    Expired,
    Cancelled,
    Failed,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthStage {
    pub kind: AuthStageKind,
    pub methods: Vec<String>,
    pub polling_attempt: u8,
    pub max_polling_attempts: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub p4_path: Option<String>,
    pub port: String,
    pub user: String,
    pub client: Option<String>,
    pub charset: Option<String>,
    #[serde(default)]
    pub p4_config: Option<String>,
    #[serde(default)]
    pub p4_enviro: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub language: String,
    pub theme: ThemeMode,
    pub recent_connections: Vec<ConnectionInput>,
    pub favorite_connections: Vec<ConnectionInput>,
    pub delete_added_files_on_revert: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "en".to_owned(),
            theme: ThemeMode::System,
            recent_connections: Vec::new(),
            favorite_connections: Vec::new(),
            delete_added_files_on_revert: false,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleBundle {
    pub code: String,
    pub name: String,
    pub translations: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleCatalog {
    pub locales: Vec<LocaleBundle>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct P4Info {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unicode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_handling: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_services: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<CapabilitySnapshot>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub name: String,
    pub owner: String,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSpec {
    pub name: String,
    pub owner: String,
    pub root: String,
    pub host: Option<String>,
    pub stream: Option<String>,
    pub description: String,
    pub options: Vec<String>,
    pub submit_options: Option<String>,
    pub line_end: Option<String>,
    pub alt_roots: Vec<String>,
    pub change_view: Vec<String>,
    pub workspace_type: String,
    pub server_id: Option<String>,
    pub mappings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamSummary {
    pub path: String,
    pub name: String,
    pub parent: Option<String>,
    pub stream_type: String,
    pub description: String,
    pub owner: Option<String>,
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamHistoryEntry {
    pub revision: String,
    pub action: String,
    pub change: Option<String>,
    pub user: Option<String>,
    pub time: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamIntegrationHint {
    pub direction: StreamIntegrationDirection,
    pub state: CapabilityState,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamDetail {
    pub stream: StreamSummary,
    pub parent_view: String,
    pub options: Vec<String>,
    pub paths: Vec<String>,
    pub remapped: Vec<String>,
    pub ignored: Vec<String>,
    pub history: Vec<StreamHistoryEntry>,
    pub hints: Vec<StreamIntegrationHint>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum StreamIntegrationDirection {
    MergeDown,
    CopyUp,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamIntegrationInput {
    pub connection: ConnectionInput,
    pub direction: StreamIntegrationDirection,
    pub source_stream: String,
    pub target_stream: String,
    pub target_change: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct StreamIntegrationPreviewItem {
    pub source_path: String,
    pub target_path: String,
    pub local_path: Option<String>,
    pub action: String,
    pub source_start_revision: Option<String>,
    pub source_end_revision: Option<String>,
    pub resolve_type: Option<String>,
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamIntegrationPreview {
    pub identity: String,
    pub direction: StreamIntegrationDirection,
    pub source_stream: String,
    pub target_stream: String,
    pub target_workspace: String,
    pub target_change: String,
    pub revision_scope: String,
    pub items: Vec<StreamIntegrationPreviewItem>,
    pub warnings: Vec<String>,
    pub truncated: bool,
    pub partial: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CreateStreamType {
    Development,
    Release,
    Virtual,
    Task,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamPathKind {
    Share,
    Isolate,
    Import,
    Exclude,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamPathRuleInput {
    pub kind: StreamPathKind,
    pub view_path: String,
    pub depot_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateStreamInput {
    pub connection: ConnectionInput,
    pub name: String,
    pub parent: String,
    pub stream_type: CreateStreamType,
    pub description: String,
    pub paths: Vec<StreamPathRuleInput>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateStreamPreview {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub stream_type: String,
    pub description: String,
    pub parent_view: String,
    pub options: String,
    pub paths: Vec<String>,
    pub spec: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamLocalStrategy {
    Shelve,
    Keep,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchStreamInput {
    pub connection: ConnectionInput,
    pub stream: String,
    pub local_strategy: StreamLocalStrategy,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdateInput {
    pub connection: ConnectionInput,
    pub name: String,
    pub root: String,
    pub stream: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateInput {
    pub connection: ConnectionInput,
    pub name: String,
    pub root: String,
    pub stream: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DepotDirectory {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DepotSummary {
    pub name: String,
    pub path: String,
    pub depot_type: String,
    pub description: String,
    pub date: Option<String>,
    pub map: Option<String>,
    pub stream_depth: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DepotFile {
    pub depot_path: String,
    pub revision: Option<String>,
    pub action: Option<String>,
    pub change: Option<String>,
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustEntry {
    pub server: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationEventKind {
    Started,
    Progress,
    CancelRequested,
    Completed,
    Failed,
    Cancelled,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum OperationItemStatus {
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum OperationCompensationStatus {
    NotRequired,
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationReadBackStatus {
    Succeeded,
    Failed,
    NotRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationItemResult {
    pub item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub status: OperationItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub compensation: OperationCompensationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_action_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationReadBack {
    pub status: OperationReadBackStatus,
    pub affected_state: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationEvent {
    pub operation_id: String,
    pub operation_kind: String,
    pub kind: OperationEventKind,
    pub started_at_ms: u64,
    pub processed: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_files: Option<u64>,
    pub processed_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    pub current_path: Option<String>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconcile_items: Option<Vec<ReconcileItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submit_outcome: Option<SubmitOutcome>,
    pub diagnostics: Vec<OperationDiagnostic>,
    pub item_results: Vec<OperationItemResult>,
    pub read_back: OperationReadBack,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingChange {
    pub id: String,
    pub description: String,
    pub user: String,
    pub client: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub status: Option<String>,
    pub user: Option<String>,
    pub date: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub owner: Option<String>,
    pub update: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub job: String,
    pub change: String,
    pub date: Option<String>,
    pub user: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub depot_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_path: Option<String>,
    pub action: String,
    pub change: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub depot_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub have_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    pub mapped: bool,
    pub other_open: bool,
    pub other_lock: bool,
    pub unresolved: bool,
    pub untracked: bool,
    pub ignored: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLocalBatch {
    pub directories: Vec<String>,
    pub ignored_directories: Vec<String>,
    pub files: Vec<WorkspaceFile>,
    pub completed_directories: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMappingState {
    Mapped,
    Unmapped,
    Excluded,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMapping {
    pub query: String,
    pub state: WorkspaceMappingState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depot_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMappingBatch {
    pub mappings: Vec<WorkspaceMapping>,
    pub partial: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreviewItem {
    pub depot_path: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    pub items: Vec<SyncPreviewItem>,
    pub total_bytes: u64,
    pub modified_files: Vec<String>,
    pub writable_files: Vec<String>,
    pub missing_have_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileItem {
    pub stable_id: String,
    pub preview_token: String,
    pub depot_path: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    pub mapping_state: WorkspaceMappingState,
    pub ignored: bool,
    pub unsafe_item: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_partner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePreviewItem {
    pub depot_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub conflict_kind: ResolveConflictKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_identifier: Option<String>,
    pub workspace_identifier: String,
    pub allowed_actions: Vec<ResolveMode>,
    pub read_back: ResolveReadBackState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolveConflictKind {
    Text,
    Binary,
    MoveName,
    FiletypeAttribute,
    StreamSpec,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolveReadBackState {
    Pending,
    Resolved,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApplyItem {
    pub depot_path: String,
    pub state: ResolveReadBackState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApplyResult {
    pub items: Vec<ResolveApplyItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveContentSide {
    pub identifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveContent {
    pub depot_path: String,
    pub local_path: String,
    pub preview_token: String,
    pub base: ResolveContentSide,
    pub source: ResolveContentSide,
    pub workspace: ResolveContentSide,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertPreviewItem {
    pub depot_path: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelvedFile {
    pub depot_path: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationLine {
    pub change: String,
    pub user: Option<String>,
    pub date: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    pub revision: String,
    pub change: String,
    pub action: String,
    pub user: String,
    pub time: Option<String>,
    pub file_type: Option<String>,
    pub client: Option<String>,
    pub size: Option<String>,
    pub description: Option<String>,
    pub integrations: Vec<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedFile {
    pub depot_path: String,
    pub action: String,
    pub revision: Option<String>,
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedChangeDetail {
    pub id: String,
    pub description: String,
    pub user: String,
    pub client: String,
    pub time: Option<String>,
    pub jobs: Vec<String>,
    pub files: Vec<SubmittedFile>,
    pub files_truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedFilterOptions {
    pub users: Vec<String>,
    pub clients: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickPreviewItem {
    pub source_path: String,
    pub target_path: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeExportResult {
    pub saved_files: u32,
    pub skipped_files: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoPreviewItem {
    pub depot_path: String,
    pub action: String,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReopenInput {
    pub connection: ConnectionInput,
    pub depot_paths: Vec<String>,
    pub target_change: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffInput {
    pub connection: ConnectionInput,
    pub depot_path: String,
    #[serde(default)]
    pub mode: DiffMode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveRevisionInput {
    pub connection: ConnectionInput,
    pub depot_path: String,
    pub revision: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveChangeFilesInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub output_directory: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveShelvedInput {
    pub connection: ConnectionInput,
    pub source_change: String,
    pub depot_path: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffMode {
    #[default]
    Default,
    IgnoreWhitespaceChanges,
    IgnoreWhitespace,
    IgnoreLineEndings,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFilesInput {
    pub connection: ConnectionInput,
    pub change: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfDiffInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub depot_path: String,
    #[serde(default)]
    pub against_local: bool,
    #[serde(default)]
    pub mode: DiffMode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubmitMode {
    Local,
    Shelf,
    LocalDeleteShelf,
    LocalUpdateShelf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preserved_local_change: Option<String>,
    pub terminal: SubmitTerminalOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_change: Option<String>,
    pub recovery_actions: Vec<String>,
    pub steps: Vec<SubmitStepResult>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubmitTerminalOutcome {
    Submitted,
    Pending,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitStepResult {
    pub step: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitReadBack {
    pub outcome: SubmitTerminalOutcome,
    pub affected_change: Option<String>,
    pub message: String,
    pub recovery_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPreflightIssue {
    pub depot_path: String,
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPreflightJob {
    pub id: String,
    pub date: Option<String>,
    pub user: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPreflightSummary {
    pub issues: Vec<SubmitPreflightIssue>,
    pub jobs: Vec<String>,
    pub job_details: Vec<SubmitPreflightJob>,
    pub warnings: Vec<String>,
    pub total_size: u64,
    pub stream: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub description: Option<String>,
    pub mode: SubmitMode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShelveInput {
    pub connection: ConnectionInput,
    pub change: String,
    #[serde(default)]
    pub depot_paths: Vec<String>,
    #[serde(default)]
    pub replace_all: bool,
    #[serde(default)]
    pub revert_after: bool,
    #[serde(default)]
    pub delete_added_files: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnshelveInput {
    pub connection: ConnectionInput,
    pub source_change: String,
    pub target_change: String,
    #[serde(default)]
    pub depot_paths: Vec<String>,
    #[serde(default)]
    pub force_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReshelveInput {
    pub connection: ConnectionInput,
    pub source_change: String,
    pub target_change: String,
    #[serde(default)]
    pub depot_paths: Vec<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewUnshelveInput {
    pub connection: ConnectionInput,
    pub source_change: String,
    #[serde(default)]
    pub depot_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnshelveConflict {
    pub depot_path: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnshelvePreview {
    pub conflicts: Vec<UnshelveConflict>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteShelfInput {
    pub connection: ConnectionInput,
    pub change: String,
    #[serde(default)]
    pub depot_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub depot_paths: Vec<String>,
    #[serde(default)]
    pub delete_added_files: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditChangeInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteChangeInput {
    pub connection: ConnectionInput,
    pub change: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateChangeInput {
    pub connection: ConnectionInput,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub depot_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveInput {
    pub connection: ConnectionInput,
    pub depot_paths: Vec<String>,
    pub mode: ResolveMode,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResultInput {
    pub connection: ConnectionInput,
    pub depot_path: String,
    pub local_path: String,
    pub preview_token: String,
    pub result: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoveInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResolveMode {
    Yours,
    Theirs,
    AutoSafe,
    AutoMerge,
    EditResult,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileInput {
    pub connection: ConnectionInput,
    pub change: String,
    pub preview_scope: String,
    pub preview_token: String,
    #[serde(default)]
    pub items: Vec<ReconcileItem>,
}
