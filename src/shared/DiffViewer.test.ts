import { describe, expect, it } from "vitest";
import { parseRows } from "./DiffViewer";

describe("parseRows", () => {
  it("tracks line numbers and hunk positions", () => {
    const { rows, hunks } = parseRows("@@ -2,2 +2,3 @@\n-old\n context\n+new\n");

    expect(hunks).toEqual([0]);
    expect(rows[1].kind).toBe("remove");
    expect(rows[1].oldLine).toBe(2);
    expect(rows[1].newLine).toBeUndefined();
    expect(rows[2]).toMatchObject({ kind: "context", oldLine: 3, newLine: 2 });
    expect(rows[3].kind).toBe("add");
    expect(rows[3].oldLine).toBeUndefined();
    expect(rows[3].newLine).toBe(3);
  });
});
