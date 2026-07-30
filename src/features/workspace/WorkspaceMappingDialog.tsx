import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { applyWorkspaceMappings, inspectWorkspaceMappingEditor, normalizeAppError, previewWorkspaceMappings } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, WorkspaceMappingKind, WorkspaceMappingPreview, WorkspaceSpec } from "../../shared/models";
import { CompactEmpty, Modal } from "../../shared/View";
import { createWorkspaceMappingDraft, moveWorkspaceMappingDraft, newWorkspaceMappingDraft, removeWorkspaceMappingDraft, serializeWorkspaceMappingDraft, workspaceMappingDraftIsComplete, type WorkspaceMappingDraftEntry } from "./workspaceMappings";

export function WorkspaceMappingDialog({ connection, workspace, onClose, onSaved }: {
  connection: ConnectionInput;
  workspace: string;
  onClose: () => void;
  onSaved: (spec: WorkspaceSpec) => void;
}) {
  const { t } = useLocale();
  const [entries, setEntries] = useState<WorkspaceMappingDraftEntry[]>([]);
  const [preview, setPreview] = useState<WorkspaceMappingPreview>();
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<AppError>();
  const nextId = useRef(0);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setLoaded(false);
    void inspectWorkspaceMappingEditor(connection, workspace)
      .then((editor) => {
        if (active) {
          setEntries(createWorkspaceMappingDraft(editor));
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (active) setError(normalizeAppError(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [connection, workspace]);

  function changeEntries(update: (current: WorkspaceMappingDraftEntry[]) => WorkspaceMappingDraftEntry[]) {
    setEntries((current) => update(current));
    setPreview(undefined);
    setError(undefined);
  }

  function updateNewEntry(id: string, update: Partial<Extract<WorkspaceMappingDraftEntry, { source: "new" }>>) {
    changeEntries((current) => current.map((entry) => entry.id === id && entry.source === "new" ? { ...entry, ...update } : entry));
  }

  async function review() {
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await previewWorkspaceMappings(connection, { workspace, entries: serializeWorkspaceMappingDraft(entries) }));
    } catch (cause) {
      setError(normalizeAppError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      const spec = await applyWorkspaceMappings(connection, {
        workspace,
        entries: serializeWorkspaceMappingDraft(entries),
        previewToken: preview.previewToken,
      });
      onSaved(spec);
    } catch (cause) {
      setError(normalizeAppError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={preview ? t("workspaceMappingConfirmTitle") : t("workspaceMappingEditorTitle")} busy={busy} wide onClose={onClose}>
    <div className="dialog-body" data-agent-id="workspace-mapping-editor">
      {error && <div className="diff-warning" role="alert"><strong>{error.message}</strong>{error.hints.map((hint) => <div key={hint}>{hint}</div>)}</div>}
      {preview ? <>
        <p>{t("workspaceMappingConfirmHelp")}</p>
        <div className="workspace-mapping-preview" data-agent-id="workspace-mapping-preview">
          <MappingList title={t("workspaceMappingBefore")} mappings={preview.before} empty={t("workspaceSpecNoMappings")} />
          <MappingList title={t("workspaceMappingAfter")} mappings={preview.after} empty={t("workspaceSpecNoMappings")} />
        </div>
        <p className="workspace-mapping-preservation">{t("workspaceMappingPreservedUnknown")}: {preview.preservedUnknownEntries}</p>
        <div className="large-change-warning"><strong>{t("workspaceMappingConfirmationWarning")}</strong><p>{t("workspaceMappingConfirmationDetail")}</p></div>
      </> : <>
        <p>{t("workspaceMappingEditorHelp")}</p>
        {loaded && <div className="workspace-mapping-list">
          {entries.length ? entries.map((entry, index) => <MappingEntry
            key={entry.id}
            entry={entry}
            index={index}
            count={entries.length}
            busy={busy}
            onMove={(offset) => changeEntries((current) => moveWorkspaceMappingDraft(current, entry.id, offset))}
            onRemove={() => changeEntries((current) => removeWorkspaceMappingDraft(current, entry.id))}
            onUpdate={(update) => updateNewEntry(entry.id, update)}
          />) : <CompactEmpty text={t("workspaceSpecNoMappings")} />}
        </div>}
        <button className="secondary-button" type="button" disabled={busy || !loaded} onClick={() => changeEntries((current) => [...current, newWorkspaceMappingDraft(`new-${nextId.current++}`)])}>
          <Plus className="ui-icon" aria-hidden="true" /> {t("workspaceMappingAdd")}
        </button>
      </>}
    </div>
    <div className="dialog-actions">
      {preview && <button className="secondary-button" type="button" disabled={busy} onClick={() => setPreview(undefined)}>{t("back")}</button>}
      <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{t("cancel")}</button>
      {preview
        ? <button className="primary-button" data-agent-id="workspace-mapping-confirm" type="button" disabled={busy || !preview.changed} onClick={() => void confirm()}>{t("workspaceMappingApply")}</button>
        : <button className="primary-button" data-agent-id="workspace-mapping-review" type="button" disabled={busy || !loaded || !workspaceMappingDraftIsComplete(entries)} onClick={() => void review()}>{t("workspaceMappingReview")}</button>}
    </div>
  </Modal>;
}

function MappingList({ title, mappings, empty }: { title: string; mappings: string[]; empty: string }) {
  return <section><h3>{title}</h3><div className="resource-detail-list">{mappings.length
    ? mappings.map((mapping, index) => <div className="resource-detail-row" key={`${index}-${mapping}`}><code>{mapping}</code></div>)
    : <CompactEmpty text={empty} />}</div></section>;
}

function MappingEntry({ entry, index, count, busy, onMove, onRemove, onUpdate }: {
  entry: WorkspaceMappingDraftEntry;
  index: number;
  count: number;
  busy: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (update: Partial<Extract<WorkspaceMappingDraftEntry, { source: "new" }>>) => void;
}) {
  const { t } = useLocale();
  const protectedEntry = entry.source === "existing" && entry.preservedOnly;
  return <div className={`workspace-mapping-entry${protectedEntry ? " protected" : ""}`}>
    <div className="workspace-mapping-entry-actions">
      <button type="button" disabled={busy || index === 0 || protectedEntry} aria-label={t("workspaceMappingMoveUp")} onClick={() => onMove(-1)}><ArrowUp className="ui-icon" aria-hidden="true" /></button>
      <button type="button" disabled={busy || index === count - 1 || protectedEntry} aria-label={t("workspaceMappingMoveDown")} onClick={() => onMove(1)}><ArrowDown className="ui-icon" aria-hidden="true" /></button>
      <button type="button" disabled={busy || protectedEntry} aria-label={t("workspaceMappingRemove")} onClick={onRemove}><Trash2 className="ui-icon" aria-hidden="true" /></button>
    </div>
    {entry.source === "existing" ? <div className="workspace-mapping-existing">
      <code>{entry.mapping}</code>
      <small>{protectedEntry ? t("workspaceMappingProtected") : t("workspaceMappingExisting")}</small>
    </div> : <div className="workspace-mapping-new">
      <label className="field"><span className="field-label">{t("workspaceMappingKind")}</span><select value={entry.kind} onChange={(event) => onUpdate({ kind: event.target.value as WorkspaceMappingKind })}>
        <option value="include">{t("workspaceMappingInclude")}</option>
        <option value="exclude">{t("workspaceMappingExclude")}</option>
        <option value="overlay">{t("workspaceMappingOverlay")}</option>
        <option value="ditto">{t("workspaceMappingDitto")}</option>
      </select></label>
      <label className="field"><span className="field-label">{t("workspaceMappingDepotPath")}</span><input value={entry.depotPath} onChange={(event) => onUpdate({ depotPath: event.target.value })} /></label>
      <label className="field"><span className="field-label">{t("workspaceMappingClientPath")}</span><input value={entry.clientPath} onChange={(event) => onUpdate({ clientPath: event.target.value })} /></label>
    </div>}
  </div>;
}
