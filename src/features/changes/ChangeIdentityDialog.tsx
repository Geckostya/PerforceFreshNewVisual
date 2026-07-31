import { useEffect, useMemo, useState } from "react";
import { normalizeAppError, previewChangeIdentity, updateChangeIdentity } from "../../shared/api";
import { useLocale, type TranslationKey } from "../../shared/i18n";
import type {
  AppError,
  ChangeIdentityBlocker,
  ChangeIdentityPreflight,
  ChangeVisibility,
  ConnectionInput,
} from "../../shared/models";
import { Modal } from "../../shared/View";

interface Props {
  connection: ConnectionInput;
  change: string;
  initialOwner: string;
  initialClient: string;
  onClose: () => void;
  onApplied: () => void;
  setError: (error?: AppError) => void;
}

const blockerKeys: Record<ChangeIdentityBlocker, TranslationKey> = {
  capability_unknown: "changeIdentityCapabilityUnknown",
  unsupported: "changeIdentityUnsupported",
  permission_unknown: "changeIdentityPermissionUnknown",
  permission_denied: "changeIdentityPermissionDenied",
  topology_unknown: "changeIdentityTopologyUnknown",
  topology_mismatch: "changeIdentityTopologyMismatch",
  target_client_owner_mismatch: "changeIdentityClientOwnerMismatch",
  not_pending: "changeIdentityNotPending",
};

function draftKey(owner: string, client: string, visibility: ChangeVisibility) {
  return `${owner}\0${client}\0${visibility}`;
}

export function ChangeIdentityDialog({
  connection,
  change,
  initialOwner,
  initialClient,
  onClose,
  onApplied,
  setError,
}: Props) {
  const { t } = useLocale();
  const [owner, setOwner] = useState(initialOwner);
  const [client, setClient] = useState(initialClient);
  const [visibility, setVisibility] = useState<ChangeVisibility>("public");
  const [preflight, setPreflight] = useState<ChangeIdentityPreflight>();
  const [preparedKey, setPreparedKey] = useState("");
  const [busy, setBusy] = useState(true);
  const currentKey = useMemo(() => draftKey(owner.trim(), client.trim(), visibility), [client, owner, visibility]);
  const ready = preflight && preparedKey === currentKey && preflight.blockers.length === 0;

  useEffect(() => {
    let active = true;
    void previewChangeIdentity(connection, change, initialOwner, initialClient, "public")
      .then((result) => {
        if (!active) return;
        setPreflight(result);
        setOwner(result.current.owner);
        setClient(result.current.client);
        setVisibility(result.current.visibility);
        if (result.current.visibility === "public") {
          setPreparedKey(draftKey(result.current.owner, result.current.client, result.current.visibility));
        }
      })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [change, connection, initialClient, initialOwner, setError]);

  async function runPreflight() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await previewChangeIdentity(connection, change, owner.trim(), client.trim(), visibility);
      setPreflight(result);
      setPreparedKey(draftKey(result.target.owner, result.target.client, result.target.visibility));
    } catch (reason) {
      setPreparedKey("");
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!ready || !preflight) return;
    setBusy(true);
    setError(undefined);
    try {
      await updateChangeIdentity(
        connection,
        change,
        owner.trim(),
        client.trim(),
        visibility,
        preflight.previewToken,
      );
      onApplied();
    } catch (reason) {
      setPreparedKey("");
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={t("changeIdentityTitle")} busy={busy} onClose={onClose}>
    <div className="dialog-body">
      <p>{t("changeIdentityBody")}</p>
      <label className="field"><span className="field-label">{t("changeOwner")}</span><input data-agent-id="change-identity-owner" value={owner} disabled={busy} onChange={(event) => setOwner(event.target.value)} /></label>
      <label className="field"><span className="field-label">{t("changeWorkspace")}</span><input data-agent-id="change-identity-client" value={client} disabled={busy} onChange={(event) => setClient(event.target.value)} /></label>
      <label className="field"><span className="field-label">{t("changeVisibility")}</span><select data-agent-id="change-identity-visibility" value={visibility} disabled={busy} onChange={(event) => setVisibility(event.target.value as ChangeVisibility)}><option value="public">{t("changePublic")}</option><option value="restricted">{t("changeRestricted")}</option></select></label>
      {preflight && <>
        <dl className="dialog-facts">
          <dt>{t("permissionLabel")}</dt><dd>{preflight.permissionLevel}</dd>
          <dt>{t("topologyLabel")}</dt><dd>{preflight.topology}</dd>
          <dt>{t("openedFilesLabel")}</dt><dd>{preflight.hasOpenedFiles ? t("yes") : t("no")}</dd>
          <dt>{t("shelvedFilesLabel")}</dt><dd>{preflight.hasShelvedFiles ? t("yes") : t("no")}</dd>
          <dt>{t("jobsLabel")}</dt><dd>{preflight.hasJobs ? t("yes") : t("no")}</dd>
        </dl>
        {preflight.requiresAdmin && <p className="notice-banner" role="status">{t("changeIdentityAdminRequired")}</p>}
        {preflight.blockers.length > 0 && <div className="notice-banner" role="alert">{preflight.blockers.map((blocker) => <p key={blocker}>{t(blockerKeys[blocker])}</p>)}</div>}
      </>}
      {preparedKey !== currentKey && <p className="dialog-description">{t("changeIdentityPreflightRequired")}</p>}
    </div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{t("cancel")}</button>
      <button data-agent-id="change-identity-preflight" className="secondary-button" type="button" onClick={() => void runPreflight()} disabled={busy || !owner.trim() || !client.trim()}>{t("runPreflight")}</button>
      <button data-agent-id="change-identity-apply" className="primary-button" type="button" onClick={() => void apply()} disabled={busy || !ready}>{t("applyChangeIdentity")}</button>
    </div>
  </Modal>;
}
