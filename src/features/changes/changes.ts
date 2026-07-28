import type { OpenedFile, PendingChange, ShelvedFile, SubmitPreflightIssue, SubmitPreflightJob } from "../../shared/models";
import { markdownToPlainText } from "../../shared/ChangelistDescription";

export interface ChangeGroup extends PendingChange {
  files: OpenedFile[];
  isDefault: boolean;
  isShelved: boolean;
}

export function groupChanges(
  changes: PendingChange[],
  files: OpenedFile[],
  shelvedChanges: PendingChange[] = [],
): ChangeGroup[] {
  const shelvedIds = new Set(shelvedChanges.map((change) => change.id));
  const byChange = new Map<string, OpenedFile[]>();
  for (const file of files) {
    const change = file.change || "default";
    byChange.set(change, [...(byChange.get(change) ?? []), file]);
  }

  const groups: ChangeGroup[] = [{
    id: "default",
    description: "",
    user: "",
    client: "",
    files: byChange.get("default") ?? [],
    isDefault: true,
    isShelved: false,
  }];

  for (const change of changes) {
    groups.push({
      ...change,
      files: byChange.get(change.id) ?? [],
      isDefault: false,
      isShelved: shelvedIds.has(change.id),
    });
    byChange.delete(change.id);
    shelvedIds.delete(change.id);
  }

  for (const [id, unlistedFiles] of byChange) {
    if (id !== "default") {
      groups.push({
        id,
        description: "",
        user: "",
        client: "",
        files: unlistedFiles,
        isDefault: false,
        isShelved: shelvedIds.has(id),
      });
      shelvedIds.delete(id);
    }
  }

  for (const id of shelvedIds) {
    const shelf = shelvedChanges.find((change) => change.id === id);
    if (shelf) groups.push({ ...shelf, files: [], isDefault: false, isShelved: true });
  }
  return groups;
}

export function filterChangeGroups<T extends ChangeGroup>(groups: T[], query: string, selectedId?: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const matches = (group: T) => [group.id, group.description, group.user, group.client]
    .some((value) => value.toLowerCase().includes(needle));
  const filtered = groups.filter(matches);
  const selected = selectedId && groups.find((group) => group.id === selectedId);
  return selected && !filtered.some((group) => group.id === selected.id) ? [selected, ...filtered] : filtered;
}

export function selectedChangesForArchive(selected: string[], target: string, archivedIds: string[]): string[] {
  const archived = new Set(archivedIds);
  const targetArchived = archived.has(target);
  return (selected.includes(target) ? selected : [target])
    .filter((id) => id !== "default" && archived.has(id) === targetArchived);
}

export function shouldRefreshOnFocus(focused: boolean, lastRefresh: number, now: number) {
  return focused && now - lastRefresh >= 1_500;
}

export function visibleShelfFiles(isShelved: boolean, cached: ShelvedFile[]): ShelvedFile[] {
  return isShelved ? cached : [];
}

export function hasUnresolvedSubmitIssue(issues: SubmitPreflightIssue[]): boolean {
  return issues.some((issue) => issue.kind === "unresolved");
}

export function formatSubmitJob(job: SubmitPreflightJob): string {
  return [job.id, job.status, job.user, job.date].filter(Boolean).join(" · ");
}

export function changeOptionLabel(
  group: ChangeGroup,
  defaultLabel: string,
  noDescriptionLabel: string,
): string {
  if (group.isDefault) return defaultLabel;
  return `CL ${group.id} · ${markdownToPlainText(group.description) || noDescriptionLabel}`;
}

export const CHANGE_DRAG_TYPE = "application/x-p4fnv-change-file";

export type ChangeDragItem = {
  kind: "opened" | "shelved";
  depotPaths: string[];
  sourceChange: string;
};

export type ChangeDropTarget = {
  kind: "changelist" | "shelf";
  change: string;
};

export type ChangeDropAction =
  | { kind: "move"; depotPaths: string[]; targetChange: string }
  | { kind: "shelve"; depotPaths: string[]; sourceChange: string; targetChange: string }
  | { kind: "unshelve"; depotPaths: string[]; sourceChange: string; targetChange: string };

export function encodeChangeDrag(item: ChangeDragItem): string {
  return JSON.stringify(item);
}

export function dragEffectAllowed(kind: ChangeDragItem["kind"]): "copyMove" | "copy" {
  return kind === "opened" ? "copyMove" : "copy";
}

export function dropEffect(action: ChangeDropAction): "move" | "copy" {
  return action.kind === "move" ? "move" : "copy";
}

export function decodeChangeDrag(value: string): ChangeDragItem | undefined {
  try {
    const item = JSON.parse(value) as Partial<ChangeDragItem>;
    if (
      (item.kind === "opened" || item.kind === "shelved")
      && Array.isArray(item.depotPaths)
      && item.depotPaths.length > 0
      && item.depotPaths.every((path) => typeof path === "string" && path.startsWith("//"))
      && typeof item.sourceChange === "string"
    ) return item as ChangeDragItem;
  } catch {
    // Ignore external or malformed drag payloads.
  }
  return undefined;
}

export function resolveChangeDrop(
  item: ChangeDragItem,
  target: ChangeDropTarget,
): ChangeDropAction | undefined {
  if (item.kind === "opened" && target.kind === "changelist") {
    if (item.sourceChange === target.change) return undefined;
    return { kind: "move", depotPaths: item.depotPaths, targetChange: target.change };
  }
  if (item.kind === "opened" && target.kind === "shelf") {
    if (target.change === "default") return undefined;
    return {
      kind: "shelve",
      depotPaths: item.depotPaths,
      sourceChange: item.sourceChange,
      targetChange: target.change,
    };
  }
  if (item.kind === "shelved" && target.kind === "changelist") {
    return {
      kind: "unshelve",
      depotPaths: item.depotPaths,
      sourceChange: item.sourceChange,
      targetChange: target.change,
    };
  }
  return undefined;
}
