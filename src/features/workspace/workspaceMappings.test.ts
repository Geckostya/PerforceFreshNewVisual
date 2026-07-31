import { describe, expect, it } from "vitest";
import type { WorkspaceMappingEditor } from "../../shared/models";
import { createWorkspaceMappingDraft, moveWorkspaceMappingDraft, newWorkspaceMappingDraft, removeWorkspaceMappingDraft, serializeWorkspaceMappingDraft, workspaceMappingDraftCanMove, workspaceMappingDraftIsComplete } from "./workspaceMappings";

const editor: WorkspaceMappingEditor = {
  workspace: "sample-main",
  entries: [
    { index: 0, mapping: "//depot/main/... //sample-main/main/...", preservedOnly: false },
    { index: 1, mapping: "# extension-owned entry", preservedOnly: true },
  ],
};

describe("workspace mapping editor draft", () => {
  it("keeps existing mapping text opaque and serializes only its server index", () => {
    const entries = createWorkspaceMappingDraft(editor);
    expect(entries[1]).toMatchObject({ mapping: "# extension-owned entry", preservedOnly: true });
    expect(serializeWorkspaceMappingDraft(entries)).toEqual([
      { source: "existing", index: 0 },
      { source: "existing", index: 1 },
    ]);
  });

  it("does not remove, move, or cross a protected unknown entry", () => {
    const entries = createWorkspaceMappingDraft(editor);
    expect(removeWorkspaceMappingDraft(entries, "existing-1")).toBe(entries);
    expect(workspaceMappingDraftCanMove(entries, "existing-1", -1)).toBe(false);
    expect(workspaceMappingDraftCanMove(entries, "existing-0", 1)).toBe(false);
    expect(moveWorkspaceMappingDraft(entries, "existing-1", -1)).toBe(entries);
    expect(moveWorkspaceMappingDraft(entries, "existing-0", 1)).toBe(entries);
  });

  it("serializes complete new rows without interpreting server rows", () => {
    const added = { ...newWorkspaceMappingDraft("new-1"), kind: "exclude" as const, depotPath: "  //depot/tmp/... ", clientPath: " //sample-main/tmp/... " };
    expect(workspaceMappingDraftIsComplete([added])).toBe(true);
    expect(serializeWorkspaceMappingDraft([added])).toEqual([{
      source: "new",
      kind: "exclude",
      depotPath: "//depot/tmp/...",
      clientPath: "//sample-main/tmp/...",
    }]);
    expect(workspaceMappingDraftIsComplete([{ ...added, clientPath: "sample-main/tmp/..." }])).toBe(false);
  });
});
