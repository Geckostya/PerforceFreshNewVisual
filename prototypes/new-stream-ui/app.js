const state = {
  name: "ui-refresh",
  type: "development",
  parent: "//FNV/main",
  description: "Обновление интерфейса Streams",
  step: 1,
};

const typeFlow = {
  development: "В обе стороны",
  release: "В основном к родителю",
  virtual: "Зависит от Paths",
  task: "Изолированная задача",
};

function normalizedName(value) {
  return value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "new-stream";
}

function streamPath() {
  const depot = state.parent.split("/").slice(0, 3).join("/") || "//FNV";
  return `${depot}/${normalizedName(state.name)}`;
}

function updateOutputs() {
  document.querySelectorAll('[data-output="name"]').forEach((node) => { node.textContent = normalizedName(state.name); });
  document.querySelectorAll('[data-output="path"]').forEach((node) => { node.textContent = streamPath(); });
  document.querySelectorAll('[data-output="type"]').forEach((node) => { node.textContent = state.type; });
  document.querySelectorAll('[data-output="parent"]').forEach((node) => { node.textContent = state.parent; });
  document.querySelectorAll('[data-output="flow"]').forEach((node) => { node.textContent = typeFlow[state.type]; });
  document.querySelectorAll("[data-type-dot]").forEach((node) => {
    node.className = `stream-type-dot ${state.type}`;
  });
  document.querySelectorAll('[data-field="name"]').forEach((input) => {
    if (input !== document.activeElement) input.value = state.name;
  });
  document.querySelectorAll('[data-field="type"]').forEach((input) => { input.value = state.type; });
  document.querySelectorAll('[data-field="parent"]').forEach((input) => { input.value = state.parent; });
  document.querySelectorAll('[data-field="description"]').forEach((input) => {
    if (input !== document.activeElement) input.value = state.description;
  });
  document.querySelectorAll("[data-type]").forEach((button) => {
    const selected = button.dataset.type === state.type;
    button.classList.toggle("selected", selected);
    const label = button.querySelector("i");
    if (label) label.textContent = selected ? "Выбрано" : "Выбрать";
  });
  document.querySelectorAll("[data-parent]").forEach((button) => {
    const selected = button.dataset.parent === state.parent;
    button.classList.toggle("selected-parent", selected);
    let badge = button.querySelector("em");
    if (selected && !badge) {
      badge = document.createElement("em");
      button.append(badge);
    }
    if (badge) badge.textContent = selected ? "Выбран" : "";
  });
}

document.querySelectorAll(".concept-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".concept-tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-selected", String(item === tab));
    });
    document.querySelectorAll(".concept-panel").forEach((panel) => {
      const active = panel.id === `concept-${tab.dataset.concept}`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    updateOutputs();
  });
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  state[input.dataset.field] = input.value;
  updateOutputs();
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  state[input.dataset.field] = input.value;
  updateOutputs();
});

document.querySelectorAll("[data-type]").forEach((button) => {
  button.addEventListener("click", () => {
    state.type = button.dataset.type;
    updateOutputs();
  });
});

document.querySelectorAll("[data-parent]").forEach((button) => {
  button.addEventListener("click", () => {
    state.parent = button.dataset.parent;
    updateOutputs();
  });
});

function showWizardStep(step) {
  state.step = Math.max(1, Math.min(3, step));
  document.querySelectorAll(".wizard-step").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.step) === state.step);
  });
  document.querySelectorAll(".wizard-page").forEach((page) => {
    const active = Number(page.dataset.page) === state.step;
    page.hidden = !active;
    page.classList.toggle("active", active);
  });
  document.querySelector("#wizard-back").disabled = state.step === 1;
  document.querySelector("#current-step").textContent = state.step;
  document.querySelector("#wizard-next").textContent = state.step === 3 ? "Проверить и создать" : "Продолжить";
  updateOutputs();
}

document.querySelectorAll(".wizard-step").forEach((button) => button.addEventListener("click", () => showWizardStep(Number(button.dataset.step))));
document.querySelector("#wizard-back").addEventListener("click", () => showWizardStep(state.step - 1));
document.querySelector("#wizard-next").addEventListener("click", () => {
  if (state.step < 3) showWizardStep(state.step + 1);
  else openPreview();
});

const previewOverlay = document.querySelector("#preview-overlay");
function openPreview() {
  updateOutputs();
  previewOverlay.hidden = false;
  document.querySelector("#preview-close").focus();
}
function closePreview() { previewOverlay.hidden = true; }
document.querySelectorAll(".preview-trigger").forEach((button) => button.addEventListener("click", openPreview));
document.querySelector("#preview-close").addEventListener("click", closePreview);
document.querySelector("#preview-cancel").addEventListener("click", closePreview);
previewOverlay.addEventListener("click", (event) => { if (event.target === previewOverlay) closePreview(); });

const toast = document.querySelector("#toast");
document.querySelector("#fake-create").addEventListener("click", () => {
  closePreview();
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 4200);
});
toast.querySelector("button").addEventListener("click", () => { toast.hidden = true; });

document.querySelector("#theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
});

document.querySelectorAll(".add-rule, .add-path").forEach((button) => {
  button.addEventListener("click", () => {
    toast.querySelector("strong").textContent = "Добавлено демонстрационное правило";
    toast.querySelector("small").textContent = "В прототипе список остаётся неизменным.";
    toast.hidden = false;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewOverlay.hidden) closePreview();
  if (["ArrowLeft", "ArrowRight"].includes(event.key) && document.activeElement?.classList.contains("concept-tab")) {
    const tabs = [...document.querySelectorAll(".concept-tab")];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (tabs.indexOf(document.activeElement) + direction + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex].click();
    tabs[nextIndex].focus();
  }
});

updateOutputs();
