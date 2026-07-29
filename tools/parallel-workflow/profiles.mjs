const npmCi = command("npm-ci", "Install locked dependencies", "npm", ["ci"], 15);
const frontendTests = command(
  "frontend-tests",
  "Run frontend and workflow tests",
  "npm",
  ["test", "--", "--run"],
  15,
);
const rustfmt = command(
  "rustfmt",
  "Check Rust formatting",
  "cargo",
  ["fmt", "--manifest-path", "src-tauri\\Cargo.toml", "--", "--check"],
  5,
);
const rustTests = command(
  "rust-tests",
  "Run Rust tests",
  "cargo",
  ["test", "--manifest-path", "src-tauri\\Cargo.toml"],
  30,
);
const clippy = command(
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
);

const docsProfile = Object.freeze([npmCi, frontendTests]);
const frontendProfile = Object.freeze([
  npmCi,
  frontendTests,
  command("web-build", "Type-check and build the web application", "npm", ["run", "build:web"], 15),
]);
const rustProfile = Object.freeze([rustfmt, rustTests, clippy]);
const fastProfile = Object.freeze([
  npmCi,
  frontendTests,
  rustfmt,
  command("debug-build", "Build the debug desktop application", "npm", ["run", "build:fast"], 30),
]);

const fullProfile = Object.freeze([
  npmCi,
  frontendTests,
  rustfmt,
  rustTests,
  clippy,
  command("release-build", "Build the release desktop application", "npm", ["run", "build"], 45),
]);

export const validationProfiles = Object.freeze({
  "p4fnv-docs": docsProfile,
  "p4fnv-frontend": frontendProfile,
  "p4fnv-rust": rustProfile,
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
