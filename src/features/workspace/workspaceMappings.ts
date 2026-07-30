import type { WorkspaceMappingEdit, WorkspaceMappingEditor, WorkspaceMappingKind } from "../../shared/models";

export type WorkspaceMappingDraftEntry =
  | { id: string; source: "existing"; index: number; mapping: string; preservedOnly: boolean }
  | { id: string; source: "new"; kind: WorkspaceMappingKind; depotPath: string; clientPath: string };

export function createWorkspaceMappingDraft(editor: WorkspaceMappingEditor): WorkspaceMappingDraftEntry[] {
  return editor.entries.map((entry) => ({
    id: `existing-${entry.index}`,
    source: "existing",
    ...entry,
  }));
}

export function newWorkspaceMappingDraft(id: string): Extract<WorkspaceMappingDraftEntry, { source: "new" }> {
  return { id, source: "new", kind: "include", depotPath: "//", clientPath: "//" };
}

export function serializeWorkspaceMappingDraft(entries: WorkspaceMappingDraftEntry[]): WorkspaceMappingEdit[] {
  return entries.map((entry) => entry.source === "existing"
    ? { source: "existing", index: entry.index }
    : { source: "new", kind: entry.kind, depotPath: entry.depotPath.trim(), clientPath: entry.clientPath.trim() });
}

export function removeWorkspaceMappingDraft(entries: WorkspaceMappingDraftEntry[], id: string): WorkspaceMappingDraftEntry[] {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || (entry.source === "existing" && entry.preservedOnly)) return entries;
  return entries.filter((candidate) => candidate.id !== id);
}

export function moveWorkspaceMappingDraft(entries: WorkspaceMappingDraftEntry[], id: string, offset: -1 | 1): WorkspaceMappingDraftEntry[] {
  if (!workspaceMappingDraftCanMove(entries, id, offset)) return entries;
  const from = entries.findIndex((entry) => entry.id === id);
  const to = from + offset;
  const next = [...entries];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function workspaceMappingDraftCanMove(entries: WorkspaceMappingDraftEntry[], id: string, offset: -1 | 1): boolean {
  const from = entries.findIndex((entry) => entry.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= entries.length) return false;
  return ![entries[from], entries[to]].some((entry) => entry.source === "existing" && entry.preservedOnly);
}

export function workspaceMappingDraftIsComplete(entries: WorkspaceMappingDraftEntry[]): boolean {
  return entries.every((entry) => entry.source === "existing" || (entry.depotPath.trim().startsWith("//") && entry.clientPath.trim().startsWith("//")));
}
