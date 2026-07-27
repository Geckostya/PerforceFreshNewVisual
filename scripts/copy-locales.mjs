import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "locales");
const destination = join(root, "src-tauri", "target", "release", "locales");

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
copyFileSync(join(root, "THIRD_PARTY_NOTICES.md"), join(root, "src-tauri", "target", "release", "THIRD_PARTY_NOTICES.md"));
console.log(`Language packs copied to ${destination}`);
