# Future portability readiness

P4FNV is developed and shipped for Windows first. macOS and Linux are outside the Definition of Done until a dedicated porting phase, but new code must not turn Windows-first into Windows-only without need.

## Mandatory rules now

- Keep the Perforce domain and models OS-independent. Launching `p4`, path handling, and filesystem mutations remain in Rust; the frontend receives neither a shell nor an arbitrary filesystem API.
- Use `Path`/`PathBuf` for local paths. Do not build them through string concatenation or assume `\`, a drive letter, or an `.exe` suffix.
- Do not normalize local paths to one case without an explicit platform policy. Windows, macOS, and Linux may have different case sensitivity.
- Isolate OS actions (`reveal`, `open`, process flags, atomic replace) in small functions with `cfg(...)` or in an official cross-platform Tauri API. Do not spread OS branching through feature code.
- Use platform-neutral model names and translation keys (`file manager`, `executable`, `primary modifier`). Display text may reflect the current OS.
- Support both `Ctrl` and `Meta/Cmd` in keyboard interactions. Do not rely only on `DataTransfer.types` in drag-and-drop.
- Add fixtures with at least Windows and Unix paths for pure path logic, even while shipping and native UI verification remain Windows-only.
- Preserve explicit selection of the `p4` path: a GUI application on macOS/Linux may not inherit the shell `PATH`.

Do not create a general platform SDK, empty adapter set, or dependencies before a current use case exists. Preserving narrow boundaries and avoiding new irreversible Windows assumptions is sufficient.

## Deferred until the porting phase

- native builds and UI smoke through WebView2/WKWebView/WebKitGTK;
- platform-specific toolchain scripts, Tauri configs, and CI runners;
- macOS signing/notarization and the Linux package matrix;
- adaptation of `p4fnv_agent`, system menus, shortcuts, file-manager actions, and DnD;
- full integration tests on every supported filesystem.

## Condition for declaring platform support

A platform is supported only after a build on its native runner, the full test/build gate, verification of the main read-only and mutation workflows against a disposable Helix Core Server, native UI smoke, and release of a signed or platform-standard artifact. Cross-compilation or successful unit tests alone do not constitute support.
