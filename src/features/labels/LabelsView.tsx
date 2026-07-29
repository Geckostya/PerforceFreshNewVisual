import { useEffect, useMemo, useState } from "react";
import { listDepotFiles, listLabels, normalizeAppError, previewSync } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, DepotFile, Label, SyncPreview } from "../../shared/models";
import { RefreshButton } from "../../shared/RefreshButton";
import { SafeSyncConflictDialog, SyncPreviewDetails, useSafeSync } from "../../shared/SafeSync";
import { BoundedListNotice, CompactEmpty, EmptyState, View } from "../../shared/View";
import { SERVER_LIST_LIMIT } from "../../shared/scale";

const LABEL_DETAIL_LIMIT = 100;

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

  async function inspectLabel(label: Label) {
    setSelectedLabel(label);
    setSyncPreviewState(undefined);
    setDetailBusy(true);
    setError(undefined);
    try { setLabelFiles(await listDepotFiles(connection, `//...@${label.name}`, true)); }
    catch (reason) { setError(normalizeAppError(reason)); }
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
          <button className="primary-button" type="button" onClick={() => void showLabelSync()} disabled={detailBusy || safeSync.phase !== "idle"}>{t("previewLabelSync")}</button>
          {syncPreviewState && <div className="inline-preview"><strong>{t("syncPreviewTitle")}</strong><SyncPreviewDetails preview={syncPreviewState} acknowledged={syncAcknowledged} onAcknowledged={setSyncAcknowledged} /><button className="primary-button" type="button" onClick={() => void applyLabelSync()} disabled={detailBusy || !syncPreviewState.items.length || (syncPreviewState.modifiedFiles.length > 0 && !syncAcknowledged)}>{t("syncNow")}</button></div>}
        </div>}
      </aside>
    </div>
    <SafeSyncConflictDialog sync={safeSync} />
  </View>;
}
