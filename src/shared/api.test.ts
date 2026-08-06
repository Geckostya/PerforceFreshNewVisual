import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { deleteChange, listOpenedFiles, listPendingChanges, reopenFiles, shelveFiles, unshelveFiles } from "./api";

beforeEach(() => vi.mocked(invoke).mockReset());

describe("deleteChange", () => {
  it("invalidates pending changelists before the UI refreshes", async () => {
    const connection = { port: "1666", user: "api-delete-test", client: "api-delete-test" };
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce([{ id: "42", description: "Delete me", user: connection.user, client: connection.client }]);
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce([]);

    await listPendingChanges(connection);
    await deleteChange(connection, "42");

    await expect(listPendingChanges(connection)).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "list_pending_changes", { input: connection });
  });
});

describe("workspace mutations", () => {
  it.each([
    ["reopen", (connection: { port: string; user: string; client: string }) => reopenFiles(connection, ["//main/a.txt"], "42")],
    ["shelve", (connection: { port: string; user: string; client: string }) => shelveFiles(connection, "42")],
    ["unshelve", (connection: { port: string; user: string; client: string }) => unshelveFiles(connection, "42", "default")],
  ])("invalidates cached opened files after %s", async (_name, mutate) => {
    const connection = { port: "1666", user: `api-mutation-${_name}`, client: "api-mutation-test" };
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce([{ depotPath: "//main/a.txt", action: "edit", change: "42" }]);
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce([]);

    await listOpenedFiles(connection);
    await mutate(connection);

    await expect(listOpenedFiles(connection)).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "list_opened_files", { input: connection });
  });
});
