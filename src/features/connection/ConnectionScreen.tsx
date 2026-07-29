import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import {
  detectP4,
  listWorkspaces,
  listTrust,
  toggleFavoriteConnection,
  loadLocales,
  loadSettings,
  login,
  loginStatus,
  normalizeAppError,
  openWorkspace as openWorkspaceSession,
  rememberConnection,
  testConnection,
} from "../../shared/api";
import { LanguagePicker } from "../../shared/LanguagePicker";
import { ThemePicker } from "../../shared/ThemePicker";
import { useLocale, type TranslationKey } from "../../shared/i18n";
import type { AppError, ConnectionInput, ErrorKind, LoginStatus, P4Detection, P4Info, TrustEntry, WorkspaceSummary } from "../../shared/models";
import { connectionForServer } from "../../shared/connection";
import { validateConnection, type ConnectionErrors } from "./connection";

type DetectionState =
  | { phase: "loading" }
  | { phase: "ready"; value: P4Detection }
  | { phase: "error"; error: AppError };

type TestState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; value: P4Info }
  | { phase: "error"; error: AppError };

type Translate = (key: TranslationKey) => string;

export interface ConnectedSession {
  connection: ConnectionInput;
  info: P4Info;
}

export function ConnectionScreen({ initialError, onConnected }: { initialError?: AppError; onConnected: (session: ConnectedSession) => void }) {
  const { setLocales, t } = useLocale();
  const [detection, setDetection] = useState<DetectionState>({ phase: "loading" });
  const [testState, setTestState] = useState<TestState>(initialError ? { phase: "error", error: initialError } : { phase: "idle" });
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<AppError>();
  const [busyAction, setBusyAction] = useState<"test" | "open" | "login" | "trust">();
  const [recentConnections, setRecentConnections] = useState<ConnectionInput[]>([]);
  const [favoriteConnections, setFavoriteConnections] = useState<ConnectionInput[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [settingsWarning, setSettingsWarning] = useState(false);
  const [localeWarning, setLocaleWarning] = useState(false);
  const [p4Path, setP4Path] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [client, setClient] = useState("");
  const [charset, setCharset] = useState("");
  const [p4Config, setP4Config] = useState("");
  const [p4Enviro, setP4Enviro] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<ConnectionErrors>({});
  const [trustEntries, setTrustEntries] = useState<TrustEntry[]>();
  const [trustError, setTrustError] = useState<AppError>();
  const [ticketStatus, setTicketStatus] = useState<{ phase: "idle" | "loading" | "success" | "error"; value?: LoginStatus; error?: AppError }>({ phase: "idle" });
  const [renewBusy, setRenewBusy] = useState(false);

  async function runDetection(path?: string) {
    setDetection({ phase: "loading" });
    try {
      const value = await detectP4(path?.trim() || undefined);
      setP4Path(value.path);
      setDetection({ phase: "ready", value });
    } catch (error) {
      setDetection({ phase: "error", error: normalizeAppError(error) });
    }
  }

  function applyProfile(profile: ConnectionInput, selectionValue: string) {
    setSelectedProfile(selectionValue);
    setPort(profile.port);
    setUser(profile.user);
    setClient(profile.client ?? "");
    setCharset(profile.charset ?? "");
    setP4Config(profile.p4Config ?? "");
    setP4Enviro(profile.p4Enviro ?? "");
    setP4Path(profile.p4Path ?? "");
    setErrors({});
    setTestState({ phase: "idle" });
    setWorkspaces([]);
    setWorkspacesLoading(false);
    setWorkspaceError(undefined);
    setTrustEntries(undefined);
    setTrustError(undefined);
    setTicketStatus({ phase: "idle" });
  }

  function resetVerification() {
    setTestState({ phase: "idle" });
    setWorkspaces([]);
    setWorkspacesLoading(false);
    setWorkspaceError(undefined);
    setTrustEntries(undefined);
    setTrustError(undefined);
    setTicketStatus({ phase: "idle" });
  }

  useEffect(() => {
    let active = true;
    void Promise.all([loadSettings(), loadLocales()])
      .then(([settings, catalog]) => {
        if (!active) return;
        setLocales(catalog.locales, settings.language);
        setLocaleWarning(catalog.warnings.length > 0);
        setRecentConnections(settings.recentConnections);
        setFavoriteConnections(settings.favoriteConnections ?? []);
        const recent = settings.recentConnections[0];
        if (recent) {
          applyProfile(recent, "recent:0");
        }
        if (initialError) setTestState({ phase: "error", error: initialError });
        return runDetection(recent?.p4Path);
      })
      .catch(() => {
        if (!active) return;
        setSettingsWarning(true);
        return runDetection();
      });
    return () => {
      active = false;
    };
  }, []);

  function validatedInput(requireWorkspace: boolean): ConnectionInput | undefined {
    const validation = validateConnection({ port, user, client }, requireWorkspace);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return undefined;
    return {
      p4Path: p4Path.trim() || undefined,
      port: port.trim(),
      user: user.trim(),
      client: client.trim() || undefined,
      charset: charset || undefined,
      p4Config: p4Config.trim() || undefined,
      p4Enviro: p4Enviro.trim() || undefined,
    };
  }

  async function handleTestConnection() {
    const input = validatedInput(false);
    if (!input) return;
    setBusyAction("test");
    setTestState({ phase: "loading" });
    try {
      const value = await testConnection(input);
      setTestState({ phase: "success", value });
      setWorkspaceError(undefined);
      setWorkspacesLoading(true);
      try {
        const found = await listWorkspaces(connectionForServer(input, value));
        setWorkspaces(found);
        const preferred = [input.client, value.clientName].find((name) =>
          Boolean(name && found.some((workspace) => workspace.name === name)),
        );
        if (preferred || found.length === 1) setClient(preferred ?? found[0].name);
      } catch (error) {
        const fallback = input.client || value.clientName;
        setWorkspaces(fallback ? [{ name: fallback, owner: input.user, root: value.clientRoot ?? "", stream: value.clientStream }] : []);
        if (fallback) setClient(fallback);
        setWorkspaceError(normalizeAppError(error));
      } finally {
        setWorkspacesLoading(false);
      }
    } catch (error) {
      setTestState({ phase: "error", error: normalizeAppError(error) });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function openWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const connection = validatedInput(true);
    if (!connection?.client) return;
    setBusyAction("open");
    setTestState({ phase: "loading" });
    try {
      const info = await openWorkspaceSession(connection);
      try {
        const settings = await rememberConnection(connection);
        setRecentConnections(settings.recentConnections);
        setSettingsWarning(false);
      } catch {
        setSettingsWarning(true);
      }
      const workspace = workspaces.find((item) => item.name === connection.client);
      onConnected({
        connection: connectionForServer(connection, info),
        info: {
          ...info,
          clientName: connection.client,
          clientRoot: workspace?.root || info.clientRoot,
          clientStream: workspace?.stream || info.clientStream,
        },
      });
    } catch (error) {
      setTestState({ phase: "error", error: normalizeAppError(error) });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleLogin() {
    const input = validatedInput(false);
    if (!input || !password) return;
    setBusyAction("login");
    setTestState({ phase: "loading" });
    try {
      await login(input, password);
      setPassword("");
      await handleTestConnection();
    } catch (error) {
      setTestState({ phase: "error", error: normalizeAppError(error) });
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleListTrust() {
    const input = validatedInput(false);
    if (!input) return;
    setBusyAction("trust"); setTrustError(undefined);
    try { setTrustEntries(await listTrust(input)); }
    catch (error) { setTrustEntries(undefined); setTrustError(normalizeAppError(error)); }
    finally { setBusyAction(undefined); }
  }

  async function handleTicketStatus() {
    const input = validatedInput(false);
    if (!input) return;
    setTicketStatus({ phase: "loading" });
    try {
      setTicketStatus({ phase: "success", value: await loginStatus(input) });
    } catch (error) {
      setTicketStatus({ phase: "error", error: normalizeAppError(error) });
    }
  }

  async function handleRenewTicket() {
    const input = validatedInput(false);
    if (!input || !password) return;
    setRenewBusy(true);
    try {
      await login(input, password);
      setPassword("");
      await handleTicketStatus();
    } catch (error) {
      setTicketStatus({ phase: "error", error: normalizeAppError(error) });
    } finally {
      setRenewBusy(false);
    }
  }

  async function handleToggleFavorite() {
    const input = validatedInput(false);
    if (!input) return;
    setBusyAction("trust");
    try {
      const settings = await toggleFavoriteConnection(input);
      setFavoriteConnections(settings.favoriteConnections);
    } catch (error) {
      setSettingsWarning(true);
    } finally {
      setBusyAction(undefined);
    }
  }

  const knownUsers = uniqueValues(recentConnections, "user");
  const knownClients = uniqueValues(recentConnections, "client");

  return (
    <div className="app" data-agent-screen="connection">
      <header className="app-header">
        <div className="brand" aria-label="P4FNV">
          <span className="brand-mark" aria-hidden="true">P4</span>
          P4FNV
        </div>
        <div className="header-actions">
          <span className="header-meta">{t("headerSubtitle")}</span>
          <ThemePicker onSaveError={() => setSettingsWarning(true)} />
          <LanguagePicker onSaveError={() => setSettingsWarning(true)} />
        </div>
      </header>

      <main className="connection-page">
        <section className="connection-intro" aria-labelledby="connection-title">
          <p className="eyebrow">{t("firstRun")}</p>
          <h1 id="connection-title">{t("title")}</h1>
          <p className="lede">{t("intro")}</p>

          <ol className="steps" aria-label={t("stepsLabel")}>
            <Step number="1" title={t("stepToolsTitle")} body={t("stepToolsBody")} />
            <Step number="2" title={t("stepServerTitle")} body={t("stepServerBody")} />
            <Step number="3" title={t("stepWorkspaceTitle")} body={t("stepWorkspaceBody")} />
          </ol>
        </section>

        <section className="connection-card" aria-labelledby="connection-form-title">
          <div className="card-heading">
            <h2 id="connection-form-title">{t("formTitle")}</h2>
            <p>{t("formSubtitle")}</p>
          </div>

          {settingsWarning && <p className="settings-warning" role="status">{t("settingsWarning")}</p>}
          {localeWarning && <p className="settings-warning" role="status">{t("localeWarning")}</p>}
          <DetectionStatus detection={detection} onRetry={() => void runDetection(p4Path)} t={t} />

          <form className="connection-form" onSubmit={openWorkspace} noValidate>
            {(recentConnections.length > 0 || favoriteConnections.length > 0) && (
              <label className="field">
                <span className="field-label">{t("profilesLabel")}</span>
                <select
                  value={selectedProfile}
                  onChange={(event) => {
                    const [kind, rawIndex] = event.target.value.split(":");
                    const index = Number(rawIndex);
                    const profiles = kind === "favorite" ? favoriteConnections : recentConnections;
                    if (Number.isInteger(index) && profiles[index]) applyProfile(profiles[index], event.target.value);
                  }}
                >
                  <option value="">{t("profilePlaceholder")}</option>
                  {favoriteConnections.length > 0 && <optgroup label={t("favoritesGroup")}>
                    {favoriteConnections.map((profile, index) => <option value={`favorite:${index}`} key={`favorite-${profileKey(profile)}`}>★ {profileLabel(profile)}</option>)}
                  </optgroup>}
                  {recentConnections.length > 0 && <optgroup label={t("recentGroup")}>
                    {recentConnections.map((profile, index) => <option value={`recent:${index}`} key={`recent-${profileKey(profile)}`}>{profileLabel(profile)}</option>)}
                  </optgroup>}
                </select>
                <button className="link-button" type="button" onClick={() => void handleToggleFavorite()} disabled={Boolean(busyAction)}>{favoriteConnections.some((profile) => profileKey(profile) === profileKey({ p4Path: p4Path || undefined, port, user, client: client || undefined, charset: charset || undefined, p4Config: p4Config || undefined, p4Enviro: p4Enviro || undefined })) ? t("removeFavorite") : t("addFavorite")}</button>
              </label>
            )}

            <label className="field">
              <span className="field-label">{t("serverLabel")}</span>
              <input
                autoFocus
                value={port}
                onChange={(event) => { setPort(event.target.value); setSelectedProfile(""); resetVerification(); }}
                placeholder="ssl:perforce.company.net:1666"
                autoComplete="off"
                aria-invalid={Boolean(errors.port)}
                aria-describedby={errors.port ? "port-error" : "port-hint"}
              />
              {errors.port ? (
                <span className="field-error" id="port-error">{t(errors.port)}</span>
              ) : (
                <span className="field-hint" id="port-hint">{t("serverHint")}</span>
              )}
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">{t("userLabel")}</span>
                <input
                  value={user}
                  onChange={(event) => { setUser(event.target.value); setSelectedProfile(""); resetVerification(); }}
                  placeholder="alex"
                  list="known-users"
                  autoComplete="username"
                  aria-invalid={Boolean(errors.user)}
                  aria-describedby={errors.user ? "user-error" : undefined}
                />
                {errors.user && <span className="field-error" id="user-error">{t(errors.user)}</span>}
              </label>

              <label className="field">
                <span className="field-label">{t("workspaceLabel")}</span>
                <input
                  value={client}
                  onChange={(event) => { setClient(event.target.value); setSelectedProfile(""); resetVerification(); }}
                  placeholder={t("workspacePlaceholder")}
                  list="known-clients"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.client)}
                  aria-describedby={errors.client ? "workspace-error" : undefined}
                />
                {errors.client && <span className="field-error" id="workspace-error">{t(errors.client)}</span>}
              </label>
            </div>
            <datalist id="known-users">{knownUsers.map((value) => <option value={value} key={value} />)}</datalist>
            <datalist id="known-clients">{knownClients.map((value) => <option value={value} key={value} />)}</datalist>

            <details className="advanced">
              <summary>{t("advanced")}</summary>
              <div className="advanced-content">
                <label className="field">
                  <span className="field-label">{t("p4PathLabel")}</span>
                  <input
                    value={p4Path}
                    onChange={(event) => { setP4Path(event.target.value); setSelectedProfile(""); resetVerification(); }}
                    placeholder="C:\\Program Files\\Perforce\\p4.exe"
                    spellCheck={false}
                  />
                  <span className="field-hint">{t("p4PathHint")}</span>
                </label>

                <label className="field">
                  <span className="field-label">{t("charsetLabel")}</span>
                  <select value={charset} onChange={(event) => { setCharset(event.target.value); setSelectedProfile(""); resetVerification(); }}>
                    <option value="">{t("charsetAuto")}</option>
                    <option value="utf8">{t("charsetUtf8")}</option>
                    <option value="utf8-bom">{t("charsetUtf8Bom")}</option>
                    <option value="none">{t("charsetNone")}</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t("p4ConfigLabel")}</span>
                  <input value={p4Config} onChange={(event) => { setP4Config(event.target.value); setSelectedProfile(""); resetVerification(); }} placeholder="P4CONFIG" spellCheck={false} />
                  <span className="field-hint">{t("p4ConfigHint")}</span>
                </label>
                <label className="field">
                  <span className="field-label">{t("p4EnviroLabel")}</span>
                  <input value={p4Enviro} onChange={(event) => { setP4Enviro(event.target.value); setSelectedProfile(""); resetVerification(); }} placeholder="C:\\Users\\me\\.p4enviro" spellCheck={false} />
                  <span className="field-hint">{t("p4EnviroHint")}</span>
                </label>
                <button className="secondary-button" type="button" onClick={() => void handleListTrust()} disabled={Boolean(busyAction)}>{busyAction === "trust" ? t("loadingTrust") : t("inspectTrust")}</button>
              </div>
            </details>

            <div className="actions">
              <button
                className="secondary-button"
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void handleTestConnection()}
              >
                {busyAction === "test" ? t("checking") : t("checkConnection")}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={Boolean(busyAction)}
              >
                {busyAction === "open" ? t("openingWorkspace") : t("openWorkspace")}
              </button>
            </div>
          </form>

          <ConnectionResult state={testState} t={t} password={password} setPassword={setPassword} onLogin={() => void handleLogin()} loginBusy={busyAction === "login"} ticketStatus={ticketStatus} onTicketStatus={() => void handleTicketStatus()} onRenew={() => void handleRenewTicket()} renewBusy={renewBusy} />
          {trustError && <InlineError error={trustError} t={t} />}
          {trustEntries && <div className="workspace-choice discovery trust-list" role="status"><strong>{t("trustEntriesTitle")}</strong>{trustEntries.length ? trustEntries.map((entry) => <div className="preview-row" key={`${entry.server}-${entry.fingerprint}`}><span>{entry.server}</span><small>{entry.fingerprint}</small></div>) : <p className="field-hint">{t("noTrustEntries")}</p>}</div>}
          {(workspacesLoading || workspaces.length > 0 || workspaceError) && (
            <div className="workspace-choice discovery">
              <label className="field">
                <span className="field-label">{t("availableWorkspaces")}</span>
                <select
                  value={workspaces.some((workspace) => workspace.name === client) ? client : ""}
                  onChange={(event) => { setClient(event.target.value); setErrors((current) => ({ ...current, client: undefined })); }}
                  disabled={workspacesLoading || workspaces.length === 0}
                >
                  <option value="">{workspacesLoading ? t("loadingWorkspaces") : t("chooseWorkspacePlaceholder")}</option>
                  {workspaces.map((workspace) => (
                    <option value={workspace.name} key={workspace.name}>
                      {workspace.name}{workspace.stream ? ` · ${workspace.stream}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {workspaces.length === 0 && !workspacesLoading && !workspaceError && <p className="field-hint">{t("noWorkspaces")}</p>}
              {workspaceError && <InlineError error={workspaceError} t={t} />}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return <li className="step"><span className="step-number">{number}</span><span><strong>{title}</strong>{body}</span></li>;
}

function DetectionStatus({ detection, onRetry, t }: { detection: DetectionState; onRetry: () => void; t: Translate }) {
  if (detection.phase === "loading") {
    return <div className="tool-status" role="status"><LoaderCircle className="status-symbol icon-spin" aria-hidden="true" /><div className="tool-status-copy"><strong>{t("toolSearching")}</strong><span>{t("toolSearchingBody")}</span></div></div>;
  }
  if (detection.phase === "error") {
    return <div className="tool-status error" role="alert"><CircleAlert className="status-symbol" aria-hidden="true" /><div className="tool-status-copy"><strong>{errorText(detection.error.kind, t).message}</strong><span>{errorText(detection.error.kind, t).hint}</span></div><button className="link-button" type="button" onClick={onRetry}>{t("findAgain")}</button></div>;
  }
  return <div className="tool-status success" role="status"><CircleCheck className="status-symbol" aria-hidden="true" /><div className="tool-status-copy"><strong>{t("toolReady")}</strong><span title={`${detection.value.path} · ${detection.value.version}`}>{detection.value.path} · {detection.value.version}</span></div><button className="link-button" type="button" onClick={onRetry}>{t("findAgain")}</button></div>;
}

function ConnectionResult({ state, t, password, setPassword, onLogin, loginBusy, ticketStatus, onTicketStatus, onRenew, renewBusy }: { state: TestState; t: Translate; password: string; setPassword: (value: string) => void; onLogin: () => void; loginBusy: boolean; ticketStatus: { phase: "idle" | "loading" | "success" | "error"; value?: LoginStatus; error?: AppError }; onTicketStatus: () => void; onRenew: () => void; renewBusy: boolean }) {
  if (state.phase === "idle" || state.phase === "loading") return null;
  if (state.phase === "error") {
    const copy = errorText(state.error.kind, t);
    return <div className="result error" role="alert"><CircleAlert className="status-symbol" aria-hidden="true" /><div><h3>{t("connectionFailed")}</h3><p>{copy.message}</p><p>{copy.hint}</p>{state.error.kind === "auth" && <div className="login-inline"><label className="field"><span className="field-label">{t("passwordLabel")}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" onKeyDown={(event) => { if (event.key === "Enter") onLogin(); }} /></label><button className="primary-button" type="button" onClick={onLogin} disabled={loginBusy || !password}>{loginBusy ? t("loggingIn") : t("login")}</button><small>{t("passwordNotStored")}</small></div>}{state.error.diagnostics && <details className="diagnostics"><summary>{t("technicalDetails")}</summary><pre>{state.error.diagnostics}</pre></details>}</div></div>;
  }
  const info = state.value;
  return <div className="result success" role="status"><CircleCheck className="status-symbol" aria-hidden="true" /><div><h3>{t("serverResponded")}</h3><p>{t("connectionSuccessBody")}</p><dl className="connection-facts"><Fact label={t("factServer")} value={info.serverAddress} /><Fact label={t("factVersion")} value={info.serverVersion} /><Fact label={t("factUser")} value={info.userName} /><Fact label={t("factWorkspace")} value={info.clientName} /><Fact label={t("factRoot")} value={info.clientRoot} /><Fact label={t("factStream")} value={info.clientStream} /><Fact label={t("factServerServices")} value={info.serverServices} /><Fact label={t("factServerId")} value={info.serverId} /><Fact label={t("factSecurity")} value={info.security} /><Fact label={t("factClientAddress")} value={info.clientAddress} /><Fact label={t("factUserEmail")} value={info.userEmail} /></dl><div className="ticket-status"><button className="secondary-button" type="button" onClick={onTicketStatus} disabled={ticketStatus.phase === "loading"}>{ticketStatus.phase === "loading" ? t("checkingTicket") : t("checkTicket")}</button>{ticketStatus.phase === "success" && <><span>{t("ticketValid")}{ticketStatus.value?.expiresInMinutes !== undefined ? ` · ${ticketStatus.value.expiresInMinutes} ${t("minutesRemaining")}` : ""}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("renewPasswordPlaceholder")} autoComplete="current-password" /><button className="secondary-button" type="button" onClick={onRenew} disabled={renewBusy || !password}>{renewBusy ? t("renewingTicket") : t("renewTicket")}</button></>}{ticketStatus.phase === "error" && <span className="field-error">{errorText(ticketStatus.error?.kind ?? "command_failed", t).message}</span>}</div></div></div>;
}

function Fact({ label, value }: { label: string; value?: string }) {
  return value ? <><dt>{label}</dt><dd>{value}</dd></> : null;
}

function InlineError({ error, t }: { error: AppError; t: Translate }) {
  const copy = errorText(error.kind, t);
  return <p className="field-error" role="alert">{copy.message} {copy.hint}</p>;
}

function errorText(kind: ErrorKind, t: Translate) {
  const keys: Record<ErrorKind, [TranslationKey, TranslationKey]> = {
    executable_not_found: ["errorExecutable", "hintExecutable"],
    auth: ["errorAuth", "hintAuth"],
    trust: ["errorTrust", "hintTrust"],
    permission: ["errorPermission", "hintPermission"],
    conflict: ["errorConflict", "hintConflict"],
    offline: ["errorOffline", "hintOffline"],
    timeout: ["errorTimeout", "hintTimeout"],
    unsupported_capability: ["errorUnsupportedCapability", "hintUnsupportedCapability"],
    server_limit: ["errorServerLimit", "hintServerLimit"],
    cancelled: ["errorCancelled", "hintCancelled"],
    stale: ["errorStale", "hintStale"],
    partial_result: ["errorPartialResult", "hintPartialResult"],
    invalid_output: ["errorInvalidOutput", "hintInvalidOutput"],
    settings: ["errorSettings", "hintSettings"],
    command_failed: ["errorCommand", "hintCommand"],
  };
  return { message: t(keys[kind][0]), hint: t(keys[kind][1]) };
}

function uniqueValues(profiles: ConnectionInput[], field: "user" | "client"): string[] {
  return [...new Set(profiles.map((profile) => profile[field]).filter((value): value is string => Boolean(value)))];
}

function profileKey(profile: ConnectionInput): string {
  return `${profile.port}\0${profile.user}\0${profile.client ?? ""}\0${profile.p4Path ?? ""}\0${profile.charset ?? ""}\0${profile.p4Config ?? ""}\0${profile.p4Enviro ?? ""}`;
}

function profileLabel(profile: ConnectionInput): string {
  return `${profile.user} @ ${profile.port}${profile.client ? ` · ${profile.client}` : ""}`;
}
