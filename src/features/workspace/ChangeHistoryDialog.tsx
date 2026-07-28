import { useEffect, useState } from "react";
import { describeChange, diffRevisions, normalizeAppError, saveChangeFiles, saveRevision } from "../../shared/api";
import { DiffViewer } from "../../shared/DiffViewer";
import { ChangelistDescription } from "../../shared/ChangelistDescription";
import { useLocale } from "../../shared/i18n";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, FileDiff, SubmittedChangeDetail, SubmittedFile } from "../../shared/models";
import { isContextMenuShortcut } from "../../shared/selection";
import { CompactEmpty, ContextMenu, ErrorBanner, MenuButton, Modal, Notice } from "../../shared/View";
import { useContextMenu } from "../../shared/useContextMenu";
import { useMultiSelection } from "../../shared/useMultiSelection";
import { canDiffSubmittedFile, canDownloadSubmittedFile, formatWorkspaceHistoryTime, previousWorkspaceRevision } from "./workspace";

type SaveTarget = "all" | SubmittedFile;

export function ChangeHistoryDialog({ connection, change, onClose }: { connection: ConnectionInput; change: string; onClose: () => void }) {
  const { t, language } = useLocale();
  const [detail, setDetail] = useState<SubmittedChangeDetail>();
  const fileMenu = useContextMenu<{ file: SubmittedFile; paths: string[] }>();
  const [diff, setDiff] = useState<FileDiff>();
  const [diffTitle, setDiffTitle] = useState("");
  const [saveTarget, setSaveTarget] = useState<SaveTarget>();
  const [outputPath, setOutputPath] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const fileSelection = useMultiSelection(detail?.files.map((file) => file.depotPath) || []);
  const selected = fileSelection.selected;

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    fileSelection.clear();
    fileMenu.close();
    setBusy(true);
    setError(undefined);
    void describeChange(connection, change)
      .then((value) => { if (active) setDetail(value); })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [change, connection]);

  function selectFile(file: SubmittedFile, event: React.MouseEvent) {
    fileSelection.select(file.depotPath, event);
  }

  function openMenu(event: React.MouseEvent | React.KeyboardEvent, file: SubmittedFile) {
    const paths = selected.includes(file.depotPath) ? selected : [file.depotPath];
    if (!selected.includes(file.depotPath)) fileSelection.replace(paths);
    fileMenu.open(event, { file, paths });
  }

  async function showDiff(file: SubmittedFile) {
    const previous = previousWorkspaceRevision(file.revision);
    if (!file.revision || !previous) return;
    setBusy(true);
    setError(undefined);
    try {
      setDiff(await diffRevisions(connection, file.depotPath, previous, file.revision));
      setDiffTitle(`${file.depotPath}#${previous} ↔ #${file.revision}`);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  function requestSave(target: SaveTarget) {
    setSaveTarget(target);
    setOutputPath("");
    setError(undefined);
  }

  async function save() {
    if (!saveTarget || !outputPath.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      if (saveTarget === "all") {
        const result = await saveChangeFiles(connection, change, outputPath.trim());
        setNotice(result.skippedFiles
          ? `${t("changeFilesSaved")}: ${result.savedFiles}. ${t("changeFilesSkipped")}: ${result.skippedFiles}.`
          : `${t("changeFilesSaved")}: ${result.savedFiles}.`);
      } else if (saveTarget.revision) {
        await saveRevision(connection, saveTarget.depotPath, saveTarget.revision, outputPath.trim());
        setNotice(t("revisionSaved"));
      }
      setSaveTarget(undefined);
      setOutputPath("");
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  const printableCount = detail?.files.filter(canDownloadSubmittedFile).length || 0;
  const menu = fileMenu.menu?.target;
  const singleMenuFile = menu?.paths.length === 1 ? menu.file : undefined;

  return <Modal title={<>{t("changeDetails")} · <span className="changelist-number">CL {change}</span></>} busy={busy} wide onClose={onClose}>
    <div className="dialog-body change-history-dialog">
      {error && <ErrorBanner error={error} />}
      {notice && <Notice text={notice} onDismiss={() => setNotice("")} />}
      {!detail ? <CompactEmpty text={busy ? t("loadingHistory") : t("submittedEmpty")} /> : <>
        <div><ChangelistDescription value={detail.description} fallback={t("noDescription")} /><small className="change-history-meta">{[detail.user, detail.client, formatWorkspaceHistoryTime(detail.time, language)].filter(Boolean).join(" · ")}</small></div>
        <div className="column-heading"><strong>{t("filesLabel")}</strong><span>{selected.length ? `${selected.length} / ` : ""}{detail.files.length}</span></div>
        <div className="change-history-files" role="listbox" aria-multiselectable="true">
          {detail.files.map((file) => <SelectableRow
            selected={selected.includes(file.depotPath)}
            selectionRole="option"
            className="change-history-file"
            key={file.depotPath}
            onClick={(event) => selectFile(file, event)}
            onContextMenu={(event) => openMenu(event, file)}
            onKeyDown={(event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, file); }}
          ><ItemRowCopy primary={file.depotPath.split("/").at(-1) || file.depotPath} secondary={file.depotPath} /><ItemRowCopy primary={file.action || "—"} secondary={<>{file.revision ? `#${file.revision}` : "—"}{file.fileType ? ` · ${file.fileType}` : ""}</>} /></SelectableRow>)}
        </div>
        {diff && <div className="history-diff"><h2>{diffTitle}</h2><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} /></div>}
        {saveTarget && <div className="inline-preview"><p>{saveTarget === "all" ? t("saveChangeFilesBody") : `${saveTarget.depotPath}#${saveTarget.revision}`}</p><label className="field"><span className="field-label">{saveTarget === "all" ? t("saveChangeDirectoryPrompt") : t("saveRevisionPathPrompt")}</span><input autoFocus value={outputPath} onChange={(event) => setOutputPath(event.target.value)} /></label></div>}
      </>}
    </div>
    <div className="dialog-actions">
      {saveTarget ? <><button className="secondary-button" type="button" onClick={() => setSaveTarget(undefined)} disabled={busy}>{t("cancel")}</button><button className="primary-button" type="button" onClick={() => void save()} disabled={busy || !outputPath.trim()}>{saveTarget === "all" ? t("saveChangeFiles") : t("saveRevision")}</button></> : <><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("close")}</button><button className="primary-button" type="button" onClick={() => requestSave("all")} disabled={busy || printableCount === 0}>{t("saveChangeFiles")}</button></>}
    </div>
    {menu && fileMenu.menu && <ContextMenu x={fileMenu.menu.x} y={fileMenu.menu.y} onSelect={fileMenu.close}>
      {singleMenuFile ? <>
        <MenuButton disabled={!canDiffSubmittedFile(singleMenuFile) || busy} onClick={() => void showDiff(singleMenuFile)}>{t("previewFileDiff")}</MenuButton>
        <MenuButton disabled={!canDownloadSubmittedFile(singleMenuFile) || busy} onClick={() => requestSave(singleMenuFile)}>{t("saveRevision")}</MenuButton>
      </> : <MenuButton disabled onClick={() => undefined}>{t("singleFileActionRequired")}</MenuButton>}
    </ContextMenu>}
  </Modal>;
}
