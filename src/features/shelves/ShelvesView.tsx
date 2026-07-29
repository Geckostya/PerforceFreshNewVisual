import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, GitBranch, Monitor, Search, UserRound, UsersRound } from "lucide-react";
import { listPendingChanges, listShelvedChanges, listShelvedFiles, normalizeAppError, previewUnshelve, reshelveFiles, saveShelvedFile, unshelveFiles } from "../../shared/api";
import { ChangelistDescription, markdownToPlainText } from "../../shared/ChangelistDescription";
import { useLocale } from "../../shared/i18n";
import { ItemRowCopy, SelectableRow } from "../../shared/ItemList";
import type { AppError, ConnectionInput, PendingChange, ShelvedFile, UnshelvePreview } from "../../shared/models";
import { RefreshButton } from "../../shared/RefreshButton";
import { useMultiSelection } from "../../shared/useMultiSelection";
import { ActionDialog, BoundedListNotice, CompactEmpty, EmptyState, View } from "../../shared/View";
import { SERVER_LIST_LIMIT } from "../../shared/scale";
import { canApplyUnshelve, filterShelves, groupShelvesByUser, nextShelfSelection, shelfTimestamp, splitUnshelvePaths, type ShelfAgeFilter } from "./shelves";

type ShelfDialog = { kind: "export"; outputPath: string } | { kind: "reshelve" };

const INITIAL_SHELF_LIMIT = 120;

