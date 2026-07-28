import { describe, expect, it } from "vitest";
import { changeScope, directoryPattern, directoryScope, filePattern, hasNextHistoryPage, historyPageItems, historyPageLimit, parentScope, revisionScope, scopeBase, scopeSegments } from "./depot";

describe("depot browser patterns", () => {
  it("uses dirs star and files ellipsis patterns", () => {
    expect(directoryPattern("//Acme/main/..." )).toBe("//Acme/main/*");
    expect(filePattern("//Acme/main/*")).toBe("//Acme/main/...");
  });

  it("keeps a direct directory scope safe", () => {
    expect(directoryPattern("//Acme/main")).toBe("//Acme/main/*");
    expect(filePattern("//Acme/main")).toBe("//Acme/main/...");
  });

  it("builds navigable directory scopes and breadcrumbs", () => {
    expect(directoryScope("//Acme/main/src/")).toBe("//Acme/main/src/...");
    expect(scopeBase("//Acme/main/src/.../")).toBe("//Acme/main/src");
    expect(parentScope("//Acme/main/src/..." )).toBe("//Acme/main/...");
    expect(parentScope("//Acme/...")).toBe("//...");
    expect(scopeSegments("//Acme/main/src/..." )).toEqual(["Acme", "main", "src"]);
  });

  it("builds exact historical sync scopes", () => {
    expect(revisionScope("//Acme/main/readme.md", "7")).toBe("//Acme/main/readme.md#7");
    expect(changeScope("//Acme/main/src/", "1234")).toBe("//Acme/main/src/...@1234");
  });

  it("paginates bounded history without appending into the visible page", () => {
    const items = Array.from({ length: 201 }, (_, index) => index + 1);
    expect(historyPageLimit(0)).toBe(101);
    expect(historyPageLimit(49)).toBe(5000);
    expect(historyPageItems(items, 1)).toEqual(Array.from({ length: 100 }, (_, index) => index + 101));
    expect(hasNextHistoryPage(items.length, 1)).toBe(true);
    expect(hasNextHistoryPage(200, 1)).toBe(false);
  });
});
