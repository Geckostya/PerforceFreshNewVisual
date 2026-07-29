const fastProfile = Object.freeze([
    command("npm-ci", "Install locked dependencies", "npm", ["ci"], 15),
    command("frontend-tests", "Run frontend tests", "npm", ["test", "--", "--run"], 15),
    command(
      "rustfmt",
      "Check Rust formatting",
      "cargo",
      ["fmt", "--manifest-path", "src-tauri\\Cargo.toml", "--", "--check"],
      5,
    ),
    command("debug-build", "Build the debug desktop application", "npm", ["run", "build:fast"], 30),
  ]);

const fullProfile = Object.freeze([
    command("npm-ci", "Install locked dependencies", "npm", ["ci"], 15),
    command("frontend-tests", "Run frontend tests", "npm", ["test", "--", "--run"], 15),
    command(
      "rustfmt",
      "Check Rust formatting",
      "cargo",
      ["fmt", "--manifest-path", "src-tauri\\Cargo.toml", "--", "--check"],
      5,
    ),
    command(
      "rust-tests",
      "Run Rust tests",
      "cargo",
      ["test", "--manifest-path", "src-tauri\\Cargo.toml"],
      30,
    ),
    command(
      "clippy",
      "Run Clippy with warnings denied",
      "cargo",
      [
        "clippy",
        "--manifest-path",
        "src-tauri\\Cargo.toml",
        "--all-targets",
        "--",
        "-D",
        "warnings",
      ],
      30,
    ),
    command("release-build", "Build the release desktop application", "npm", ["run", "build"], 45),
  ]);

export const validationProfiles = Object.freeze({
  "p4fnv-fast": fastProfile,
  "p4fnv-full": fullProfile,
  "p4fnv-full-p4d": Object.freeze([
    ...fullProfile,
    command(
      "p4d-write-smoke",
      "Create and delete a changelist on the disposable P4D server",
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "scripts\\smoke-p4d.ps1",
        "-ServerRoot",
        "{p4dTestServerRoot}",
      ],
      10,
    ),
  ]),
});

function command(id, name, executable, args, timeoutMinutes) {
  return Object.freeze({
    id,
    name,
    executable,
    args: Object.freeze(args),
    timeoutMs: timeoutMinutes * 60_000,
  });
}
