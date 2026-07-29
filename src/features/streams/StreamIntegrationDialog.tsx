import { useEffect, useMemo, useState } from "react";
import { cancelOperation, createChange, listPendingChanges, normalizeAppError, previewStreamIntegration, startStreamIntegration } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, CapabilitySnapshot, ConnectionInput, OperationEvent, PendingChange, StreamIntegrationInput, StreamIntegrationPreview, StreamSummary } from "../../shared/models";
import { isOperationTerminal, startObservedOperation } from "../../shared/operations";
import { CompactEmpty, Modal } from "../../shared/View";
import { streamIntegrationCandidates } from "./streams";

interface Props {
  connection: ConnectionInput;
  streams: StreamSummary[];
  currentStream: string;
  capabilities?: CapabilitySnapshot;
  initialSource?: string;
  onClose: () => void;
  onResolve: (change: string, paths: string[]) => void;
  onReview: (change: string, openSubmit: boolean) => void;
}

export function StreamIntegrationDialog({ connection, streams, currentStream, capabilities, initialSource, onClose, onResolve, onReview }: Props) {
  const { t } = useLocale();
  const candidates = useMemo(() => streamIntegrationCandidates(streams, currentStream).filter((candidate) => capabilities?.commands[candidate.direction === "mergeDown" ? "integrate" : "copy"]?.state !== "unsupported"), [streams, currentStream, capabilities]);
  const preferred = candidates.findIndex((candidate) => candidate.sourceStream === initialSource);
  const [candidateIndex, setCandidateIndex] = useState(Math.max(0, preferred));
  const [changes, setChanges] = useState<PendingChange[]>([]);
  const [targetChange, setTargetChange] = useState("default");
  const [newDescription, setNewDescription] = useState("");
  const [preview, setPreview] = useState<StreamIntegrationPreview>();
  const [operation, setOperation] = useState<OperationEvent>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const candidate = candidates[candidateIndex];
  const operationActive = operation ? !isOperationTerminal(operation.kind) : false;
  const succeededPaths = operation?.itemResults?.filter((item) => item.status === "succeeded" && item.path).map((item) => item.path!) || [];

  useEffect(() => {
    let active = true;
    void listPendingChanges(connection)
      .then((items) => { if (active) setChanges(items); })
      .catch((reason) => { if (active) setError(normalizeAppError(reason)); });
    return () => { active = false; };
  }, [connection.port, connection.user, connection.client]);

  useEffect(() => {
    setPreview(undefined);
    setOperation(undefined);
  }, [candidateIndex, targetChange]);

  function request(): StreamIntegrationInput | undefined {
    return candidate ? {
      connection,
      direction: candidate.direction,
      sourceStream: candidate.sourceStream,
      targetStream: candidate.targetStream,
      targetChange,
    } : undefined;
  }

  async function runPreview() {
    const input = request();
    if (!input) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await previewStreamIntegration(input));
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addChange() {
    if (!newDescription.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const id = await createChange(connection, newDescription);
      setChanges(await listPendingChanges(connection));
      setTargetChange(id);
      setNewDescription("");
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const input = request();
    if (!input || !preview) return;
    setBusy(true);
    setError(undefined);
    try {
      await startObservedOperation("integrate", () => startStreamIntegration(input, preview.identity), setOperation);
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={t("streamIntegrationTitle")} busy={busy || operationActive} wide onClose={onClose}>
    <div className="dialog-body stream-integration-dialog">
      <p>{t("streamIntegrationBody")}</p>
      {error && <div className="error-banner" role="alert"><strong>{error.message}</strong>{error.hints.map((hint) => <span key={hint}>{hint}</span>)}</div>}
      {candidates.length === 0 ? <CompactEmpty text={t("streamIntegrationNoCandidates")} /> : <>
        <label className="form-field"><span>{t("streamIntegrationRoute")}</span><select value={candidateIndex} disabled={busy || operationActive} onChange={(event) => setCandidateIndex(Number(event.target.value))}>
          {candidates.map((item, index) => <option value={index} key={`${item.direction}-${item.sourceStream}`}>{t(item.direction === "mergeDown" ? "streamMergeDown" : "streamCopyUp")}: {item.sourceStream} → {item.targetStream}</option>)}
        </select></label>
        <dl className="dialog-facts"><dt>{t("streamSource")}</dt><dd>{candidate?.sourceStream}</dd><dt>{t("streamTarget")}</dt><dd>{candidate?.targetStream}</dd><dt>{t("workspace")}</dt><dd>{connection.client}</dd></dl>
        <label className="form-field"><span>{t("targetChangelist")}</span><select value={targetChange} disabled={busy || operationActive} onChange={(event) => setTargetChange(event.target.value)}><option value="default">{t("defaultChangelist")}</option>{changes.map((change) => <option value={change.id} key={change.id}>CL {change.id} · {change.description.split("\n")[0]}</option>)}</select></label>
        <div className="inline-form"><input value={newDescription} disabled={busy || operationActive} placeholder={t("streamIntegrationNewChangePlaceholder")} onChange={(event) => setNewDescription(event.target.value)} /><button type="button" disabled={busy || operationActive || !newDescription.trim()} onClick={() => void addChange()}>{t("createChangelist")}</button></div>
      </>}
      {preview && <section className="integration-preview" aria-label={t("streamIntegrationPreview")}>
        <div className="column-heading"><strong>{t("streamIntegrationPreview")}</strong><span>{preview.items.length}</span></div>
        <dl className="dialog-facts"><dt>{t("revisionScope")}</dt><dd>{preview.revisionScope}</dd><dt>{t("targetChangelist")}</dt><dd>{preview.targetChange}</dd></dl>
        {(preview.partial || preview.truncated || preview.warnings.length > 0) && <div className="notice-banner" role="status">{preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
        {preview.items.length === 0 ? <CompactEmpty text={t("streamIntegrationEmpty")} /> : <div className="file-selection-summary">{preview.items.slice(0, 200).map((item) => <span key={`${item.targetPath}-${item.action}`}><strong>{item.action}</strong> {item.sourcePath} → {item.targetPath}{item.sourceStartRevision || item.sourceEndRevision ? ` (${item.sourceStartRevision || "?"}..${item.sourceEndRevision || "?"})` : ""}</span>)}</div>}
      </section>}
      {operation && <div className={`notice-banner${operation.kind === "failed" || operation.kind === "unknown" || operation.kind === "partial" ? " warning" : ""}`} role="status"><strong>{t(`operationStatus.${operation.kind}`)}</strong><span>{operation.message}</span><span>{operation.processed} / {operation.totalFiles ?? preview?.items.length ?? 0}</span></div>}
    </div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" disabled={busy || operationActive} onClick={onClose}>{t("close")}</button>
      {!operationActive && succeededPaths.length > 0 && <><button type="button" onClick={() => onResolve(targetChange, succeededPaths)}>{t("streamIntegrationResolve")}</button><button type="button" onClick={() => onReview(targetChange, false)}>{t("streamIntegrationReview")}</button><button className="primary-button" type="button" onClick={() => onReview(targetChange, true)}>{t("streamIntegrationSubmit")}</button></>}
      {operationActive && <button className="danger-button" type="button" onClick={() => void cancelOperation(operation!.operationId)}>{t("cancelOperation")}</button>}
      {!operation && !preview && <button className="primary-button" type="button" disabled={busy || !candidate} onClick={() => void runPreview()}>{t("preview")}</button>}
      {!operation && preview && <><button type="button" disabled={busy} onClick={() => void runPreview()}>{t("refreshPreview")}</button><button className="primary-button" type="button" disabled={busy || preview.partial || preview.truncated || preview.items.length === 0} onClick={() => void apply()}>{t("streamIntegrationApply")}</button></>}
    </div>
  </Modal>;
}
