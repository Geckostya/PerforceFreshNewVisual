import { describe, expect, it } from "vitest";
import { nextPaneIndex } from "./focus";

describe("pane focus order", () => {
  it("cycles forward and backward and enters from outside", () => {
    expect(nextPaneIndex(-1, 4)).toBe(0);
    expect(nextPaneIndex(-1, 4, true)).toBe(3);
    expect(nextPaneIndex(3, 4)).toBe(0);
    expect(nextPaneIndex(0, 4, true)).toBe(3);
  });

  it("has no target for an empty shell", () => {
    expect(nextPaneIndex(0, 0)).toBe(-1);
  });
});
