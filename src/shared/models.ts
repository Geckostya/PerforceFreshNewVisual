export type ErrorKind =
  | "executable_not_found"
  | "auth"
  | "trust"
  | "permission"
  | "conflict"
  | "offline"
  | "timeout"
  | "unsupported_capability"
  | "server_limit"
  | "cancelled"
  | "stale"
  | "partial_result"
  | "invalid_output"
  | "settings"
  | "command_failed";

export interface AppError {
  kind: ErrorKind;
  message: string;
  hints: string[];
  diagnostics?: string;
}

export interface CliLogEntry {
  id: number;
  level: "warning" | "error";
  message: string;
  details?: string;
  timestampMs: number;
}

export interface P4Detection {
  path: string;
  version: string;
}

export interface ConnectionInput {
  p4Path?: string;
  port: string;
  user: string;
  client?: string;
  charset?: string;
  p4Config?: string;
  p4Enviro?: string;
}

export type ThemeMode = "system" | "light" | "dark";

export interface AppSettings {
  language: string;
  theme: ThemeMode;
  recentConnections: ConnectionInput[];
  favoriteConnections: ConnectionInput[];
  deleteAddedFilesOnRevert: boolean;
}

export interface LocaleBundle {
  code: string;
  name: string;
  translations: Record<string, string>;
}

export interface LocaleCatalog {
  locales: LocaleBundle[];
  warnings: string[];
}

export interface P4Info {
  serverAddress?: string;
  serverVersion?: string;
  userName?: string;
  clientName?: string;
  clientRoot?: string;
  clientStream?: string;
  unicode?: string;
  caseHandling?: string;
  serverServices?: string;
  serverId?: string;
  security?: string;
  clientAddress?: string;
  userEmail?: string;
  capabilities?: CapabilitySnapshot;
}

export type CapabilityState = "supported" | "unsupported" | "unknown";
export type CapabilityEvidence = "client" | "server" | "workspace" | "topology" | "permission" | "unavailable";

export interface CapabilityFact {
  state: CapabilityState;
  reason: string;
  evidence: CapabilityEvidence;
}

export interface CapabilitySnapshot {
  cliVersion?: string;
  serverVersion?: string;
  serverServices?: string;
  serverId?: string;
  topology?: string;
  unicode?: string;
  caseHandling?: string;
  security?: string;
  workspaceKind: "stream" | "classic" | "unknown";
  depotModes: string[];
  commands: Record<string, CapabilityFact>;
  facts: Record<string, CapabilityFact>;
}

export interface LoginStatus {
  loggedIn: boolean;
  expiresInMinutes?: number;
  message: string;
}

export interface WorkspaceSummary {
  name: string;
  owner: string;
  root: string;
  host?: string;
  stream?: string;
  description?: string;
}

export interface WorkspaceSpec {
  name: string;
  owner: string;
  root: string;
  host?: string;
  stream?: string;
  description: string;
  options: string[];
  submitOptions?: string;
  lineEnd?: string;
  altRoots: string[];
  mappings: string[];
}

export interface StreamSummary {
  path: string;
  name: string;
  parent?: string;
  streamType: string;
  description: string;
  owner?: string;
  updated?: string;
}

export type StreamIntegrationDirection = "mergeDown" | "copyUp";
export interface StreamHistoryEntry { revision: string; action: string; change?: string; user?: string; time?: string; description?: string; }
export interface StreamIntegrationHint { direction: StreamIntegrationDirection; state: "supported" | "unsupported" | "unknown"; message: string; }
export interface StreamDetail {
  stream: StreamSummary;
  parentView: string;
  options: string[];
  paths: string[];
  remapped: string[];
  ignored: string[];
  history: StreamHistoryEntry[];
  hints: StreamIntegrationHint[];
  warnings: string[];
}
export interface StreamIntegrationInput {
  connection: ConnectionInput;
  direction: StreamIntegrationDirection;
  sourceStream: string;
  targetStream: string;
  targetChange: string;
}
export interface StreamIntegrationPreviewItem {
  sourcePath: string;
  targetPath: string;
  localPath?: string;
  action: string;
  sourceStartRevision?: string;
  sourceEndRevision?: string;
  resolveType?: string;
  fileType?: string;
}
export interface StreamIntegrationPreview {
  identity: string;
  direction: StreamIntegrationDirection;
  sourceStream: string;
  targetStream: string;
  targetWorkspace: string;
  targetChange: string;
  revisionScope: string;
  items: StreamIntegrationPreviewItem[];
  warnings: string[];
  truncated: boolean;
  partial: boolean;
}