function uniqueShelfValues(shelves: PendingChange[], field: "user" | "client" | "stream") {
  return [...new Set(shelves.map((shelf) => shelf[field]).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

function userInitials(user: string) {
  const initials = user.split(/[._\-\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "?";
}

function formatShelfTime(value: string | undefined, language: string) {
  const timestamp = shelfTimestamp(value);
  return timestamp === undefined
    ? "—"
    : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp * 1000));
}

export function ShelvesView({ connection }: { connection: ConnectionInput }) {
  const { t, language } = useLocale();
  const [shelves, setShelves] = useState<PendingChange[]>([]);
  const [targets, setTargets] = useState<PendingChange[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<string>();
  const [files, setFiles] = useState<ShelvedFile[]>([]);
  const fileSelection = useMultiSelection(files.map((file) => file.depotPath));
  const selectedPaths = fileSelection.selected;
  const [targetChange, setTargetChange] = useState("default");
  const [preview, setPreview] = useState<UnshelvePreview>();
  const [overwritePaths, setOverwritePaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<ShelfDialog>();
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [streamFilter, setStreamFilter] = useState("all");
  const [ageFilter, setAgeFilter] = useState<ShelfAgeFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_SHELF_LIMIT);
  const shelfRequest = useRef(0);

  const filters = useMemo(() => ({ query, user: userFilter, client: clientFilter, stream: streamFilter, age: ageFilter }), [ageFilter, clientFilter, query, streamFilter, userFilter]);
  const visibleShelves = useMemo(() => filterShelves(shelves, filters), [filters, shelves]);
  const displayedShelves = useMemo(() => visibleShelves.slice(0, visibleLimit), [visibleLimit, visibleShelves]);
  const shelfGroups = useMemo(() => groupShelvesByUser(displayedShelves), [displayedShelves]);
  const shelfUsers = useMemo(() => uniqueShelfValues(shelves, "user"), [shelves]);
  const shelfClients = useMemo(() => uniqueShelfValues(shelves, "client"), [shelves]);
  const shelfStreams = useMemo(() => uniqueShelfValues(shelves, "stream"), [shelves]);
  const visibleShelfIds = visibleShelves.map((shelf) => shelf.id).join(",");

  function clearSelectedShelf() {
    shelfRequest.current += 1;
    setSelectedShelf(undefined);
    setFiles([]);
    fileSelection.clear();
    setPreview(undefined);
    setOverwritePaths([]);
  }

  async function selectShelf(change: string) {
    const request = ++shelfRequest.current;
    setSelectedShelf(change);
    setPreview(undefined);
    setOverwritePaths([]);
    setError(undefined);
    setBusy(true);
    try {
      const nextFiles = await listShelvedFiles(connection, change);
      if (request !== shelfRequest.current) return;
      setFiles(nextFiles);
      fileSelection.replace(nextFiles.map((file) => file.depotPath));
    } catch (reason) {
      if (request === shelfRequest.current) setError(normalizeAppError(reason));
    } finally {
      if (request === shelfRequest.current) setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const [nextShelves, nextTargets] = await Promise.all([listShelvedChanges(connection), listPendingChanges(connection)]);
      setShelves(nextShelves);
      setTargets(nextTargets.filter((change) => change.id !== "default"));
      const nextSelected = nextShelfSelection(filterShelves(nextShelves, filters), selectedShelf);
      if (nextSelected) await selectShelf(nextSelected);
      else clearSelectedShelf();
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [connection.port, connection.user, connection.client]);

  useEffect(() => { setVisibleLimit(INITIAL_SHELF_LIMIT); }, [ageFilter, clientFilter, query, streamFilter, userFilter]);

  useEffect(() => {
    const nextSelected = nextShelfSelection(visibleShelves, selectedShelf);
    if (nextSelected === selectedShelf) return;
    if (nextSelected) void selectShelf(nextSelected);
    else clearSelectedShelf();
  }, [visibleShelfIds, selectedShelf]);

  function selectFile(path: string, event: React.MouseEvent) {
    fileSelection.select(path, event);
    setPreview(undefined);
    setOverwritePaths([]);
  }

  async function previewSelected() {
    if (!selectedShelf || !selectedPaths.length) return;
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    try { setPreview(await previewUnshelve(connection, selectedShelf, selectedPaths)); setOverwritePaths([]); }
    catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyUnshelve() {
    if (!selectedShelf || !preview || !canApplyUnshelve(preview, selectedPaths, overwritePaths)) return;
    const plan = splitUnshelvePaths(selectedPaths, preview, overwritePaths);
    const paths = [...plan.normalPaths, ...plan.forcePaths];
    setBusy(true);
    setError(undefined);
    try {
      await unshelveFiles(connection, selectedShelf, targetChange, paths, plan.forcePaths);
      setNotice(t("shelvesUnshelveSucceeded"));
      setPreview(undefined);
      setOverwritePaths([]);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  async function applyDialog() {
    if (!dialog || !selectedShelf) return;
    setBusy(true);
    setError(undefined);
    try {
      if (dialog.kind === "export") {
        await saveShelvedFile(connection, selectedShelf, selectedPaths[0], dialog.outputPath.trim());
        setNotice(t("shelfExportSucceeded"));
      } else {
        await reshelveFiles(connection, selectedShelf, targetChange, selectedPaths);
        setNotice(t("reshelveSucceeded"));
      }
      setDialog(undefined);
    } catch (reason) { setError(normalizeAppError(reason)); }
    finally { setBusy(false); }
  }

  const shelf = shelves.find((item) => item.id === selectedShelf);
  return <View
    id="shelves-title"
    title={t("shelvesTitle")}
    subtitle={t("shelvesBody")}
    busy={busy}
    error={error}
    notice={notice}
    onDismissNotice={() => setNotice("")}
    actions={<RefreshButton busy={busy} onClick={() => void load()} agentId="shelves-refresh" />}
  >
    <div className="shelves-toolbar" aria-label={t("shelfFiltersLabel")}>
      <label className="shelves-search-control">
        <Search aria-hidden="true" />
        <input data-agent-id="shelves-search" value={query} aria-label={t("shelfSearchLabel")} placeholder={t("shelfSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="shelves-filter-control"><UsersRound aria-hidden="true" /><select data-agent-id="shelves-user-filter" value={userFilter} aria-label={t("factUser")} onChange={(event) => setUserFilter(event.target.value)}><option value="all">{t("allUsers")}</option>{shelfUsers.map((user) => <option key={user} value={user}>{user === connection.user ? `${t("currentUser")} · ${user}` : user}</option>)}</select></label>
      <label className="shelves-filter-control"><Monitor aria-hidden="true" /><select data-agent-id="shelves-workspace-filter" value={clientFilter} aria-label={t("workspaceLabel")} onChange={(event) => setClientFilter(event.target.value)}><option value="all">{t("allWorkspaces")}</option>{shelfClients.map((client) => <option key={client} value={client}>{client === connection.client ? `${t("currentWorkspace")} · ${client}` : client}</option>)}</select></label>
      <label className="shelves-filter-control"><GitBranch aria-hidden="true" /><select data-agent-id="shelves-stream-filter" value={streamFilter} aria-label={t("factStream")} onChange={(event) => setStreamFilter(event.target.value)}><option value="all">{t("allStreams")}</option>{shelfStreams.map((stream) => <option key={stream} value={stream}>{stream}</option>)}</select></label>
      <label className="shelves-filter-control shelves-age-control"><CalendarClock aria-hidden="true" /><select data-agent-id="shelves-age-filter" value={ageFilter} aria-label={t("shelfAgeFilter")} onChange={(event) => setAgeFilter(event.target.value as ShelfAgeFilter)}><option value="all">{t("shelfAgeAny")}</option><option value="day">{t("shelfAgeDay")}</option><option value="week">{t("shelfAgeWeek")}</option><option value="month">{t("shelfAgeMonth")}</option></select></label>
    </div>
    {shelves.length >= SERVER_LIST_LIMIT && <BoundedListNotice count={SERVER_LIST_LIMIT} />}

    <div className="resource-workbench shelves-people-workbench">
      <div className="shelves-people-board">
        <div className="column-heading"><strong>{t("shelfPeopleHeading")}</strong><span>{visibleShelves.length} / {shelves.length}</span></div>
        {busy && shelves.length === 0
          ? <CompactEmpty text={t("loadingShelves")} />
          : shelfGroups.length === 0
            ? <EmptyState title={shelves.length ? t("shelfFilterEmpty") : t("shelvesEmpty")} body={shelves.length ? t("shelfFilterEmptyBody") : t("shelvesBody")} />
            : <div className="shelf-user-groups">{shelfGroups.map((group) => <section className="shelf-user-group" key={group.user}>
              <header className="shelf-user-heading">
                <span className="shelf-user-avatar" aria-hidden="true">{userInitials(group.user)}</span>
                <span className="shelf-user-copy"><strong>{group.user}</strong><small>{group.clients.length} {t("shelfWorkspaceCount")}</small></span>
                <span className="shelf-user-count">{group.shelves.length} {t("shelfGroupCount")}</span>
              </header>
              <div className="shelf-person-cards">{group.shelves.map((item) => <SelectableRow data-agent-id={`shelves-change-${item.id}`} selected={item.id === selectedShelf} className="shelf-person-card" key={item.id} onClick={() => void selectShelf(item.id)}>
                <span className="shelf-card-heading"><strong className="changelist-number">CL {item.id}</strong><time dateTime={item.time}>{formatShelfTime(item.time, language)}</time></span>
                <span className="shelf-card-description">{markdownToPlainText(item.description) || t("noDescription")}</span>
                <span className="shelf-card-meta"><span>{item.client || "—"}</span><span>{item.stream || t("shelfStreamUnknown")}</span></span>
              </SelectableRow>)}</div>
            </section>)}{displayedShelves.length < visibleShelves.length && <button className="load-more shelves-load-more" type="button" onClick={() => setVisibleLimit((current) => current + INITIAL_SHELF_LIMIT)}>{t("loadMoreShelves")}</button>}</div>}
      </div>
      <aside className="resource-inspector shelves-inspector">
        <div className="column-heading"><strong className={shelf ? "changelist-number" : undefined}>{shelf ? `CL ${shelf.id}` : t("shelvesTitle")}</strong><span>{selectedPaths.length} / {files.length}</span></div>
        {!selectedShelf || !shelf ? <EmptyState title={t("selectShelf")} body={t("shelvesBody")} /> : <div className="inspector-content">
          <div className="shelf-inspector-description"><ChangelistDescription value={shelf.description} fallback={t("noDescription")} /><p>{selectedPaths.length} / {files.length} {t("shelvedFilesCount")}</p></div>
          <dl className="shelf-inspector-facts">
            <div><UserRound aria-hidden="true" /><dt>{t("factUser")}</dt><dd title={shelf.user}>{shelf.user || "—"}</dd></div>
            <div><Monitor aria-hidden="true" /><dt>{t("workspaceLabel")}</dt><dd title={shelf.client}>{shelf.client || "—"}</dd></div>
            <div><GitBranch aria-hidden="true" /><dt>{t("factStream")}</dt><dd title={shelf.stream}>{shelf.stream || t("shelfStreamUnknown")}</dd></div>
            <div><CalendarClock aria-hidden="true" /><dt>{t("labelUpdated")}</dt><dd>{formatShelfTime(shelf.time, language)}</dd></div>
          </dl>
          <label className="field"><span className="field-label">{t("targetChangelist")}</span><select data-agent-id="shelves-target-change" value={targetChange} onChange={(event) => { setTargetChange(event.target.value); setPreview(undefined); setOverwritePaths([]); }}><option value="default">{t("defaultChangelist")}</option>{targets.map((target) => <option value={target.id} key={target.id}>{`CL ${target.id} · ${markdownToPlainText(target.description) || t("noDescription")}`}</option>)}</select></label>
          <div className="resource-detail-list shelf-files-list">{files.map((file) => <SelectableRow selected={selectedPaths.includes(file.depotPath)} className="resource-entry preview-select" key={file.depotPath} onClick={(event) => selectFile(file.depotPath, event)}><ItemRowCopy primary={file.depotPath} secondary={<>{file.action}{file.revision ? ` · #${file.revision}` : ""}</>} /></SelectableRow>)}</div>
          <div className="inspector-actions"><button className="secondary-button" type="button" onClick={() => { fileSelection.replace(files.map((file) => file.depotPath)); setPreview(undefined); setOverwritePaths([]); }} disabled={busy}>{t("selectAllFiles")}</button><button className="primary-button" type="button" onClick={() => void previewSelected()} disabled={busy || !selectedPaths.length}>{t("previewUnshelve")}</button><button className="secondary-button" type="button" onClick={() => setDialog({ kind: "export", outputPath: "" })} disabled={busy || selectedPaths.length !== 1}>{t("exportShelfFile")}</button>{targetChange !== "default" && <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "reshelve" })} disabled={busy || !selectedPaths.length}>{t("reshelveToTarget")}</button>}</div>
          {preview && <div className="inline-preview"><strong>{t("unshelvePreview")}</strong><p>{preview.conflicts.length ? `${preview.conflicts.length} ${t("unshelveConflicts")}` : t("unshelveNoConflicts")}</p>{preview.conflicts.map((conflict) => <label className="check-field" key={conflict.depotPath}><input type="checkbox" checked={overwritePaths.includes(conflict.depotPath)} onChange={(event) => setOverwritePaths((current) => event.target.checked ? [...current, conflict.depotPath] : current.filter((path) => path !== conflict.depotPath))} /><span><strong>{conflict.depotPath}</strong><small>{conflict.localPath ? `${conflict.localPath} · ${t("unshelveConflictDefaultSkip")}` : t("unshelveConflictDefaultSkip")}</small></span></label>)}<button className="primary-button" type="button" onClick={() => void applyUnshelve()} disabled={busy || !canApplyUnshelve(preview, selectedPaths, overwritePaths)}>{t("applyUnshelve")}</button></div>}
        </div>}
      </aside>
    </div>

    {dialog?.kind === "export" && <ActionDialog title={t("exportShelfFile")} confirmLabel={t("exportShelfFile")} busy={busy} confirmDisabled={!dialog.outputPath.trim()} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{selectedPaths[0]}</p><label className="field"><span className="field-label">{t("shelfExportPathPrompt")}</span><input autoFocus value={dialog.outputPath} onChange={(event) => setDialog({ ...dialog, outputPath: event.target.value })} /></label></ActionDialog>}
    {dialog?.kind === "reshelve" && <ActionDialog title={t("reshelveToTarget")} confirmLabel={t("reshelveToTarget")} busy={busy} onClose={() => setDialog(undefined)} onConfirm={() => void applyDialog()}><p>{t("reshelveConfirm")}</p></ActionDialog>}
  </View>;
}
