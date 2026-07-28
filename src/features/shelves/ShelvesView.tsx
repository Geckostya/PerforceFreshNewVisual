import { useEffect, useState } from "react";
import { listPendingChanges, listShelvedChanges, listShelvedFiles, normalizeAppError, previewUnshelve, reshelveFiles, saveShelvedFile, unshelveFiles } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import { ChangelistDescription, markdownToPlainText } from "../../shared/ChangelistDescription";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, PendingChange, ShelvedFile, UnshelvePreview } from "../../shared/models";
import { useMultiSelection } from "../../shared/useMultiSelection";
import { ActionDialog, CompactEmpty, EmptyState, View } from "../../shared/View";
import { canApplyUnshelve, nextShelfSelection, splitUnshelvePaths } from "./shelves";

type ShelfDialog = { kind: "export"; outputPath: string } | { kind: "reshelve" };

export function ShelvesView({ connection }: { connection: ConnectionInput }) {
  const { t } = useLocale();
  const [shelves, setShelves] = useState<PendingChange[]>([]);
  const [targets, setTargets] = useState<PendingChange[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<string>();
  const [files, setFiles] = useState<ShelvedFile[]>([]);
  const fileSelection = useMultiSelection(files.map((file) => file.depotPath));
  const selectedPaths = fileSelection.selected;
  const [targetChange, setTargetChange] = useState("default");
  const [preview, setPreview] = useState<UnshelvePreview>();
  const [overwritePaths, setOverwritePaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<ShelfDialog>();

  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const [nextShelves, nextTargets] = await Promise.all([listShelvedChanges(connection), listPendingChanges(connection)]);
      setShelves(nextShelves);
      setTargets(nextTargets.filter((change) => change.id !== "default"));
      const nextSelected = nextShelfSelection(nextShelves, selectedShelf);
      if (nextSelected) {
        await selectShelf(nextSelected);
      } else {
        setSelectedShelf(undefined);
        setFiles([]);
        fileSelection.clear();
        setPreview(undefined);
        setOverwritePaths([]);
      }
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function selectShelf(change: string) {
    setSelectedShelf(change);
    setPreview(undefined);
    setOverwritePaths([]);
    setError(undefined);
    setBusy(true);
    try {
      const nextFiles = await listShelvedFiles(connection, change);
      setFiles(nextFiles);
      fileSelection.replace(nextFiles.map((file) => file.depotPath));
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [connection.port, connection.user, connection.client]);

  function selectFile(path: string, event: React.MouseEvent) {
    fileSelection.select(path, event);
    setPreview(undefined);
    setOverwritePaths([]);
  }

  async function previewSelected() {
    if (!selectedShelf || !selectedPaths.length) return;
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    try { setPreview(await previewUnshelve(connection, selectedShelf, selectedPaths)); setOverwritePaths([]); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyUnshelve() {
    if (!selectedShelf || !preview || !canApplyUnshelve(preview, selectedPaths, overwritePaths)) return;
    const plan = splitUnshelvePaths(selectedPaths, preview, overwritePaths);
    const paths = [...plan.normalPaths, ...plan.forcePaths];
    setBusy(true);
    setError(undefined);
    try {
      await unshelveFiles(connection, selectedShelf, targetChange, paths, plan.forcePaths);
      setNotice(t("shelvesUnshelveSucceeded"));
      setPreview(undefined);
      setOverwritePaths([]);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyDialog() {
    if (!dialog || !selectedShelf) return;
    setBusy(true);
    setError(undefined);
    try {
      if (dialog.kind === "export") {
        await saveShelvedFile(connection, selectedShelf, selectedPaths[0], dialog.outputPath.trim());
        setNotice(t("shelfExportSucceeded"));
      } else {
        await reshelveFiles(connection, selectedShelf, targetChange, selectedPaths);
        setNotice(t("reshelveSucceeded"));
      }
      setDialog(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  const shelf = shelves.find((item) => item.id === selectedShelf);
  return <View
    id="shelves-title"
    title={t("shelvesTitle")}
    subtitle={t("shelvesBody")}
    error={error}
    notice={notice}
    onDismissNotice={() => setNotice("")}
    actions={<button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? t("loadingShelves") : t("refresh")}</button>}
  >
    <div className="resource-workbench">
      <div className="resource-list">
        <div className="column-heading"><strong>{t("shelvesTitle")}</strong><span>{shelves.length}</span></div>
        {shelves.length ? shelves.map((item) => <SelectableRow selected={item.id === selectedShelf} className="resource-row" key={item.id} onClick={() => void selectShelf(item.id)}>
          <ItemRowCopy primary={<span className="changelist-number">CL {item.id}</span>} secondary={`${item.user} · ${item.client}`} />
          <ChangelistDescription value={item.description} fallback={t("noDescription")} compact />
        </SelectableRow>) : <CompactEmpty text={t("shelvesEmpty")} />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong className={shelf ? "changelist-number" : undefined}>{shelf ? `CL ${shelf.id}` : t("shelvesTitle")}</strong><span>{selectedPaths.length} / {files.length}</span></div>
        {!selectedShelf ? <EmptyState title={t("selectShelf")} body={t("shelvesBody")} /> : <div className="inspector-content">
          <div><ChangelistDescription value={shelf?.description} fallback={t("noDescription")} /><p>{selectedPaths.length} / {files.length} {t("shelvedFilesCount")}</p></div>
          <label className="field"><span className="field-label">{t("targetChangelist")}</span><select value={targetChange} onChange={(event) => { setTargetChange(event.target.value); setPreview(undefined); setOverwritePaths([]); }}><option value="default">{t("defaultChangelist")}</option>{targets.map((target) => <option value={target.id} key={target.id}>{`CL ${target.id} · ${markdownToPlainText(target.description) || t("noDescription")}`}</option>)}</select></label>
          <div className="resource-detail-list">{files.map((file) => <SelectableRow selected={selectedPaths.includes(file.depotPath)} className="resource-entry preview-select" key={file.depotPath} onClick={(event) => selectFile(file.depotPath, event)}><ItemRowCopy primary={file.depotPath} secondary={<>{file.action}{file.revision ? ` · #${file.revision}` : ""}</>} /></SelectableRow>)}</div>
          <div className="inspector-actions"><button className="secondary-button" type="button" onClick={() => { fileSelection.replace(files.map((file) => file.depotPath)); setPreview(undefined); setOverwritePaths([]); }} disabled={busy}>{t("selectAllFiles")}</button><button className="primary-button" type="button" onClick={() => void previewSelected()} disabled={busy || !selectedPaths.length}>{t("previewUnshelve")}</button><button className="secondary-button" type="button" onClick={() => setDialog({ kind: "export", outputPath: "" })} disabled={busy || selectedPaths.length !== 1}>{t("exportShelfFile")}</button>{targetChange !== "default" && <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "reshelve" })} disabled={busy || !selectedPaths.length}>{t("reshelveToTarget")}</button>}</div>
          {preview && <div className="inline-preview"><strong>{t("unshelvePreview")}</strong><p>{preview.conflicts.length ? `${preview.conflicts.length} ${t("unshelveConflicts")}` : t("unshelveNoConflicts")}</p>{preview.conflicts.map((conflict) => <label className="check-field" key={conflict.depotPath}><input type="checkbox" checked={overwritePaths.includes(conflict.depotPath)} onChange={(event) => setOverwritePaths((current) => event.target.checked ? [...current, conflict.depotPath] : current.filter((path) => path !== conflict.depotPath))} /><span><strong>{conflict.depotPath}</strong><small>{conflict.localPath ? `${conflict.localPath} · ${t("unshelveConflictDefaultSkip")}` : t("unshelveConflictDefaultSkip")}</small></span></label>)}<button className="primary-button" type="button" onClick={() => void applyUnshelve()} disabled={busy || !canApplyUnshelve(preview, selectedPaths, overwritePaths)}>{t("applyUnshelve")}</button></div>}
        </div>}
      </aside>
    </div>

    {dialog?.kind === "export" && <ActionDialog title={t("exportShelfFile")} confirmLabel={t("exportShelfFile")} busy={busy} confirmDisabled={!dialog.outputPath.trim()} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{selectedPaths[0]}</p><label className="field"><span className="field-label">{t("shelfExportPathPrompt")}</span><input autoFocus value={dialog.outputPath} onChange={(event) => setDialog({ ...dialog, outputPath: event.target.value })} /></label></ActionDialog>}
    {dialog?.kind === "reshelve" && <ActionDialog title={t("reshelveToTarget")} confirmLabel={t("reshelveToTarget")} busy={busy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("reshelveConfirm")}</p></ActionDialog>}
  </View>;
}
