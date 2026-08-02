# Releases and portable updates

This contract owns P4FNV application versioning, portable distribution through GitHub Releases, and the in-app update workflow. Current build commands and verification gates remain in [`TOOLCHAIN.md`](TOOLCHAIN.md); current readiness is tracked in [`checklists/MAIN_FEATURES.md`](checklists/MAIN_FEATURES.md).

## Distribution model

P4FNV ships first as a Windows x64 portable ZIP. A user extracts the archive into a directory they control and starts `p4fnv.exe`; no installer or administrator permission is required. A future installer may be added for a demonstrated need, but it is not a prerequisite for releases or in-app updates.

Each release contains these assets:

```text
P4FNV_<version>_windows_x64_portable.zip
P4FNV_<version>_windows_x64_portable.zip.sig
P4FNV_<version>_windows_x64_portable.zip.intoto.jsonl
latest.json
latest.json.sig
SHA256SUMS.txt
```

The portable ZIP contains only distribution-owned files: `p4fnv.exe`, `p4fnv-update-helper.exe`, `locales/`, `THIRD_PARTY_NOTICES.md`, and `release-manifest.json`. The manifest lists every managed relative path. It makes an update safe in an application directory that may also contain user files: the updater may replace or remove only paths from the old or new manifest, never the directory as a whole.

User settings, connection profiles, and caches remain in the operating system app-config directory. They are outside the portable archive and are never copied, deleted, or reset by an application update.

## Version policy

Use Semantic Versioning and a matching immutable Git tag:

- `X.Y.Z` is the public application version and tag `vX.Y.Z`.
- Patch versions fix compatible behavior; minor versions add compatible user-visible behavior; major versions permit breaking changes.
- Pre-release versions use SemVer suffixes such as `0.3.0-beta.1` and must not replace the stable update feed.
- Published tags and release assets are never overwritten. A correction is a newer version.

`package.json` is the primary source of the application version. Tauri reads it through the `version` path in `tauri.conf.json`; Cargo's package version is a required mirror. The release verification rejects a tag, Cargo version, package version, lockfile version, or release metadata that do not agree.

## Publishing workflow

`scripts/set-version.ps1 -Version X.Y.Z` validates SemVer and updates every version-bearing file. Commit the version, release notes, and product changes before publishing.

`scripts/publish-release.ps1 -Version X.Y.Z -NotesFile <path>` is the human- and agent-invocable release entry point. It must:

1. verify GitHub CLI authentication, a clean commit, matching versions, and an unused tag;
2. create and push `vX.Y.Z`;
3. wait for the GitHub Actions release workflow;
4. apply the supplied release notes only after the workflow uploaded all assets;
5. verify the archive, manifest, hashes, signatures, and `latest.json`; and
6. publish the draft release, or leave it as a draft on any failure.

Use `-VerifyDraftOnly` to stop safely after verification. Use `-ResumeDraft` to continue an existing draft only when its annotated local/remote tag, notes, successful workflow, and draft identity still match; combine both switches for a repeatable draft audit.

GitHub Actions is the canonical build agent. After the full test, fmt, Clippy, and production-build gate, it builds the tagged commit, signs metadata and archive with the GitHub Secrets key, and uploads every asset to a draft Release. Local builds validate but are not upload sources.

The workflow passes the archive SHA-256 to the SLSA Generic Generator in a separate job. Pin a reviewed generator tag, grant only `actions: read`, `id-token: write`, and release-upload permissions, and publish its signed in-toto provenance beside the archive. Before publication, `publish-release.ps1` verifies it with `slsa-verifier` against the expected repository and exact tag.

The Ed25519 private signing key needs two protected backups. Generate it outside the repository with `scripts/new-release-key.ps1`; store its base64 seed as the `P4FNV_RELEASE_PRIVATE_KEY` GitHub secret and the emitted public key as `P4FNV_UPDATE_PUBLIC_KEY`. The public value is embedded at compile time; the private value exists only in protected storage and the release job. Losing it prevents installed versions from accepting future releases.

## Update feed and trust

The stable endpoint is the `latest.json` asset of the latest published GitHub Release. It contains the version, release notes, publication time, portable archive URL, archive SHA-256, and detached signature. The application verifies the signed metadata with its embedded public key, then verifies the downloaded archive hash before unpacking it. HTTPS and an unsigned checksum alone are not sufficient trust boundaries.

SLSA provenance complements but does not replace these update signatures. It proves which repository, commit, tag, and GitHub workflow produced the archive for independent or organizational verification. The application does not contact Sigstore or Rekor and does not verify SLSA during an update; its offline trust boundary remains the embedded P4FNV public key.

