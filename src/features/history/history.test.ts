import { describe, expect, it } from "vitest";
import { filterSubmittedChanges, isLargeSubmittedChange, nextSubmittedFileRenderLimit, previousRevision, submittedChangeStream, submittedRevisionScopes, submittedScope } from "./history";

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

  it("uses all streams by default and scopes current-stream history explicitly", () => {
    expect(submittedScope("//Acme/main", "all")).toBe("//...");
    expect(submittedScope("//Acme/main", "current")).toBe("//Acme/main/...");
    expect(submittedScope(undefined, "current")).toBe("//...");
  });

  it("identifies one exact source stream for cherry-pick", () => {
    const streams = [
      { path: "//Acme/main", name: "main", streamType: "mainline", description: "" },
      { path: "//Acme/dev", name: "dev", streamType: "development", description: "" },
    ];
    expect(submittedChangeStream([
      { depotPath: "//Acme/dev/a.txt", action: "edit", revision: "4" },
      { depotPath: "//Acme/dev/lib/b.txt", action: "add", revision: "1" },
    ], streams)).toBe("//Acme/dev");
    expect(submittedChangeStream([
      { depotPath: "//Acme/dev/a.txt", action: "edit", revision: "4" },
      { depotPath: "//Acme/main/b.txt", action: "edit", revision: "2" },
    ], streams)).toBeUndefined();
  });

  it("builds exact retrieval scopes for every described revision", () => {
    expect(submittedRevisionScopes([
      { depotPath: "//Acme/main/a.txt", action: "edit", revision: "7" },
      { depotPath: "//Acme/main/old.txt", action: "delete", revision: "3" },
      { depotPath: "//Acme/main/unknown.txt", action: "edit" },
    ])).toEqual(["//Acme/main/a.txt#7", "//Acme/main/old.txt#3"]);
  });

  it("reveals large submitted file lists in bounded render pages", () => {
    expect(nextSubmittedFileRenderLimit(200, 84451)).toBe(400);
    expect(nextSubmittedFileRenderLimit(800, 850)).toBe(850);
    expect(isLargeSubmittedChange(200, true)).toBe(true);
    expect(isLargeSubmittedChange(201, false)).toBe(true);
    expect(isLargeSubmittedChange(200, false)).toBe(false);
  });
});