export type CreateStreamType = "development" | "release" | "virtual" | "task";
export type StreamPathKind = "share" | "isolate" | "import" | "exclude";

export interface StreamPathRuleInput {
  kind: StreamPathKind;
  viewPath: string;
  depotPath?: string;
}

export interface CreateStreamInput {
  connection: ConnectionInput;
  name: string;
  parent: string;
  streamType: CreateStreamType;
  description: string;
  paths: StreamPathRuleInput[];
}

export interface CreateStreamPreview {
  path: string;
  name: string;
  parent: string;
  streamType: string;
  description: string;
  parentView: string;
  options: string;
  paths: string[];
  spec: string;
}

export type StreamLocalStrategy = "shelve" | "keep";

export interface WorkspaceUpdateInput { name: string; root: string; stream?: string; description: string; }
export interface WorkspaceCreateInput { name: string; root: string; stream?: string; description: string; }

export interface DepotDirectory { path: string; }
export interface DepotSummary {
  name: string;
  path: string;
  depotType: string;
  description: string;
  date?: string;
  map?: string;
  streamDepth?: string;
}
export interface DepotFile {
  depotPath: string;
  revision?: string;
  action?: string;
  change?: string;
  fileType?: string;
}
export interface DepotStateDifference {
  depotPath: string;
  beforeRevision?: string;
  afterRevision?: string;
  beforeFileType?: string;
  afterFileType?: string;
}
export interface DepotStateComparison {
  scope: string;
  baseChange: string;
  targetChange?: string;
  added: DepotStateDifference[];
  changed: DepotStateDifference[];
  deleted: DepotStateDifference[];
  typeChanged: DepotStateDifference[];
}

export interface TrustEntry { server: string; fingerprint: string; }

export interface TrustChallenge {
  server: string;
  presentedFingerprint: string;
  existingFingerprint?: string;
  reason: "new" | "changed";
}

export type AuthStageKind =
  | "password_required"
  | "method_selection"
  | "second_factor"
  | "external_browser"
  | "waiting"
  | "success"
  | "expired"
  | "cancelled"
  | "failed"
  | "unsupported";

export interface AuthStage {
  kind: AuthStageKind;
  methods: string[];
  pollingAttempt: number;
  maxPollingAttempts: number;
}

export type OperationEventKind =
  | "started"
  | "progress"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "cancelled"
  | "partial"
  | "unknown";
export type OperationItemStatus = "succeeded" | "failed" | "skipped";
export type OperationCompensationStatus = "not_required" | "succeeded" | "failed" | "unknown";
export type OperationReadBackStatus = "succeeded" | "failed" | "not_required" | "unknown";
export interface OperationDiagnostic {
  code: string;
  message: string;
  itemId?: string;
}
export interface OperationItemResult {
  itemId: string;
  path?: string;
  status: OperationItemStatus;
  reason?: string;
  compensation: OperationCompensationStatus;
  recoveryActionId?: "refresh_workspace" | "refresh_changes" | "refresh_streams" | string;
}
export interface OperationReadBack {
  status: OperationReadBackStatus;
  affectedState: string[];
  message?: string;
}
export interface OperationEvent {
  operationId: string;
  operationKind: "sync" | "submit" | "reconcile" | "reconcile_preview" | "stream_switch" | "integrate" | string;
  kind: OperationEventKind;
  startedAtMs?: number;
  processed: number;
  totalFiles?: number;
  processedBytes: number;
  totalBytes?: number;
  currentPath?: string;
  message?: string;
  scope?: string;
  scopes?: string[];
  phase?: "scan" | "validate" | "apply" | string;
  reconcileItems?: ReconcileItem[];
  submitOutcome?: SubmitOutcome;
  diagnostics?: OperationDiagnostic[];
  itemResults?: OperationItemResult[];
  readBack?: OperationReadBack;
  retryable: boolean;
}

