import type { ConnectionInput, OpenedFile, PendingChange, WorkspaceFile } from "../../shared/models";

export type WorkspaceFilter = "all" | "opened" | "outdated" | "unresolved" | "otherOpen" | "locked" | "unmapped" | "untracked";

export interface WorkspaceTreeGroup {
  path: string;
  files: WorkspaceFile[];
}

export interface WorkspaceTreeFolder {
  name: string;
  path: string;
  folders: WorkspaceTreeFolder[];
  files: WorkspaceFile[];
  ignored: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface WorkspaceDirectorySnapshot {
  directory: string;
  directories: string[];
  ignoredDirectories: string[];
  files: WorkspaceFile[];
  statuses: WorkspaceFile[];
  statusVersion?: string;
}

export function workspaceFolderPaths(folders: WorkspaceTreeFolder[]): string[] {
  return folders.flatMap((folder) => [folder.path, ...workspaceFolderPaths(folder.folders)]);
}

export function workspaceSelectionOrder(folders: WorkspaceTreeFolder[], collapsed = new Set<string>()): string[] {
  return folders.flatMap((folder) => [
    `folder:${folder.path}`,
    ...(collapsed.has(folder.path) ? [] : [
      ...workspaceSelectionOrder(folder.folders, collapsed),
      ...folder.files.map((file) => `file:${file.depotPath}`),
    ]),
  ]);
}

const memoryFileCache = new Map<string, WorkspaceFile[]>();
const memoryDirectoryCache = new Map<string, WorkspaceDirectorySnapshot>();
const memoryStatusVersionCache = new Map<string, string>();
const workspaceCacheDatabase = "p4fnv-workspace-cache";

function workspaceFiles(value: unknown): WorkspaceFile[] {
  return Array.isArray(value)
    ? value.filter((item): item is WorkspaceFile => Boolean(item)
      && typeof (item as WorkspaceFile).depotPath === "string"
      && typeof (item as WorkspaceFile).mapped === "boolean")
    : [];
}

function workspaceDirectorySnapshot(value: unknown): WorkspaceDirectorySnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Partial<WorkspaceDirectorySnapshot>;
  if (typeof snapshot.directory !== "string" || !Array.isArray(snapshot.directories)) return undefined;
  return {
    directory: snapshot.directory,
    directories: snapshot.directories.filter((path): path is string => typeof path === "string"),
    ignoredDirectories: Array.isArray(snapshot.ignoredDirectories)
      ? snapshot.ignoredDirectories.filter((path): path is string => typeof path === "string")
      : [],
    files: workspaceFiles(snapshot.files),
    statuses: workspaceFiles(snapshot.statuses),
    statusVersion: typeof snapshot.statusVersion === "string" ? snapshot.statusVersion : undefined,
  };
}

