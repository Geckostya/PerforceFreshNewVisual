import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppSettings,
  CliLogEntry,
  ConnectionInput,
  FileDiff,
  AnnotationLine,
  DiffMode,
  FileRevision,
  HistoryPage,
  LocaleCatalog,
  OpenedFile,
  P4Detection,
  P4Info,
  LoginStatus,
  PendingChange,
  Job,
  Label,
  Fix,
  ShelvedFile,
  SubmitMode,
  SubmitPreflightSummary,
  SubmittedChangeDetail,
  SubmittedFilterOptions,
  ChangeExportResult,
  ChangeIdentityPreflight,
  ChangeIdentityState,
  ChangeVisibility,
  CherryPickPreviewItem,
  UndoPreviewItem,
  UnshelvePreview,
  WorkspaceSummary,
  WorkspaceSpec,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
  DepotDirectory,
  DepotFile,
  DepotStateComparison,
  DepotSummary,
  TrustEntry,
  TrustChallenge,
  AuthStage,
  ThemeMode,
  SyncPreview,
  WorkspaceFile,
  WorkspaceLocalBatch,
  WorkspaceMappingBatch,
  ReconcileItem,
  ResolvePreviewItem,
  ResolveApplyResult,
  ResolveContent,
  RevertPreviewItem,
  ResolveMode,
  StreamLocalStrategy,
  StreamSummary,
  StreamDetail,
  StreamIntegrationInput,
  StreamIntegrationPreview,
  CreateStreamInput,
  CreateStreamPreview,
  UiAgentCommand,
  UiAgentResponse,
  UiSnapshot,
} from "./models";

const fallbackError: AppError = {
  kind: "command_failed",
  message: "The operation failed.",
  hints: [],
};

export async function detectP4(p4Path?: string): Promise<P4Detection> {
  return invoke<P4Detection>("detect_p4", { p4Path });
}

export async function testConnection(input: ConnectionInput): Promise<P4Info> {
  return invoke<P4Info>("test_connection", { input });
}

export async function openWorkspace(input: ConnectionInput): Promise<P4Info> {
  return invoke<P4Info>("open_workspace", { input });
}

export async function login(input: ConnectionInput, password: string): Promise<void> {
  return invoke("login", { input, password });
}

export async function beginAuth(input: ConnectionInput): Promise<AuthStage> {
  return invoke<AuthStage>("begin_auth", { input });
}

export async function selectAuthMethod(input: ConnectionInput, method: string): Promise<AuthStage> {
  return invoke<AuthStage>("select_auth_method", { input, method });
}

export async function checkAuth(input: ConnectionInput, response: string | undefined, pollingAttempt: number): Promise<AuthStage> {
  return invoke<AuthStage>("check_auth", { input, response, pollingAttempt });
}

export async function loginStatus(input: ConnectionInput): Promise<LoginStatus> {
  return invoke<LoginStatus>("login_status", { input });
}

export async function logout(input: ConnectionInput): Promise<void> {
  return invoke("logout", { input });
}

export async function revealPath(path: string): Promise<void> {
  return invoke("reveal_path", { path });
}

export async function listTrust(input: ConnectionInput): Promise<TrustEntry[]> {
  return invoke<TrustEntry[]>("list_trust", { input });
}

export async function inspectTrust(input: ConnectionInput): Promise<TrustChallenge> {
  return invoke<TrustChallenge>("inspect_trust", { input });
}

export async function confirmTrust(input: ConnectionInput, fingerprint: string): Promise<TrustEntry> {
  return invoke<TrustEntry>("confirm_trust", { input, fingerprint });
}

export async function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_settings");
}

export async function saveLanguage(language: string): Promise<void> {
  return invoke("save_language", { language });
}

export async function saveTheme(theme: ThemeMode): Promise<void> {
  return invoke("save_theme", { theme });
}

export async function saveRevertPreference(deleteAddedFiles: boolean): Promise<void> {
  return invoke("save_revert_preference", { deleteAddedFiles });
}

