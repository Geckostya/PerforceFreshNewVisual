import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../shared/i18n";
import { UndoDialog } from "./UndoDialog";

const connection = { port: "ssl:perforce:1666", user: "gecko", client: "gecko-main" };

describe("UndoDialog", () => {
  it("uses a pending changelist selector and keeps new changelist creation optional", () => {
    const html = renderToStaticMarkup(<LocaleProvider><UndoDialog
      connection={connection}
      sourceChange="42"
      onClose={() => undefined}
      onComplete={() => undefined}
    /></LocaleProvider>);

    expect(html).toContain("data-agent-id=\"undo-target-change\"");
    expect(html).toContain("Default changelist");
    expect(html).toContain("Create new changelist…");
    expect(html).not.toContain("New changelist description");
  });

  it("disables only rollback preview for a large change", () => {
    const html = renderToStaticMarkup(<LocaleProvider><UndoDialog
      connection={connection}
      sourceChange="84451"
      previewDisabledReason="Too many files"
      onClose={() => undefined}
      onComplete={() => undefined}
    /></LocaleProvider>);

    expect(html).toContain("Rollback preview is unavailable");
    expect(html).toContain("title=\"Too many files\"");
    expect(html).toContain("data-agent-id=\"undo-preview\"");
    expect(html).toContain("aria-describedby=\"undo-preview-disabled\"");
    expect(html).toMatch(/data-agent-id="undo-preview"[^>]*disabled/);
    expect(html).toMatch(/data-agent-id="undo-apply"/);
    expect(html).not.toMatch(/data-agent-id="undo-apply"[^>]*disabled/);
  });
});
