const areas = [
  {
    id: "connection", short: "Подключение", icon: "CN", title: "Подключение и workspaces",
    description: "Базовые сценарии работают; нужны современные auth, capabilities и точный mapping.",
    items: [
      ["done", "P0", "Поиск p4 и отображение версии", "Явный путь или PATH."],
      ["done", "P0", "Проверка подключения и понятные классы ошибок", "CLI, сеть, auth, trust и permissions."],
      ["done", "P0", "Недавние и избранные профили без секретов", "Восстановление последнего валидного workspace."],
      ["done", "P0", "Password login, статус, продление и logout", "С безопасным stdin и подтверждением."],
      ["done", "P0", "Полный базовый цикл client specs", "Список, открытие, switch, create, edit, rename, delete."],
      ["done", "P0", "Trust list и информация о сервере/client", "Безопасный режим только для чтения."],
      ["partial", "P1", "Переключение стрима со стратегиями контента", "Нет зафиксированной проверки на disposable server."],
      ["planned", "P0", "Подтверждение нового SSL fingerprint", "Показ полного fingerprint до явного p4 trust."],
      ["planned", "P0", "MFA/login2 и SSO/P4 Authentication Service", "Без логирования стадий, URL и токенов."],
      ["planned", "P0", "Снимок capabilities сервера", "Версии, help, topology, Unicode, case mode и flags."],
      ["partial", "P0", "Расширенная проверка client spec", "AltRoots, options, ChangeView, type и server binding."],
      ["planned", "P0", "Навигация Depot ↔ client ↔ local через where", "Без выдуманного пути для unmapped depot file."],
      ["planned", "P0", "Безопасный визуальный mapping editor", "Include, exclude, overlay и ditto."],
      ["planned", "P0", "Server-backed поиск workspaces", "За пределами текущего лимита списка."],
      ["planned", "P1", "Проверка switch во всех рабочих состояниях", "Opened, offline, shelved и активные операции."],
      ["planned", "P2", "Unload/reload и advanced workspace handoff", "Только с preflight по permissions и topology."]
    ]
  },
  {
    id: "changes", short: "Изменения", icon: "CH", title: "Changes, shelves, submit и resolve",
    description: "Сильный основной поток; главные пробелы — полный resolve и восстановление submit.",
    items: [
      ["done", "P0", "Default и numbered changelists", "Local/shelf секции, фильтр, multi-select, context menu и DnD."],
      ["done", "P0", "Создание и управление changelist", "Create/edit/delete empty changes и batch move."],
      ["done", "P0", "Полный базовый shelf workflow", "Shelve, unshelve, delete, reshelve и export одного файла."],
      ["done", "P0", "Безопасный revert", "Selected, unchanged или весь changelist из server preview."],
      ["done", "P0", "Submit local, shelf или вместе", "С recovery и компенсацией."],
      ["done", "P0", "Расширенный submit preflight", "Missing, unresolved, outdated, locks, jobs, stream spec и warnings."],
      ["done", "P0", "Submitted history и безопасные действия", "Фильтры, детали, retrieval, undo и foreign-stream cherry-pick."],
      ["partial", "P0", "Базовый resolve", "Preview, keep workspace, use server, auto-safe и auto-merge."],
      ["planned", "P0", "Трёхсторонний текстовый resolve editor", "Base/source/workspace/result, конфликты, save и read-back."],
      ["planned", "P0", "Специализированные resolve workflows", "Binary, move/name, filetype/attributes и stream spec."],
      ["planned", "P0", "Честный статус после обрыва submit", "Submitted, pending или unknown с recovery action."],
      ["planned", "P0", "Shelf-preserving submit через общий protocol", "Те же гарантии, что у local submit."],
      ["planned", "P0", "Единый partial result сложных мутаций", "Succeeded, failed, skipped и compensation."],
      ["planned", "P0", "Диагностика server triggers", "Без подмены server validation клиентским preflight."],
      ["planned", "P1", "Расширенный shelf workflow", "Conflict taxonomy, batch export, native picker и topology."],
      ["planned", "P1", "Смена owner/workspace и типа change", "С preflight по shelf, jobs и topology."],
      ["planned", "P2", "Shelved stream specs и P4 Code Review", "Только при поддержке сервера или интеграции."]
    ]
  },
  {
    id: "files", short: "Файлы", icon: "FL", title: "Files, Depot, sync и history",
    description: "Широкий рабочий набор; остаются edge cases mapping, масштаб и content tools.",
    items: [
      ["done", "P0", "Lazy Local Files и локальный cache", "Memory/IndexedDB, scoped status, ignored/local-only и refresh."],
      ["done", "P0", "Единый Local/Depot resource layout", "Search, tree/list, inspector, multi-select и bounded history."],
      ["done", "P0", "Реальный Depot browser", "Roots, types, metadata, lazy children, deleted toggle и preview."],
      ["done", "P0", "Жизненный цикл файла и reconcile", "Edit/add/delete/move/lock/unlock/revert и preview/apply."],
      ["done", "P0", "Общий Safe Sync", "Progress, cancel, writable decisions и bounded recovery."],
      ["done", "P0", "История, diff, annotate и undo", "Lazy details, revision preview/export/compare и apply."],
      ["planned", "P0", "Полная классификация перед file mutation", "Mapping, P4IGNORE, moves, case rename, collisions и locks."],
      ["planned", "P0", "Строгий reconcile", "Единые группы и отклонение каждого stale preview."],
      ["planned", "P0", "Mapping navigation и pagination в Depot", "Partial state для permission и maxresults."],
      ["planned", "P0", "Получение по дате и гибкий target", "Changelist/revision без второго sync implementation."],
      ["planned", "P0", "Server-side history filters и cursors", "Без скрытого глобального сканирования."],
      ["planned", "P0", "Сравнение folder/changelist states", "Added, changed, deleted и type-changed sets."],
      ["planned", "P0", "Точное следование rename/integration records", "Без эвристических path joins."],
      ["planned", "P0", "Измерение и оптимизация больших списков", "Virtualization только после incremental loading."],
      ["planned", "P1", "Большие текстовые файлы", "Chunk/stream и понятный bounded fallback."],
      ["planned", "P1", "Rich content preview", "Syntax/word highlight и image/binary metadata."],
      ["planned", "P1", "Внешние editor/diff/merge tools", "Без shell, с явным управлением temp files."],
      ["planned", "P1", "Revision Graph из данных сервера", "Только filelog/integration records, без выдуманных edges."]
    ]
  },
  {
    id: "streams", short: "Стримы", icon: "ST", title: "Streams и collaboration",
    description: "Обзор и switch уже полезны; integration и advanced collaboration остаются P1.",
    items: [
      ["partial", "P1", "Stream catalog, tree и graph", "Есть hierarchy/filter/selection; details/spec/history неполны."],
      ["partial", "P1", "Подтверждённый stream/workspace switch", "Нет live coverage standard и commit-edge."],
      ["done", "P1", "Базовый lock/unlock", "Для выбранных opened files."],
      ["partial", "P1", "Shared Shelves", "Browse/inspect/unshelve/reshelve/export; нет advanced topology."],
      ["done", "P1", "Foreign-stream cherry-pick", "Exact preview в текущий stream без auto resolve/submit."],
      ["partial", "P1", "Jobs", "Search, fixes, attach/detach и filters; нет create/edit/status."],
      ["partial", "P1", "Labels", "Search, files и Safe Sync; нет CRUD/tag."],
      ["planned", "P1", "Полные stream specs и hints", "History, workspaces, Paths/Remapped/Ignored, istat/interchanges."],
      ["planned", "P1", "Merge down и copy up", "Явные source/target и выбранный target changelist."],
      ["planned", "P1", "Integration → Resolve → Review → Submit", "Без автоматического submit."],
      ["planned", "P1", "Сложные integration cases", "Partial revisions, moves, filetype и stream-spec conflicts."],
      ["planned", "P1", "Точная модель locks", "Explicit, exclusive-filetype, local и global по topology."],
      ["planned", "P1", "Create/edit Jobs из custom jobspec", "И server-defined post-submit status."],
      ["planned", "P1", "CRUD Labels и безопасный tag/untag", "С обязательным preview."],
      ["planned", "P2", "Promoted shelves и commit-edge actions", "Только по конкретной потребности."],
      ["planned", "P2", "Classic branch maps и integration ranges", "Только по конкретной потребности."],
      ["planned", "P2", "P4 Code Review integration", "Только с настроенным endpoint."],
      ["planned", "P2", "Graph/hybrid depot и DVCS/remotes", "Как явные product modes."],
      ["planned", "P2", "Spec/archive/unload depots и P4 Search", "Как явные product modes."]
    ]
  },
  {
    id: "operations", short: "Система", icon: "UX", title: "Operations, errors, settings и accessibility",
    description: "Фундамент есть; нужны единое покрытие операций, stale mode, preferences и проверка accessibility.",
    items: [
      ["partial", "P0", "Operations Center", "Sync/local submit, progress, bounded history, cancel и retry sync."],
      ["partial", "P0", "Классификация core errors", "Conflict, offline, cancelled, stale и partial с подсказками."],
      ["done", "P0", "Сессионная CLI-диагностика", "Bounded warnings и errors."],
      ["partial", "P0", "Навигация и keyboard productivity", "Go To, palette, shortcuts, multi-select и context menus."],
      ["done", "P0", "Полные English/Russian packs", "Включая complete external JSON packs."],
      ["partial", "P0", "Semantic и keyboard-usable core controls", "Нет полной pane/screen-reader/scale verification."],
      ["planned", "P0", "Все долгие мутации через общий protocol", "Event/cancel/read-back без auto-retry unknown mutation."],
      ["planned", "P0", "Стандартный partial-result UI", "Succeeded/failed/skipped, compensation и recovery."],
      ["planned", "P0", "Read-only stale/offline snapshot", "Mutation disabled с причиной до controlled refresh."],
      ["planned", "P0", "Точные типы инфраструктурных ошибок", "Timeout, unsupported, limit, invalid output и connection."],
      ["planned", "P0", "Полная keyboard-навигация", "Panes, focus restoration, announcements и shortcut help."],
      ["planned", "P0", "Проверка RU/EN, масштаба и Narrator", "100%, 125%, 200% и minimum window."],
      ["planned", "P0", "Стабильный selection/scroll/focus", "При incremental loading и refresh больших списков."],
      ["planned", "P1", "Постоянные UI/preferences settings", "Appearance, panes, columns, diff, tools, shortcuts и privacy."],
      ["planned", "P1", "Расширенная command navigation", "Actions и stream/user/entity targets без global query."],
      ["planned", "P1", "Saved filters и recent destinations", "Отдельно для server/workspace."]
    ]
  }
];

