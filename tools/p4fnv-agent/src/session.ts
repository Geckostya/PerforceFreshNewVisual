import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BuildMode = "if-needed" | "always" | "never";

export interface UiElementSnapshot {
  index: number;
  locator: string;
  agentId?: string;
  tag: string;
  role?: string;
  type?: string;
  id?: string;
  name?: string;
  accessibleName?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  disabled: boolean;
  selected?: boolean;
  expanded?: boolean;
  busy?: boolean;
  ignored?: boolean;
  hidden: boolean;
}

export interface UiSnapshot {
  schemaVersion: number;
  stateVersion: number;
  generatedAt: string;
  screen?: string;
  location: string;
  title: string;
  activeElement?: string;
  settled: boolean;
  busy: boolean;
  elements: UiElementSnapshot[];
  html: string;
}

export interface UiAgentResponse {
  id: string;
  ok: boolean;
  beforeStateVersion: number;
  afterStateVersion: number;
  error?: string;
}

export interface UiCommandInput {
  method: "ui.click" | "ui.input" | "ui.key" | "ui.focus";
  target: string;
  expectedStateVersion?: number;
  value?: string;
  key?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface SessionStatus {
  running: boolean;
  pid?: number;
  visible?: boolean;
  sessionDirectory?: string;
  executable?: string;
  exitCode?: number | null;
  stateVersion?: number;
  generatedAt?: string;
}

export interface SnapshotWait {
  timeoutMs?: number;
  settleMs?: number;
  minimumStateVersion?: number;
  containsText?: string;
  target?: string;
  screen?: string;
  excludedScreen?: string;
  settled?: boolean;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const releaseExecutable = join(repositoryRoot, "src-tauri", "target", "release", "p4fnv.exe");
const maxSnapshotBytes = 8 * 1024 * 1024;
const maxBuildOutputBytes = 2 * 1024 * 1024;

export class P4FnvAgentSession {
  private child: ChildProcess | undefined;
  private sessionDirectory: string | undefined;
  private snapshotPath: string | undefined;
  private commandPath: string | undefined;
  private responsePath: string | undefined;
  private token: string | undefined;
  private visible = false;
  private exitCode: number | null | undefined;
  private commandQueue: Promise<void> = Promise.resolve();

  async start(options: { visible?: boolean; build?: BuildMode; timeoutMs?: number } = {}): Promise<SessionStatus> {
    if (this.child && this.exitCode === undefined) return this.status();
    await this.stop();
    const visible = options.visible ?? true;
    if (!visible) {
      throw new Error("WebView2 suspends hidden/background windows on this host. Start the native verification window with visible: true.");
    }

    const build = options.build ?? "if-needed";
    if (build === "always" || (build === "if-needed" && await applicationBuildIsStale())) {
      await buildApplication();
    }
    if (!await fileExists(releaseExecutable)) {
      throw new Error(`P4FNV release executable is missing: ${releaseExecutable}.`);
    }

    this.sessionDirectory = await mkdtemp(join(tmpdir(), "p4fnv-agent-"));
    this.snapshotPath = join(this.sessionDirectory, "snapshot.json");
    this.commandPath = join(this.sessionDirectory, "command.json");
    this.responsePath = join(this.sessionDirectory, "response.json");
    this.token = randomUUID();
    this.visible = visible;
    this.exitCode = undefined;

    const child = spawn(releaseExecutable, [], {
      cwd: dirname(releaseExecutable),
      env: {
        ...process.env,
        P4FNV_UI_SNAPSHOT_PATH: this.snapshotPath,
        P4FNV_AGENT_COMMAND_PATH: this.commandPath,
        P4FNV_AGENT_RESPONSE_PATH: this.responsePath,
        P4FNV_AGENT_TOKEN: this.token,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
          process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ].filter(Boolean).join(" "),
      },
      stdio: "ignore",
      windowsHide: !this.visible,
    });
    this.child = child;
    child.once("exit", (code) => { this.exitCode = code; });
    child.once("error", () => { this.exitCode = -1; });

