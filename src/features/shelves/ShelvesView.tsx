import { useEffect, useRef, useState } from "react";
import { listPendingChanges, listShelvedChanges, listShelvedFiles, normalizeAppError, previewUnshelve, reshelveFiles, saveShelvedFile, unshelveFiles } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, PendingChange, ShelvedFile, UnshelvePreview } from "../../shared/models";
import { selectionMode, updateSelection } from "../../shared/selection";
import { ActionDialog, CompactEmpty, EmptyState, View } from "../../shared/View";
import { canApplyUnshelve, splitUnshelvePaths } from "./shelves";

type ShelfDialog = { kind: "export"; outputPath: string } | { kind: "reshelve" };

export function ShelvesView({ connection }: { connection: ConnectionInput }) {
  const { t } = useLocale();
  const [shelves, setShelves] = useState<PendingChange[]>([]);
  const [targets, setTargets] = useState<PendingChange[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<string>();
  const [files, setFiles] = useState<ShelvedFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const selectionAnchor = useRef<string | undefined>(undefined);
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
      if (!selectedShelf && nextShelves[0]) await selectShelf(nextShelves[0].id);
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
      setSelectedPaths(nextFiles.map((file) => file.depotPath));
      selectionAnchor.current = nextFiles[0]?.depotPath;
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [connection.port, connection.user, connection.client]);

  function selectFile(path: string, event: React.MouseEvent) {
    const next = updateSelection(files.map((file) => file.depotPath), selectedPaths, path, selectionAnchor.current, selectionMode(event));
    setSelectedPaths(next.selected);
    selectionAnchor.current = next.anchor;
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
    eyebrow={t("shelvesEyebrow")}
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
        {shelves.length ? shelves.map((item) => <button type="button" className={`resource-row${item.id === selectedShelf ? " selected" : ""}`} key={item.id} onClick={() => void selectShelf(item.id)}>
          <span><strong>CL {item.id}</strong><small>{item.user} · {item.client}</small></span>
          <span>{item.description || t("noDescription")}</span>
        </button>) : <CompactEmpty text={t("shelvesEmpty")} />}
      </div>
      <aside className="resource-inspector">
        <div className="column-heading"><strong>{shelf ? `CL ${shelf.id}` : t("shelvesTitle")}</strong><span>{selectedPaths.length} / {files.length}</span></div>
        {!selectedShelf ? <EmptyState title={t("selectShelf")} body={t("shelvesBody")} /> : <div className="inspector-content">
          <div><h2>{shelf?.description || t("noDescription")}</h2><p>{selectedPaths.length} / {files.length} {t("shelvedFilesCount")}</p></div>
          <label className="field"><span className="field-label">{t("targetChangelist")}</span><select value={targetChange} onChange={(event) => { setTargetChange(event.target.value); setPreview(undefined); setOverwritePaths([]); }}><option value="default">{t("defaultChangelist")}</option>{targets.map((target) => <option value={target.id} key={target.id}>{`CL ${target.id} · ${target.description || t("noDescription")}`}</option>)}</select></label>
          <div className="resource-detail-list">{files.map((file) => <button type="button" aria-pressed={selectedPaths.includes(file.depotPath)} className={`resource-entry preview-select${selectedPaths.includes(file.depotPath) ? " selected" : ""}`} key={file.depotPath} onClick={(event) => selectFile(file.depotPath, event)}><strong>{file.depotPath}</strong><small>{file.action}{file.revision ? ` · #${file.revision}` : ""}</small></button>)}</div>
          <div className="inspector-actions"><button className="secondary-button" type="button" onClick={() => { const paths = files.map((file) => file.depotPath); setSelectedPaths(paths); selectionAnchor.current = paths[0]; setPreview(undefined); setOverwritePaths([]); }} disabled={busy}>{t("selectAllFiles")}</button><button className="primary-button" type="button" onClick={() => void previewSelected()} disabled={busy || !selectedPaths.length}>{t("previewUnshelve")}</button><button className="secondary-button" type="button" onClick={() => setDialog({ kind: "export", outputPath: "" })} disabled={busy || selectedPaths.length !== 1}>{t("exportShelfFile")}</button>{targetChange !== "default" && <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "reshelve" })} disabled={busy || !selectedPaths.length}>{t("reshelveToTarget")}</button>}</div>
          {preview && <div className="inline-preview"><strong>{t("unshelvePreview")}</strong><p>{preview.conflicts.length ? `${preview.conflicts.length} ${t("unshelveConflicts")}` : t("unshelveNoConflicts")}</p>{preview.conflicts.map((conflict) => <label className="check-field" key={conflict.depotPath}><input type="checkbox" checked={overwritePaths.includes(conflict.depotPath)} onChange={(event) => setOverwritePaths((current) => event.target.checked ? [...current, conflict.depotPath] : current.filter((path) => path !== conflict.depotPath))} /><span><strong>{conflict.depotPath}</strong><small>{conflict.localPath ? `${conflict.localPath} · ${t("unshelveConflictDefaultSkip")}` : t("unshelveConflictDefaultSkip")}</small></span></label>)}<button className="primary-button" type="button" onClick={() => void applyUnshelve()} disabled={busy || !canApplyUnshelve(preview, selectedPaths, overwritePaths)}>{t("applyUnshelve")}</button></div>}
        </div>}
      </aside>
    </div>

    {dialog?.kind === "export" && <ActionDialog title={t("exportShelfFile")} confirmLabel={t("exportShelfFile")} busy={busy} confirmDisabled={!dialog.outputPath.trim()} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{selectedPaths[0]}</p><label className="field"><span className="field-label">{t("shelfExportPathPrompt")}</span><input autoFocus value={dialog.outputPath} onChange={(event) => setDialog({ ...dialog, outputPath: event.target.value })} /></label></ActionDialog>}
    {dialog?.kind === "reshelve" && <ActionDialog title={t("reshelveToTarget")} confirmLabel={t("reshelveToTarget")} busy={busy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("reshelveConfirm")}</p></ActionDialog>}
  </View>;
}
