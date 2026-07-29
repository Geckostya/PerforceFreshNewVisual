import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../shared/i18n";
import { filterPaletteCommands, type PaletteCommandId } from "./commands";

type View = "changes" | "workspace" | "streams" | "history" | "depot" | "jobs" | "labels" | "shelves";

export function CommandPalette({ onNavigate, onFocusGoTo }: { onNavigate: (view: View) => void; onFocusGoTo: () => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const commands = useMemo(() => [
    { id: "workspace" as const, searchText: `${t("workspaceFiles")} workspace` },
    { id: "changes" as const, searchText: `${t("myChanges")} changes` },
    { id: "streams" as const, searchText: `${t("streamsTitle")} streams` },
    { id: "history" as const, searchText: `${t("submittedHistory")} submitted history` },
    { id: "depot" as const, searchText: `${t("depotBrowser")} depot` },
    { id: "jobs" as const, searchText: `${t("jobsTitle")} jobs` },
    { id: "labels" as const, searchText: `${t("labelsTitle")} labels` },
    { id: "shelves" as const, searchText: `${t("shelvesTitle")} shelves` },
    { id: "goTo" as const, searchText: `${t("globalGoTo")} go to` },
  ], [t]);
  const filtered = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        const target = event.target as HTMLElement | null;
        const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
        if (!editing || open) {
          event.preventDefault();
          setOpen((value) => !value);
        }
        return;
      }
      if (!open) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(filtered.length - 1, 0))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
      if (event.key === "Enter" && filtered[active]) { event.preventDefault(); execute(filtered[active].id); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [active, filtered, open]);

  useEffect(() => { setActive(0); }, [query]);

  function execute(id: PaletteCommandId) {
    setOpen(false);
    setQuery("");
    if (id === "goTo") onFocusGoTo();
    else onNavigate(id);
  }

  function label(id: PaletteCommandId) {
    const keys = { workspace: "filesTitle", changes: "myChanges", streams: "streamsTitle", history: "submittedHistory", depot: "depotBrowser", jobs: "jobsTitle", labels: "labelsTitle", shelves: "shelvesTitle", goTo: "globalGoTo" } as const;
    return t(keys[id]);
  }

  if (!open) return null;
  return <div className="command-palette-layer" role="presentation" onMouseDown={() => setOpen(false)}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" onMouseDown={(event) => event.stopPropagation()}>
      <h2 id="command-palette-title">{t("commandPalette")}</h2>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("commandPalettePlaceholder")} aria-label={t("commandPalette")} />
      <div className="command-palette-list" role="listbox">
        {filtered.length === 0 ? <p className="empty-copy">{t("commandPaletteEmpty")}</p> : filtered.map((command, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? "active" : ""} key={command.id} onMouseEnter={() => setActive(index)} onClick={() => execute(command.id)}>{label(command.id)}<small>{command.id === "goTo" ? "Ctrl/Cmd+L" : ""}</small></button>)}
      </div>
    </section>
  </div>;
}