export type ResourceFreshness =
  | "fresh"
  | "loading"
  | "stale"
  | "offline"
  | "permission"
  | "partial"
  | "error";

export interface ResourceSnapshot<T> {
  freshness: ResourceFreshness;
  data?: T;
  lastSuccessfulAt?: number;
  error?: AppError;
}

export interface PendingChange {
  id: string;
  description: string;
  user: string;
  client: string;
  time?: string;
  stream?: string;
}

export type ChangeVisibility = "public" | "restricted";

export interface ChangeIdentityState {
  owner: string;
  client: string;
  visibility: ChangeVisibility;
}

export type ChangeIdentityBlocker =
  | "capability_unknown"
  | "unsupported"
  | "permission_unknown"
  | "permission_denied"
  | "topology_unknown"
  | "topology_mismatch"
  | "target_client_owner_mismatch"
  | "not_pending";

export interface ChangeIdentityPreflight {
  change: string;
  current: ChangeIdentityState;
  target: ChangeIdentityState;
  hasOpenedFiles: boolean;
  hasShelvedFiles: boolean;
  hasJobs: boolean;
  requiresAdmin: boolean;
  permissionLevel: string;
  topology: string;
  blockers: ChangeIdentityBlocker[];
  previewToken: string;
}

export interface HistoryPage<T> {
  items: T[];
  nextCursor?: string;
  partial: boolean;
}

export interface Job {
  id: string;
  status?: string;
  user?: string;
  date?: string;
  description: string;
}

export interface Label {
  name: string;
  owner?: string;
  update?: string;
  description: string;
}

export interface Fix {
  job: string;
  change: string;
  date?: string;
  user?: string;
  status?: string;
}

export interface OpenedFile {
  depotPath: string;
  clientPath?: string;
  action: string;
  change: string;
  revision?: string;
  fileType?: string;
}

export interface WorkspaceFile {
  depotPath: string;
  clientPath?: string;
  localPath?: string;
  action: string;
  change?: string;
  haveRevision?: string;
  headRevision?: string;
  fileType?: string;
  mapped: boolean;
  otherOpen: boolean;
  otherLock: boolean;
  unresolved: boolean;
  untracked: boolean;
  ignored: boolean;
  fileSize?: number;
  statusPending?: boolean;
}

export interface WorkspaceLocalBatch {
  directories: string[];
  ignoredDirectories: string[];
  files: WorkspaceFile[];
  completedDirectories: string[];
}

export type WorkspaceMappingState = "mapped" | "unmapped" | "excluded";
export interface WorkspaceMapping {
  query: string;
  state: WorkspaceMappingState;
  depotPath?: string;
  clientPath?: string;
  localPath?: string;
  diagnostics: string[];
}
export interface WorkspaceMappingBatch {
  mappings: WorkspaceMapping[];
  partial: boolean;
  diagnostics: string[];
}

export interface UiControlSnapshot {
  index: number;
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  value?: string;
  checked?: boolean;
  disabled: boolean;
}

export interface UiElementSnapshot {
  index: number;
  locator: string;
  agentId?: string;
  tag: string;
  role?: string;
  type?: string;
  id?: string;
  name?: string;
  accessibleName?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  disabled: boolean;
  selected?: boolean;
  expanded?: boolean;
  busy?: boolean;
  ignored?: boolean;
  hidden: boolean;
}

export interface UiSnapshot {
  schemaVersion: 2;
  stateVersion: number;
  generatedAt: string;
  screen?: string;
  location: string;
  title: string;
  activeElement?: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  settled: boolean;
  busy: boolean;
  controls: UiControlSnapshot[];
  elements: UiElementSnapshot[];
  html: string;
}

export type UiAgentMethod = "ui.click" | "ui.input" | "ui.key" | "ui.focus";

