import { useState } from "react";
import { revealPath } from "./api";
import { useLocale } from "./i18n";

export function PathActions({ depotPath, localPath }: { depotPath: string; localPath?: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy(path: string) {
    setError("");
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setError(t("copyPathFailed"));
    }
  }

  async function reveal() {
    if (!localPath) return;
    setError("");
    try { await revealPath(localPath); }
    catch { setError(t("revealPathFailed")); }
  }

  return <div className="path-actions"><button type="button" className="secondary-button" onClick={() => void copy(depotPath)}>{copied ? t("pathCopied") : t("copyDepotPath")}</button>{localPath && <><button type="button" className="secondary-button" onClick={() => void copy(localPath)}>{t("copyLocalPath")}</button><button type="button" className="secondary-button" onClick={() => void reveal()}>{t("revealInExplorer")}</button></>}{error && <small role="alert">{error}</small>}</div>;
}
