import {
  readUiAgentCommand,
  uiSnapshotEnabled,
  writeUiAgentResponse,
  writeUiSnapshot,
} from "./api";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  UiAgentCommand,
  UiAgentResponse,
  UiControlSnapshot,
  UiElementSnapshot,
  UiSnapshot,
} from "./models";

const controlSelector = "input, select, textarea";
const interactiveSelector = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "[data-agent-id]",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='tab']",
  "[role='treeitem']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
const publishDelayMs = 100;
const pollDelayMs = 50;

let snapshotObserver: MutationObserver | undefined;
let publishTimer: number | undefined;
let stateVersion = 0;
let publishedStateVersion = -1;
let snapshotPublishing = false;

export async function startUiSnapshotBridge(): Promise<void> {
  const snapshotEnabled = await uiSnapshotEnabled();
  if (!snapshotEnabled) return;
  startSnapshotPublisher();
  void pollAgentCommands();
}

function startSnapshotPublisher(): void {
  const changed = () => markStateChanged();
  snapshotObserver?.disconnect();
  snapshotObserver = new MutationObserver(changed);
  snapshotObserver.observe(document.body, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  document.addEventListener("input", changed, true);
  document.addEventListener("change", changed, true);
  window.addEventListener("resize", changed);
  markStateChanged();
}

function markStateChanged(): void {
  stateVersion += 1;
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => void publishSnapshot(), publishDelayMs);
}

async function publishSnapshot(): Promise<void> {
  if (snapshotPublishing) {
    markStateChanged();
    return;
  }
  snapshotPublishing = true;
  const version = stateVersion;
  try {
    await writeUiSnapshot(createUiSnapshot(version));
    publishedStateVersion = version;
  } catch (error) {
    console.error(error);
  } finally {
    snapshotPublishing = false;
    if (stateVersion !== version) {
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => void publishSnapshot(), publishDelayMs);
    }
  }
}

export function createUiSnapshot(version = stateVersion): UiSnapshot {
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll("input").forEach((input) => input.removeAttribute("value"));
  body.querySelectorAll("textarea").forEach((textarea) => { textarea.textContent = ""; });
  const interactiveElements = findInteractiveElements();
  const elements = interactiveElements.map(elementSnapshot);
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(controlSelector)]
    .map(controlSnapshot);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const busy = elements.some((element) => element.busy === true);
  return {
    schemaVersion: 2,
    stateVersion: version,
    generatedAt: new Date().toISOString(),
    screen: document.querySelector<HTMLElement>("[data-agent-screen]")?.dataset.agentScreen,
    location: window.location.href,
    title: document.title,
    activeElement: active && interactiveElements.includes(active)
      ? locatorFor(active, interactiveElements.indexOf(active))
      : undefined,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    settled: !busy && version === stateVersion,
    busy,
    controls,
    elements,
    html: body.outerHTML,
  };
}

function controlSnapshot(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  index: number,
): UiControlSnapshot {
  const input = control instanceof HTMLInputElement ? control : undefined;
  return {
    index,
    tag: control.tagName.toLowerCase(),
    type: input?.type,
    id: control.id || undefined,
    name: control.getAttribute("name") || undefined,
    ariaLabel: control.getAttribute("aria-label") || undefined,
    value: input?.type === "password" ? "[redacted]" : control.value,
    checked: input && ["checkbox", "radio"].includes(input.type) ? input.checked : undefined,
    disabled: control.disabled,
  };
}

function elementSnapshot(element: HTMLElement, index: number): UiElementSnapshot {
  const input = element instanceof HTMLInputElement ? element : undefined;
  const formControl = element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
  const ariaDisabled = element.getAttribute("aria-disabled") === "true";
  const nativeDisabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
  return {
    index,
    locator: locatorFor(element, index),
    agentId: element.dataset.agentId || undefined,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || undefined,
    type: input?.type,
    id: element.id || undefined,
    name: element.getAttribute("name") || undefined,
    accessibleName: accessibleName(element),
    text: normalizedText(element.textContent),
    value: formControl ? controlValue(element) : undefined,
    checked: input && ["checkbox", "radio"].includes(input.type) ? input.checked : ariaBoolean(element, "aria-checked"),
    disabled: nativeDisabled || ariaDisabled,
    selected: ariaBoolean(element, "aria-selected"),
    expanded: ariaBoolean(element, "aria-expanded"),
    busy: ariaBoolean(element, "aria-busy"),
    ignored: dataBoolean(element, "agentIgnored"),
    hidden: Boolean(element.hidden) || element.getAttribute("aria-hidden") === "true" || element.getClientRects().length === 0,
  };
}

function controlValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  return element instanceof HTMLInputElement && element.type === "password" ? "[redacted]" : element.value;
}

function ariaBoolean(element: HTMLElement, attribute: string): boolean | undefined {
  const value = element.getAttribute(attribute);
  return value === null ? undefined : value === "true";
}

function dataBoolean(element: HTMLElement, key: keyof DOMStringMap): boolean | undefined {
  const value = element.dataset[key];
  return value === undefined ? undefined : value === "true";
}

