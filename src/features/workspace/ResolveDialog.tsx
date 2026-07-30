import { useEffect, useMemo, useRef, useState } from "react";
import { loadResolveContent, normalizeAppError, saveResolveResult } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, ResolveContent, ResolvePreviewItem } from "../../shared/models";
import { ActionDialog, CompactEmpty } from "../../shared/View";

export interface ConflictRange {
  start: number;
  end: number;
  workspace: string;
  source: string;
}

const conflictPattern = /<<<<<<< WORKSPACE\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> SOURCE/g;

export function initialResolveResult(base: string, source: string, workspace: string): string {
  if (workspace === source) return workspace;
  if (workspace === base) return source;
  if (source === base) return workspace;
  return mergeLineChanges(base, workspace, source).join("\n");
}

type DiffOperation = { kind: "equal" | "insert" | "delete"; value: string };
type LineChange = { start: number; end: number; lines: string[] };
const MAX_RESOLVE_DIFF_DISTANCE = 512;

function mergeLineChanges(base: string, workspace: string, source: string): string[] {
  const baseLines = splitResolveLines(base);
  const workspaceLines = splitResolveLines(workspace);
  const sourceLines = splitResolveLines(source);
  const workspaceChanges = changedLineRanges(baseLines, workspaceLines);
  const sourceChanges = changedLineRanges(baseLines, sourceLines);
  if (!workspaceChanges || !sourceChanges) {
    return ["<<<<<<< WORKSPACE", ...workspaceLines, "=======", ...sourceLines, ">>>>>>> SOURCE"];
  }
  const result: string[] = [];
  let workspaceIndex = 0;
  let sourceIndex = 0;
  let cursor = 0;

  while (workspaceIndex < workspaceChanges.length || sourceIndex < sourceChanges.length) {
    const nextWorkspace = workspaceChanges[workspaceIndex];
    const nextSource = sourceChanges[sourceIndex];
    const start = Math.min(nextWorkspace?.start ?? Number.POSITIVE_INFINITY, nextSource?.start ?? Number.POSITIVE_INFINITY);
    result.push(...baseLines.slice(cursor, start));

    const workspaceRegion: LineChange[] = [];
    const sourceRegion: LineChange[] = [];
    let end = start;
    let expanded = true;
    while (expanded) {
      expanded = false;
      const workspaceChange = workspaceChanges[workspaceIndex];
      if (workspaceChange && (workspaceChange.start === start || workspaceChange.start < end)) {
        workspaceRegion.push(workspaceChange);
        workspaceIndex += 1;
        end = Math.max(end, workspaceChange.end);
        expanded = true;
      }
      const sourceChange = sourceChanges[sourceIndex];
      if (sourceChange && (sourceChange.start === start || sourceChange.start < end)) {
        sourceRegion.push(sourceChange);
        sourceIndex += 1;
        end = Math.max(end, sourceChange.end);
        expanded = true;
      }
    }

    const unchanged = baseLines.slice(start, end);
    const workspaceResult = applyLineChanges(baseLines, start, end, workspaceRegion);
    const sourceResult = applyLineChanges(baseLines, start, end, sourceRegion);
    if (sameLines(workspaceResult, sourceResult)) result.push(...workspaceResult);
    else if (sameLines(workspaceResult, unchanged)) result.push(...sourceResult);
    else if (sameLines(sourceResult, unchanged)) result.push(...workspaceResult);
    else result.push("<<<<<<< WORKSPACE", ...workspaceResult, "=======", ...sourceResult, ">>>>>>> SOURCE");
    cursor = end;
  }

  result.push(...baseLines.slice(cursor));
  return result;
}

function splitResolveLines(value: string): string[] {
  return value ? value.split("\n") : [];
}

function changedLineRanges(base: string[], side: string[]): LineChange[] | undefined {
  const changes: LineChange[] = [];
  let baseIndex = 0;
  let current: LineChange | undefined;
  const finish = () => {
    if (current) changes.push(current);
    current = undefined;
  };

  const operations = diffLines(base, side);
  if (!operations) return undefined;
  for (const operation of operations) {
    if (operation.kind === "equal") {
      finish();
      baseIndex += 1;
    } else {
      current ??= { start: baseIndex, end: baseIndex, lines: [] };
      if (operation.kind === "delete") {
        baseIndex += 1;
        current.end = baseIndex;
      } else {
        current.lines.push(operation.value);
      }
    }
  }
  finish();
  return changes;
}

function diffLines(base: string[], side: string[]): DiffOperation[] | undefined {
  const max = base.length + side.length;
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  for (let distance = 0; distance <= Math.min(max, MAX_RESOLVE_DIFF_DISTANCE); distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      let x = diagonal === -distance || (diagonal !== distance && right < down) ? down : right + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < base.length && y < side.length && base[x] === side[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= base.length && y >= side.length) return backtrackLineDiff(trace, base, side);
    }
  }
  return undefined;
}

