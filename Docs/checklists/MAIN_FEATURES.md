# Distribution and application updates

The release and portable-update contract is [`../RELEASES_AND_UPDATES.md`](../RELEASES_AND_UPDATES.md). None of the items below is complete until the release workflow and the stated native verification evidence exist.

## Portable release and publishing

- [ ] `build-release.bat` creates a versioned Windows x64 portable ZIP with a managed-file manifest, locales, notices, and SHA-256.
- [ ] `publish-release.ps1` uses GitHub Actions as the canonical build agent, creates a draft GitHub Release, uploads the signed assets, accepts release notes, verifies the assets, and publishes only after success.

## Versioning and updates

- [ ] One SemVer version is synchronized across the package, Tauri, Cargo, lockfile, immutable Git tag, and GitHub Release.
- [ ] The app checks the signed GitHub update feed at startup without blocking normal use, presents the available version and notes, and supports an explicit recheck.
- [ ] A native helper safely replaces only manifest-owned files after the app exits, restarts the new portable version, preserves app-config settings/caches, and recovers from interrupted replacement.
- [ ] Show who checked out files
- [ ] Revert or accept changes from unopened changes

## Visual
- [ ] Redesign Files to make it more compact and coherent view between local and depot
- [ ] Redesign top layers to use less space for useless elements
