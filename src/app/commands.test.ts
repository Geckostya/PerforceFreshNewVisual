import { describe, expect, it } from "vitest";
import { filterPaletteCommands, paletteOptionId, type PaletteCommand } from "./commands";

const commands: PaletteCommand[] = [
  { id: "workspace", searchText: "workspace files" },
  { id: "history", searchText: "file history" },
  { id: "goTo", searchText: "global go to" },
];

describe("command palette filtering", () => {
  it("filters case-insensitively and keeps the full list for an empty query", () => {
    expect(filterPaletteCommands(commands, "HISTORY").map((item) => item.id)).toEqual(["history"]);
    expect(filterPaletteCommands(commands, "  ")).toEqual(commands);
    expect(filterPaletteCommands(commands, "missing")).toEqual([]);
  });

  it("provides stable option ids for combobox active-descendant narration", () => {
    expect(paletteOptionId("workspace")).toBe("command-palette-option-workspace");
    expect(new Set(commands.map((command) => paletteOptionId(command.id))).size).toBe(commands.length);
  });
});
