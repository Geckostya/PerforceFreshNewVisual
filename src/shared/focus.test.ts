import { describe, expect, it, vi } from "vitest";
import { focusCurrentViewHeading, nextPaneIndex } from "./focus";

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

  it("moves shortcut navigation focus to the new screen heading", () => {
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() } as unknown as HTMLElement;
    const root = { querySelector: vi.fn(() => target) } as unknown as ParentNode;

    expect(focusCurrentViewHeading(root)).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith(".workspace-main .resource-view h1[data-pane-entry]");
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("leaves focus unchanged while no resource screen is mounted", () => {
    const root = { querySelector: vi.fn(() => null) } as unknown as ParentNode;
    expect(focusCurrentViewHeading(root)).toBe(false);
  });
});
