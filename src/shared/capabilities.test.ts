import { describe, expect, it } from "vitest";
import { capabilityGate, capabilityIsSupported, capabilitySetGate } from "./capabilities";

describe("capability gating", () => {
  it("allows an authoritative attempt for unknown facts but blocks proven unsupported facts", () => {
    expect(capabilityGate({ state: "unknown", reason: "permission_denied", evidence: "permission" })).toEqual({ allowed: true, reason: "permission_denied" });
    expect(capabilityGate({ state: "unsupported", reason: "command_missing", evidence: "client" })).toEqual({ allowed: false, reason: "command_missing" });
  });

  it("requires proven support for setup that is unsafe to infer", () => {
    expect(capabilityIsSupported({ state: "supported", reason: "unicode_enabled", evidence: "server" })).toBe(true);
    expect(capabilityIsSupported({ state: "unknown", reason: "unicode_unknown", evidence: "unavailable" })).toBe(false);
    expect(capabilityIsSupported()).toBe(false);
  });

  it("requires every proven requirement while allowing unknown requirements", () => {
    expect(capabilitySetGate([
      { state: "supported", reason: "verified_help", evidence: "client" },
      { state: "unknown", reason: "probe_unavailable", evidence: "unavailable" },
    ])).toBe(true);
    expect(capabilitySetGate([
      { state: "supported", reason: "verified_help", evidence: "client" },
      { state: "unsupported", reason: "flag_missing", evidence: "client" },
    ])).toBe(false);
  });
});
