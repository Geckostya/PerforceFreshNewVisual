import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../..");
const configurationPath = resolve(repositoryRoot, ".codex", "config.toml");

describe("project MCP configuration", () => {
  it("resolves its bundled Node, launcher, and working directory", () => {
    const configuration = readFileSync(configurationPath, "utf8");
    const command = requiredTomlString(configuration, "command");
    const cwd = requiredTomlString(configuration, "cwd");
    const launcher = /args\s*=\s*\[\s*'([^']+)'\s*]/.exec(configuration)?.[1];

    expect(launcher).toBeDefined();
    const workingDirectory = resolve(repositoryRoot, cwd);
    expect(workingDirectory).toBe(repositoryRoot);
    expect(existsSync(resolve(workingDirectory, command))).toBe(true);
    expect(existsSync(resolve(workingDirectory, launcher!))).toBe(true);
  });
});

function requiredTomlString(configuration: string, key: string): string {
  const value = new RegExp(`^${key}\\s*=\\s*'([^']+)'`, "m").exec(configuration)?.[1];
  if (!value) throw new Error(`Missing ${key} in .codex/config.toml.`);
  return value;
}