export async function loadLocales(): Promise<LocaleCatalog> {
  return invoke<LocaleCatalog>("load_locales");
}

export async function rememberConnection(input: ConnectionInput): Promise<AppSettings> {
  return invoke<AppSettings>("remember_connection", { input });
}

export async function toggleFavoriteConnection(input: ConnectionInput): Promise<AppSettings> {
  return invoke<AppSettings>("toggle_favorite_connection", { input });
}

export async function listWorkspaces(input: ConnectionInput): Promise<WorkspaceSummary[]> {
  return invoke<WorkspaceSummary[]>("list_workspaces", { input });
}

export async function inspectWorkspace(input: ConnectionInput): Promise<WorkspaceSpec> {
  return invoke<WorkspaceSpec>("inspect_workspace", { input });
}

export async function updateWorkspace(connection: ConnectionInput, update: WorkspaceUpdateInput): Promise<void> {
  return invoke("update_workspace", { input: { connection, ...update } });
}

export async function createWorkspace(connection: ConnectionInput, create: WorkspaceCreateInput): Promise<void> {
  return invoke("create_workspace", { input: { connection, ...create } });
}

export async function deleteWorkspace(connection: ConnectionInput, name: string): Promise<void> {
  return invoke("delete_workspace", { input: connection, name });
}

export async function renameWorkspace(connection: ConnectionInput, from: string, to: string): Promise<void> {
  return invoke("rename_workspace", { input: connection, from, to });
}

export async function listStreams(input: ConnectionInput): Promise<StreamSummary[]> {
  return invoke<StreamSummary[]>("list_streams", { input });
}

export async function inspectStream(input: ConnectionInput, streamPath: string): Promise<StreamDetail> {
  return invoke<StreamDetail>("inspect_stream", { input, streamPath });
}

export async function previewStreamIntegration(input: StreamIntegrationInput): Promise<StreamIntegrationPreview> {
  return invoke<StreamIntegrationPreview>("preview_stream_integration", { input });
}

export async function startStreamIntegration(input: StreamIntegrationInput, previewIdentity: string): Promise<string> {
  return invoke<string>("start_stream_integration", { input, previewIdentity });
}

export async function previewCreateStream(input: CreateStreamInput): Promise<CreateStreamPreview> {
  return invoke<CreateStreamPreview>("preview_create_stream", { input });
}

export async function createStream(input: CreateStreamInput): Promise<StreamSummary> {
  return invoke<StreamSummary>("create_stream", { input });
}

export async function streamViewPathsFromLocalDirectories(input: ConnectionInput, directories: string[]): Promise<string[]> {
  return invoke<string[]>("stream_view_paths_from_local_directories", { input, directories });
}

export async function switchStream(connection: ConnectionInput, stream: string, localStrategy: StreamLocalStrategy): Promise<void> {
  return invoke("switch_stream", { input: { connection, stream, localStrategy } });
}

export async function listDepotDirectories(input: ConnectionInput, scope: string): Promise<DepotDirectory[]> {
  return invoke<DepotDirectory[]>("list_depot_directories", { input, scope });
}

export async function listDepots(input: ConnectionInput): Promise<DepotSummary[]> {
  return invoke<DepotSummary[]>("list_depots", { input });
}

export async function listDepotFiles(input: ConnectionInput, scope: string, includeDeleted = false): Promise<DepotFile[]> {
  return invoke<DepotFile[]>("list_depot_files", { input, scope, includeDeleted });
}

export async function compareDepotStates(input: ConnectionInput, scope: string, baseChange: string, targetChange?: string): Promise<DepotStateComparison> {
  return invoke<DepotStateComparison>("compare_depot_states", { input, scope, baseChange, targetChange });
}

export async function listPendingChanges(input: ConnectionInput): Promise<PendingChange[]> {
  return invoke<PendingChange[]>("list_pending_changes", { input });
}

export async function listJobs(input: ConnectionInput, search?: string): Promise<Job[]> {
  return invoke<Job[]>("list_jobs", { input, search });
}

