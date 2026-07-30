import { describe, expect, it } from "vitest";
import { initialResolveResult, replaceResolveConflict, resolveConflictRanges } from "./ResolveDialog";

describe("three-way resolve result", () => {
  it("takes the changed side when the other side still matches base", () => {
    expect(initialResolveResult("base", "source", "base")).toBe("source");
    expect(initialResolveResult("base", "base", "workspace")).toBe("workspace");
  });

  it("creates navigable markers for overlapping edits", () => {
    const result = initialResolveResult("base", "source", "workspace");
    expect(resolveConflictRanges(result)).toEqual([{
      start: 0,
      end: result.length,
      workspace: "workspace",
      source: "source",
    }]);
  });

  it("combines independent workspace and source edits without a conflict", () => {
    expect(initialResolveResult(
      "alpha\nshared\nomega",
      "source-alpha\nshared\nomega",
      "alpha\nshared\nworkspace-omega",
    )).toBe("source-alpha\nshared\nworkspace-omega");
  });

  it("limits conflict markers to overlapping line changes", () => {
    const result = initialResolveResult(
      "alpha\nshared\nomega",
      "alpha\nsource-change\nomega",
      "alpha\nworkspace-change\nomega",
    );
    const [conflict] = resolveConflictRanges(result);

    expect(conflict.workspace).toBe("workspace-change");
    expect(conflict.source).toBe("source-change");
    expect(replaceResolveConflict(result, conflict, "workspace")).toBe("alpha\nworkspace-change\nomega");
  });

  it("keeps equal insertions only once", () => {
    expect(initialResolveResult("alpha\nomega", "alpha\nshared\nomega", "alpha\nshared\nomega"))
      .toBe("alpha\nshared\nomega");
  });

  it("falls back to one explicit conflict when the bounded diff budget is exceeded", () => {
    const base = Array.from({ length: 600 }, (_, index) => `base-${index}`).join("\n");
    const source = Array.from({ length: 600 }, (_, index) => `source-${index}`).join("\n");
    const workspace = Array.from({ length: 600 }, (_, index) => `workspace-${index}`).join("\n");

    expect(resolveConflictRanges(initialResolveResult(base, source, workspace))).toHaveLength(1);
  });

  it("accepts one side without altering text outside the selected hunk", () => {
    const value = `before\n${initialResolveResult("base", "source", "workspace")}\nafter`;
    const conflict = resolveConflictRanges(value)[0];
    expect(replaceResolveConflict(value, conflict, "source")).toBe("before\nsource\nafter");
  });
});
