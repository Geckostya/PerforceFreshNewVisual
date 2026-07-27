import { useEffect, useRef, useState } from "react";
import { describeChange, diffRevisions, normalizeAppError, saveChangeFiles, saveRevision } from "../../shared/api";
import { DiffViewer } from "../../shared/DiffViewer";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, FileDiff, SubmittedChangeDetail, SubmittedFile } from "../../shared/models";
import { isContextMenuShortcut, selectionMode, updateSelection } from "../../shared/selection";
import { CompactEmpty, ContextMenu, ErrorBanner, MenuButton, Modal, Notice } from "../../shared/View";
import { canDiffSubmittedFile, canDownloadSubmittedFile, formatWorkspaceHistoryTime, previousWorkspaceRevision } from "./workspace";

type SaveTarget = "all" | SubmittedFile;

export function ChangeHistoryDialog({ connection, change, onClose }: { connection: ConnectionInput; change: string; onClose: () => void }) {
  const { t, language } = useLocale();
  const [detail, setDetail] = useState<SubmittedChangeDetail>();
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ file: SubmittedFile; paths: string[]; x: number; y: number }>();
  const [diff, setDiff] = useState<FileDiff>();
  const [diffTitle, setDiffTitle] = useState("");
  const [saveTarget, setSaveTarget] = useState<SaveTarget>();
  const [outputPath, setOutputPath] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const selectionAnchor = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(undefined);
    void describeChange(connection, change)
      .then((value) => { if (active) setDetail(value); })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [change, connection]);

  function selectFile(file: SubmittedFile, event: React.MouseEvent) {
    if (!detail) return;
    const order = detail.files.map((item) => item.depotPath);
    const next = updateSelection(order, selected, file.depotPath, selectionAnchor.current, selectionMode(event));
    selectionAnchor.current = next.anchor;
    setSelected(next.selected);
  }

  function openMenu(event: React.MouseEvent | React.KeyboardEvent, file: SubmittedFile) {
    event.preventDefault();
    event.stopPropagation();
    const paths = selected.includes(file.depotPath) ? selected : [file.depotPath];
    if (!selected.includes(file.depotPath)) setSelected(paths);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      file,
      paths,
      x: "clientX" in event && event.clientX > 0 ? event.clientX : rect.left,
      y: "clientY" in event && event.clientY > 0 ? event.clientY : rect.bottom,
    });
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
  const singleMenuFile = menu?.paths.length === 1 ? menu.file : undefined;

  return <Modal title={`${t("changeDetails")} · CL ${change}`} busy={busy} wide onClose={onClose}>
    <div className="dialog-body change-history-dialog">
      {error && <ErrorBanner error={error} />}
      {notice && <Notice text={notice} onDismiss={() => setNotice("")} />}
      {!detail ? <CompactEmpty text={busy ? t("loadingHistory") : t("submittedEmpty")} /> : <>
        <div><strong>{detail.description || t("noDescription")}</strong><small className="change-history-meta">{[detail.user, detail.client, formatWorkspaceHistoryTime(detail.time, language)].filter(Boolean).join(" · ")}</small></div>
        <div className="column-heading"><strong>{t("filesLabel")}</strong><span>{selected.length ? `${selected.length} / ` : ""}{detail.files.length}</span></div>
        <div className="change-history-files" role="listbox" aria-multiselectable="true">
          {detail.files.map((file) => <button
            type="button"
            role="option"
            aria-selected={selected.includes(file.depotPath)}
            className={`change-history-file${selected.includes(file.depotPath) ? " selected" : ""}`}
            key={file.depotPath}
            onClick={(event) => selectFile(file, event)}
            onContextMenu={(event) => openMenu(event, file)}
            onKeyDown={(event) => { if (isContextMenuShortcut(event.key, event.shiftKey)) openMenu(event, file); }}
          ><span><strong>{file.depotPath.split("/").at(-1) || file.depotPath}</strong><small>{file.depotPath}</small></span><span><strong>{file.action || "—"}</strong><small>{file.revision ? `#${file.revision}` : "—"}{file.fileType ? ` · ${file.fileType}` : ""}</small></span></button>)}
        </div>
        {diff && <div className="history-diff"><h2>{diffTitle}</h2><DiffViewer text={diff.text || t("filesIdentical")} truncated={diff.truncated} /></div>}
        {saveTarget && <div className="inline-preview"><p>{saveTarget === "all" ? t("saveChangeFilesBody") : `${saveTarget.depotPath}#${saveTarget.revision}`}</p><label className="field"><span className="field-label">{saveTarget === "all" ? t("saveChangeDirectoryPrompt") : t("saveRevisionPathPrompt")}</span><input autoFocus value={outputPath} onChange={(event) => setOutputPath(event.target.value)} /></label></div>}
      </>}
    </div>
    <div className="dialog-actions">
      {saveTarget ? <><button className="secondary-button" type="button" onClick={() => setSaveTarget(undefined)} disabled={busy}>{t("cancel")}</button><button className="primary-button" type="button" onClick={() => void save()} disabled={busy || !outputPath.trim()}>{saveTarget === "all" ? t("saveChangeFiles") : t("saveRevision")}</button></> : <><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("close")}</button><button className="primary-button" type="button" onClick={() => requestSave("all")} disabled={busy || printableCount === 0}>{t("saveChangeFiles")}</button></>}
    </div>
    {menu && <ContextMenu x={menu.x} y={menu.y} onSelect={() => setMenu(undefined)}>
      {singleMenuFile ? <>
        <MenuButton disabled={!canDiffSubmittedFile(singleMenuFile) || busy} onClick={() => void showDiff(singleMenuFile)}>{t("previewFileDiff")}</MenuButton>
        <MenuButton disabled={!canDownloadSubmittedFile(singleMenuFile) || busy} onClick={() => requestSave(singleMenuFile)}>{t("saveRevision")}</MenuButton>
      </> : <MenuButton disabled onClick={() => undefined}>{t("singleFileActionRequired")}</MenuButton>}
    </ContextMenu>}
  </Modal>;
}
