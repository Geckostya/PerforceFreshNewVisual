import { describe, expect, it } from "vitest";
import { collectionTargetIndex, isContextMenuShortcut, retainAvailableSelection, selectionMode, updateSelection } from "./selection";

describe("shared list selection", () => {
  const items = ["a", "b", "c", "d"];

  it("uses the same single, toggle, and range rules for every list", () => {
    expect(selectionMode({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe("single");
    expect(selectionMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe("toggle");
    expect(selectionMode({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe("range");
    expect(updateSelection(items, ["a"], "b", "a", "single").selected).toEqual(["b"]);
    expect(updateSelection(items, ["a"], "c", "a", "range").selected).toEqual(["a", "b", "c"]);
    expect(updateSelection(items, ["a", "b"], "b", "a", "toggle").selected).toEqual(["a"]);
  });

  it("maps arrow, boundary, and page keys without moving outside the collection", () => {
    expect(collectionTargetIndex(5, 30, "ArrowDown")).toBe(6);
    expect(collectionTargetIndex(0, 30, "ArrowUp")).toBe(0);
    expect(collectionTargetIndex(8, 30, "PageDown")).toBe(18);
    expect(collectionTargetIndex(8, 30, "PageUp")).toBe(0);
    expect(collectionTargetIndex(8, 30, "Home")).toBe(0);
    expect(collectionTargetIndex(8, 30, "End")).toBe(29);
  });

  it("drops stale items and recognizes both keyboard context-menu shortcuts", () => {
    expect(retainAvailableSelection(["a", "b", "c"], ["a", "c", "d"])).toEqual(["a", "c"]);
    expect(isContextMenuShortcut("ContextMenu")).toBe(true);
    expect(isContextMenuShortcut("F10", true)).toBe(true);
    expect(isContextMenuShortcut("F10", false)).toBe(false);
  });
});