An update check is non-blocking and runs once after the application window is ready, whether or not the user connects to Perforce. A network, GitHub, parsing, or signature failure never prevents normal application use. An explicit check is available both from the Connections header and from the connected-workspace settings menu, and reports the latest check result.

The UI shows a non-modal update notice with current and available versions, release notes, and Update/Later choices. Download starts only after explicit confirmation, and the backend refuses installation if the feed version changed after review. English and Russian strings, keyboard navigation, progress, retry-safe errors, and a visible native-agent smoke are required.

## Applying an update

Windows cannot replace the running executable. The main app therefore downloads and validates the archive into a unique temporary staging directory, extracts and validates its `release-manifest.json`, and launches a small native update helper from outside the application directory. It supplies the current process ID, target directory, staged files, and new executable path.

The app exits only after the helper is ready. The helper waits for that exact process, replaces only manifest-owned files, and retains a backup until the new executable starts. On replacement or launch failure, it restores and restarts the previous version, recording a bounded diagnostic. It refuses unwritable targets and managed paths crossing a link or junction, offering manual download instead.

The helper is native rather than a PowerShell script so updates do not depend on execution policy, a console window, or a user-installed scripting environment. It has no Perforce authority and never reads or writes application settings or caches.

## Implemented boundaries

The typed update coordinator and IPC commands live in `src-tauri/src/updates.rs`, the out-of-process helper is `p4fnv-update-helper`, release signing and verification use `p4fnv-release-crypto`, and the user-facing state lives in `src/features/updates/`. The frontend receives only typed metadata and progress; it cannot choose arbitrary URLs, filesystem targets, commands, or keys. Deterministic native tests may compile a disposable build with alternate feed and archive URL prefixes plus a disposable public key; normal production builds leave those test-only inputs unset and accept only the fixed GitHub release locations and embedded production key.

## Implementation and rollout sequence

1. **Release foundation — implemented locally.** The version synchronizer and verifier keep package, Cargo, lockfile, Tauri, tag, and metadata versions aligned. `build-release.bat` creates the versioned portable archive with the app, native helper, resources, notices, and generated manifest, then validates the archive round trip.

2. **Reproducible GitHub publishing — hosted-run verified.** The `v0.1.3` workflow passed the full gate, signed the archive, created a six-asset draft, and attached SLSA provenance for commit `202377211b86756761e8d365d356a866a510fbf6`. The downloaded draft passed `verify-release-assets.ps1` asset-set, signature, manifest, hash, repository, and tag checks.

3. **Release trust chain — configured and draft-verified.** Two protected backups and the private/public GitHub Secrets exist. The hosted `p4fnv.exe` contains the public key; a deliberately incorrect key rejected the draft, while the configured key accepted its Ed25519 signatures, SHA-256 hash, manifest, and SLSA provenance. `v0.1.3` remains a draft pending the clean-profile and end-to-end checks below.

4. **Read-only in-app discovery — implemented and locally verified.** Typed commands, startup and Settings checks, English/Russian UI, release notes, and explicit download consent are present. Unit fixtures cover version and trust failures. Native-agent checks proved both the signed available-update state and a safe invalid-release failure; the signed download flow also proved cancellation before application exit and a retry-safe return to the available-update state.

5. **Portable replacement — hosted-asset end-to-end verified.** A native-agent smoke upgraded portable `0.1.2` with the exact hosted `0.1.3` ZIP and production signatures, relaunched `0.1.3`, matched every managed-file hash, left no transaction state, preserved an unmanaged file, and kept app-config settings and workspace cache byte-for-byte unchanged. Automated tests cover locked and unwritable targets, cancellation, invalid signatures/hashes, rollback, and interrupted recovery.

6. **First public release.** Build and publish a new stable version through `publish-release.ps1`, manually verify the downloaded ZIP on a clean Windows profile, then verify the full in-app path from the immediately previous version. Mark each checklist item complete only with this evidence.

Local implementation completion requires unit coverage for version comparison, manifest validation, signature/hash failures, and rollback decisions; release-workflow verification of the final asset set and SLSA provenance; and a native smoke on a disposable copy: install version N, offer N+1, apply it, relaunch N+1, and prove that app-config settings and cache are unchanged. Cover offline, unavailable update, malformed metadata, invalid signature, locked file, unwritable directory, cancellation before exit, and interrupted replacement. Public-release completion additionally requires real protected signing keys, the hosted tagged workflow, verified SLSA provenance from that workflow, publication through `publish-release.ps1`, and a clean-profile verification of the downloaded GitHub assets.
