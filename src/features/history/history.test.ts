import { describe, expect, it } from "vitest";
import { filterSubmittedChanges, previousRevision } from "./history";

const changes = [
  { id: "42", description: "Fix menu", user: "alex", client: "main", time: "2026/07/22" },
  { id: "41", description: "Update tests", user: "sam", client: "release", time: "2026/07/21" },
];

describe("filterSubmittedChanges", () => {
  it("matches changelist fields case-insensitively", () => {
    expect(filterSubmittedChanges(changes, "MENU", "", "").map((change) => change.id)).toEqual(["42"]);
    expect(filterSubmittedChanges(changes, "", "sam", "").map((change) => change.id)).toEqual(["41"]);
    expect(filterSubmittedChanges(changes, "", "", "release").map((change) => change.id)).toEqual(["41"]);
  });

  it("returns a safe previous numeric revision for inline diff", () => {
    expect(previousRevision("8")).toBe("7");
    expect(previousRevision("1")).toBeUndefined();
    expect(previousRevision("head")).toBeUndefined();
  });
});
