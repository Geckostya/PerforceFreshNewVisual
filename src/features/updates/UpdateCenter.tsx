import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import { cancelUpdate, checkForUpdate, installUpdate, normalizeAppError, takeUpdateDiagnostic } from "../../shared/api";
import { useLocale } from "../../shared/i18n";
import type { AppError, UpdateCheckResult, UpdateDownloadProgress } from "../../shared/models";
import { ErrorBanner, Modal } from "../../shared/View";
import { formatDownloadSize, updateErrorTranslationKey, updateProgressRatio } from "./updates";

type UpdatePhase = "idle" | "checking" | "current" | "available" | "downloading" | "cancelling" | "error";

interface UpdateContextValue {
  phase: UpdatePhase;
  openDetails: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);
const releasesUrl = "https://github.com/Geckostya/PerforceFreshNewVisual/releases/latest";

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [result, setResult] = useState<UpdateCheckResult>();
  const [error, setError] = useState<AppError>();
  const [recoveryNotice, setRecoveryNotice] = useState<AppError>();
  const [progress, setProgress] = useState<UpdateDownloadProgress>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [cancelledNotice, setCancelledNotice] = useState(false);

  const runCheck = useCallback(async (showDialog: boolean) => {
    if (showDialog) setDialogOpen(true);
    setPhase("checking");
    setError(undefined);
    setCancelledNotice(false);
    setProgress(undefined);
    try {
      const next = await checkForUpdate();
      setResult(next);
      setPhase(next.status);
      if (next.status === "available") setNoticeDismissed(false);
    } catch (reason) {
      setError(normalizeAppError(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(false), 0);
    void takeUpdateDiagnostic().then((message) => {
      if (!message) return;
      setRecoveryNotice({ kind: "partial_result", message, hints: [], diagnostics: message });
      setDialogOpen(true);
    }).catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<UpdateDownloadProgress>("p4fnv://update-download-progress", (event) => {
      if (active) setProgress(event.payload);
    }).then((dispose) => { if (active) unlisten = dispose; else dispose(); });
    return () => { active = false; unlisten?.(); };
  }, []);

  async function applyUpdate() {
    if (!result || result.status !== "available") return;
    setDialogOpen(true);
    setPhase("downloading");
    setError(undefined);
    setCancelledNotice(false);
    setProgress(undefined);
    try {
      await installUpdate(result.release.version);
    } catch (reason) {
      const next = normalizeAppError(reason);
      if (next.kind === "cancelled") {
        setCancelledNotice(true);
        setError(undefined);
        setPhase("available");
      } else {
        setError(next);
        setPhase("error");
      }
    }
  }

  async function requestCancel() {
    setPhase("cancelling");
    try {
      await cancelUpdate();
    } catch (reason) {
      setError(normalizeAppError(reason));
      setPhase("error");
    }
  }

  const value = useMemo<UpdateContextValue>(() => ({
    phase,
    openDetails: () => void runCheck(true),
  }), [phase, runCheck]);
  const ratio = updateProgressRatio(progress);
  const busy = phase === "checking" || phase === "downloading" || phase === "cancelling";
  const available = result?.status === "available";

  return <UpdateContext.Provider value={value}>
    {children}
    {available && !noticeDismissed && phase === "available" && <aside data-agent-id="update-notice" className="update-notice" aria-label={t("updateAvailable")}>
      <Download className="ui-icon" aria-hidden="true" />
      <div><strong>{t("updateAvailable")}</strong><span>{t("updateVersion")} {result.release.version}</span></div>
      <button className="primary-button" type="button" onClick={() => void applyUpdate()}>{t("updateNow")}</button>
      <button className="secondary-button" type="button" onClick={() => setNoticeDismissed(true)}>{t("later")}</button>
      <button className="icon-button" type="button" aria-label={t("close")} onClick={() => setNoticeDismissed(true)}><X className="ui-icon" aria-hidden="true" /></button>
    </aside>}
    {dialogOpen && <Modal title={t("applicationUpdates")} busy={busy} onClose={() => setDialogOpen(false)}>
      <div className="update-dialog" data-agent-id="update-dialog">
        {phase === "checking" && <div className="update-state" role="status"><LoaderCircle className="ui-icon icon-spin" aria-hidden="true" /><span>{t("checkingForUpdates")}</span></div>}
        {phase === "current" && result && <div className="update-state" role="status"><strong>{t("upToDate")}</strong><span>{t("currentVersion")} {result.currentVersion}</span></div>}
        {available && (phase === "available" || phase === "error") && <>
          <div className="update-version"><span>{t("currentVersion")} {result.currentVersion}</span><strong>{t("updateVersion")} {result.release.version}</strong></div>
          {result.release.notes && <div className="update-notes"><strong>{t("releaseNotes")}</strong><p>{result.release.notes}</p></div>}
        </>}
        {(phase === "downloading" || phase === "cancelling") && <div className="update-download" role="status">
          <strong>{phase === "cancelling" ? t("cancellingUpdate") : t("downloadingUpdate")}</strong>
          <div className={`update-progress${ratio === undefined ? " indeterminate" : ""}`} role="progressbar" aria-label={t("downloadingUpdate")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === undefined ? undefined : Math.round(ratio * 100)}><span style={ratio === undefined ? undefined : { width: `${ratio * 100}%` }} /></div>
          {progress && <span>{formatDownloadSize(progress.downloadedBytes)}{progress.totalBytes ? ` / ${formatDownloadSize(progress.totalBytes)}` : ""}</span>}
          <small>{t("appWillRestart")}</small>
        </div>}
        {recoveryNotice && <ErrorBanner error={{ ...recoveryNotice, message: t("updateRecoveryNotice"), hints: [] }} />}
        {cancelledNotice && <div className="update-state" role="status"><span>{t("updateCancelled")}</span></div>}
        {error && <ErrorBanner error={{ ...error, message: t(updateErrorTranslationKey(error.kind)), hints: [] }} />}
        <div className="dialog-actions">
          {phase === "available" && <button className="primary-button" data-agent-id="install-update" type="button" onClick={() => void applyUpdate()}>{t("updateNow")}</button>}
          {phase === "downloading" && <button className="secondary-button" type="button" onClick={() => void requestCancel()}>{t("cancel")}</button>}
          {(phase === "current" || phase === "error" || phase === "available") && <button className="secondary-button" type="button" onClick={() => void runCheck(false)}><RefreshCw className="ui-icon" aria-hidden="true" />{t("checkAgain")}</button>}
          {phase === "error" && <button className="secondary-button" type="button" onClick={() => void openUrl(releasesUrl)}>{t("downloadManually")}</button>}
          {!busy && <button className="secondary-button" type="button" onClick={() => setDialogOpen(false)}>{phase === "available" ? t("later") : t("close")}</button>}
        </div>
      </div>
    </Modal>}
  </UpdateContext.Provider>;
}

export function useUpdates(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useUpdates must be used inside UpdateProvider");
  return value;
}