export interface UiAgentCommand {
  id: string;
  token: string;
  method: UiAgentMethod;
  expectedStateVersion: number;
  target: string;
  value?: string;
  key?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface UiAgentResponse {
  id: string;
  token: string;
  ok: boolean;
  beforeStateVersion: number;
  afterStateVersion: number;
  error?: string;
}

export type ResolveMode = "yours" | "theirs" | "autoSafe" | "autoMerge" | "editResult";
export type ResolveConflictKind = "text" | "binary" | "move_name" | "filetype_attribute" | "stream_spec" | "unknown";
export type ResolveReadBackState = "pending" | "resolved" | "unknown";

export interface SyncPreviewItem {
  depotPath: string;
  action: string;
  revision?: string;
  localPath?: string;
  bytes?: string;
}

export interface SyncPreview { items: SyncPreviewItem[]; totalBytes: number; modifiedFiles: string[]; writableFiles: string[]; missingHaveFiles: string[]; }

export type ReconcileAction = "add" | "edit" | "delete" | "move" | "unsafe";
export interface ReconcileItem {
  stableId: string;
  previewToken: string;
  depotPath: string;
  action: ReconcileAction;
  originalAction?: string;
  clientPath?: string;
  localPath?: string;
  mappingState: WorkspaceMappingState;
  ignored: boolean;
  unsafeItem: boolean;
  reasons: string[];
  movePartner?: string;
  localSize?: number;
  localModified?: string;
}

export interface ResolvePreviewItem {
  depotPath: string;
  clientPath?: string;
  localPath?: string;
  action: string;
  detail?: string;
  conflictKind: ResolveConflictKind;
  baseIdentifier?: string;
  sourceIdentifier?: string;
  workspaceIdentifier: string;
  allowedActions: ResolveMode[];
  readBack: ResolveReadBackState;
}
export interface ResolveApplyItem { depotPath: string; state: ResolveReadBackState; reason?: string; }
export interface ResolveApplyResult { items: ResolveApplyItem[]; }
export interface ResolveContentSide { identifier: string; text?: string; binary: boolean; truncated: boolean; }
export interface ResolveContent {
  depotPath: string;
  localPath: string;
  previewToken: string;
  base: ResolveContentSide;
  source: ResolveContentSide;
  workspace: ResolveContentSide;
}

export interface RevertPreviewItem { depotPath: string; action: string; }

export interface ShelvedFile {
  depotPath: string;
  action: string;
  revision?: string;
  fileType?: string;
}

export interface UnshelveConflict {
  depotPath: string;
  localPath: string;
}

export interface UnshelvePreview {
  conflicts: UnshelveConflict[];
}

export type SubmitMode =
  | "local"
  | "shelf"
  | "local_delete_shelf"
  | "local_update_shelf";

export interface SubmitOutcome {
  preservedLocalChange?: string;
  terminal: "submitted" | "pending" | "unknown";
  affectedChange?: string;
  recoveryActions: string[];
  steps: Array<{ step: string; status: string; detail?: string }>;
}

export interface SubmitPreflightIssue {
  depotPath: string;
  kind: string;
  detail: string;
}

export interface SubmitPreflightJob { id: string; date?: string; user?: string; status?: string; }
export interface SubmitPreflightSummary { issues: SubmitPreflightIssue[]; jobs: string[]; jobDetails?: SubmitPreflightJob[]; warnings?: string[]; totalSize: number; stream?: string; }

export interface FileDiff {
  text: string;
  truncated: boolean;
  binary: boolean;
}

export interface AnnotationLine { change: string; user?: string; date?: string; text: string; }

export type DiffMode = "default" | "ignoreWhitespaceChanges" | "ignoreWhitespace" | "ignoreLineEndings";

export interface FileRevision {
  revision: string;
  change: string;
  action: string;
  user: string;
  time?: string;
  fileType?: string;
  client?: string;
  size?: string;
  description?: string;
  integrationRecords: FileIntegrationRecord[];
  labels: string[];
}

export interface FileIntegrationRecord {
  how?: string;
  filePath?: string;
  startRevision?: string;
  endRevision?: string;
  complete: boolean;
  cyclic: boolean;
}

export interface SubmittedFile { depotPath: string; action: string; revision?: string; fileType?: string; }
export interface SubmittedChangeDetail { id: string; description: string; user: string; client: string; time?: string; jobs: string[]; files: SubmittedFile[]; filesTruncated: boolean; }
export interface SubmittedFilterOptions { users: string[]; clients: string[]; }
export interface ChangeExportResult { savedFiles: number; skippedFiles: number; }
export interface UndoPreviewItem { depotPath: string; action: string; localPath?: string; }
export interface CherryPickPreviewItem { sourcePath: string; targetPath: string; action: string; localPath?: string; }
