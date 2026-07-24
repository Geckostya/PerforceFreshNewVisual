import { useState } from "react";
import { normalizeAppError, previewUndo, undoChange } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, UndoPreviewItem } from "../../shared/models";

export function UndoDialog({ connection, sourceChange, onClose, onComplete }: {
  connection: ConnectionInput;
  sourceChange: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useLocale();
  const [targetChange, setTargetChange] = useState("default");
  const [items, setItems] = useState<UndoPreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState<AppError>();

  async function loadPreview() {
    setBusy(true); setError(undefined);
    try { setItems(await previewUndo(connection, sourceChange)); setPreviewed(true); }
    catch (reason) { setError(normalizeAppError(reason)); setPreviewed(false); }
    finally { setBusy(false); }
  }

  async function applyUndo() {
    setBusy(true); setError(undefined);
    try { await undoChange(connection, sourceChange, targetChange.trim() || "default"); onComplete(); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  return <div className="dialog-layer"><section className="action-dialog wide" role="dialog" aria-modal="true" aria-labelledby="undo-dialog-title">
    <div className="dialog-heading"><div><h2 id="undo-dialog-title">{t("undoTitle")}</h2><p>{t("undoBody")}</p></div><button type="button" onClick={onClose} disabled={busy} aria-label={t("close")}>×</button></div>
    {error && <div className="error-banner" role="alert"><strong>{error.message}</strong>{error.hints.map((hint) => <span key={hint}>{hint}</span>)}</div>}
    <div className="dialog-body"><dl className="dialog-facts"><dt>{t("undoSource")}</dt><dd>CL {sourceChange}</dd></dl><label className="field"><span className="field-label">{t("undoTarget")}</span><input value={targetChange} onChange={(event) => { setTargetChange(event.target.value); setPreviewed(false); }} placeholder="default or 12345" /></label>{previewed && <><p>{items.length ? `${items.length} ${t("filesCount")}` : t("undoEmpty")}</p>{items.map((item) => <div className="preview-row" key={`${item.depotPath}-${item.action}`}><span>{item.action}</span><span>{item.depotPath}</span><span>{item.localPath || ""}</span></div>)}</>}</div>
    <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className="secondary-button" type="button" onClick={() => void loadPreview()} disabled={busy}>{busy && !previewed ? t("loadingHistory") : t("previewUndo")}</button><button className="danger-button" type="button" onClick={() => void applyUndo()} disabled={busy || !previewed || items.length === 0}>{t("applyUndo")}</button></div>
  </section></div>;
}
