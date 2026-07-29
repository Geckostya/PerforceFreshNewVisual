import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelistHistory, formatChangelistTime } from "./ChangelistHistory";
import { LocaleProvider } from "./i18n";

describe("ChangelistHistory", () => {
  it("renders the shared recent-activity row for every submitted change", () => {
    const html = renderToStaticMarkup(<LocaleProvider><ChangelistHistory
      title="Recent activity"
      summary="Latest 20"
      items={[
        { id: "42", description: "First change", user: "alice", client: "alice-main", time: "1720094400", stream: "//Acme/main" },
        { id: "41", description: "", user: "bob", client: "bob-main" },
      ]}
      showStream
      selectedId="42"
      agentId={(item) => `history:${item.id}`}
      onSelect={() => undefined}
    /></LocaleProvider>);

    expect(html.match(/changelist-history-row/g)).toHaveLength(2);
    expect(html).toContain("data-agent-id=\"history:42\"");
    expect(html).toContain("CL 42");
    expect(html).toContain("changelist-history-change changelist-number");
    expect(html).toContain("First change");
    expect(html).toContain("//Acme/main · alice · alice-main");
    expect(html).toContain("No description");
    expect(html).toContain("aria-pressed=\"true\"");
  });

  it("keeps non-numeric server dates intact", () => {
    expect(formatChangelistTime("2026/07/28", "en")).toBe("2026/07/28");
    expect(formatChangelistTime(undefined, "en")).toBeUndefined();
  });
});
