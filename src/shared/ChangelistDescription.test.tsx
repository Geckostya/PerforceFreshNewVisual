import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangelistDescription, externalMarkdownUrl, markdownToPlainText } from "./ChangelistDescription";

describe("ChangelistDescription", () => {
  it("renders formatted issue links without accepting raw HTML", () => {
    const html = renderToStaticMarkup(<ChangelistDescription value={'**[BUG-7233 [Bullets]](https://deadgunslinger.atlassian.net/browse/BUG-7233)** <script>alert("x")</script>'} />);
    expect(html).toContain("<strong><a href=\"https://deadgunslinger.atlassian.net/browse/BUG-7233\"");
    expect(html).toContain("BUG-7233 [Bullets]");
    expect(html).not.toContain("<script>");
  });

  it("allows only web links", () => {
    expect(externalMarkdownUrl("https://example.com/work/42")).toBe("https://example.com/work/42");
    expect(externalMarkdownUrl("http://example.com/work/42")).toBe("http://example.com/work/42");
    expect(externalMarkdownUrl("javascript:alert(1)")).toBeUndefined();
    expect(externalMarkdownUrl("file:///C:/secret.txt")).toBeUndefined();
  });

  it("provides readable text for native controls", () => {
    expect(markdownToPlainText("**[BUG-7233](https://example.com/BUG-7233)**")).toBe("BUG-7233");
  });
});
