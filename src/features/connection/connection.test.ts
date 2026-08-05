import { describe, expect, it } from "vitest";
import { capabilityGate } from "../../shared/capabilities";
import { authReducer, authShouldPoll, initialAuthState, trustDialogModel, validateConnection } from "./connection";

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

describe("authentication state", () => {
  it("clears secret responses after use, failure, and cancellation", () => {
    const entered = authReducer({ ...initialAuthState, open: true }, { type: "response", response: "123456" });
    const busy = authReducer(entered, { type: "busy" });
    expect(busy.response).toBe("");
    const failed = authReducer({ ...entered }, { type: "error", error: { kind: "auth", message: "failed", hints: [] } });
    expect(failed.response).toBe("");
    expect(authReducer(entered, { type: "cancel" }).response).toBe("");
  });

  it("polls only bounded browser or waiting stages", () => {
    expect(authShouldPoll({ kind: "waiting", methods: [], pollingAttempt: 19, maxPollingAttempts: 20 })).toBe(true);
    expect(authShouldPoll({ kind: "waiting", methods: [], pollingAttempt: 20, maxPollingAttempts: 20 })).toBe(false);
    expect(authShouldPoll({ kind: "second_factor", methods: [], pollingAttempt: 1, maxPollingAttempts: 20 })).toBe(false);
  });
});

describe("capability gating", () => {
  it("allows a safe authoritative server attempt for unknown facts", () => {
    expect(capabilityGate({ state: "unknown", reason: "permission_denied", evidence: "permission" })).toEqual({ allowed: true, reason: "permission_denied" });
    expect(capabilityGate({ state: "unsupported", reason: "workspace_classic", evidence: "workspace" }).allowed).toBe(false);
  });
});

describe("trust confirmation", () => {
  it("keeps the complete new and changed fingerprints in the dialog model", () => {
    const fingerprint = "SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
    expect(trustDialogModel({ server: "ssl:p4:1666", presentedFingerprint: fingerprint, reason: "new" })).toEqual({ title: "trustNewTitle", warning: "trustNewWarning", fingerprint });
    expect(trustDialogModel({ server: "ssl:p4:1666", presentedFingerprint: fingerprint, existingFingerprint: "MD5:11", reason: "changed" }).title).toBe("trustChangedTitle");
  });
});