function accessibleName(element: HTMLElement): string | undefined {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(" ");
  const inputLabel = element.id
    ? [...document.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.htmlFor === element.id)?.textContent
    : undefined;
  return normalizedText(
    element.getAttribute("aria-label")
      || labelledText
      || inputLabel
      || element.getAttribute("title")
      || element.getAttribute("placeholder")
      || element.textContent,
  );
}

function normalizedText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 500);
}

function findInteractiveElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(interactiveSelector)];
}

function locatorFor(element: HTMLElement, index: number): string {
  if (element.dataset.agentId) return `agent:${element.dataset.agentId}`;
  if (element.id) return `id:${element.id}`;
  return `ui:${index}`;
}

async function pollAgentCommands(): Promise<void> {
  let lastRequestId: string | undefined;
  while (true) {
    try {
      const command = await readUiAgentCommand(lastRequestId);
      if (command) {
        lastRequestId = command.id;
        const response = await executeAgentCommand(command);
        await writeUiAgentResponse(response);
      }
    } catch (error) {
      console.error(error);
    }
    await delay(pollDelayMs);
  }
}

async function executeAgentCommand(command: UiAgentCommand): Promise<UiAgentResponse> {
  const beforeStateVersion = stateVersion;
  const response: UiAgentResponse = {
    id: command.id,
    token: command.token,
    ok: false,
    beforeStateVersion,
    afterStateVersion: stateVersion,
  };
  try {
    if (!isUiAgentCommand(command)) throw new Error("Invalid agent command.");
    if (command.expectedStateVersion !== stateVersion || publishedStateVersion !== stateVersion) {
      throw new Error(`Stale UI state: expected ${command.expectedStateVersion}, current ${stateVersion}.`);
    }
    if (command.method === "ui.resize") {
      if (!Number.isInteger(command.width) || !Number.isInteger(command.height)) throw new Error("ui.resize requires integer width and height.");
      const width = command.width!;
      const height = command.height!;
      await getCurrentWindow().setSize(new LogicalSize(width, height));
    } else {
      const element = resolveTarget(command.target);
      if (!element) throw new Error(`UI target not found: ${command.target}.`);
      if (isDisabled(element) && command.method !== "ui.focus") {
        throw new Error(`UI target is disabled: ${command.target}.`);
      }
      runAgentAction(element, command);
    }
    markStateChanged();
    response.ok = true;
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  response.afterStateVersion = stateVersion;
  return response;
}

export function isUiAgentCommand(value: unknown): value is UiAgentCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<UiAgentCommand>;
  return typeof command.id === "string"
    && typeof command.token === "string"
    && ["ui.click", "ui.input", "ui.key", "ui.focus", "ui.resize"].includes(command.method ?? "")
    && Number.isSafeInteger(command.expectedStateVersion)
    && typeof command.target === "string";
}

function resolveTarget(locator: string): HTMLElement | undefined {
  const elements = findInteractiveElements();
  if (locator.startsWith("agent:")) {
    const agentId = locator.slice("agent:".length);
    return elements.find((element) => element.dataset.agentId === agentId);
  }
  if (locator.startsWith("id:")) {
    const id = locator.slice("id:".length);
    return elements.find((element) => element.id === id);
  }
  const match = /^ui:(\d+)$/.exec(locator);
  return match ? elements[Number(match[1])] : undefined;
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && Boolean((element as HTMLButtonElement).disabled));
}

function runAgentAction(element: HTMLElement, command: UiAgentCommand): void {
  switch (command.method) {
    case "ui.click":
      element.focus({ preventScroll: true });
      element.click();
      return;
    case "ui.focus":
      element.focus({ preventScroll: true });
      return;
    case "ui.input":
      setControlValue(element, command.value ?? "");
      return;
    case "ui.key": {
      const key = command.key;
      if (!key) throw new Error("ui.key requires a key.");
      const init: KeyboardEventInit = {
        key,
        bubbles: true,
        cancelable: true,
        ctrlKey: command.ctrlKey,
        shiftKey: command.shiftKey,
        altKey: command.altKey,
        metaKey: command.metaKey,
      };
      element.focus({ preventScroll: true });
      element.dispatchEvent(new KeyboardEvent("keydown", init));
      element.dispatchEvent(new KeyboardEvent("keyup", init));
      return;
    }
  }
}

function setControlValue(element: HTMLElement, value: string): void {
  if (element instanceof HTMLSelectElement) {
    setNativeValue(element, value, HTMLSelectElement.prototype);
  } else if (element instanceof HTMLTextAreaElement) {
    setNativeValue(element, value, HTMLTextAreaElement.prototype);
  } else if (element instanceof HTMLInputElement && !["checkbox", "radio", "file"].includes(element.type)) {
    setNativeValue(element, value, HTMLInputElement.prototype);
  } else {
    throw new Error("ui.input target must be a text input, textarea, or select.");
  }
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function setNativeValue(element: HTMLElement, value: string, prototype: object): void {
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The control does not expose a value setter.");
  setter.call(element, value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
