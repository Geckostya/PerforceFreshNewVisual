import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ClipboardList, EyeOff, FolderTree, GitBranch, History as HistoryIcon, ListChecks, LoaderCircle, Menu, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { ConnectionScreen, type ConnectedSession } from "../features/connection/ConnectionScreen";
import { clearCliLog, listWorkspaces, loadLocales, loadSettings, logout, normalizeAppError, openWorkspace } from "../shared/api";
import { CliLogCenter } from "../shared/CliLogCenter";
import { OperationsCenter } from "../shared/OperationsCenter";
import type { AppError, WorkspaceSummary } from "../shared/models";
import { LocaleProvider, useLocale } from "../shared/i18n";
import { LanguagePicker } from "../shared/LanguagePicker";
import { ThemePicker } from "../shared/ThemePicker";
import { ThemeProvider, useTheme } from "../shared/theme";
import { connectionToAutoOpen } from "./startup";
import "./app.css";
import { classifyGoTo } from "./goTo";
import { CommandPalette } from "./CommandPalette";
import { ActionDialog } from "../shared/View";
import { connectionForServer } from "../shared/connection";

const ChangesView = lazy(() => import("../features/changes/ChangesView").then((module) => ({ default: module.ChangesView })));
const WorkspaceView = lazy(() => import("../features/workspace/WorkspaceView").then((module) => ({ default: module.WorkspaceView })));
const HistoryView = lazy(() => import("../features/history/HistoryView").then((module) => ({ default: module.HistoryView })));
const DepotView = lazy(() => import("../features/depot/DepotView").then((module) => ({ default: module.DepotView })));
const JobsView = lazy(() => import("../features/jobs/JobsView").then((module) => ({ default: module.JobsView })));
const LabelsView = lazy(() => import("../features/labels/LabelsView").then((module) => ({ default: module.LabelsView })));
const ShelvesView = lazy(() => import("../features/shelves/ShelvesView").then((module) => ({ default: module.ShelvesView })));
const StreamsView = lazy(() => import("../features/streams/StreamsView").then((module) => ({ default: module.StreamsView })));

export function App() {
  return <ThemeProvider><LocaleProvider><AppContent /></LocaleProvider></ThemeProvider>;
}

