import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");

describe("100/125/200% scale layout evidence", () => {
  it("keeps the full-width 100% resource layout bounded", () => {
    expect(css).toContain("grid-template-columns: minmax(340px, 1.2fr) minmax(300px, .8fr);");
    expect(css).toContain(".resource-list,\n.resource-pane,\n.resource-inspector");
  });

  it("compacts navigation before the 125% effective viewport crowds content", () => {
    expect(css).toContain("@media (max-width: 980px)");
    expect(css).toContain(".workspace-shell.sidebar-expanded,\n  .workspace-shell.sidebar-compact { grid-template-columns: 58px minmax(0, 1fr); }");
  });

  it("stacks actions and resource panes at the 200% narrow viewport boundary", () => {
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain(".view-heading { grid-template-columns: minmax(0, 1fr); align-items: stretch; }");
    expect(css).toContain(".resource-workbench.three-pane,\n  .streams-workbench,\n  .depot-overview-workbench { grid-template-columns: minmax(0, 1fr); overflow: auto; }");
  });
});