    try {
      await this.waitForSnapshot({
        timeoutMs: options.timeoutMs ?? 20_000,
        settleMs: 300,
        excludedScreen: "startup",
        settled: true,
      });
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.stop();
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`P4FNV agent session failed to start: ${message} Cleanup also failed: ${cleanupMessage}`);
      }
      throw new Error(`P4FNV agent session failed to start: ${message}`);
    }
  }

  async stop(): Promise<SessionStatus> {
    const child = this.child;
    if (child && this.exitCode === undefined) {
      child.kill();
      await Promise.race([
        new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
        delay(3_000),
      ]);
    }
    const status = await this.status();
    this.child = undefined;
    const directory = this.sessionDirectory;
    this.sessionDirectory = undefined;
    this.snapshotPath = undefined;
    this.commandPath = undefined;
    this.responsePath = undefined;
    this.token = undefined;
    if (directory) await removeSessionDirectory(directory);
    return { ...status, running: false };
  }

  async status(): Promise<SessionStatus> {
    let snapshot: UiSnapshot | undefined;
    try {
      snapshot = this.snapshotPath ? await this.readSnapshot() : undefined;
    } catch {
      snapshot = undefined;
    }
    return {
      running: Boolean(this.child && this.exitCode === undefined),
      pid: this.child?.pid,
      visible: this.child ? this.visible : undefined,
      sessionDirectory: this.sessionDirectory,
      executable: this.child ? releaseExecutable : undefined,
      exitCode: this.exitCode,
      stateVersion: snapshot?.stateVersion,
      generatedAt: snapshot?.generatedAt,
    };
  }

  async readSnapshot(): Promise<UiSnapshot> {
    this.assertRunning();
    const path = this.snapshotPath!;
    const metadata = await stat(path);
    if (metadata.size > maxSnapshotBytes) throw new Error("P4FNV UI snapshot exceeds 8 MiB.");
    const snapshot = JSON.parse(await readFile(path, "utf8")) as Partial<UiSnapshot>;
    if (snapshot.schemaVersion !== 2 || !Number.isSafeInteger(snapshot.stateVersion) || !Array.isArray(snapshot.elements)) {
      throw new Error("P4FNV returned an unsupported UI snapshot.");
    }
    return snapshot as UiSnapshot;
  }

  async sendCommand(input: UiCommandInput, timeoutMs = 10_000): Promise<{ response: UiAgentResponse; snapshot: UiSnapshot }> {
    return this.exclusive(async () => {
      this.assertRunning();
      const current = await this.readSnapshot();
      const id = randomUUID();
      const command = {
        id,
        token: this.token,
        method: input.method,
        expectedStateVersion: input.expectedStateVersion ?? current.stateVersion,
        target: input.target,
        value: input.value,
        key: input.key,
        ctrlKey: input.ctrlKey,
        shiftKey: input.shiftKey,
        altKey: input.altKey,
        metaKey: input.metaKey,
      };
      await writeJsonAtomic(this.commandPath!, command);
      const rawResponse = await waitForJson<UiAgentResponse & { token?: string }>(
        this.responsePath!,
        (candidate) => candidate.id === id,
        timeoutMs,
        () => this.assertRunning(),
      );
      const response: UiAgentResponse = {
        id: rawResponse.id,
        ok: rawResponse.ok,
        beforeStateVersion: rawResponse.beforeStateVersion,
        afterStateVersion: rawResponse.afterStateVersion,
        error: rawResponse.error,
      };
      const snapshot = response.ok
        ? await this.waitForSnapshot({
          timeoutMs,
          minimumStateVersion: response.afterStateVersion,
          settled: false,
        })
        : await this.readSnapshot();
      return { response, snapshot };
    });
  }

  async waitForSnapshot(options: SnapshotWait = {}): Promise<UiSnapshot> {
    const timeoutMs = bounded(options.timeoutMs ?? 10_000, 50, 120_000);
    const settleMs = bounded(options.settleMs ?? 200, 0, 5_000);
    const deadline = Date.now() + timeoutMs;
    let lastVersion = -1;
    let stableSince = Date.now();
    let lastError: unknown;
    while (Date.now() <= deadline) {
      this.assertRunning();
      try {
        const snapshot = await this.readSnapshot();
        if (snapshot.stateVersion !== lastVersion) {
          lastVersion = snapshot.stateVersion;
          stableSince = Date.now();
        }
        if (snapshotMatches(snapshot, options) && Date.now() - stableSince >= settleMs) return snapshot;
      } catch (error) {
        lastError = error;
      }
      await delay(50);
    }
    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
    throw new Error(`Timed out waiting for P4FNV UI state.${detail}`);
  }

  private assertRunning(): void {
    if (!this.child) throw new Error("P4FNV is not running. Call app_start first.");
    if (this.exitCode !== undefined) throw new Error(`P4FNV exited with code ${this.exitCode}.`);
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.commandQueue;
    let release: () => void = () => undefined;
    this.commandQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

export function snapshotMatches(snapshot: UiSnapshot, options: SnapshotWait): boolean {
  if (options.minimumStateVersion !== undefined && snapshot.stateVersion < options.minimumStateVersion) return false;
  if ((options.settled ?? true) && (!snapshot.settled || snapshot.busy)) return false;
  if (options.containsText) {
    const wanted = options.containsText.toLocaleLowerCase();
    const text = [snapshot.title, snapshot.html, ...snapshot.elements.flatMap((element) => [
      element.accessibleName ?? "",
      element.text ?? "",
      element.value === "[redacted]" ? "" : element.value ?? "",
    ])].join("\n").toLocaleLowerCase();
    if (!text.includes(wanted)) return false;
  }
  if (options.target && !snapshot.elements.some((element) => element.locator === options.target)) return false;
  if (options.screen && snapshot.screen !== options.screen) return false;
  if (options.excludedScreen && snapshot.screen === options.excludedScreen) return false;
  return true;
}

export function snapshotForTool(snapshot: UiSnapshot, includeHtml = false): Omit<UiSnapshot, "html"> & { html?: string } {
  const { html, ...summary } = snapshot;
  return includeHtml ? { ...summary, html } : summary;
}

async function applicationBuildIsStale(): Promise<boolean> {
  if (!await fileExists(releaseExecutable)) return true;
  const executableTime = (await stat(releaseExecutable)).mtimeMs;
  const roots = [
    "src",
    "src-tauri/src",
    "src-tauri/capabilities",
    "locales",
    "index.html",
    "src-tauri/build.rs",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "scripts/copy-locales.mjs",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    ".node-version",
    "rust-toolchain.toml",
  ];
  for (const root of roots) {
    const path = join(repositoryRoot, root);
    if (await newestModification(path) > executableTime) return true;
  }
  return false;
}

async function newestModification(path: string): Promise<number> {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) return metadata.mtimeMs;
  const { readdir } = await import("node:fs/promises");
  let newest = metadata.mtimeMs;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["target", "node_modules", "dist"].includes(entry.name)) continue;
    newest = Math.max(newest, await newestModification(join(path, entry.name)));
  }
  return newest;
}