const statusMeta = {
  done: { mark: "✓", label: "Готово" },
  partial: { mark: "~", label: "Частично" },
  planned: { mark: "—", label: "Ещё нет" }
};

const state = { status: "all", priority: "all", area: "all", query: "" };
const allItems = areas.flatMap(area => area.items.map(item => ({ area, status: item[0], priority: item[1], title: item[2], detail: item[3] })));

const normalize = value => value.toLocaleLowerCase("ru-RU");
const count = status => allItems.filter(item => item.status === status).length;
const doneCount = count("done");
const completion = Math.round(doneCount / allItems.length * 100);

document.querySelector("#total-count").textContent = allItems.length;
document.querySelector("#done-count").textContent = doneCount;
document.querySelector("#partial-count").textContent = count("partial");
document.querySelector("#planned-count").textContent = count("planned");
document.querySelector("#progress-value").textContent = `${completion}%`;
document.querySelector("#progress-ring").style.setProperty("--progress", `${completion * 3.6}deg`);

const tabs = document.querySelector("#area-tabs");
tabs.innerHTML = [
  `<button class="area-tab active" type="button" role="tab" data-area="all"><strong>Все области</strong><small>${allItems.length} пунктов</small></button>`,
  ...areas.map(area => `<button class="area-tab" type="button" role="tab" data-area="${area.id}"><strong>${area.short}</strong><small>${area.items.length} пунктов</small></button>`)
].join("");

