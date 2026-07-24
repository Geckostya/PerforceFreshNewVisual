import { describe, expect, it } from "vitest";
import english from "../../locales/en.json";
import russian from "../../locales/ru.json";
import { translate } from "./i18n";

describe("localization", () => {
  it("returns the selected language from the same typed key", () => {
    expect(translate(russian, "checkConnection")).toBe("Проверить подключение");
    expect(translate(english, "checkConnection")).toBe("Test connection");
  });
});
