import { describe, expect, it } from "vitest";
import { snapshotMatches, snapshotForTool, type UiSnapshot } from "./session.js";

const snapshot: UiSnapshot = {
  schemaVersion: 2,
  stateVersion: 12,
  generatedAt: "2026-07-23T00:00:00.000Z",
  screen: "connection",
  location: "tauri://localhost/",
  title: "P4FNV",
  settled: true,
  busy: false,
  elements: [{
    index: 0,
    locator: "id:refresh",
    tag: "button",
    accessibleName: "Refresh",
    text: "Refresh",
    disabled: false,
    hidden: false,
  }],
  html: "<body><button id=\"refresh\">Refresh</button></body>",
};

describe("agent snapshot matching", () => {
  it("matches stable versions, text, and locators", () => {
    expect(snapshotMatches(snapshot, {
      minimumStateVersion: 12,
      containsText: "refresh",
      target: "id:refresh",
      screen: "connection",
    })).toBe(true);
    expect(snapshotMatches(snapshot, { minimumStateVersion: 13 })).toBe(false);
    expect(snapshotMatches({ ...snapshot, busy: true }, {})).toBe(false);
  });

  it("omits raw HTML unless explicitly requested", () => {
    expect(snapshotForTool(snapshot)).not.toHaveProperty("html");
    expect(snapshotForTool(snapshot, true)).toHaveProperty("html", snapshot.html);
  });
});
