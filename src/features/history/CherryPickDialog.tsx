import { useEffect, useState } from "react";
import { cherryPickChange, listPendingChanges, normalizeAppError, previewCherryPick } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, CherryPickPreviewItem, ConnectionInput, PendingChange } from "../../shared/models";
import { ErrorBanner, Modal } from "../../shared/View";

export function CherryPickDialog({ connection, sourceChange, sourceStream, targetStream, onClose, onComplete }: {
  connection: ConnectionInput;
  sourceChange: string;
  sourceStream: string;
  targetStream: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useLocale();
  const [targetChange, setTargetChange] = useState("default");
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [items, setItems] = useState<CherryPickPreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState<AppError>();

  useEffect(() => {
    let active = true;
    void listPendingChanges(connection)
      .then((changes) => { if (active) setPending(changes); })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); });
    return () => { active = false; };
  }, [connection.client, connection.port, connection.user]);

  async function loadPreview() {
    setBusy(true);
    setError(undefined);
    try {
      setItems(await previewCherryPick(connection, sourceChange, sourceStream, targetStream, targetChange));
      setPreviewed(true);
    } catch (reason) {
      setError(normalizeAppError(reason));
      setPreviewed(false);
    } finally { setBusy(false); }
  }

  async function applyCherryPick() {
    setBusy(true);
    setError(undefined);
    try {
      await cherryPickChange(connection, sourceChange, sourceStream, targetStream, targetChange);
      onComplete();
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  return <Modal title={t("cherryPickTitle")} busy={busy} wide onClose={onClose}>
    {error && <ErrorBanner error={error} />}
    <div className="dialog-body">
      <p>{t("cherryPickBody")}</p>
      <dl className="dialog-facts"><dt>{t("cherryPickSource")}</dt><dd><span className="changelist-number">CL {sourceChange}</span> · {sourceStream}</dd><dt>{t("cherryPickTargetStream")}</dt><dd>{targetStream}</dd></dl>
      <label className="field"><span className="field-label">{t("cherryPickTargetChange")}</span><select value={targetChange} onChange={(event) => { setTargetChange(event.target.value); setPreviewed(false); }}><option value="default">{t("defaultChangelist")}</option>{pending.filter((change) => change.id !== "default").map((change) => <option key={change.id} value={change.id}>CL {change.id} · {change.description || t("noDescription")}</option>)}</select></label>
      {previewed && <><p>{items.length ? `${items.length} ${t("filesCount")}` : t("cherryPickEmpty")}</p>{items.map((item) => <div className="preview-row" key={`${item.targetPath}-${item.action}`}><span>{item.action}</span><span>{item.sourcePath || sourceStream}</span><span>{item.targetPath}</span></div>)}</>}
    </div>
    <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><button className="secondary-button" type="button" onClick={() => void loadPreview()} disabled={busy}>{busy && !previewed ? t("loadingHistory") : t("previewCherryPick")}</button><button className="primary-button" type="button" onClick={() => void applyCherryPick()} disabled={busy || !previewed || items.length === 0}>{t("applyCherryPick")}</button></div>
  </Modal>;
}
