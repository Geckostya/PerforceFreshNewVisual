import { describe, expect, it } from "vitest";
import { isUiAgentCommand } from "./uiSnapshot";

describe("UI agent command validation", () => {
  it("accepts only the narrow UI action contract", () => {
    expect(isUiAgentCommand({
      id: "request-1",
      token: "token",
      method: "ui.click",
      expectedStateVersion: 4,
      target: "id:refresh",
    })).toBe(true);
    expect(isUiAgentCommand({
      id: "request-2",
      token: "token",
      method: "run_p4",
      expectedStateVersion: 4,
      target: "sync -f //...",
    })).toBe(false);
  });
});
