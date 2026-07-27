import { useEffect, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { clearCliLog, listCliLog } from "./api";
import { useLocale } from "./i18n";
import type { CliLogEntry } from "./models";

export function CliLogCenter({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { language, t } = useLocale();
  const [entries, setEntries] = useState<CliLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listCliLog()
        .then((next) => { if (active) setEntries(next); })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const hasErrors = entries.some((entry) => entry.level === "error");

  async function clear() {
    await clearCliLog();
    setEntries([]);
  }

  function toggle() {
    setOpen((current) => {
      onOpenChange?.(!current);
      return !current;
    });
  }

  return <div className={`cli-log-center${open ? " open" : ""}`}>
    {open && <section className="cli-log-panel" aria-label={t("cliLogTitle")}>
      <header><div><strong>{t("cliLogTitle")}</strong><span>{entries.length} {t("cliLogEvents")}</span></div><button type="button" onClick={() => void clear()} disabled={entries.length === 0}>{t("clearLog")}</button></header>
      <div className="cli-log-list">
        {entries.length === 0 ? <p>{t("cliLogEmpty")}</p> : [...entries].reverse().map((entry) => <article className={entry.level} key={entry.id}>
          <span className="cli-log-level" aria-hidden="true">{entry.level === "error" ? <CircleAlert className="ui-icon" /> : <TriangleAlert className="ui-icon" />}</span>
          <div><strong>{entry.message}</strong><time>{new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(entry.timestampMs)}</time>{entry.details && <pre>{entry.details}</pre>}</div>
        </article>)}
      </div>
    </section>}
    <button className={`cli-log-toggle${hasErrors ? " error" : entries.length > 0 ? " warning" : ""}`} type="button" onClick={toggle} aria-label={t("openCliLog")} aria-expanded={open}>
      {hasErrors ? <CircleAlert className="ui-icon" aria-hidden="true" /> : <TriangleAlert className="ui-icon" aria-hidden="true" />}{entries.length > 0 && <small>{entries.length}</small>}
    </button>
  </div>;
}
