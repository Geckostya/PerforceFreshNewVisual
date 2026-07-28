import type { PendingChange, UnshelvePreview } from "../../shared/models";

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
