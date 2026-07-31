import { describe, expect, it } from "vitest";
import { connectionForServer } from "./connection";
import type { P4Info } from "./models";

describe("connectionForServer", () => {
  const input = { port: "p4:1666", user: "alex", client: "alex-main" };
  const info = (state: "supported" | "unsupported" | "unknown") => ({
    unicode: state === "supported" ? "enabled" : state === "unsupported" ? "disabled" : "future-mode",
    capabilities: {
      facts: {
        unicodeServer: { state, reason: `unicode_${state}`, evidence: state === "unknown" ? "unavailable" : "server" },
      },
    },
  }) as P4Info;

  it("uses UTF-8 for automatic charset on a Unicode server", () => {
    expect(connectionForServer(input, info("supported"))).toEqual({
      ...input,
      charset: "utf8",
    });
  });

  it("leaves automatic charset unset unless Unicode support is proven", () => {
    expect(connectionForServer(input, info("unsupported"))).toBe(input);
    expect(connectionForServer(input, info("unknown"))).toBe(input);
    expect(connectionForServer(input, { unicode: "enabled" })).toBe(input);
    expect(connectionForServer(input, {})).toBe(input);
  });

  it("preserves an explicitly selected charset", () => {
    const explicit = { ...input, charset: "utf8-bom" };
    expect(connectionForServer(explicit, info("supported"))).toBe(explicit);
  });
});
