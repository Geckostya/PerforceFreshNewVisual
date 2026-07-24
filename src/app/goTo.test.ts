import { describe, expect, it } from "vitest";
import { classifyGoTo } from "./goTo";

describe("global go to classification", () => {
  it("routes depot paths and workspace scopes", () => {
    expect(classifyGoTo("//Acme/main/..." )).toEqual({ kind: "depot", value: "//Acme/main/..." });
    expect(classifyGoTo("ws://Acme/main/..." )).toEqual({ kind: "workspace", value: "//Acme/main/..." });
  });

  it("routes changelist numbers and rejects ambiguous input", () => {
    expect(classifyGoTo("#42")).toEqual({ kind: "change", value: "42" });
    expect(classifyGoTo("job:bug" )).toEqual({ kind: "job", value: "bug" });
    expect(classifyGoTo("label:release" )).toEqual({ kind: "label", value: "release" });
    expect(classifyGoTo("42")).toEqual({ kind: "change", value: "42" });
    expect(classifyGoTo("menu.txt").kind).toBe("unknown");
  });
});