function matches(item) {
  const haystack = normalize(`${item.title} ${item.detail} ${item.area.title}`);
  return (state.status === "all" || item.status === state.status)
    && (state.priority === "all" || item.priority === state.priority)
    && (state.area === "all" || item.area.id === state.area)
    && (!state.query || haystack.includes(normalize(state.query)));
}

function render() {
  const matched = allItems.filter(matches);
  const visibleAreas = areas.filter(area => state.area === "all" || state.area === area.id);
  const cards = visibleAreas.map(area => {
    const items = matched.filter(item => item.area.id === area.id);
    if (!items.length) return "";
    const areaDone = area.items.filter(item => item[0] === "done").length;
    const score = Math.round(areaDone / area.items.length * 100);
    const rows = items.map(item => `<div class="feature-row" data-status="${item.status}">
      <span class="status-mark" title="${statusMeta[item.status].label}">${statusMeta[item.status].mark}</span>
      <span class="priority-tag">${item.priority}</span>
      <span class="feature-copy"><strong>${item.title}</strong><small>${item.detail}</small></span>
    </div>`).join("");
    return `<article class="area-card open" data-card="${area.id}">
      <button class="area-header" type="button" aria-expanded="true">
        <span class="area-icon">${area.icon}</span>
        <span class="area-title"><strong>${area.title}</strong><small>${area.description}</small></span>
        <span class="area-score"><span class="mini-bar"><i style="width:${score}%"></i></span><span>${areaDone}/${area.items.length}</span><b class="chevron">⌃</b></span>
      </button>
      <div class="feature-list">${rows}</div>
    </article>`;
  }).join("");

  document.querySelector("#area-list").innerHTML = cards;
  document.querySelector("#empty-state").hidden = matched.length > 0;
  document.querySelector("#result-label").textContent = matched.length === allItems.length
    ? `Показаны все ${allItems.length} пунктов`
    : `Найдено: ${matched.length} из ${allItems.length}`;

  document.querySelectorAll(".area-header").forEach(button => button.addEventListener("click", () => {
    const card = button.closest(".area-card");
    const open = card.classList.toggle("open");
    card.querySelector(".feature-list").hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }));
}

