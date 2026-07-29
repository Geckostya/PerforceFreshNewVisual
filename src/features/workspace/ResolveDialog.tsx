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
  return `<<<<<<< WORKSPACE\n${workspace}\n=======\n${source}\n>>>>>>> SOURCE`;
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
