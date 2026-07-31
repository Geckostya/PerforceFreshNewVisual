import { useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { configureWorkspaceScan, normalizeAppError } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, P4Info, WorkspaceScanSnapshot } from "../../shared/models";
import { CompactEmpty, ErrorBanner, Modal } from "../../shared/View";

const MAX_SCAN_PATHS = 32;

function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
}

function mergePaths(current: string[], selected: string[]): string[] {
  const result = [...current];
  const seen = new Set(result.map(pathKey));
  for (const path of selected) {
    const normalized = path.trim();
    if (normalized && !seen.has(pathKey(normalized))) {
      result.push(normalized);
      seen.add(pathKey(normalized));
    }
  }
  return result;
}

export function UnopenedChangesConfigDialog({ connection, info, snapshot, onClose, onSaved }: {
  connection: ConnectionInput;
  info: P4Info;
  snapshot: WorkspaceScanSnapshot;
  onClose: () => void;
  onSaved: (snapshot: WorkspaceScanSnapshot) => void;
}) {
  const { t } = useLocale();
  const initialRoots = snapshot.roots.map((root) => root.localPath);
  const [roots, setRoots] = useState(initialRoots.length > 0 ? initialRoots : info.clientRoot ? [info.clientRoot] : []);
  const [exclusions, setExclusions] = useState(snapshot.exclusions);
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [error, setError] = useState<AppError>();

  async function chooseFolders(kind: "root" | "exclusion") {
    setError(undefined);
    setPickerBusy(true);
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        defaultPath: info.clientRoot || roots[0],
        title: t(kind === "root" ? "unopenedChooseRoots" : "unopenedChooseExclusions"),
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (kind === "root") setRoots((current) => mergePaths(current, paths).slice(0, MAX_SCAN_PATHS));
      else setExclusions((current) => mergePaths(current, paths).slice(0, MAX_SCAN_PATHS));
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setPickerBusy(false);
    }
  }

  async function save() {
    if (roots.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await configureWorkspaceScan(connection, roots, exclusions));
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  const dialogBusy = busy || pickerBusy;
  return <Modal wide title={t("unopenedConfigureTitle")} busy={dialogBusy} onClose={onClose}>
    <div className="dialog-body unopened-config-dialog">
      {error && <ErrorBanner error={error} />}
      <p>{t("unopenedConfigureHelp")}</p>
      <section className="unopened-config-section">
        <div className="unopened-config-section-heading">
          <div><strong>{t("unopenedScanRoots")}</strong><small>{t("unopenedScanRootsHint")}</small></div>
          <div className="button-row">
            <button className="secondary-button" type="button" disabled={dialogBusy || roots.length >= MAX_SCAN_PATHS} onClick={() => setRoots((current) => [...current, ""]) }><Plus className="ui-icon" aria-hidden="true" />{t("unopenedAddRoot")}</button>
            <button className="secondary-button" type="button" disabled={dialogBusy || roots.length >= MAX_SCAN_PATHS} onClick={() => void chooseFolders("root")}><FolderOpen className="ui-icon" aria-hidden="true" />{pickerBusy ? t("unopenedChoosingFolder") : t("unopenedChooseRoots")}</button>
          </div>
        </div>
        {roots.length > 0 ? <div className="unopened-config-path-list">{roots.map((root, index) => <div className="unopened-config-path" key={`${index}-${root}`}>
          <input value={root} placeholder={info.clientRoot || "C:\\workspace"} disabled={dialogBusy} onChange={(event) => setRoots((current) => current.map((path, pathIndex) => pathIndex === index ? event.target.value : path))} />
          <button className="icon-button" type="button" aria-label={t("unopenedRemoveRoot")} title={t("unopenedRemoveRoot")} disabled={dialogBusy} onClick={() => setRoots((current) => current.filter((_, pathIndex) => pathIndex !== index))}><Trash2 className="ui-icon" aria-hidden="true" /></button>
        </div>)}</div> : <CompactEmpty text={t("unopenedNoRoots")} />}
      </section>
      <section className="unopened-config-section">
        <div className="unopened-config-section-heading">
          <div><strong>{t("unopenedScanExclusions")}</strong><small>{t("unopenedScanExclusionsHint")}</small></div>
          <div className="button-row">
            <button className="secondary-button" type="button" disabled={dialogBusy || exclusions.length >= MAX_SCAN_PATHS} onClick={() => setExclusions((current) => [...current, ""]) }><Plus className="ui-icon" aria-hidden="true" />{t("unopenedAddExclusion")}</button>
            <button className="secondary-button" type="button" disabled={dialogBusy || exclusions.length >= MAX_SCAN_PATHS} onClick={() => void chooseFolders("exclusion")}><FolderOpen className="ui-icon" aria-hidden="true" />{pickerBusy ? t("unopenedChoosingFolder") : t("unopenedChooseExclusions")}</button>
          </div>
        </div>
        {exclusions.length > 0 ? <div className="unopened-config-path-list">{exclusions.map((exclusion, index) => <div className="unopened-config-path" key={`${index}-${exclusion}`}>
          <input value={exclusion} placeholder={t("unopenedExclusionPlaceholder")} disabled={dialogBusy} onChange={(event) => setExclusions((current) => current.map((path, pathIndex) => pathIndex === index ? event.target.value : path))} />
          <button className="icon-button" type="button" aria-label={t("unopenedRemoveExclusion")} title={t("unopenedRemoveExclusion")} disabled={dialogBusy} onClick={() => setExclusions((current) => current.filter((_, pathIndex) => pathIndex !== index))}><Trash2 className="ui-icon" aria-hidden="true" /></button>
        </div>)}</div> : <CompactEmpty text={t("unopenedNoExclusions")} />}
      </section>
    </div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" disabled={dialogBusy} onClick={onClose}>{t("cancel")}</button>
      <button className="primary-button" type="button" disabled={dialogBusy || roots.some((root) => !root.trim()) || roots.length === 0} onClick={() => void save()}>{busy ? t("unopenedConfiguring") : t("unopenedSaveConfiguration")}</button>
    </div>
  </Modal>;
}
