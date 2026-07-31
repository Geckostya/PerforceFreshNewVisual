export function directoryPattern(scope: string): string {
  const value = scope.trim() || "//...";
  if (value.endsWith("*")) return value;
  if (value.endsWith("...")) return `${value.slice(0, -3)}*`;
  return `${value.replace(/\/+$/, "")}/*`;
}

export function filePattern(scope: string): string {
  const value = scope.trim() || "//...";
  if (value.endsWith("...")) return value;
  if (value.endsWith("*")) return `${value.slice(0, -1)}...`;
  return `${value.replace(/\/+$/, "")}/...`;
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

export function parentScope(scope: string): string {
  const base = scopeBase(scope);
  if (base === "//" || !base.startsWith("//")) return "//...";
  const parent = base.slice(2).split("/").slice(0, -1).join("/");
  return parent ? `//${parent}/...` : "//...";
}

export function scopeSegments(scope: string): string[] {
  const base = scopeBase(scope);
  return base === "//" ? [] : base.slice(2).split("/").filter(Boolean);
}
