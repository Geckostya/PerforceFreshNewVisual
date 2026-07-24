import { describe, expect, it } from "vitest";
import type { OpenedFile, PendingChange, WorkspaceFile } from "../../shared/models";
import { buildWorkspaceTree, filterWorkspaceFiles, groupWorkspaceFiles, loadWorkspaceDirectoryCache, mergeWorkspaceFileStatuses, saveWorkspaceDirectoryCache, workspaceDirectoryCacheKey, workspaceDirectoryPaths, workspaceDirectoryStatusScope, workspaceFileHistoryPath, workspaceFolderPaths, workspaceLazyRoot, workspaceStatus, workspaceStatusVersion } from "./workspace";

const file = (overrides: Partial<WorkspaceFile>): WorkspaceFile => ({
  depotPath: "//Acme/main/a.txt",
  action: "",
  mapped: true,
  otherOpen: false,
  otherLock: false,
  unresolved: false,
  untracked: false,
  ignored: false,
  ...overrides,
});

describe("workspace status filters", () => {
  it("classifies have less than head as outdated", () => {
    expect(workspaceStatus(file({ haveRevision: "3", headRevision: "4" }))).toContain("outdated");
    expect(workspaceStatus(file({ haveRevision: "4", headRevision: "4" }))).not.toContain("outdated");
  });

  it("filters by status and path query", () => {
    const files = [
      file({ depotPath: "//Acme/main/a.txt", action: "edit", change: "42", haveRevision: "3", headRevision: "4" }),
      file({ depotPath: "//Acme/main/b.bin", unresolved: true }),
      file({ depotPath: "//Acme/lib/c.txt", mapped: false, otherOpen: true }),
    ];
    expect(filterWorkspaceFiles(files, "outdated", "a.txt").map((item) => item.depotPath)).toEqual(["//Acme/main/a.txt"]);
    expect(filterWorkspaceFiles(files, "otherOpen", "").map((item) => item.depotPath)).toEqual(["//Acme/lib/c.txt"]);
    expect(filterWorkspaceFiles(files, "all", "LIB").map((item) => item.depotPath)).toEqual(["//Acme/lib/c.txt"]);
  });

  it("filters locked files and exposes the locked status", () => {
    const locked = file({ depotPath: "//Acme/main/locked.txt", otherLock: true });
    expect(filterWorkspaceFiles([locked], "locked", "")).toEqual([locked]);
    expect(workspaceStatus(locked)).toContain("locked");
  });

  it("filters untracked files and exposes the status", () => {
    const untracked = file({ depotPath: "//Acme/main/new.txt", untracked: true, action: "add" });
    expect(filterWorkspaceFiles([untracked], "untracked", "")).toEqual([untracked]);
    expect(workspaceStatus(untracked)).toContain("untracked");
  });

  it("groups visible files by depot folder for tree mode", () => {
    const groups = groupWorkspaceFiles([
      file({ depotPath: "//Acme/z/z.txt" }),
      file({ depotPath: "//Acme/a/a.txt" }),
      file({ depotPath: "//Acme/z/other.txt" }),
    ]);
    expect(groups.map((group) => group.path)).toEqual(["//Acme/a", "//Acme/z"]);
    expect(groups[1].files).toHaveLength(2);
  });

  it("builds a real nested tree and marks ignored files", () => {
    const ignored = file({ depotPath: "//Acme/main/build/output.log", untracked: true, ignored: true });
    const tree = buildWorkspaceTree([ignored, file({ depotPath: "//Acme/main/readme.md" })]);
    expect(tree[0].path).toBe("//Acme");
    expect(tree[0].folders[0].path).toBe("//Acme/main");
    expect(tree[0].folders[0].folders[0].files[0]).toBe(ignored);
    expect(workspaceStatus(ignored)).toContain("ignored");
  });

  it("flattens folders in visible tree order", () => {
    const tree = buildWorkspaceTree([
      file({ depotPath: "//Acme/main/a.txt" }),
      file({ depotPath: "//Acme/main/deep/b.txt" }),
      file({ depotPath: "//Acme/tools/c.txt" }),
    ]);
    const ordered = workspaceFolderPaths(tree);
    expect(ordered).toEqual(["//Acme", "//Acme/main", "//Acme/main/deep", "//Acme/tools"]);
  });

  it("shows discovered empty folders while their contents are still loading", () => {
    const local = file({ depotPath: "//Acme/main/a.txt", clientPath: "//alex-main/Source/a.txt" });
    const directories = ["//alex-main", "//alex-main/Source", "//alex-main/Empty"];
    const tree = buildWorkspaceTree(
      [local],
      directories,
      new Set(["//alex-main/Empty"]),
      new Set(["//alex-main", "//alex-main/Source"]),
    );
    expect(tree[0].folders.map((folder) => folder.name)).toEqual(["Empty", "Source"]);
    expect(tree[0].folders[0].loading).toBe(true);
    expect(tree[0].folders[0].loaded).toBe(false);
    expect(tree[0].folders[1].loaded).toBe(true);
    expect(tree[0].folders[1].files).toEqual([local]);
    expect(workspaceDirectoryPaths([local])).toEqual(["//alex-main", "//alex-main/Source"]);
  });

  it("attaches streamed files directly to their discovered folders", () => {
    const first = file({ depotPath: "//Acme/main/a.txt", clientPath: "//alex-main/Source/a.txt" });
    const second = file({ depotPath: "//Acme/main/b.txt", clientPath: "//alex-main/Source/b.txt" });
    const tree = buildWorkspaceTree(
      [first, second],
      ["//alex-main", "//alex-main/Source", "//alex-main/Source/Empty"],
      new Set(["//alex-main/Source"]),
    );
    expect(tree[0].folders[0].files).toEqual([first, second]);
    expect(tree[0].folders[0].folders[0].path).toBe("//alex-main/Source/Empty");
  });

  it("indexes lazy directory snapshots by connection and directory", async () => {
    const connection = { port: "ssl:p4:1666", user: "alex", client: "alex-main" };
    const local = file({ depotPath: "//alex-main/Source/a.txt", clientPath: "//alex-main/Source/a.txt" });
    const key = workspaceDirectoryCacheKey(connection, "//alex-main/Source");
    const snapshot = {
      directory: "//alex-main/Source",
      directories: ["//alex-main/Source/Empty"],
      ignoredDirectories: ["//alex-main/Source/Empty"],
      files: [local],
      statuses: [],
      statusVersion: "v1",
    };
    await saveWorkspaceDirectoryCache(key, snapshot);
    expect(await loadWorkspaceDirectoryCache(key)).toEqual(snapshot);
    expect(workspaceLazyRoot(connection, "//...")).toBe("//alex-main");
    expect(workspaceLazyRoot(connection, "//alex-main/Source/...")).toBe("//alex-main/Source");
    expect(workspaceLazyRoot(connection, "//depot/main/...")).toBeUndefined();
    expect(workspaceDirectoryStatusScope("//alex-main/Source/")).toBe("//alex-main/Source/*");
  });

  it("marks ignored folders even when they are empty or not loaded", () => {
    const tree = buildWorkspaceTree(
      [],
      ["//alex-main", "//alex-main/build"],
      new Set(),
      new Set(["//alex-main"]),
      new Set(["//alex-main/build"]),
    );
    expect(tree[0].ignored).toBe(false);
    expect(tree[0].folders[0]).toMatchObject({ path: "//alex-main/build", ignored: true, loaded: false });
  });

  it("shows local files immediately and enriches matching paths with server status", () => {
    const local = file({ depotPath: "//client/Source/a.txt", clientPath: "//client/Source/a.txt", localPath: "\\\\?\\C:\\work\\Source\\a.txt", fileSize: 12, statusPending: true });
    const status = file({ depotPath: "//Acme/main/Source/a.txt", clientPath: "c:\\work\\source\\a.txt", mapped: false, action: "edit", change: "42" });
    expect(mergeWorkspaceFileStatuses([local], [status], true)).toEqual([{
      ...local,
      ...status,
      clientPath: local.clientPath,
      localPath: local.localPath,
      mapped: true,
      untracked: false,
      fileSize: 12,
      statusPending: false,
    }]);
    expect(mergeWorkspaceFileStatuses([local], [], false)[0].statusPending).toBe(true);
    expect(mergeWorkspaceFileStatuses([local], [file({ depotPath: "//Acme/main/missing.txt", localPath: "C:\\work\\missing.txt" })], true)).toHaveLength(1);
  });

  it("requests history only after a tracked file status is complete", () => {
    expect(workspaceFileHistoryPath(file({ depotPath: "//Acme/main/a.txt" }))).toBe("//Acme/main/a.txt");
    expect(workspaceFileHistoryPath(file({ statusPending: true }))).toBeUndefined();
    expect(workspaceFileHistoryPath(file({ mapped: false, untracked: true }))).toBeUndefined();
  });

  it("changes the status cache version only when changelist state changes", () => {
    const pending: PendingChange[] = [{ id: "42", description: "Work", user: "alex", client: "alex-main", time: "10" }];
    const opened: OpenedFile[] = [{ depotPath: "//Acme/main/a.txt", action: "edit", change: "42" }];
    const submitted: PendingChange[] = [{ id: "100", description: "Submit", user: "sam", client: "sam-main", time: "9" }];
    const version = workspaceStatusVersion(pending, opened, submitted);
    expect(workspaceStatusVersion([...pending].reverse(), [...opened].reverse(), submitted)).toBe(version);
    expect(workspaceStatusVersion(pending, [{ ...opened[0], action: "delete" }], submitted)).not.toBe(version);
    expect(workspaceStatusVersion(pending, opened, [{ ...submitted[0], id: "101" }])).not.toBe(version);
  });
});
