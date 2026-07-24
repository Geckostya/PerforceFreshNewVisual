import { describe, expect, it } from "vitest";
import { directoryPattern, directoryScope, filePattern, parentScope, scopeBase, scopeSegments } from "./depot";

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
});
