import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  P4FnvAgentSession,
  snapshotForTool,
  type BuildMode,
  type UiCommandInput,
} from "./session.js";

const session = new P4FnvAgentSession();
const server = new McpServer(
  { name: "p4fnv-agent", version: "0.1.0" },
  {
    instructions: [
      "Use app_start before UI tools and app_stop when verification is complete. Windows native verification currently requires visible: true.",
      "Read ui_snapshot before every action and pass its stateVersion to reject stale locators.",
      "ui_click and ui_input drive the real React UI; never bypass previews or confirmation dialogs.",
      "The server never exposes arbitrary shell, JavaScript, filesystem, Tauri invoke, or p4 commands.",
    ].join(" "),
  },
);

server.registerTool(
  "app_start",
  {
    title: "Start P4FNV agent session",
    description: "Build when needed and start the native P4FNV release with an opt-in UI automation bridge.",
    inputSchema: {
      visible: z.boolean().default(true).describe("Must remain true on Windows because WebView2 suspends hidden/background windows."),
      build: z.enum(["if-needed", "always", "never"]).default("if-needed"),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ visible, build, timeoutMs }) => toolResult(await session.start({ visible, build: build as BuildMode, timeoutMs })),
);

server.registerTool(
  "app_stop",
  {
    title: "Stop P4FNV agent session",
    description: "Stop only the P4FNV process launched by this MCP session and remove its temporary bridge files.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => toolResult(await session.stop()),
);

server.registerTool(
  "app_status",
  {
    title: "Inspect P4FNV agent session",
    description: "Return process and latest snapshot status without changing the application.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => toolResult(await session.status()),
);

server.registerTool(
  "ui_snapshot",
  {
    title: "Read P4FNV UI",
    description: "Read structured interactive elements from the real native WebView. HTML is omitted by default to keep results compact.",
    inputSchema: { includeHtml: z.boolean().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ includeHtml }) => toolResult(snapshotForTool(await session.readSnapshot(), includeHtml)),
);

server.registerTool(
  "ui_click",
  {
    title: "Click P4FNV control",
    description: "Click a current snapshot locator through HTMLElement.click(), exercising the existing React onClick route.",
    inputSchema: {
      target: z.string().min(1).max(256),
      expectedStateVersion: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().min(50).max(120_000).default(10_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ target, expectedStateVersion, timeoutMs }) => commandResult({
    method: "ui.click",
    target,
    expectedStateVersion,
  }, timeoutMs),
);

server.registerTool(
  "ui_input",
  {
    title: "Enter P4FNV form value",
    description: "Set a text input, textarea, or select through its native setter and dispatch real input/change events.",
    inputSchema: {
      target: z.string().min(1).max(256),
      value: z.string().max(64 * 1024),
      expectedStateVersion: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().min(50).max(120_000).default(10_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ target, value, expectedStateVersion, timeoutMs }) => commandResult({
    method: "ui.input",
    target,
    value,
    expectedStateVersion,
  }, timeoutMs),
);

server.registerTool(
  "ui_focus",
  {
    title: "Focus P4FNV control",
    description: "Focus a current interactive locator in the native WebView.",
    inputSchema: {
      target: z.string().min(1).max(256),
      expectedStateVersion: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().min(50).max(120_000).default(10_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ target, expectedStateVersion, timeoutMs }) => commandResult({
    method: "ui.focus",
    target,
    expectedStateVersion,
  }, timeoutMs),
);

server.registerTool(
  "ui_key",
  {
    title: "Send key to P4FNV control",
    description: "Focus a current locator and dispatch keydown/keyup through the native WebView.",
    inputSchema: {
      target: z.string().min(1).max(256),
      key: z.string().min(1).max(64),
      ctrlKey: z.boolean().default(false),
      shiftKey: z.boolean().default(false),
      altKey: z.boolean().default(false),
      metaKey: z.boolean().default(false),
      expectedStateVersion: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().min(50).max(120_000).default(10_000),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ target, key, ctrlKey, shiftKey, altKey, metaKey, expectedStateVersion, timeoutMs }) => commandResult({
    method: "ui.key",
    target,
    key,
    ctrlKey,
    shiftKey,
    altKey,
    metaKey,
    expectedStateVersion,
  }, timeoutMs),
);

server.registerTool(
  "ui_wait",
  {
    title: "Wait for P4FNV UI state",
    description: "Wait until the native UI is stable and optionally contains text, a locator, or a minimum state version.",
    inputSchema: {
      timeoutMs: z.number().int().min(50).max(120_000).default(10_000),
      settleMs: z.number().int().min(0).max(5_000).default(200),
      minimumStateVersion: z.number().int().nonnegative().optional(),
      containsText: z.string().max(1_000).optional(),
      target: z.string().min(1).max(256).optional(),
      screen: z.string().min(1).max(64).optional(),
      settled: z.boolean().default(true),
      includeHtml: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ includeHtml, ...wait }) => toolResult(snapshotForTool(await session.waitForSnapshot(wait), includeHtml)),
);

async function commandResult(input: UiCommandInput, timeoutMs: number) {
  const result = await session.sendCommand(input, timeoutMs);
  return toolResult({ response: result.response, snapshot: snapshotForTool(result.snapshot) }, !result.response.ok);
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, undefined, 2) }],
    isError,
  };
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await session.stop();
    await server.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.stdin.once("end", () => void shutdown());

const transport = new StdioServerTransport();
await server.connect(transport);