function AppContent() {
  const { setLocales, t } = useLocale();
  const { setTheme } = useTheme();
  const [session, setSession] = useState<ConnectedSession>();
  const [startup, setStartup] = useState<"loading" | "ready">("loading");
  const [autoOpenError, setAutoOpenError] = useState<AppError>();
  const [fileCount, setFileCount] = useState(0);
  const [cliLogOpen, setCliLogOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<AppError>();
  const [view, setView] = useState<"changes" | "workspace" | "streams" | "history" | "jobs" | "labels" | "shelves">("workspace");
  const [filesSource, setFilesSource] = useState<"local" | "depot">("local");
  const [sidebar, setSidebar] = useState<"compact" | "expanded" | "hidden">("compact");
  const [goToQuery, setGoToQuery] = useState("");
  const [goToError, setGoToError] = useState("");
  const [workspaceScope, setWorkspaceScope] = useState<string>();
  const [depotScope, setDepotScope] = useState<string>();
  const [changeTarget, setChangeTarget] = useState<string>();
  const [jobSearch, setJobSearch] = useState<string>();
  const [labelSearch, setLabelSearch] = useState<string>();
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceSummary[]>([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<AppError>();
  const goToInputRef = useRef<HTMLInputElement>(null);
  const handleFileCount = useCallback((count: number) => setFileCount(count), []);

  useEffect(() => {
    let active = true;
    void Promise.all([loadSettings(), loadLocales()])
      .then(async ([settings, catalog]) => {
        if (!active) return;
        setLocales(catalog.locales, settings.language);
        setTheme(settings.theme);
        const connection = connectionToAutoOpen(settings);
        if (!connection) return;
        try {
          const info = await openWorkspace(connection);
          await clearCliLog().catch(() => undefined);
          if (active) setSession({ connection: connectionForServer(connection, info), info });
        } catch (error) {
          if (active) setAutoOpenError(normalizeAppError(error));
        }
      })
      .catch(() => undefined)
      .finally(() => { if (active) setStartup("ready"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void listWorkspaces(session.connection)
      .then((workspaces) => { if (active) setWorkspaceOptions(workspaces); })
      .catch((error) => { if (active) setWorkspaceSwitchError(normalizeAppError(error)); });
    return () => { active = false; };
  }, [session?.connection.port, session?.connection.user, session?.connection.client]);

  useEffect(() => {
    if (!session) return;
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        goToInputRef.current?.focus();
        return;
      }
      if (editing || !(event.ctrlKey || event.metaKey)) return;
      const nextView = ({ "1": "workspace", "2": "changes", "3": "streams", "4": "shelves", "5": "jobs" } as const)[event.key];
      if (nextView) { event.preventDefault(); setView(nextView); }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [session]);

  if (startup === "loading") return <StartupScreen />;
  if (!session) return <ConnectionScreen initialError={autoOpenError} onConnected={(next) => {
    setAutoOpenError(undefined);
    void clearCliLog().catch(() => undefined).finally(() => setSession(next));
  }} />;
  const currentSession = session;

  function exitWorkspace() {
    setSession(undefined);
    setAutoOpenError(undefined);
    setFileCount(0);
    setCliLogOpen(false);
  }

  async function signOut() {
    setLogoutBusy(true);
    setLogoutError(undefined);
    try {
      await logout(currentSession.connection);
      setLogoutConfirmOpen(false);
      exitWorkspace();
    } catch (error) {
      setLogoutError(normalizeAppError(error));
    } finally {
      setLogoutBusy(false);
    }
  }

  async function switchWorkspace(name: string) {
    if (!name || name === currentSession.connection.client) return;
    setWorkspaceBusy(true);
    setWorkspaceSwitchError(undefined);
    try {
      const connection = { ...currentSession.connection, client: name };
      const info = await openWorkspace(connection);
      const selected = workspaceOptions.find((item) => item.name === name);
      setSession({ connection, info: { ...info, clientName: name, clientRoot: selected?.root || info.clientRoot, clientStream: selected?.stream || info.clientStream } });
      setFileCount(0);
      setView("workspace");
      setFilesSource("local");
    } catch (error) {
      setWorkspaceSwitchError(normalizeAppError(error));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function submitGoTo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = classifyGoTo(goToQuery);
    if (target.kind === "unknown") {
      setGoToError(t("goToUnknown"));
      return;
    }
    setGoToError("");
    setGoToQuery("");
    if (target.kind === "depot") { setDepotScope(target.value); setFilesSource("depot"); setView("workspace"); }
    if (target.kind === "workspace") { setWorkspaceScope(target.value); setFilesSource("local"); setView("workspace"); }
    if (target.kind === "change") { setChangeTarget(target.value); setView("changes"); }
    if (target.kind === "job") { setJobSearch(target.value); setView("jobs"); }
    if (target.kind === "label") { setLabelSearch(target.value); setView("labels"); }
  }

  return (
    <div className={`app workspace-app${cliLogOpen ? " cli-log-open" : ""}`} data-agent-screen={view}>
      <header className="app-header">
        <div className="brand-area"><button className="sidebar-header-toggle" type="button" title={t(sidebar === "hidden" ? "showSidebar" : sidebar === "compact" ? "expandSidebar" : "collapseSidebar")} aria-label={t(sidebar === "hidden" ? "showSidebar" : sidebar === "compact" ? "expandSidebar" : "collapseSidebar")} onClick={() => setSidebar((state) => state === "hidden" ? "compact" : state === "compact" ? "expanded" : "compact")}><NavIcon name="menu" /></button><div className="brand" aria-label="P4FNV"><span className="brand-mark" aria-hidden="true">P4</span>P4FNV</div></div>
        <div className="session-context" title={session.info.serverAddress}>
          <span>{session.connection.user}</span><span aria-hidden="true">/</span><label className="session-workspace-picker"><span className="sr-only">{t("switchWorkspace")}</span><select value={session.connection.client} onChange={(event) => void switchWorkspace(event.target.value)} disabled={workspaceBusy}><option value={session.connection.client}>{session.connection.client}</option>{workspaceOptions.filter((item) => item.name !== session.connection.client).map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
        </div>
        <form className="goto-form" onSubmit={submitGoTo} role="search" title={t("globalGoToHint")}>
          <label className="sr-only" htmlFor="global-go-to">{t("globalGoTo")}</label>
          <input ref={goToInputRef} id="global-go-to" value={goToQuery} onChange={(event) => { setGoToQuery(event.target.value); setGoToError(""); }} placeholder={t("globalGoToPlaceholder")} aria-describedby="global-go-to-hint" />
          <span className="sr-only" id="global-go-to-hint">{t("globalGoToHint")}</span>
          <button className="link-button" type="submit">{t("goTo")}</button>
        </form>
        <div className="header-actions">
          <ThemePicker />
          <LanguagePicker />
          <button className="link-button" type="button" title={t("logoutHint")} onClick={() => setLogoutConfirmOpen(true)} disabled={logoutBusy}>{logoutBusy ? t("loggingOut") : t("logout")}</button>
          <button className="link-button" type="button" title={t("exitWorkspaceHint")} onClick={exitWorkspace}>{t("exitWorkspace")}</button>
        </div>
      </header>
      {goToError && <div className="top-error" role="alert">{goToError}</div>}
      {logoutError && <div className="top-error" role="alert"><strong>{logoutError.message}</strong><span>{logoutError.hints[0]}</span></div>}
      {workspaceSwitchError && <div className="top-error" role="alert"><strong>{workspaceSwitchError.message}</strong><span>{workspaceSwitchError.hints[0]}</span></div>}
      <div className={`workspace-shell sidebar-${sidebar}`}>
        {sidebar !== "hidden" && <aside className="main-sidebar">
          <nav aria-label={t("mainNavigation")}>
            <button className={`nav-item${view === "workspace" ? " active" : ""}`} type="button" title={t("filesTitle")} aria-label={t("filesTitle")} onClick={() => setView("workspace")}><NavIcon name="files" /><span className="nav-label">{t("filesTitle")}</span></button>
            <button className={`nav-item${view === "changes" ? " active" : ""}`} type="button" title={t("myChanges")} aria-label={t("myChanges")} onClick={() => setView("changes")}><NavIcon name="changes" /><span className="nav-label">{t("myChanges")}</span><small>{fileCount}</small></button>
            <button data-agent-id="nav-submitted" className={`nav-item${view === "history" ? " active" : ""}`} type="button" title={t("submittedHistory")} aria-label={t("submittedHistory")} onClick={() => setView("history")}><NavIcon name="history" /><span className="nav-label">{t("submittedHistory")}</span></button>
            <button className={`nav-item${view === "streams" ? " active" : ""}`} type="button" title={t("streamsTitle")} aria-label={t("streamsTitle")} onClick={() => setView("streams")}><NavIcon name="streams" /><span className="nav-label">{t("streamsTitle")}</span></button>
            <span className="nav-separator" role="separator" />
            <button data-agent-id="nav-shelves" className={`nav-item${view === "shelves" ? " active" : ""}`} type="button" title={t("shelvesTitle")} aria-label={t("shelvesTitle")} onClick={() => setView("shelves")}><NavIcon name="shelves" /><span className="nav-label">{t("shelvesTitle")}</span></button>
            <button className={`nav-item${view === "jobs" ? " active" : ""}`} type="button" title={t("jobsTitle")} aria-label={t("jobsTitle")} onClick={() => setView("jobs")}><NavIcon name="jobs" /><span className="nav-label">{t("jobsTitle")}</span></button>
          </nav>
          <div><div className="sidebar-controls"><button type="button" title={t(sidebar === "compact" ? "expandSidebar" : "collapseSidebar")} aria-label={t(sidebar === "compact" ? "expandSidebar" : "collapseSidebar")} onClick={() => setSidebar((state) => state === "compact" ? "expanded" : "compact")}><NavIcon name={sidebar === "compact" ? "expand" : "collapse"} /></button><button type="button" title={t("hideSidebar")} aria-label={t("hideSidebar")} onClick={() => setSidebar("hidden")}><NavIcon name="hide" /></button></div><div className="workspace-identity"><span>{t("workspaceLabel")}</span><strong>{session.connection.client}</strong><small>{session.info.clientStream || session.info.clientRoot}</small></div></div>
        </aside>}
        <main className="workspace-main">
          <Suspense fallback={<div className="compact-empty" role="status">{t("loadingFiles")}</div>}>
            <div className="workspace-view-host" hidden={view !== "workspace" || filesSource !== "local"}>
              <WorkspaceView connection={session.connection} info={session.info} initialScope={workspaceScope} sourceControl={<FilesSourceControl source="local" setSource={setFilesSource} />} onDeleted={exitWorkspace} onRenamed={(name) => setSession((current) => current ? { ...current, connection: { ...current.connection, client: name }, info: { ...current.info, clientName: name } } : current)} />
            </div>
            {view === "changes" ? <ChangesView connection={session.connection} info={session.info} onFileCountChange={handleFileCount} initialChange={changeTarget} /> : view === "workspace" ? filesSource === "depot" ? <DepotView connection={session.connection} initialScope={depotScope} sourceControl={<FilesSourceControl source="depot" setSource={setFilesSource} />} /> : null : view === "streams" ? <StreamsView connection={session.connection} currentStream={session.info.clientStream} onSwitched={(info) => setSession((current) => current ? { ...current, info } : current)} /> : view === "history" ? <HistoryView connection={session.connection} info={session.info} /> : view === "jobs" ? <JobsView connection={session.connection} initialSearch={jobSearch} /> : view === "labels" ? <LabelsView connection={session.connection} initialSearch={labelSearch} /> : <ShelvesView connection={session.connection} />}
          </Suspense>
        </main>
      </div>
      <CliLogCenter onOpenChange={setCliLogOpen} />
      <OperationsCenter connection={currentSession.connection} />
      <CommandPalette onNavigate={(target) => { if (target === "depot") { setFilesSource("depot"); setView("workspace"); } else setView(target); }} onFocusGoTo={() => goToInputRef.current?.focus()} />
      {logoutConfirmOpen && <ActionDialog danger title={t("logout")} confirmLabel={t("logout")} busy={logoutBusy} onClose={() => setLogoutConfirmOpen(false)} onConfirm={() => void signOut()}><p>{t("logoutConfirm")}</p></ActionDialog>}
    </div>
  );
}

function FilesSourceControl({ source, setSource }: { source: "local" | "depot"; setSource: (source: "local" | "depot") => void }) {
  const { t } = useLocale();
  return <div className="segmented-control files-source-control" role="tablist" aria-label={t("filesSource")}><button data-agent-id="files-source-local" type="button" role="tab" aria-selected={source === "local"} className={source === "local" ? "active" : ""} onClick={() => setSource("local")}>{t("localFiles")}</button><button data-agent-id="files-source-depot" type="button" role="tab" aria-selected={source === "depot"} className={source === "depot" ? "active" : ""} onClick={() => setSource("depot")}>{t("depotFiles")}</button></div>;
}

function NavIcon({ name }: { name: "menu" | "files" | "changes" | "history" | "streams" | "shelves" | "jobs" | "expand" | "collapse" | "hide" }) {
  const icons: Record<typeof name, LucideIcon> = {
    menu: Menu,
    files: FolderTree,
    changes: ListChecks,
    history: HistoryIcon,
    streams: GitBranch,
    shelves: Archive,
    jobs: ClipboardList,
    expand: PanelLeftOpen,
    collapse: PanelLeftClose,
    hide: EyeOff,
  };
  const Icon = icons[name];
  return <Icon className="nav-icon" aria-hidden="true" />;
}

function StartupScreen() {
  const { t } = useLocale();
  return <div className="app" data-agent-screen="startup"><header className="app-header"><div className="brand" aria-label="P4FNV"><span className="brand-mark" aria-hidden="true">P4</span>P4FNV</div><LanguagePicker /></header><main className="startup-page"><div className="startup-status" role="status"><LoaderCircle className="status-symbol icon-spin" aria-hidden="true" /><strong>{t("openingSavedWorkspace")}</strong></div></main></div>;
}
