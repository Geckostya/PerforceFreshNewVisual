import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UiAgentResponse, UiElementSnapshot, UiSnapshot } from "./session.js";

interface ToolContent {
  type: string;
  text?: string;
}

interface ToolCallResult {
  content?: ToolContent[];
  isError?: boolean;
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(toolRoot, "../..");
const launcher = resolve(toolRoot, "start.mjs");
const client = new Client({ name: "p4fnv-native-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher],
  cwd: repositoryRoot,
  stderr: "inherit",
});

let connected = false;
let started = false;
try {
  await client.connect(transport);
  connected = true;
  const startResult = await client.callTool({
    name: "app_start",
    arguments: { visible: true, build: "always", timeoutMs: 30_000 },
  }, undefined, { timeout: 20 * 60_000 });
  started = true;
  parseToolResult(startResult);

  const snapshot = parseToolResult<UiSnapshot>(await client.callTool({
    name: "ui_snapshot",
    arguments: { includeHtml: false },
  }));
  const target = safeFocusTarget(snapshot.elements);
  const action = parseToolResult<{ response: UiAgentResponse; snapshot: UiSnapshot }>(await client.callTool({
    name: "ui_focus",
    arguments: {
      target: target.locator,
      expectedStateVersion: snapshot.stateVersion,
      timeoutMs: 10_000,
    },
  }));
  if (!action.response.ok || action.response.afterStateVersion <= snapshot.stateVersion) {
    throw new Error("The native UI action did not advance stateVersion.");
  }

  const settled = parseToolResult<UiSnapshot>(await client.callTool({
    name: "ui_wait",
    arguments: {
      minimumStateVersion: action.response.afterStateVersion,
      target: target.locator,
      settled: true,
      timeoutMs: 10_000,
    },
  }));
  process.stdout.write(`P4FNV native MCP smoke passed: screen=${settled.screen ?? "unknown"}, stateVersion=${settled.stateVersion}, target=${target.locator}\n`);
} finally {
  if (connected && started) {
    try {
      parseToolResult(await client.callTool({ name: "app_stop", arguments: {} }));
    } catch (error) {
      process.stderr.write(`P4FNV native MCP smoke cleanup failed: ${String(error)}\n`);
    }
  }
  if (connected) await client.close();
}

function parseToolResult<T>(result: unknown): T {
  const toolResult = result as ToolCallResult;
  const text = toolResult.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("P4FNV agent returned no JSON tool result.");
  if (toolResult.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

function safeFocusTarget(elements: UiElementSnapshot[]): UiElementSnapshot {
  const target = elements.find((element) => !element.disabled && !element.hidden);
  if (!target) throw new Error("The native UI snapshot contains no safe focus target.");
  return target;
}