export async function listLabels(input: ConnectionInput, search?: string): Promise<Label[]> {
  return invoke<Label[]>("list_labels", { input, search });
}

export async function listFixes(input: ConnectionInput, job: string): Promise<Fix[]> {
  return invoke<Fix[]>("list_fixes", { input, job });
}

export async function fixJob(input: ConnectionInput, change: string, job: string): Promise<Fix[]> {
  return invoke<Fix[]>("fix_job", { input, change, job });
}

export async function unfixJob(input: ConnectionInput, change: string, job: string): Promise<Fix[]> {
  return invoke<Fix[]>("unfix_job", { input, change, job });
}

export async function listSubmittedChanges(input: ConnectionInput, scope: string, limit = 100, job?: string, user?: string, client?: string, includeStreams = false): Promise<PendingChange[]> {
  return invoke<PendingChange[]>("list_submitted_changes", {
    input,
    scope,
    limit,
    job: job?.trim() || undefined,
    user: user?.trim() || undefined,
    client: client?.trim() || undefined,
    includeStreams,
  });
}

export async function listSubmittedHistoryPage(input: ConnectionInput, scope: string, limit = 100, cursor?: string, job?: string, user?: string, client?: string, includeStreams = false): Promise<HistoryPage<PendingChange>> {
  return invoke<HistoryPage<PendingChange>>("list_submitted_history_page", { request: { connection: input, scope, limit, cursor, job: job?.trim() || undefined, user: user?.trim() || undefined, client: client?.trim() || undefined, includeStreams } });
}

export async function listSubmittedFilterOptions(input: ConnectionInput): Promise<SubmittedFilterOptions> {
  return invoke<SubmittedFilterOptions>("list_submitted_filter_options", { input });
}

export async function describeChange(input: ConnectionInput, change: string, maxFiles?: number): Promise<SubmittedChangeDetail> {
  return invoke<SubmittedChangeDetail>("describe_change", { input, change, maxFiles });
}

export async function previewUndo(input: ConnectionInput, sourceChange: string): Promise<UndoPreviewItem[]> {
  return invoke<UndoPreviewItem[]>("preview_undo", { input, sourceChange });
}

export async function undoChange(input: ConnectionInput, sourceChange: string, targetChange: string): Promise<void> {
  return invoke("undo_change", { input, sourceChange, targetChange });
}

export async function previewCherryPick(input: ConnectionInput, sourceChange: string, sourceStream: string, targetStream: string, targetChange: string): Promise<CherryPickPreviewItem[]> {
  return invoke<CherryPickPreviewItem[]>("preview_cherry_pick", { input, sourceChange, sourceStream, targetStream, targetChange });
}

export async function cherryPickChange(input: ConnectionInput, sourceChange: string, sourceStream: string, targetStream: string, targetChange: string): Promise<void> {
  return invoke("cherry_pick_change", { input, sourceChange, sourceStream, targetStream, targetChange });
}

export async function listShelvedChanges(input: ConnectionInput): Promise<PendingChange[]> {
  return invoke<PendingChange[]>("list_shelved_changes", { input });
}

export async function listOpenedFiles(input: ConnectionInput): Promise<OpenedFile[]> {
  return invoke<OpenedFile[]>("list_opened_files", { input });
}

export async function listWorkspaceFiles(input: ConnectionInput, scope?: string, includeUntracked = false): Promise<WorkspaceFile[]> {
  return invoke<WorkspaceFile[]>("list_workspace_files", { input, scope, includeUntracked });
}

export async function mapWorkspacePaths(input: ConnectionInput, paths: string[]): Promise<WorkspaceMappingBatch> {
  return invoke<WorkspaceMappingBatch>("map_workspace_paths", { input, paths });
}

export async function listLocalWorkspaceDirectory(input: ConnectionInput, directory: string): Promise<WorkspaceLocalBatch> {
  return invoke<WorkspaceLocalBatch>("list_local_workspace_directory", { input, directory });
}

