import type { PendingChange, UnshelvePreview } from "../../shared/models";

export type ShelfAgeFilter = "all" | "day" | "week" | "month";

export interface ShelfFilters {
  query: string;
  user: string;
  client: string;
  stream: string;
  age: ShelfAgeFilter;
}

export interface ShelfUserGroup {
  user: string;
  clients: string[];
  shelves: PendingChange[];
}

const ageSeconds: Record<Exclude<ShelfAgeFilter, "all">, number> = {
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
};

export function shelfTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed / 1000;
}

export function filterShelves(shelves: PendingChange[], filters: ShelfFilters, nowSeconds = Date.now() / 1000): PendingChange[] {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const maximumAge = filters.age === "all" ? undefined : ageSeconds[filters.age];
  return shelves.filter((shelf) => {
    const searchable = [shelf.id, shelf.description, shelf.user, shelf.client, shelf.stream].filter(Boolean).join(" ").toLocaleLowerCase();
    const timestamp = shelfTimestamp(shelf.time);
    return terms.every((term) => searchable.includes(term))
      && (filters.user === "all" || shelf.user === filters.user)
      && (filters.client === "all" || shelf.client === filters.client)
      && (filters.stream === "all" || shelf.stream === filters.stream)
      && (maximumAge === undefined || (timestamp !== undefined && nowSeconds - timestamp <= maximumAge));
  });
}

export function groupShelvesByUser(shelves: PendingChange[]): ShelfUserGroup[] {
  const groups = new Map<string, ShelfUserGroup>();
  for (const shelf of shelves) {
    const user = shelf.user || "—";
    const group = groups.get(user) ?? { user, clients: [], shelves: [] };
    group.shelves.push(shelf);
    if (shelf.client && !group.clients.includes(shelf.client)) group.clients.push(shelf.client);
    groups.set(user, group);
  }
  return [...groups.values()];
}

export function nextShelfSelection(shelves: PendingChange[], current: string | undefined): string | undefined {
  return shelves.some((shelf) => shelf.id === current) ? current : shelves[0]?.id;
}

export function splitUnshelvePaths(
  selected: string[],
  preview: UnshelvePreview,
  overwritePaths: string[],
): { normalPaths: string[]; forcePaths: string[] } {
  const conflicts = new Set(preview.conflicts.map((conflict) => conflict.depotPath));
  const force = new Set(overwritePaths);
  const normalPaths = selected.filter((path) => !conflicts.has(path));
  const forcePaths = selected.filter((path) => conflicts.has(path) && force.has(path));
  return { normalPaths, forcePaths };
}

export function canApplyUnshelve(
  preview: UnshelvePreview | undefined,
  selected: string[],
  overwritePaths: string[] = [],
): boolean {
  if (!preview || selected.length === 0) return false;
  const plan = splitUnshelvePaths(selected, preview, overwritePaths);
  return plan.normalPaths.length > 0 || plan.forcePaths.length > 0;
}