async function buildApplication(): Promise<void> {
  const toolchainRoot = join(repositoryRoot, ".toolchain");
  const node = join(toolchainRoot, "node", "node.exe");
  const npm = join(toolchainRoot, "node", "node_modules", "npm", "bin", "npm-cli.js");
  if (!await fileExists(node) || !await fileExists(npm)) {
    throw new Error("P4FNV bundled Node/npm is missing. Run scripts/toolchain.ps1 and npm ci first.");
  }
  const environment = {
    ...process.env,
    CARGO_HOME: join(toolchainRoot, "cargo"),
    RUSTUP_HOME: join(toolchainRoot, "rustup"),
    npm_config_cache: join(toolchainRoot, "npm-cache"),
    PATH: [join(toolchainRoot, "node"), join(toolchainRoot, "cargo", "bin"), process.env.PATH ?? ""].join(";"),
  };
  const result = await runProcess(node, [npm, "run", "build:app"], environment, 15 * 60_000);
  if (result.code !== 0) throw new Error(`P4FNV build failed.\n${result.output}`);
}

async function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, windowsHide: true });
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < maxBuildOutputBytes) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("error", rejectProcess);
    const timer = setTimeout(() => {
      child.kill();
      rejectProcess(new Error(`Process timed out: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveProcess({ code, output: output.trim() });
    });
  });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, undefined, 2), "utf8");
  await rename(temporary, path);
}

async function waitForJson<T extends object>(
  path: string,
  matches: (value: T) => boolean,
  timeoutMs: number,
  assertRunning: () => void,
): Promise<T> {
  const deadline = Date.now() + bounded(timeoutMs, 50, 120_000);
  while (Date.now() <= deadline) {
    assertRunning();
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as T;
      if (matches(value)) return value;
    } catch (error) {
      if (!isMissingFile(error) && !(error instanceof SyntaxError)) throw error;
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for P4FNV agent response.");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function removeSessionDirectory(path: string): Promise<void> {
  const base = resolve(tmpdir());
  const target = resolve(path);
  if (relative(base, target).startsWith("..") || !target.startsWith(join(base, "p4fnv-agent-"))) {
    throw new Error(`Refusing to remove unexpected session directory: ${target}.`);
  }
  await rm(target, { recursive: true, force: true });
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
