import { useMemo, useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { createStream, inspectWorkspace, normalizeAppError, previewCreateStream, streamViewPathsFromLocalDirectories } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, ConnectionInput, CreateStreamInput, CreateStreamPreview, CreateStreamType, StreamPathKind, StreamPathRuleInput, StreamSummary } from "../../shared/models";
import { ErrorBanner, Modal } from "../../shared/View";
import { childStreamPath, isValidStreamName, mergeSelectedStreamViewPaths } from "./streams";

const streamTypes: CreateStreamType[] = ["development", "release", "virtual", "task"];
const pathKinds: StreamPathKind[] = ["share", "isolate", "import", "exclude"];

export function CreateStreamDialog({ connection, streams, initialParent, onClose, onCreated }: {
  connection: ConnectionInput;
  streams: StreamSummary[];
  initialParent: string;
  onClose: () => void;
  onCreated: (stream: StreamSummary) => Promise<void>;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [parent, setParent] = useState(initialParent);
  const [streamType, setStreamType] = useState<CreateStreamType>("development");
  const [description, setDescription] = useState("");
  const [paths, setPaths] = useState<StreamPathRuleInput[]>([{ kind: "share", viewPath: "..." }]);
  const [preview, setPreview] = useState<CreateStreamPreview>();
  const [busy, setBusy] = useState(false);
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const targetPath = useMemo(() => childStreamPath(parent, name), [name, parent]);
  const nameValid = isValidStreamName(name);
  const pathsValid = paths.length > 0 && paths.every((rule) => rule.viewPath.trim() && (rule.kind !== "import" || rule.depotPath?.trim().startsWith("//")));
  const dialogBusy = busy || folderPickerBusy;

  function input(): CreateStreamInput {
    return { connection, name: name.trim(), parent, streamType, description, paths };
  }

  function updatePath(index: number, patch: Partial<StreamPathRuleInput>) {
    setPaths((current) => current.map((rule, ruleIndex) => ruleIndex === index
      ? { ...rule, ...patch, depotPath: patch.kind && patch.kind !== "import" ? undefined : patch.depotPath ?? rule.depotPath }
      : rule));
    setPreview(undefined);
  }

  async function advance() {
    setError(undefined);
    if (step === 1) {
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      setPreview(await previewCreateStream(input()));
      setStep(3);
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(undefined);
    try {
      await onCreated(await createStream(input()));
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolders() {
    setError(undefined);
    setFolderPickerBusy(true);
    try {
      const workspace = await inspectWorkspace(connection);
      const selected = await open({
        directory: true,
        multiple: true,
        defaultPath: workspace.root,
        title: t("createStreamFolderDialogTitle"),
      });
      if (!selected) return;
      const directories = Array.isArray(selected) ? selected : [selected];
      const selectedPaths = await streamViewPathsFromLocalDirectories(connection, directories);
      setPaths((current) => mergeSelectedStreamViewPaths(current, selectedPaths));
      setPreview(undefined);
    } catch (reason) {
      setError(normalizeAppError(reason));
    } finally {
      setFolderPickerBusy(false);
    }
  }

  return <Modal wide title={t("createStreamTitle")} busy={dialogBusy} onClose={onClose}>
    <div className="create-stream-stepper" aria-label={t("createStreamProgress")}>
      {[1, 2, 3].map((item) => <div key={item} className={item === step ? "active" : item < step ? "complete" : ""} aria-current={item === step ? "step" : undefined}><span>{item}</span><strong>{t(item === 1 ? "createStreamStepBasics" : item === 2 ? "createStreamStepPaths" : "createStreamStepReview")}</strong></div>)}
    </div>
    <div className="dialog-body create-stream-body">
      {error && <ErrorBanner error={error} />}
      {step === 1 && <>
        <p>{t("createStreamBasicsBody")}</p>
        <div className="field-row">
          <label className="field"><span className="field-label">{t("createStreamName")}</span><input data-agent-id="create-stream-name" autoFocus value={name} onChange={(event) => { setName(event.currentTarget.value); setPreview(undefined); }} aria-invalid={name.length > 0 && !nameValid} placeholder="feature-login" />{name.length > 0 && !nameValid ? <small className="field-error">{t("createStreamNameError")}</small> : <small className="field-hint">{t("createStreamNameHint")}</small>}</label>
          <label className="field"><span className="field-label">{t("createStreamParent")}</span><select data-agent-id="create-stream-parent" value={parent} onChange={(event) => { setParent(event.currentTarget.value); setPreview(undefined); }}>{streams.map((stream) => <option key={stream.path} value={stream.path}>{stream.path}</option>)}</select><small className="field-hint">{t("createStreamParentHint")}</small></label>
        </div>
        <div className="create-stream-target"><span>{t("createStreamResultPath")}</span><strong>{targetPath || "—"}</strong></div>
        <fieldset className="strategy-fieldset create-stream-types"><legend>{t("createStreamType")}</legend>{streamTypes.map((type) => <label className="check-field" key={type}><input type="radio" name="create-stream-type" checked={streamType === type} onChange={() => { setStreamType(type); setPreview(undefined); }} /><span><strong>{t(`createStreamType_${type}`)}</strong><small>{t(`createStreamType_${type}Body`)}</small></span></label>)}</fieldset>
      </>}
      {step === 2 && <>
        <p>{t("createStreamPathsBody")}</p>
        <label className="field"><span className="field-label">{t("createStreamDescription")}</span><textarea data-agent-id="create-stream-description" value={description} maxLength={10000} onChange={(event) => { setDescription(event.currentTarget.value); setPreview(undefined); }} placeholder={t("createStreamDescriptionPlaceholder")} /></label>
        <div className="create-stream-paths-heading"><div><strong>{t("createStreamPaths")}</strong><small>{t("createStreamFolderHint")}</small></div><div className="create-stream-path-actions"><button data-agent-id="create-stream-choose-folders" className="secondary-button" type="button" onClick={() => void chooseFolders()} disabled={dialogBusy || paths.length >= 100}><FolderOpen className="ui-icon" aria-hidden="true" />{folderPickerBusy ? t("createStreamChoosingFolders") : t("createStreamChooseFolders")}</button><button className="secondary-button" type="button" onClick={() => setPaths((current) => [...current, { kind: "share", viewPath: "..." }])} disabled={dialogBusy || paths.length >= 100}><Plus className="ui-icon" aria-hidden="true" />{t("createStreamAddPath")}</button></div></div>
        <div className="create-stream-path-list">{paths.map((rule, index) => <div className="create-stream-path-row" key={index}>
          <label className="field"><span className="field-label">{t("createStreamPathKind")}</span><select value={rule.kind} onChange={(event) => updatePath(index, { kind: event.currentTarget.value as StreamPathKind })}>{pathKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label className="field"><span className="field-label">{t("createStreamViewPath")}</span><input data-agent-id={`create-stream-view-path-${index}`} value={rule.viewPath} onChange={(event) => updatePath(index, { viewPath: event.currentTarget.value })} placeholder="..." /></label>
          {rule.kind === "import" && <label className="field"><span className="field-label">{t("createStreamDepotPath")}</span><input value={rule.depotPath || ""} onChange={(event) => updatePath(index, { depotPath: event.currentTarget.value })} placeholder="//shared/tools/..." /></label>}
          <button className="icon-button create-stream-remove-path" type="button" aria-label={t("createStreamRemovePath")} onClick={() => setPaths((current) => current.filter((_, ruleIndex) => ruleIndex !== index))} disabled={paths.length === 1}><Trash2 className="ui-icon" aria-hidden="true" /></button>
        </div>)}</div>
      </>}
      {step === 3 && preview && <>
        <p>{t("createStreamReviewBody")}</p>
        <dl className="dialog-facts"><dt>{t("createStreamResultPath")}</dt><dd>{preview.path}</dd><dt>{t("createStreamParent")}</dt><dd>{preview.parent}</dd><dt>{t("createStreamType")}</dt><dd>{preview.streamType}</dd><dt>ParentView</dt><dd>{preview.parentView}</dd><dt>Options</dt><dd>{preview.options || "—"}</dd><dt>{t("createStreamPaths")}</dt><dd>{preview.paths.join(" · ")}</dd></dl>
        <div className="dialog-description"><strong>{t("createStreamNoWorkspaceChange")}</strong><p>{t("createStreamNoWorkspaceChangeBody")}</p></div>
        <details className="create-stream-spec"><summary>{t("createStreamRawSpec")}</summary><pre>{preview.spec}</pre></details>
      </>}
    </div>
    <div className="dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose} disabled={dialogBusy}>{t("cancel")}</button>
      <span className="dialog-actions-spacer" />
      {step > 1 && <button className="secondary-button" type="button" onClick={() => { setStep(step === 3 ? 2 : 1); setError(undefined); }} disabled={dialogBusy}>{t("back")}</button>}
      {step < 3 ? <button data-agent-id="create-stream-next" className="primary-button" type="button" onClick={() => void advance()} disabled={dialogBusy || (step === 1 ? !nameValid || !parent : !pathsValid)}>{busy ? t("createStreamPreviewing") : step === 2 ? t("createStreamPreview") : t("next")}</button> : <button data-agent-id="create-stream-confirm" className="primary-button" type="button" onClick={() => void apply()} disabled={dialogBusy || !preview}>{busy ? t("createStreamCreating") : t("createStreamConfirm")}</button>}
    </div>
  </Modal>;
}