export async function previewSync(input: ConnectionInput, scopes: string[]): Promise<SyncPreview> {
  return invoke<SyncPreview>("preview_sync", { input, scopes });
}

export async function repairSyncHaveList(input: ConnectionInput, paths: string[]): Promise<void> {
  return invoke("repair_sync_have_list", { input, paths });
}

export async function startSync(input: ConnectionInput, scopes: string[], force = false): Promise<string> {
  return invoke<string>("start_sync", { input, scopes, force });
}

export async function cancelOperation(operationId: string): Promise<boolean> {
  return invoke<boolean>("cancel_operation", { operationId });
}

export async function editFiles(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<void> {
  return invoke("edit_files", { input: { connection, change, depotPaths } });
}

export async function addFiles(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<void> {
  return invoke("add_files", { input: { connection, change, depotPaths } });
}

export async function deleteFiles(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<void> {
  return invoke("delete_files", { input: { connection, change, depotPaths } });
}

export async function ignoreLocalFile(input: ConnectionInput, localPath: string): Promise<void> {
  return invoke("ignore_local_file", { input, localPath });
}

export async function deleteLocalFile(input: ConnectionInput, localPath: string): Promise<void> {
  return invoke("delete_local_file", { input, localPath });
}

export async function lockFiles(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<void> {
  return invoke("lock_files", { input: { connection, change, depotPaths } });
}

export async function unlockFiles(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<void> {
  return invoke("unlock_files", { input: { connection, change, depotPaths } });
}

export async function resolveFiles(connection: ConnectionInput, depotPaths: string[], mode: ResolveMode): Promise<ResolveApplyResult> {
  return invoke<ResolveApplyResult>("resolve_files", { input: { connection, depotPaths, mode } });
}

export async function resolveSpecialized(connection: ConnectionInput, items: ResolvePreviewItem[], mode: ResolveMode): Promise<ResolveApplyResult> {
  return invoke<ResolveApplyResult>("resolve_specialized", {
    input: {
      connection,
      items: items.map(({ depotPath, previewToken, scope }) => ({ depotPath, previewToken, scope })),
      mode,
    },
  });
}

export async function previewResolve(connection: ConnectionInput, depotPaths: string[]): Promise<ResolvePreviewItem[]> {
  return invoke<ResolvePreviewItem[]>("preview_resolve", { input: connection, depotPaths });
}

export async function loadResolveContent(connection: ConnectionInput, depotPath: string): Promise<ResolveContent> {
  return invoke<ResolveContent>("load_resolve_content", { input: connection, depotPath });
}

export async function saveResolveResult(connection: ConnectionInput, depotPath: string, localPath: string, previewToken: string, result: string): Promise<ResolveApplyResult> {
  return invoke<ResolveApplyResult>("save_resolve_result", { input: { connection, depotPath, localPath, previewToken, result } });
}

export async function moveFile(connection: ConnectionInput, change: string, source: string, destination: string): Promise<void> {
  return invoke("move_file", { input: { connection, change, source, destination } });
}

export async function startReconcile(connection: ConnectionInput, change: string, previewScope: string, items: ReconcileItem[]): Promise<string> {
  return invoke<string>("start_reconcile", {
    input: { connection, change, previewScope, previewToken: items[0]?.previewToken || "", items },
  });
}

export async function startReconcilePreview(input: ConnectionInput, scope?: string): Promise<string> {
  return invoke<string>("start_reconcile_preview", { input, scope });
}

export async function listShelvedFiles(
  connection: ConnectionInput,
  change: string,
): Promise<ShelvedFile[]> {
  return invoke<ShelvedFile[]>("list_shelved_files", { input: { connection, change } });
}

export async function reopenFiles(
  connection: ConnectionInput,
  depotPaths: string[],
  targetChange: string,
): Promise<void> {
  return invoke("reopen_files", { input: { connection, depotPaths, targetChange } });
}

export async function diffFile(
  connection: ConnectionInput,
  depotPath: string,
  mode: DiffMode = "default",
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_file", { input: { connection, depotPath, mode } });
}

export async function fileHistory(connection: ConnectionInput, depotPath: string, limit = 100): Promise<FileRevision[]> {
  return invoke<FileRevision[]>("file_history", { input: connection, depotPath, limit });
}

export async function fileHistoryPage(connection: ConnectionInput, depotPath: string, limit = 100, cursor?: string): Promise<HistoryPage<FileRevision>> {
  return invoke<HistoryPage<FileRevision>>("file_history_page", { input: connection, depotPath, limit, cursor });
}

export async function printRevision(connection: ConnectionInput, depotPath: string, revision: string): Promise<FileDiff> {
  return invoke<FileDiff>("print_revision", { input: { connection, depotPath }, revision });
}

export async function saveRevision(connection: ConnectionInput, depotPath: string, revision: string, outputPath: string): Promise<void> {
  return invoke("save_revision", { input: { connection, depotPath, revision, outputPath } });
}

export async function saveChangeFiles(connection: ConnectionInput, change: string, outputDirectory: string): Promise<ChangeExportResult> {
  return invoke<ChangeExportResult>("save_change_files", { input: { connection, change, outputDirectory } });
}

export async function saveShelvedFile(connection: ConnectionInput, sourceChange: string, depotPath: string, outputPath: string): Promise<void> {
  return invoke("save_shelved_file", { input: { connection, sourceChange, depotPath, outputPath } });
}

export async function saveShelvedFiles(
  connection: ConnectionInput,
  sourceChange: string,
  depotPaths: string[],
  outputDirectory: string,
): Promise<ChangeExportResult> {
  return invoke<ChangeExportResult>("save_shelved_files", {
    input: { connection, sourceChange, depotPaths, outputDirectory },
  });
}

export async function diffRevisions(connection: ConnectionInput, depotPath: string, left: string, right: string, mode: DiffMode = "default"): Promise<FileDiff> {
  return invoke<FileDiff>("diff_revisions", { input: { connection, depotPath, mode }, left, right });
}

export async function diffRevisionWorkspace(connection: ConnectionInput, depotPath: string, revision: string, mode: DiffMode = "default"): Promise<FileDiff> {
  return invoke<FileDiff>("diff_revision_workspace", { input: { connection, depotPath, mode }, revision });
}

export async function annotateFile(connection: ConnectionInput, depotPath: string): Promise<AnnotationLine[]> {
  return invoke<AnnotationLine[]>("annotate_file", { input: connection, depotPath });
}

export async function diffShelvedFile(
  connection: ConnectionInput,
  change: string,
  depotPath: string,
  againstLocal = false,
  mode: DiffMode = "default",
): Promise<FileDiff> {
  return invoke<FileDiff>("diff_shelved_file", {
    input: { connection, change, depotPath, againstLocal, mode },
  });
}

export async function startSubmit(
  connection: ConnectionInput,
  change: string,
  description?: string,
  mode: SubmitMode = "local",
): Promise<string> {
  return invoke<string>("start_submit", { input: { connection, change, description, mode } });
}

export async function submitPreflight(connection: ConnectionInput, change: string): Promise<SubmitPreflightSummary> {
  return invoke<SubmitPreflightSummary>("submit_preflight", { input: connection, change });
}

export async function shelveFiles(
  connection: ConnectionInput,
  change: string,
  depotPaths: string[] = [],
  replaceAll = false,
  revertAfter = false,
  deleteAddedFiles = false,
): Promise<void> {
  return invoke("shelve_file", {
    input: { connection, change, depotPaths, replaceAll, revertAfter, deleteAddedFiles },
  });
}

export async function previewUnshelve(
  connection: ConnectionInput,
  sourceChange: string,
  depotPaths: string[] = [],
): Promise<UnshelvePreview> {
  return invoke<UnshelvePreview>("preview_unshelve", {
    input: { connection, sourceChange, depotPaths },
  });
}

export async function unshelveFiles(
  connection: ConnectionInput,
  sourceChange: string,
  targetChange: string,
  depotPaths: string[] = [],
  forcePaths: string[] = [],
): Promise<void> {
  return invoke("unshelve_files", {
    input: { connection, sourceChange, targetChange, depotPaths, forcePaths },
  });
}

export async function reshelveFiles(
  connection: ConnectionInput,
  sourceChange: string,
  targetChange: string,
  depotPaths: string[] = [],
  force = false,
): Promise<void> {
  return invoke("reshelve_files", { input: { connection, sourceChange, targetChange, depotPaths, force } });
}

export async function deleteShelfFiles(
  connection: ConnectionInput,
  change: string,
  depotPaths: string[] = [],
): Promise<void> {
  return invoke("delete_shelf_files", { input: { connection, change, depotPaths } });
}

export async function revertFiles(
  connection: ConnectionInput,
  change: string,
  depotPaths: string[],
  deleteAddedFiles = false,
): Promise<void> {
  return invoke("revert_files", { input: { connection, change, depotPaths, deleteAddedFiles } });
}

export async function previewRevertUnchanged(connection: ConnectionInput, change: string): Promise<RevertPreviewItem[]> {
  return invoke<RevertPreviewItem[]>("preview_revert_unchanged", { input: connection, change });
}

export async function previewRevertAll(connection: ConnectionInput, change: string): Promise<RevertPreviewItem[]> {
  return invoke<RevertPreviewItem[]>("preview_revert_all", { input: connection, change });
}

export async function previewRevertSelected(connection: ConnectionInput, change: string, depotPaths: string[]): Promise<RevertPreviewItem[]> {
  return invoke<RevertPreviewItem[]>("preview_revert_selected", { input: connection, change, depotPaths });
}

export async function revertUnchanged(connection: ConnectionInput, change: string): Promise<void> {
  return invoke("revert_unchanged", { input: connection, change });
}

export async function editChange(
  connection: ConnectionInput,
  change: string,
  description: string,
): Promise<void> {
  return invoke("edit_change", { input: { connection, change, description } });
}

export async function previewChangeIdentity(
  connection: ConnectionInput,
  change: string,
  owner: string,
  client: string,
  visibility: ChangeVisibility,
): Promise<ChangeIdentityPreflight> {
  return invoke<ChangeIdentityPreflight>("preview_change_identity", {
    input: { connection, change, owner, client, visibility },
  });
}

export async function updateChangeIdentity(
  connection: ConnectionInput,
  change: string,
  owner: string,
  client: string,
  visibility: ChangeVisibility,
  previewToken: string,
): Promise<ChangeIdentityState> {
  return invoke<ChangeIdentityState>("update_change_identity", {
    input: { connection, change, owner, client, visibility, previewToken },
  });
}

export async function deleteChange(connection: ConnectionInput, change: string): Promise<void> {
  return invoke("delete_change", { input: { connection, change } });
}

export async function createChange(
  connection: ConnectionInput,
  description: string,
): Promise<string> {
  return invoke<string>("create_change", { input: { connection, description } });
}

export async function listCliLog(): Promise<CliLogEntry[]> {
  return invoke<CliLogEntry[]>("list_cli_log");
}

export async function clearCliLog(): Promise<void> {
  return invoke("clear_cli_log");
}

export async function uiSnapshotEnabled(): Promise<boolean> {
  return invoke<boolean>("ui_snapshot_enabled");
}

export async function writeUiSnapshot(snapshot: UiSnapshot): Promise<void> {
  return invoke("write_ui_snapshot", { snapshot });
}

export async function readUiAgentCommand(lastRequestId?: string): Promise<UiAgentCommand | null> {
  return invoke<UiAgentCommand | null>("read_ui_agent_command", { lastRequestId });
}

export async function writeUiAgentResponse(response: UiAgentResponse): Promise<void> {
  return invoke("write_ui_agent_response", { response });
}

export function normalizeAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return { ...fallbackError, diagnostics: error };
  }

  return fallbackError;
}

function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AppError>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.message === "string" &&
    Array.isArray(candidate.hints)
  );
}
