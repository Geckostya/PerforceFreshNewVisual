import { describe, expect, it } from "vitest";
import type { OpenedFile, PendingChange } from "../../shared/models";
import {
  decodeChangeDrag,
  dragEffectAllowed,
  dropEffect,
  encodeChangeDrag,
  changeOptionLabel,
  filterChangeGroups,
  formatSubmitJob,
  groupChanges,
  hasUnresolvedSubmitIssue,
  resolveChangeDrop,
  shouldRefreshOnFocus,
  visibleShelfFiles,
} from "./changes";

describe("submit job summary", () => {
  it("keeps useful metadata while tolerating missing optional fields", () => {
    expect(formatSubmitJob({ id: "job00042", status: "open", user: "alex", date: "2026/07/22" })).toBe("job00042 · open · alex · 2026/07/22");
    expect(formatSubmitJob({ id: "job00043" })).toBe("job00043");
  });
});

describe("groupChanges", () => {
  it("always exposes default and keeps files from unlisted changelists", () => {
    const changes: PendingChange[] = [
      { id: "42", description: "Menu", user: "alex", client: "alex-main" },
    ];
    const files: OpenedFile[] = [
      { depotPath: "//main/a.ts", action: "edit", change: "default" },
      { depotPath: "//main/b.ts", action: "add", change: "42" },
      { depotPath: "//main/c.ts", action: "delete", change: "99" },
    ];

    const result = groupChanges(changes, files);
    expect(result.map(({ id }) => id)).toEqual(["default", "42", "99"]);
    expect(result.map(({ files }) => files.length)).toEqual([1, 1, 1]);
  });

  it("marks shelves and includes a shelf without opened files", () => {
    const shelves: PendingChange[] = [
      { id: "42", description: "Menu", user: "alex", client: "alex-main" },
      { id: "77", description: "Review", user: "alex", client: "alex-main" },
    ];
    const groups = groupChanges(shelves.slice(0, 1), [], shelves);

    expect(groups.map(({ id, isShelved }) => [id, isShelved])).toEqual([
      ["default", false], ["42", true], ["77", true],
    ]);
  });
});

describe("pending changelist filter", () => {
  it("matches id/metadata and keeps the selected changelist visible", () => {
    const groups = groupChanges([
      { id: "42", description: "Fix menu", user: "alex", client: "main" },
      { id: "77", description: "Release", user: "sam", client: "release" },
    ], []);
    expect(filterChangeGroups(groups, "release", "42").map((group) => group.id)).toEqual(["42", "77"]);
    expect(filterChangeGroups(groups, "menu").map((group) => group.id)).toEqual(["42"]);
    expect(filterChangeGroups(groups, "", "default")).toHaveLength(3);
  });
});

describe("shouldRefreshOnFocus", () => {
  it("refreshes only on focus and throttles rapid focus events", () => {
    expect(shouldRefreshOnFocus(true, 1_000, 2_500)).toBe(true);
    expect(shouldRefreshOnFocus(true, 1_000, 2_499)).toBe(false);
    expect(shouldRefreshOnFocus(false, 1_000, 3_000)).toBe(false);
  });
});

describe("changeOptionLabel", () => {
  it("adds descriptions to numbered changelists and names Default explicitly", () => {
    const groups = groupChanges(
      [{ id: "42", description: "Fix loading screen", user: "alex", client: "alex-main" }],
      [],
    );

    expect(changeOptionLabel(groups[0], "Default changelist", "No description")).toBe("Default changelist");
    expect(changeOptionLabel(groups[1], "Default changelist", "No description")).toBe("CL 42 · Fix loading screen");
  });
});

describe("changelist drag and drop", () => {
  const opened = { kind: "opened" as const, depotPaths: ["//main/a.ts", "//main/b.ts"], sourceChange: "42" };
  const shelved = { kind: "shelved" as const, depotPaths: ["//main/a.ts"], sourceChange: "42" };

  it("round-trips only valid internal drag payloads", () => {
    expect(decodeChangeDrag(encodeChangeDrag(opened))).toEqual(opened);
    expect(decodeChangeDrag("not json")).toBeUndefined();
    expect(decodeChangeDrag('{"kind":"opened","depotPaths":["C:/a"],"sourceChange":"42"}')).toBeUndefined();
  });

  it("maps drops to real Perforce operations", () => {
    expect(resolveChangeDrop(opened, { kind: "changelist", change: "77" })).toEqual({
      kind: "move", depotPaths: ["//main/a.ts", "//main/b.ts"], targetChange: "77",
    });
    expect(resolveChangeDrop(opened, { kind: "shelf", change: "77" })).toEqual({
      kind: "shelve", depotPaths: ["//main/a.ts", "//main/b.ts"], sourceChange: "42", targetChange: "77",
    });
    expect(resolveChangeDrop(shelved, { kind: "changelist", change: "default" })).toEqual({
      kind: "unshelve", depotPaths: ["//main/a.ts"], sourceChange: "42", targetChange: "default",
    });
    expect(resolveChangeDrop(shelved, { kind: "changelist", change: "77" })).toEqual({
      kind: "unshelve", depotPaths: ["//main/a.ts"], sourceChange: "42", targetChange: "77",
    });
    expect(resolveChangeDrop(opened, { kind: "shelf", change: "default" })).toBeUndefined();
    expect(resolveChangeDrop(opened, { kind: "changelist", change: "42" })).toBeUndefined();
  });

  it("allows both copy and move for local files and chooses the target effect", () => {
    expect(dragEffectAllowed("opened")).toBe("copyMove");
    expect(dragEffectAllowed("shelved")).toBe("copy");
    expect(dropEffect(resolveChangeDrop(opened, { kind: "changelist", change: "77" })!)).toBe("move");
    expect(dropEffect(resolveChangeDrop(opened, { kind: "shelf", change: "77" })!)).toBe("copy");
    expect(dropEffect(resolveChangeDrop(shelved, { kind: "changelist", change: "77" })!)).toBe("copy");
  });
});

describe("shelf cache visibility", () => {
  const cached = [{ depotPath: "//main/old.txt", action: "add" }];

  it("never exposes cached files after the server reports that the shelf is gone", () => {
    expect(visibleShelfFiles(false, cached)).toEqual([]);
    expect(visibleShelfFiles(true, cached)).toEqual(cached);
  });
});

describe("submit resolve gate", () => {
  it("blocks only when preflight reports an unresolved file", () => {
    expect(hasUnresolvedSubmitIssue([{ depotPath: "//main/a", kind: "out_of_date", detail: "old" }])).toBe(false);
    expect(hasUnresolvedSubmitIssue([{ depotPath: "//main/a", kind: "unresolved", detail: "needs resolve" }])).toBe(true);
  });
});