function openWorkspaceCache(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = indexedDB.open(workspaceCacheDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

export function workspaceFileCacheKey(connection: ConnectionInput, scope: string): string {
  return `p4fnv:workspace-files:v5:${encodeURIComponent(connection.port)}:${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.client || "")}:${encodeURIComponent(scope)}`;
}

export function workspaceDirectoryCacheKey(connection: ConnectionInput, directory: string): string {
  return `p4fnv:workspace-directory:v1:${encodeURIComponent(connection.port)}:${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.client || "")}:${encodeURIComponent(directory.toLowerCase())}`;
}

export function workspaceLazyRoot(connection: ConnectionInput, scope: string): string | undefined {
  const client = connection.client?.trim();
  if (!client) return undefined;
  const root = `//${client}`;
  const normalized = scope.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized === "//..." || normalized.toLowerCase() === `${root.toLowerCase()}/...`) return root;
  if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`) && normalized.endsWith("/...")) {
    return normalized.slice(0, -4);
  }
  return undefined;
}

export function workspaceDirectoryStatusScope(directory: string): string {
  return `${directory.replace(/\/+$/, "")}/*`;
}

export async function loadWorkspaceDirectoryCache(key: string): Promise<WorkspaceDirectorySnapshot | undefined> {
  const memory = memoryDirectoryCache.get(key);
  if (memory) return memory;
  const database = await openWorkspaceCache();
  if (!database) return undefined;
  return new Promise((resolve) => {
    const request = database.transaction("snapshots", "readonly").objectStore("snapshots").get(key);
    request.onsuccess = () => {
      const snapshot = workspaceDirectorySnapshot(request.result);
      if (snapshot) memoryDirectoryCache.set(key, snapshot);
      database.close();
      resolve(snapshot);
    };
    request.onerror = () => {
      database.close();
      resolve(undefined);
    };
  });
}

export async function saveWorkspaceDirectoryCache(key: string, snapshot: WorkspaceDirectorySnapshot): Promise<void> {
  memoryDirectoryCache.set(key, snapshot);
  const database = await openWorkspaceCache();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("snapshots", "readwrite");
    transaction.objectStore("snapshots").put(snapshot, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

export function loadWorkspaceFileCache(key: string): WorkspaceFile[] {
  const memory = memoryFileCache.get(key);
  if (memory) return memory;
  try {
    const files = workspaceFiles(JSON.parse(localStorage.getItem(key) || "[]"));
    if (files.length) memoryFileCache.set(key, files);
    return files;
  } catch {
    return [];
  }
}

export async function loadWorkspaceFileCachePersistent(key: string): Promise<WorkspaceFile[]> {
  const fallback = loadWorkspaceFileCache(key);
  const database = await openWorkspaceCache();
  if (!database) return fallback;
  return new Promise((resolve) => {
    const request = database.transaction("snapshots", "readonly").objectStore("snapshots").get(key);
    request.onsuccess = () => {
      const files = workspaceFiles(request.result);
      if (files.length) memoryFileCache.set(key, files);
      database.close();
      resolve(files.length ? files : fallback);
    };
    request.onerror = () => {
      database.close();
      resolve(fallback);
    };
  });
}

export async function saveWorkspaceFileCache(key: string, files: WorkspaceFile[]): Promise<void> {
  memoryFileCache.set(key, files);
  const database = await openWorkspaceCache();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("snapshots", "readwrite");
    transaction.objectStore("snapshots").put(files, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

export function loadWorkspaceStatusVersion(key: string): string | undefined {
  const memory = memoryStatusVersionCache.get(key);
  if (memory) return memory;
  try {
    const version = localStorage.getItem(`${key}:status-version`) || undefined;
    if (version) memoryStatusVersionCache.set(key, version);
    return version;
  } catch {
    return undefined;
  }
}

export function saveWorkspaceStatusVersion(key: string, version: string): void {
  memoryStatusVersionCache.set(key, version);
  try {
    localStorage.setItem(`${key}:status-version`, version);
  } catch {
    // The in-memory cache is sufficient for the current application session.
  }
}

export function workspaceStatusVersion(
  pending: PendingChange[],
  opened: OpenedFile[],
  submitted: PendingChange[],
): string {
  const changes = (kind: string, items: PendingChange[]) => items
    .map((change) => [kind, change.id, change.time, change.user, change.client, change.description].join("\0"))
    .sort();
  const files = opened
    .map((file) => [file.depotPath, file.clientPath, file.action, file.change, file.revision, file.fileType].join("\0"))
    .sort();
  return JSON.stringify([...changes("pending", pending), ...changes("submitted", submitted), ...files]);
}

export function mergeWorkspaceFileStatuses(
  localFiles: WorkspaceFile[],
  statusFiles: WorkspaceFile[],
  statusComplete = false,
): WorkspaceFile[] {
  const pathKey = (file: WorkspaceFile) => {
    const path = (file.localPath || file.clientPath || "").replaceAll("\\", "/");
    const normalized = path.toLowerCase().startsWith("//?/unc/")
      ? `//${path.slice(8)}`
      : path.toLowerCase().startsWith("//?/") ? path.slice(4) : path;
    return normalized.toLowerCase();
  };
  const statuses = new Map(statusFiles.map((file) => [pathKey(file), file]));
  return [
    ...localFiles.map((file) => {
      const status = statuses.get(pathKey(file));
      if (status) return { ...file, ...status, clientPath: file.clientPath, localPath: file.localPath, mapped: true, untracked: false, fileSize: file.fileSize ?? status.fileSize, statusPending: false };
      return statusComplete
        ? { ...file, mapped: false, untracked: true, statusPending: false }
        : { ...file, statusPending: true };
    }),
  ];
}

export function workspaceFileHistoryPath(file?: WorkspaceFile): string | undefined {
  return file && !file.statusPending && file.mapped && !file.untracked ? file.depotPath : undefined;
}

function isOutdated(file: WorkspaceFile): boolean {
  const have = Number(file.haveRevision);
  const head = Number(file.headRevision);
  return Number.isFinite(have) && Number.isFinite(head) && have < head;
}

export function filterWorkspaceFiles(files: WorkspaceFile[], filter: WorkspaceFilter, query: string): WorkspaceFile[] {
  const needle = query.trim().toLowerCase();
  return files.filter((file) => {
    const matchesFilter = filter === "all"
      || (filter === "opened" && Boolean(file.action || file.change))
      || (filter === "outdated" && isOutdated(file))
      || (filter === "unresolved" && file.unresolved)
      || (filter === "otherOpen" && file.otherOpen)
      || (filter === "locked" && file.otherLock)
      || (filter === "unmapped" && !file.mapped)
      || (filter === "untracked" && file.untracked);
    const matchesQuery = !needle || [file.depotPath, file.clientPath, file.localPath, file.action, file.change]
      .some((value) => value?.toLowerCase().includes(needle));
    return matchesFilter && matchesQuery;
  });
}

export function groupWorkspaceFiles(files: WorkspaceFile[]): WorkspaceTreeGroup[] {
  const groups = new Map<string, WorkspaceFile[]>();
  for (const file of files) {
    const parts = file.depotPath.split("/");
    const path = parts.length > 3 ? parts.slice(0, -1).join("/") : "//";
    const current = groups.get(path) || [];
    current.push(file);
    groups.set(path, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, groupedFiles]) => ({ path, files: groupedFiles }));
}

function workspaceTreePath(file: WorkspaceFile): string {
  return file.clientPath || file.depotPath;
}

export function workspaceDirectoryPaths(files: WorkspaceFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = workspaceTreePath(file).slice(2).split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) paths.add(`//${parts.slice(0, index).join("/")}`);
  }
  return [...paths];
}

export function buildWorkspaceTree(files: WorkspaceFile[], directoryPaths: string[] = [], loadingDirectories = new Set<string>(), loadedDirectories?: Set<string>, ignoredDirectories = new Set<string>()): WorkspaceTreeFolder[] {
  type MutableFolder = { name: string; path: string; folders: Map<string, MutableFolder>; files: WorkspaceFile[] };
  const root: MutableFolder = { name: "//", path: "//", folders: new Map(), files: [] };
  const foldersByPath = new Map<string, MutableFolder>([[root.path, root]]);
  const addPath = (path: string) => {
    const parts = path.slice(2).split("/").filter(Boolean);
    let current = root;
    for (const part of parts) {
      const path = current.path === "//" ? `//${part}` : `${current.path}/${part}`;
      if (!current.folders.has(part)) {
        const folder = { name: part, path, folders: new Map<string, MutableFolder>(), files: [] as WorkspaceFile[] };
        current.folders.set(part, folder);
        foldersByPath.set(path, folder);
      }
      current = current.folders.get(part)!;
    }
    return current;
  };
  for (const path of directoryPaths) addPath(path);
  for (const file of files) {
    const path = workspaceTreePath(file);
    const separator = path.lastIndexOf("/");
    const parent = separator > 1 ? path.slice(0, separator) : "//";
    const current = foldersByPath.get(parent) || addPath(parent);
    current.files.push(file);
  }
  const scanComplete = loadingDirectories.size === 0;
  const freeze = (folder: MutableFolder): WorkspaceTreeFolder => ({
    name: folder.name,
    path: folder.path,
    folders: [...folder.folders.values()].sort((left, right) => left.name.localeCompare(right.name)).map(freeze),
    files: scanComplete ? folder.files.sort((left, right) => left.depotPath.localeCompare(right.depotPath)) : folder.files,
    ignored: ignoredDirectories.has(folder.path),
    loading: loadingDirectories.has(folder.path),
    loaded: loadedDirectories?.has(folder.path) ?? true,
  });
  return [...root.folders.values()].sort((left, right) => left.name.localeCompare(right.name)).map(freeze);
}

export function workspaceStatus(file: WorkspaceFile): string[] {
  const statuses: string[] = [];
  if (file.action || file.change) statuses.push("opened");
  if (isOutdated(file)) statuses.push("outdated");
  if (file.unresolved) statuses.push("unresolved");
  if (file.otherOpen) statuses.push("otherOpen");
  if (file.otherLock) statuses.push("locked");
  if (!file.mapped) statuses.push("unmapped");
  if (file.untracked) statuses.push("untracked");
  if (file.ignored) statuses.push("ignored");
  return statuses;
}
