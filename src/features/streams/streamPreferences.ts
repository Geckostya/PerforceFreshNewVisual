export interface StreamPreferences {
  visiblePaths: string[];
  collapsedPaths: string[];
  archivedOpen: boolean;
}

export function streamPreferencesStorageKey(port: string, user: string, client?: string): string {
  return `p4fnv:streams:${encodeURIComponent(port)}:${encodeURIComponent(user)}:${encodeURIComponent(client || "")}`;
}

export function parseStreamPreferences(value: string | null): StreamPreferences | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StreamPreferences>;
    if (!Array.isArray(parsed.visiblePaths) || !Array.isArray(parsed.collapsedPaths) || typeof parsed.archivedOpen !== "boolean") return undefined;
    if (parsed.visiblePaths.some((path) => typeof path !== "string") || parsed.collapsedPaths.some((path) => typeof path !== "string")) return undefined;
    return {
      visiblePaths: [...new Set(parsed.visiblePaths)],
      collapsedPaths: [...new Set(parsed.collapsedPaths)],
      archivedOpen: parsed.archivedOpen,
    };
  } catch {
    return undefined;
  }
}

export function loadStreamPreferences(key: string): StreamPreferences | undefined {
  try {
    return parseStreamPreferences(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

export function saveStreamPreferences(key: string, preferences: StreamPreferences): void {
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Cosmetic state must never block Perforce workflows.
  }
}
