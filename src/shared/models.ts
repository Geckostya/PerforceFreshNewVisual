export type ErrorKind =
  | "executable_not_found"
  | "auth"
  | "trust"
  | "permission"
  | "conflict"
  | "offline"
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

export interface TrustEntry { server: string; fingerprint: string; }

export type OperationEventKind = "started" | "progress" | "completed" | "failed" | "cancelled";
export interface OperationEvent {
  operationId: string;
  operationKind: "sync" | "submit" | string;
  kind: OperationEventKind;
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
  retryable: boolean;
}

export interface PendingChange {
  id: string;
  description: string;
  user: string;
  client: string;
  time?: string;
  stream?: string;
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

export type ResolveMode = "yours" | "theirs" | "autoSafe" | "autoMerge";

export interface SyncPreviewItem {
  depotPath: string;
  action: string;
  revision?: string;
  localPath?: string;
  bytes?: string;
}

export interface SyncPreview { items: SyncPreviewItem[]; totalBytes: number; modifiedFiles: string[]; writableFiles: string[]; missingHaveFiles: string[]; }

export interface ReconcileItem { depotPath: string; action: string; localPath?: string; }

export interface ResolvePreviewItem { depotPath: string; action: string; detail?: string; }

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
  integrations: string[];
  labels: string[];
}

export interface SubmittedFile { depotPath: string; action: string; revision?: string; fileType?: string; }
export interface SubmittedChangeDetail { id: string; description: string; user: string; client: string; time?: string; jobs: string[]; files: SubmittedFile[]; filesTruncated: boolean; }
export interface SubmittedFilterOptions { users: string[]; clients: string[]; }
export interface ChangeExportResult { savedFiles: number; skippedFiles: number; }
export interface UndoPreviewItem { depotPath: string; action: string; localPath?: string; }
export interface CherryPickPreviewItem { sourcePath: string; targetPath: string; action: string; localPath?: string; }
