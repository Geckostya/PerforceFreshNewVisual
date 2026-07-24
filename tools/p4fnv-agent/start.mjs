import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolRoot, "../..");
const entryPoint = join(toolRoot, "dist", "server.js");
const sourceRoot = join(toolRoot, "src");
const typescript = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const configuration = join(toolRoot, "tsconfig.json");

if (!exists(typescript)) fail("P4FNV agent MCP: dependencies are missing. Run npm ci from the repository root.");

const needsBuild = !exists(entryPoint) || newestTypeScriptSource(sourceRoot) > statSync(entryPoint).mtimeMs;
if (needsBuild) {
  const build = spawnSync(process.execPath, [typescript, "-p", configuration], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (build.stdout) process.stderr.write(build.stdout);
  if (build.stderr) process.stderr.write(build.stderr);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

process.chdir(repositoryRoot);
await import(pathToFileURL(entryPoint).href);

function newestTypeScriptSource(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestTypeScriptSource(path) : entry.name.endsWith(".ts") ? statSync(path).mtimeMs : 0);
  }
  return newest;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
