import { RefreshCw } from "lucide-react";
import { useLocale } from "./i18n";

export function RefreshButton({ busy, onClick, agentId }: {
  busy: boolean;
  onClick: () => void;
  agentId?: string;
}) {
  const { t } = useLocale();
  return <button
    className="refresh-button"
    data-agent-id={agentId}
    type="button"
    title={t("refresh")}
    aria-label={t("refresh")}
    aria-busy={busy}
    onClick={onClick}
    disabled={busy}
  >
    <RefreshCw className={`ui-icon${busy ? " icon-spin" : ""}`} aria-hidden="true" />
  </button>;
}
