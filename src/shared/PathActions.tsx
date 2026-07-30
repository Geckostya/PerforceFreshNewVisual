import { useEffect, useState } from "react";
import { mapWorkspacePaths, revealPath } from "./api";
import { useLocale } from "./i18n";
import type { ConnectionInput, WorkspaceMapping, WorkspaceMappingBatch } from "./models";

export function authoritativeWorkspaceMapping(batch: WorkspaceMappingBatch): WorkspaceMapping | undefined {
  return batch.partial ? undefined : batch.mappings[0];
}

export function confirmedMappingLocalPath(
  connection: ConnectionInput | undefined,
  mapping: WorkspaceMapping | undefined,
  callerLocalPath: string | undefined,
): string | undefined {
  if (!connection) return callerLocalPath;
  return mapping?.state === "mapped" ? mapping.localPath : undefined;
}

export function PathActions({ depotPath, localPath, connection, onNavigateLocal }: { depotPath: string; localPath?: string; connection?: ConnectionInput; onNavigateLocal?: (mapping: WorkspaceMapping) => void }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [mapping, setMapping] = useState<WorkspaceMapping>();

  useEffect(() => {
    let active = true;
    setMapping(undefined);
    setError("");
    if (!connection) return () => { active = false; };
    void mapWorkspacePaths(connection, [depotPath])
      .then((batch) => {
        if (!active) return;
        const resolved = authoritativeWorkspaceMapping(batch);
        if (resolved) setMapping(resolved);
        else setError(t("mappingLookupFailed"));
      })
      .catch(() => { if (active) setError(t("mappingLookupFailed")); });
    return () => { active = false; };
  }, [connection?.p4Path, connection?.port, connection?.user, connection?.client, connection?.charset, connection?.p4Config, connection?.p4Enviro, depotPath, t]);

  const confirmedLocalPath = confirmedMappingLocalPath(connection, mapping, localPath);

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
    if (!confirmedLocalPath) return;
    setError("");
    try { await revealPath(confirmedLocalPath); }
    catch { setError(t("revealPathFailed")); }
  }

  return <div className="path-actions"><button type="button" className="secondary-button" onClick={() => void copy(mapping?.depotPath || depotPath)}>{copied ? t("pathCopied") : t("copyDepotPath")}</button>{mapping?.state === "mapped" && mapping.clientPath && <button type="button" className="secondary-button" onClick={() => void copy(mapping.clientPath!)}>{t("copyClientPath")}</button>}{confirmedLocalPath && <><button type="button" className="secondary-button" onClick={() => void copy(confirmedLocalPath)}>{t("copyLocalPath")}</button><button type="button" className="secondary-button" onClick={() => void reveal()}>{t("revealInExplorer")}</button></>}{mapping?.state === "mapped" && onNavigateLocal && <button data-agent-id="mapping-open-local" type="button" className="secondary-button" onClick={() => onNavigateLocal(mapping)}>{t("showInLocalFiles")}</button>}{mapping && mapping.state !== "mapped" && <small>{t(mapping.state === "excluded" ? "mappingExcluded" : "mappingUnmapped")}</small>}{error && <small role="alert">{error}</small>}</div>;
}
