import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isSurfaceActivationKey, SelectableRow, SelectableSurface, TreeItemRow } from "./ItemList";

describe("shared item-list primitives", () => {
  it("uses one selected style with the ARIA state required by the host role", () => {
    const option = renderToStaticMarkup(<SelectableRow selected selectionRole="option">File</SelectableRow>);
    const action = renderToStaticMarkup(<SelectableRow selected>Change</SelectableRow>);

    expect(option).toContain("class=\"item-row selected\"");
    expect(option).toContain("role=\"option\"");
    expect(option).toContain("aria-selected=\"true\"");
    expect(option).not.toContain("aria-pressed");
    expect(action).toContain("aria-pressed=\"true\"");
  });

  it("renders tree disclosure, hierarchy, copy, and selection through one row", () => {
    const html = renderToStaticMarkup(<TreeItemRow
      depth={2}
      selected
      disclosure={{ expanded: true, label: "Collapse", onToggle: () => undefined }}
      agentId="tree:item"
      icon={<span>icon</span>}
      primary="Item"
      secondary="//depot/item"
      trailing={<span>meta</span>}
    />);

    expect(html).toContain("class=\"item-row tree-item-row selected\"");
    expect(html).toContain("--item-depth:2");
    expect(html).toContain("aria-level=\"3\"");
    expect(html).toContain("aria-selected=\"true\"");
    expect(html.match(/aria-expanded=\"true\"/g)).toHaveLength(2);
    expect(html).toContain("data-agent-id=\"tree:item\"");
    expect(html).toContain("class=\"item-row-copy\"");
  });

  it("does not invent selection state for a non-selectable list item", () => {
    const html = renderToStaticMarkup(<SelectableSurface role="listitem">History</SelectableSurface>);
    expect(html).not.toContain("aria-selected");
    expect(html).not.toContain("aria-pressed");
  });

  it("gives div-backed rows native button activation keys", () => {
    expect(isSurfaceActivationKey("Enter")).toBe(true);
    expect(isSurfaceActivationKey(" ")).toBe(true);
    expect(isSurfaceActivationKey("ArrowDown")).toBe(false);
  });
});