function setFilter(group, value) {
  state[group] = value;
  document.querySelectorAll(`[data-filter="${group}"]`).forEach(button => button.classList.toggle("active", button.dataset.value === value));
  render();
}

document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => setFilter(button.dataset.filter, button.dataset.value)));
document.querySelector("#search").addEventListener("input", event => { state.query = event.target.value.trim(); render(); });
document.querySelectorAll(".area-tab").forEach(button => button.addEventListener("click", () => {
  state.area = button.dataset.area;
  document.querySelectorAll(".area-tab").forEach(tab => tab.classList.toggle("active", tab === button));
  render();
}));
document.querySelectorAll("[data-quick-status]").forEach(button => button.addEventListener("click", () => {
  setFilter("status", button.dataset.quickStatus);
  document.querySelector("#checklist").scrollIntoView({ behavior: "smooth" });
}));
document.querySelector("#reset-filters").addEventListener("click", () => {
  state.status = "all"; state.priority = "all"; state.area = "all"; state.query = "";
  document.querySelector("#search").value = "";
  document.querySelectorAll("[data-filter]").forEach(button => button.classList.toggle("active", button.dataset.value === "all"));
  document.querySelectorAll(".area-tab").forEach(button => button.classList.toggle("active", button.dataset.area === "all"));
  render();
});

const storedTheme = localStorage.getItem("p4fnv-checklist-theme");
if (storedTheme) document.documentElement.dataset.theme = storedTheme;
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("p4fnv-checklist-theme", next);
});

render();
