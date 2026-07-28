import { describe, expect, it } from "vitest";
import { connectionForServer } from "./connection";

describe("connectionForServer", () => {
  const input = { port: "p4:1666", user: "alex", client: "alex-main" };

  it("uses UTF-8 for automatic charset on a Unicode server", () => {
    expect(connectionForServer(input, { unicode: "enabled" })).toEqual({
      ...input,
      charset: "utf8",
    });
  });

  it("leaves automatic charset unset on a non-Unicode server", () => {
    expect(connectionForServer(input, { unicode: "disabled" })).toBe(input);
    expect(connectionForServer(input, {})).toBe(input);
  });

  it("preserves an explicitly selected charset", () => {
    const explicit = { ...input, charset: "utf8-bom" };
    expect(connectionForServer(explicit, { unicode: "enabled" })).toBe(explicit);
  });
});