function backtrackLineDiff(trace: Array<Map<number, number>>, base: string[], side: string[]): DiffOperation[] {
  const operations: DiffOperation[] = [];
  let x = base.length;
  let y = side.length;
  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
    const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && right < down)
      ? diagonal + 1
      : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      operations.push({ kind: "equal", value: base[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (distance === 0) break;
    if (x === previousX) {
      operations.push({ kind: "insert", value: side[y - 1] });
      y -= 1;
    } else {
      operations.push({ kind: "delete", value: base[x - 1] });
      x -= 1;
    }
  }
  return operations.reverse();
}

function applyLineChanges(base: string[], start: number, end: number, changes: LineChange[]): string[] {
  const result: string[] = [];
  let cursor = start;
  for (const change of changes) {
    result.push(...base.slice(cursor, change.start), ...change.lines);
    cursor = change.end;
  }
  result.push(...base.slice(cursor, end));
  return result;
}

function sameLines(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

export function resolveConflictRanges(value: string): ConflictRange[] {
  return [...value.matchAll(conflictPattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    workspace: match[1],
    source: match[2],
  }));
}

export function replaceResolveConflict(value: string, conflict: ConflictRange, side: "workspace" | "source"): string {
  return `${value.slice(0, conflict.start)}${conflict[side]}${value.slice(conflict.end)}`;
}

function textSide(content: ResolveContent, side: "base" | "source" | "workspace"): string | undefined {
  const value = content[side];
  return value.binary || value.truncated ? undefined : value.text;
}

export function ResolveDialog({ connection, item, onClose, onResolved, onError }: {
  connection: ConnectionInput;
  item: ResolvePreviewItem;
  onClose: () => void;
  onResolved: () => void;
  onError: (error: AppError) => void;
}) {
  const { t } = useLocale();
  const [content, setContent] = useState<ResolveContent>();
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<AppError>();
  const [activeConflict, setActiveConflict] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const conflicts = useMemo(() => resolveConflictRanges(result), [result]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    void loadResolveContent(connection, item.depotPath)
      .then((next) => {
        if (!active) return;
        setContent(next);
        const base = textSide(next, "base");
        const source = textSide(next, "source");
        const workspace = textSide(next, "workspace");
        if (base === undefined || source === undefined || workspace === undefined) {
          setLoadError({ kind: "command_failed", message: t("resolveEditorUnsupportedContent"), hints: [] });
          return;
        }
        setResult(initialResolveResult(base, source, workspace));
      })
      .catch((reason) => { if (active) setLoadError(normalizeAppError(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [connection, item.depotPath, t]);

  function focusConflict(index: number) {
    if (!conflicts.length) return;
    const next = (index + conflicts.length) % conflicts.length;
    setActiveConflict(next);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(conflicts[next].start, conflicts[next].end);
    });
  }

  function accept(side: "workspace" | "source") {
    const conflict = conflicts[activeConflict];
    if (!conflict) return;
    setResult(replaceResolveConflict(result, conflict, side));
    setActiveConflict(Math.min(activeConflict, Math.max(0, conflicts.length - 2)));
  }

  async function save() {
    if (!content || conflicts.length) return;
    setBusy(true);
    try {
      const readBack = await saveResolveResult(connection, item.depotPath, content.localPath, content.previewToken, result);
      const state = readBack.items.find((entry) => entry.depotPath === item.depotPath)?.state;
      if (state !== "resolved") {
        throw { kind: "partial_result", message: t("resolveStillPending"), hints: [] } satisfies AppError;
      }
      onResolved();
    } catch (reason) {
      const error = normalizeAppError(reason);
      setLoadError(error);
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return <ActionDialog
    title={t("resolveEditorTitle")}
    wide
    confirmLabel={t("resolveSaveAndMark")}
    busy={busy}
    confirmDisabled={!content || Boolean(loadError) || conflicts.length > 0}
    onClose={onClose}
    onConfirm={() => void save()}
  >
    <p>{item.depotPath}</p>
    {loadError ? <div className="inline-error"><strong>{loadError.message}</strong>{loadError.diagnostics && <small>{loadError.diagnostics}</small>}</div>
      : !content ? <CompactEmpty text={t("resolveEditorLoading")} />
        : <>
          <div className="resolve-source-grid">
            {(["base", "source", "workspace"] as const).map((side) => <section key={side}>
              <strong>{t(`resolveSide_${side}` as never)}</strong>
              <small title={content[side].identifier}>{content[side].identifier}</small>
              <pre>{content[side].text}</pre>
            </section>)}
          </div>
          <div className="resolve-editor-toolbar">
            <span>{conflicts.length ? `${activeConflict + 1} / ${conflicts.length} ${t("resolveConflicts")}` : t("resolveNoConflicts")}</span>
            <button type="button" className="secondary-button" disabled={!conflicts.length} onClick={() => focusConflict(activeConflict - 1)}>{t("resolvePrevious")}</button>
            <button type="button" className="secondary-button" disabled={!conflicts.length} onClick={() => focusConflict(activeConflict + 1)}>{t("next")}</button>
            <button type="button" className="secondary-button" disabled={!conflicts.length} onClick={() => accept("workspace")}>{t("resolveUseWorkspace")}</button>
            <button type="button" className="secondary-button" disabled={!conflicts.length} onClick={() => accept("source")}>{t("resolveUseSource")}</button>
          </div>
          <label className="field resolve-result"><span className="field-label">{t("resolveResult")}</span><textarea ref={editor} value={result} onChange={(event) => { setResult(event.target.value); setActiveConflict(0); }} /></label>
        </>}
  </ActionDialog>;
}
