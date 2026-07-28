import { describe, expect, it } from "vitest";
import { contextMenuPoint } from "./useContextMenu";

describe("context-menu positioning", () => {
  const bounds = { left: 100, top: 40, height: 32 };

  it("uses pointer coordinates when the menu came from a pointer", () => {
    expect(contextMenuPoint(240, 180, bounds)).toEqual({ x: 240, y: 180 });
  });

  it("uses a stable position inside the row for keyboard invocation", () => {
    expect(contextMenuPoint(undefined, undefined, bounds)).toEqual({ x: 124, y: 56 });
    expect(contextMenuPoint(0, 0, bounds)).toEqual({ x: 124, y: 56 });
  });
});
