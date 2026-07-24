import { describe, expect, it } from "vitest";
import { validateConnection } from "./connection";

describe("validateConnection", () => {
  it("accepts plain and SSL Helix server addresses", () => {
    expect(validateConnection({ port: "perforce.local:1666", user: "alex" })).toEqual({});
    expect(validateConnection({ port: "ssl:p4.company.net:1667", user: "alex" })).toEqual({});
  });

  it("reports fields that cannot produce a connection", () => {
    expect(validateConnection({ port: "server-without-port", user: " " })).toEqual({
      port: "portInvalid",
      user: "userRequired",
    });
  });

  it("rejects ports outside the TCP range", () => {
    expect(validateConnection({ port: "p4.local:70000", user: "alex" }).port).toBeDefined();
  });

  it("requires a workspace only for the direct open action", () => {
    const fields = { port: "p4.local:1666", user: "alex", client: "" };
    expect(validateConnection(fields)).toEqual({});
    expect(validateConnection(fields, true)).toEqual({ client: "workspaceRequired" });
  });
});
