import { describe, expect, it } from "vitest";
import { changeScope, DEPOT_HISTORY_PAGE_SIZE, directoryPattern, directoryScope, filePattern, parentScope, revisionScope, scopeBase, scopeSegments } from "./depot";

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

  it("uses a bounded server page size", () => {
    expect(DEPOT_HISTORY_PAGE_SIZE).toBe(100);
  });
});
