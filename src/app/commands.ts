export type PaletteCommandId = "workspace" | "changes" | "streams" | "history" | "depot" | "jobs" | "labels" | "shelves" | "goTo";

export interface PaletteCommand {
  id: PaletteCommandId;
  searchText: string;
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => command.searchText.toLocaleLowerCase().includes(normalized));
}
