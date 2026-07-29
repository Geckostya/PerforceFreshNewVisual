import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceOperationStatus } from "./View";

describe("workspace operation status", () => {
  it("orders the current files, determinate progress, and spinner from left to right", () => {
    const markup = renderToStaticMarkup(<WorkspaceOperationStatus label="Updating project" detail="current.bin · 2 / 4" ratio={0.5} />);

    expect(markup.indexOf("workspace-operation-copy")).toBeLessThan(markup.indexOf("workspace-progress"));
    expect(markup.indexOf("workspace-progress")).toBeLessThan(markup.indexOf("folder-loading-indicator"));
    expect(markup).toContain('aria-valuenow="50"');
    expect(markup).not.toContain("workspace-operation-action");
  });

  it("shows the current action before progress values are available", () => {
    const markup = renderToStaticMarkup(<WorkspaceOperationStatus label="Preparing update" detail="current.bin" />);

    expect(markup.indexOf("workspace-operation-copy")).toBeLessThan(markup.indexOf("workspace-operation-action"));
    expect(markup.indexOf("workspace-operation-action")).toBeLessThan(markup.indexOf("folder-loading-indicator"));
    expect(markup).not.toContain("workspace-progress");
  });

  it("does not duplicate a spinner with a progress bar when no measurable total exists", () => {
    const markup = renderToStaticMarkup(<WorkspaceOperationStatus label="Scanning workspace" detail="3 candidates found" />);

    expect(markup).not.toContain("workspace-progress");
    expect(markup).toContain("workspace-operation-action");
    expect(markup).toContain("folder-loading-indicator");
  });

  it("shows a real zero-percent bar once reconcile has a known total", () => {
    const markup = renderToStaticMarkup(<WorkspaceOperationStatus label="Opening selected files" detail="0 / 3 files opened" ratio={0} />);

    expect(markup).toContain("workspace-progress");
    expect(markup).toContain('aria-valuenow="0"');
  });
});
