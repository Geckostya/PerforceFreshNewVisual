import { describe, expect, it } from "vitest";
import { operationLabelKey } from "./OperationsCenter";

describe("operations center labels", () => {
  it("does not announce stream integration as sync", () => {
    expect(operationLabelKey("integrate")).toBe("operationIntegrate");
    expect(operationLabelKey("sync")).toBe("operationSync");
  });
});
