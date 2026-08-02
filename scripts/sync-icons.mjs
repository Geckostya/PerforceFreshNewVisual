import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "assets/app-icon.svg");
const outputPath = resolve(repositoryRoot, "src-tauri/icons");
const stampPath = resolve(outputPath, ".app-icon.sha256");
const requiredIcons = ["icon.ico", "icon.icns", "icon.png", "32x32.png"];
const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");

const stampMatches =
  existsSync(stampPath) && readFileSync(stampPath, "utf8").trim() === sourceHash;
const outputsExist = requiredIcons.every((icon) => existsSync(resolve(outputPath, icon)));

if (stampMatches && outputsExist) {
  console.log("Application icons are up to date.");
  process.exit(0);
}

const tauriCli = resolve(repositoryRoot, "node_modules/@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [tauriCli, "icon", sourcePath, "--output", outputPath], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(stampPath, `${sourceHash}\n`, "utf8");
