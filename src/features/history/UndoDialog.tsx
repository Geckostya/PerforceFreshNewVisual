import { useEffect, useState } from "react";
import { createChange, listPendingChanges, normalizeAppError, previewUndo, undoChange } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, PendingChange, UndoPreviewItem } from "../../shared/models";
import { ErrorBanner, Modal } from "../../shared/View";

const NEW_CHANGE_VALUE = "__new__";

export function UndoDialog({ connection, sourceChange, previewDisabledReason, onClose, onComplete }: {
  connection: ConnectionInput;
  sourceChange: string;
  previewDisabledReason?: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useLocale();
  const [targetChange, setTargetChange] = useState("default");
  const [newChangeDescription, setNewChangeDescription] = useState("");
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [items, setItems] = useState<UndoPreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [error, setError] = useState<AppError>();

  useEffect(() => {
    let active = true;
    setPendingLoading(true);
    void listPendingChanges(connection)
      .then((changes) => { if (active) setPending(changes); })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); })
      .finally(() => { if (active) setPendingLoading(false); });
    return () => { active = false; };
  }, [connection.client, connection.port, connection.user]);

  async function loadPreview() {
    if (previewDisabledReason) return;
    setBusy(true); setError(undefined);
    try { setItems(await previewUndo(connection, sourceChange)); setPreviewed(true); }
    catch (reason) { setError(normalizeAppError(reason)); setPreviewed(false); }
    finally { setBusy(false); }
  }

  async function applyUndo() {
    setBusy(true); setError(undefined);
    let createdChange: string | undefined;
    try {
      const target = targetChange === NEW_CHANGE_VALUE
        ? (createdChange = await createChange(connection, newChangeDescription))
        : targetChange;
      if (createdChange) {
        setPending((current) => [...current, { id: createdChange!, description: newChangeDescription, user: connection.user, client: connection.client || "" }]);
        setTargetChange(createdChange);
        setNewChangeDescription("");
      }
      await undoChange(connection, sourceChange, target);
      onComplete();
    } catch (reason) {
      const nextError = normalizeAppError(reason);
      if (createdChange) nextError.hints = [...nextError.hints, t("undoCreatedChangeHint").replace("{change}", createdChange)];
      setError(nextError);
    }
    finally { setBusy(false); }
  }

  const newChangeSelected = targetChange === NEW_CHANGE_VALUE;
  const previewUnavailable = Boolean(previewDisabledReason);
  const applyDisabled = busy || (!previewUnavailable && (!previewed || items.length === 0)) || (newChangeSelected && !newChangeDescription.trim());

  return <Modal title={t("undoTitle")} busy={busy} wide onClose={onClose}>
    {error && <ErrorBanner error={error} />}
    <div className="dialog-body">
      <p>{t("undoBody")}</p>
      <dl className="dialog-facts"><dt>{t("undoSource")}</dt><dd className="changelist-number">CL {sourceChange}</dd></dl>
      <label className="field"><span className="field-label">{t("undoTarget")}</span><select data-agent-id="undo-target-change" value={targetChange} onChange={(event) => setTargetChange(event.target.value)} disabled={busy}><option value="default">{t("defaultChangelist")}</option>{pending.filter((change) => change.id !== "default").map((change) => <option key={change.id} value={change.id}>CL {change.id} · {change.description || t("noDescription")}</option>)}<option value={NEW_CHANGE_VALUE}>{t("newChangelistOption")}</option></select>{pendingLoading && <small>{t("loadingChanges")}</small>}</label>
      {newChangeSelected && <label className="field"><span className="field-label">{t("undoNewChangeDescription")}</span><input autoFocus value={newChangeDescription} onChange={(event) => setNewChangeDescription(event.target.value)} disabled={busy} /></label>}
      {previewDisabledReason && <div id="undo-preview-disabled" className="warning-banner" role="note"><strong>{t("undoPreviewUnavailable")}</strong><p>{previewDisabledReason}</p></div>}
      {previewed && <><p>{items.length ? `${items.length} ${t("filesCount")}` : t("undoEmpty")}</p>{items.map((item) => <div className="preview-row" key={`${item.depotPath}-${item.action}`}><span>{item.action}</span><span>{item.depotPath}</span><span>{item.localPath || ""}</span></div>)}</>}
    </div>
    <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button><span className="disabled-control-tooltip" title={previewDisabledReason}><button data-agent-id="undo-preview" className="secondary-button" type="button" onClick={() => void loadPreview()} disabled={busy || previewUnavailable} aria-describedby={previewDisabledReason ? "undo-preview-disabled" : undefined}>{busy && !previewed ? t("loadingHistory") : t("previewUndo")}</button></span><button data-agent-id="undo-apply" className="danger-button" type="button" onClick={() => void applyUndo()} disabled={applyDisabled}>{t("applyUndo")}</button></div>
  </Modal>;
}
