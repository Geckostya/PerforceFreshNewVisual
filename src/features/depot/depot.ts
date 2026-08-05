export function directoryPattern(scope: string): string {
  const value = scope.trim() || "//...";
  if (value.endsWith("*")) return value;
  if (value.endsWith("...")) return `${value.slice(0, -3)}*`;
  return `${value.replace(/\/+$/, "")}/*`;
}

export function directoryScope(path: string): string {
  const value = path.trim().replace(/\/+$/, "");
  return value.startsWith("//") && value.length > 2 ? `${value}/...` : "//...";
}

export function revisionScope(path: string, revision: string): string {
  return `${path.trim()}#${revision.trim()}`;
}

export function changeScope(path: string, change: string): string {
  return `${directoryScope(path)}@${change.trim()}`;
}

export const DEPOT_HISTORY_PAGE_SIZE = 100;

export function scopeBase(scope: string): string {
  const value = (scope.trim().replace(/\/+$/, "") || "//...");
  return value.endsWith("...") ? value.slice(0, -3).replace(/\/+$/, "") || "//" : value.replace(/\/+$/, "");
}
