import { useEffect, useMemo, useState } from "react";
import { applyLabelTag, createLabel, deleteLabel, inspectLabel as fetchLabelSpec, listDepotFiles, listLabels, normalizeAppError, previewLabelTag, previewSync, updateLabel } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, DepotFile, Label, LabelInput, LabelSpec, LabelTagPreview, SyncPreview } from "../../shared/models";
import { RefreshButton } from "../../shared/RefreshButton";
import { SafeSyncConflictDialog, SyncPreviewDetails, useSafeSync } from "../../shared/SafeSync";
import { ActionDialog, BoundedListNotice, CompactEmpty, EmptyState, View } from "../../shared/View";
import { SERVER_LIST_LIMIT } from "../../shared/scale";

const LABEL_DETAIL_LIMIT = 100;
type LabelDialog = { kind: "create" | "edit"; draft: LabelInput } | { kind: "delete" } | { kind: "tag" | "untag"; preview?: LabelTagPreview };

export function LabelsView({ connection, initialSearch }: { connection: ConnectionInput; initialSearch?: string }) {
  const { t } = useLocale();
  const [query, setQuery] = useState(initialSearch || "");
  const [labels, setLabels] = useState<Label[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [selectedLabel, setSelectedLabel] = useState<Label>();
  const [labelFiles, setLabelFiles] = useState<DepotFile[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [syncPreviewState, setSyncPreviewState] = useState<SyncPreview>();
  const [syncAcknowledged, setSyncAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const [spec, setSpec] = useState<LabelSpec>();
  const [dialog, setDialog] = useState<LabelDialog>();
  const safeSync = useSafeSync(connection, {
    refresh: () => selectedLabel ? inspectLabel(selectedLabel) : load(),
    setNotice,
    setError,
  });

  async function load(search = query) {
    setBusy(true);
    setError(undefined);
    try { setLabels(await listLabels(connection, search.trim() || undefined)); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(initialSearch || ""); }, [connection, initialSearch]);

  const visibleLabels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return labels;
    return labels.filter((label) => [label.name, label.owner, label.update, label.description]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [labels, query]);

  async function inspectLabel(label: Label, knownSpec?: LabelSpec) {
    setSelectedLabel(label);
    setSpec(undefined);
    setSyncPreviewState(undefined);
    setDetailBusy(true);
    setError(undefined);
    try {
      const [files, nextSpec] = await Promise.all([
        listDepotFiles(connection, `//...@${label.name}`, true),
        knownSpec ? Promise.resolve(knownSpec) : fetchLabelSpec(connection, label.name),
      ]);
      setLabelFiles(files);
      setSpec(nextSpec);
    }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setDetailBusy(false); }
  }

  async function openEdit(kind: "create" | "edit") {
    if (kind === "create") { setDialog({ kind, draft: { name: "", description: "", view: ["//..."] } }); return; }
    if (!selectedLabel) return;
    setDetailBusy(true); setError(undefined);
    try { const next = await fetchLabelSpec(connection, selectedLabel.name); setSpec(next); setDialog({ kind, draft: { name: next.label.name, description: next.label.description, view: next.view } }); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setDetailBusy(false); }
  }

  async function applyDialog() {
    if (!dialog) return;
    setDetailBusy(true); setError(undefined);
    try {
      if (dialog.kind === "create" || dialog.kind === "edit") { const next = dialog.kind === "create" ? await createLabel(connection, dialog.draft) : await updateLabel(connection, dialog.draft); setDialog(undefined); await load(); await inspectLabel(next.label, next); setNotice(t("labelSaved")); }
      else if (dialog.kind === "delete" && selectedLabel) { await deleteLabel(connection, selectedLabel.name); setSelectedLabel(undefined); setSpec(undefined); setLabelFiles([]); setDialog(undefined); await load(); setNotice(t("labelDeleted")); }
      else if ((dialog.kind === "tag" || dialog.kind === "untag") && selectedLabel) { const tag = { label: selectedLabel.name, paths: labelFiles.map((file) => file.depotPath), remove: dialog.kind === "untag" }; if (!dialog.preview) { setDialog({ ...dialog, preview: await previewLabelTag(connection, tag) }); } else { const result = await applyLabelTag(connection, tag); setSpec(result.label); setDialog(undefined); setNotice(result.partial ? t("labelTagPartial") : t("labelTagApplied")); } }
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setDetailBusy(false); }
  }

  async function showLabelSync() {
    if (!selectedLabel) return;
    setDetailBusy(true);
    setError(undefined);
    setSyncAcknowledged(false);
    try { setSyncPreviewState(await previewSync(connection, [`//...@${selectedLabel.name}`])); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setDetailBusy(false); }
  }

  async function applyLabelSync() {
    if (!selectedLabel || !syncPreviewState) return;
    const scope = `//...@${selectedLabel.name}`;
    setSyncPreviewState(undefined);
    await safeSync.start([scope]);
  }

  return <View
    id="labels-title"
    title={t("labelsTitle")}
    subtitle={t("labelsBody")}
    busy={busy || detailBusy}
    error={error}
    notice={notice}
    operationLabel={safeSync.phase === "checking" ? t("checkingWritableConflicts") : undefined}
    onDismissNotice={() => setNotice("")}
    actions={<RefreshButton busy={busy} onClick={() => void load()} />}
  >
    <div className="resource-toolbar">
      <label className="field"><span className="field-label">{t("labelsSearch")}</span><input value={query} placeholder={t("labelsSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
      <span className="selection-count">{visibleLabels.length} / {labels.length} {t("labelsCount")}</span>
    </div>
    {labels.length >= SERVER_LIST_LIMIT && <BoundedListNotice count={SERVER_LIST_LIMIT} />}
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{t("labelsTitle")}</strong><span>{visibleLabels.length}</span></div>
        {visibleLabels.length ? visibleLabels.map((label) => <SelectableRow selected={selectedLabel?.name === label.name} className="resource-row" key={label.name} onClick={() => void inspectLabel(label)}>
          <ItemRowCopy primary={label.name} secondary={[label.owner, label.update].filter(Boolean).join(" · ") || "—"} />
          <span>{label.description || t("labelNoDescription")}</span>
        </SelectableRow>) : <CompactEmpty text={t("labelsEmpty")} />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{t("labelDetails")}</strong><span>{selectedLabel?.name || "—"}</span></div>
        {!selectedLabel ? <EmptyState title={t("labelsTitle")} body={t("labelsBody")} /> : <div className="inspector-content">
          <div><h2>{selectedLabel.name}</h2><p>{selectedLabel.description || t("labelNoDescription")}</p></div>
          <dl className="file-facts"><dt>{t("factUser")}</dt><dd>{selectedLabel.owner || "—"}</dd><dt>{t("labelUpdated")}</dt><dd>{selectedLabel.update || "—"}</dd><dt>{t("filesLabel")}</dt><dd>{detailBusy ? t("loadingFiles") : labelFiles.length}</dd></dl>
          {detailBusy ? <CompactEmpty text={t("loadingLabelDetails")} /> : <><div className="resource-detail-list">{labelFiles.slice(0, LABEL_DETAIL_LIMIT).map((file) => <div className="resource-detail-row" key={`${file.depotPath}-${file.revision}`}><span><strong>{file.depotPath}</strong><small>{file.revision ? `#${file.revision}` : ""}</small></span></div>)}</div>{labelFiles.length > LABEL_DETAIL_LIMIT && <BoundedListNotice count={LABEL_DETAIL_LIMIT} />}</>}
          {spec?.locked && <p className="error-message">{t("labelProtected")}</p>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => void openEdit("edit")} disabled={detailBusy}>{t("editLabel")}</button><button className="secondary-button" type="button" onClick={() => setDialog({ kind: "tag" })} disabled={detailBusy || !labelFiles.length}>{t("tagLabel")}</button><button className="secondary-button" type="button" onClick={() => setDialog({ kind: "untag" })} disabled={detailBusy || !labelFiles.length}>{t("untagLabel")}</button><button className="danger-button" type="button" onClick={() => setDialog({ kind: "delete" })} disabled={detailBusy}>{t("deleteLabel")}</button></div>
          <button className="primary-button" type="button" onClick={() => void showLabelSync()} disabled={detailBusy || safeSync.phase !== "idle"}>{t("previewLabelSync")}</button>
          {syncPreviewState && <div className="inline-preview"><strong>{t("syncPreviewTitle")}</strong><SyncPreviewDetails preview={syncPreviewState} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} /><button className="primary-button" type="button" onClick={() => void applyLabelSync()} disabled={detailBusy || !syncPreviewState.items.length || (syncPreviewState.modifiedFiles.length > 0 && !syncAcknowledged)}>{t("syncNow")}</button></div>}
        </div>}
      </aside>
    </div>
    <button className="primary-button" type="button" onClick={() => void openEdit("create")}>{t("createLabel")}</button>
    {(dialog?.kind === "create" || dialog?.kind === "edit") && <ActionDialog title={dialog.kind === "create" ? t("createLabel") : t("editLabel")} confirmLabel={t("save")} busy={detailBusy} confirmDisabled={!dialog.draft.name.trim() || !dialog.draft.view.length} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><label className="field"><span className="field-label">{t("labelName")}</span><input autoFocus disabled={dialog.kind === "edit"} value={dialog.draft.name} onChange={(event) => setDialog({ ...dialog, draft: { ...dialog.draft, name: event.target.value } })} /></label><label className="field"><span className="field-label">{t("labelDescription")}</span><textarea value={dialog.draft.description} onChange={(event) => setDialog({ ...dialog, draft: { ...dialog.draft, description: event.target.value } })} /></label><label className="field"><span className="field-label">{t("labelView")}</span><textarea value={dialog.draft.view.join("\n")} onChange={(event) => setDialog({ ...dialog, draft: { ...dialog.draft, view: event.target.value.split("\n").filter(Boolean) } })} /></label></ActionDialog>}
    {dialog?.kind === "delete" && selectedLabel && <ActionDialog danger title={t("deleteLabel")} confirmLabel={t("deleteLabel")} busy={detailBusy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("deleteLabelConfirm")}</p><strong>{selectedLabel.name}</strong></ActionDialog>}
    {(dialog?.kind === "tag" || dialog?.kind === "untag") && selectedLabel && <ActionDialog title={dialog.kind === "tag" ? t("tagLabel") : t("untagLabel")} confirmLabel={dialog.kind === "tag" ? t("tagLabel") : t("untagLabel")} busy={detailBusy} confirmDisabled={Boolean(dialog.preview?.protected || dialog.preview?.partial)} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{dialog.preview ? t("labelTagPreviewReady") : t("labelTagPreviewPrompt")}</p>{dialog.preview && <><dl className="dialog-facts"><dt>{t("labelScope")}</dt><dd>{dialog.preview.scopes.length}</dd><dt>{t("labelProtected")}</dt><dd>{dialog.preview.protected ? t("labelProtected") : t("labelNoDescription")}</dd></dl><div className="file-selection-summary">{dialog.preview.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div></>}</ActionDialog>}
    <SafeSyncConflictDialog sync={safeSync} />
  </View>;
}
