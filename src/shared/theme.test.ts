import { describe, expect, it } from "vitest";
import { effectiveTheme } from "./theme";

describe("effectiveTheme", () => {
  it("follows the operating system only in system mode", () => {
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });
});
