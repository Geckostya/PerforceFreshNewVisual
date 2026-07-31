import { describe, expect, it } from "vitest";
import { resolveOutcome, specializedResolveModes } from "./SpecializedResolveDialog";

describe("specialized resolve flows", () => {
  it("offers only safe side choices for binary conflicts", () => {
    expect(specializedResolveModes("binary")).toEqual(["yours", "theirs"]);
  });

  it("offers category-specific merge choices for move, type, and stream specs", () => {
    expect(specializedResolveModes("move_name")).toContain("autoMerge");
    expect(specializedResolveModes("filetype_attribute")).toContain("autoMerge");
    expect(specializedResolveModes("stream_spec")).toEqual(["yours", "theirs", "autoSafe", "autoMerge"]);
  });

  it("keeps cancel and unknown or partial read-back states distinct", () => {
    expect(resolveOutcome({ items: [{ depotPath: "//a", state: "resolved" }] })).toBe("resolved");
    expect(resolveOutcome({ items: [{ depotPath: "//a", state: "pending" }] })).toBe("partial");
    expect(resolveOutcome({ items: [{ depotPath: "//a", state: "unknown" }] })).toBe("unknown");
  });
});
