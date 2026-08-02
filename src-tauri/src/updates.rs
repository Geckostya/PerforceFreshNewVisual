use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State, Window};

use crate::models::{AppError, ErrorKind};

const DEFAULT_FEED_URL: &str =
    "https://github.com/Geckostya/PerforceFreshNewVisual/releases/latest/download/latest.json";
const DEFAULT_ARCHIVE_URL_PREFIX: &str =
    "https://github.com/Geckostya/PerforceFreshNewVisual/releases/download/";
const MAX_ARCHIVE_BYTES: u64 = 500 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 750 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_MANAGED_FILES: usize = 512;
const MAX_UPDATE_STATE_BYTES: u64 = 1024 * 1024;
const UPDATE_STATE_FILE: &str = ".p4fnv-update-state.json";
const UPDATE_ERROR_FILE: &str = ".p4fnv-update-error.txt";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRelease {
    pub version: String,
    pub notes: String,
    pub published_at: String,
    pub archive_url: String,
    pub archive_sha256: String,
    pub archive_signature: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateCheckStatus {
    Current,
    Available,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub status: UpdateCheckStatus,
    pub current_version: String,
    pub release: UpdateRelease,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub schema_version: u32,
    pub version: String,
    pub managed_paths: Vec<String>,
    pub files: Vec<ReleaseFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Default)]
pub struct UpdateCoordinator {
    installing: AtomicBool,
    cancel_requested: AtomicBool,
}

struct InstallGuard<'a>(&'a AtomicBool);

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn update_error(kind: ErrorKind, message: impl Into<String>) -> AppError {
    AppError::new(kind, message)
}

fn configured_feed_url() -> &'static str {
    option_env!("P4FNV_UPDATE_FEED_URL").unwrap_or(DEFAULT_FEED_URL)
}

fn configured_public_key() -> Result<&'static str, AppError> {
    option_env!("P4FNV_UPDATE_PUBLIC_KEY")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            update_error(
                ErrorKind::UnsupportedCapability,
                "This build does not contain a release verification key.",
            )
        })
}

fn configured_archive_url_prefix() -> &'static str {
    option_env!("P4FNV_UPDATE_ARCHIVE_URL_PREFIX").unwrap_or(DEFAULT_ARCHIVE_URL_PREFIX)
}

fn signature_url(feed_url: &str) -> String {
    format!("{feed_url}.sig")
}

fn validate_release_url(url: &str) -> Result<(), AppError> {
    let expected = configured_archive_url_prefix();
    if !url.starts_with(expected) || url.contains(['\r', '\n']) {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The update feed contains an untrusted archive URL.",
        ));
    }
    Ok(())
}

fn ensure_not_cancelled(cancel_requested: &AtomicBool) -> Result<(), AppError> {
    if cancel_requested.load(Ordering::Acquire) {
        return Err(update_error(
            ErrorKind::Cancelled,
            "The application update was cancelled.",
        ));
    }
    Ok(())
}

pub fn verify_signed_feed(
    metadata: &[u8],
    encoded_signature: &str,
    encoded_public_key: &str,
) -> Result<UpdateRelease, AppError> {
    let public_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_public_key.trim())
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The release public key is invalid.",
            )
        })?;
    let public_bytes: [u8; 32] = public_bytes.try_into().map_err(|_| {
        update_error(
            ErrorKind::InvalidOutput,
            "The release public key has an invalid length.",
        )
    })?;
    let verifying_key = VerifyingKey::from_bytes(&public_bytes).map_err(|_| {
        update_error(
            ErrorKind::InvalidOutput,
            "The release public key is invalid.",
        )
    })?;
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_signature.trim())
        .map_err(|_| update_error(ErrorKind::InvalidOutput, "The update signature is invalid."))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| update_error(ErrorKind::InvalidOutput, "The update signature is invalid."))?;
    verifying_key
        .verify_strict(metadata, &signature)
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The update metadata signature could not be verified.",
            )
        })?;

    let release: UpdateRelease = serde_json::from_slice(metadata).map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "The update metadata is malformed.",
        )
        .with_diagnostics(error.to_string())
    })?;
    validate_release(&release)?;
    Ok(release)
}

fn validate_release(release: &UpdateRelease) -> Result<(), AppError> {
    Version::parse(&release.version).map_err(|_| {
        update_error(
            ErrorKind::InvalidOutput,
            "The update feed contains an invalid version.",
        )
    })?;
    validate_release_url(&release.archive_url)?;
    validate_sha256(&release.archive_sha256)?;
    let signature = base64::engine::general_purpose::STANDARD
        .decode(release.archive_signature.trim())
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The archive signature is invalid.",
            )
        })?;
    if signature.len() != 64 {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The archive signature has an invalid length.",
        ));
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), AppError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The update feed contains an invalid SHA-256.",
        ));
    }
    Ok(())
}

fn compare_release(release: UpdateRelease) -> Result<UpdateCheckResult, AppError> {
    let current_version = env!("CARGO_PKG_VERSION").to_owned();
    let available = is_newer_version(&current_version, &release.version)?;
    Ok(UpdateCheckResult {
        status: if available {
            UpdateCheckStatus::Available
        } else {
            UpdateCheckStatus::Current
        },
        current_version,
        release,
    })
}

fn ensure_expected_release(
    release: &UpdateRelease,
    expected_version: &str,
) -> Result<(), AppError> {
    Version::parse(expected_version).map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "The selected update version is invalid.",
        )
        .with_diagnostics(error.to_string())
    })?;
    if release.version != expected_version {
        return Err(update_error(
            ErrorKind::Stale,
            "The available update changed. Review the new version before installing it.",
        ));
    }
    Ok(())
}

fn is_newer_version(current_version: &str, available_version: &str) -> Result<bool, AppError> {
    let current = Version::parse(current_version).map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "The application version is invalid.",
        )
        .with_diagnostics(error.to_string())
    })?;
    let available = Version::parse(available_version).map_err(|error| {
        update_error(ErrorKind::InvalidOutput, "The update version is invalid.")
            .with_diagnostics(error.to_string())
    })?;
    Ok(available > current)
}

async fn fetch_signed_release(client: &Client) -> Result<UpdateRelease, AppError> {
    let public_key = configured_public_key()?;
    let feed_url = configured_feed_url();
    let metadata_response = client.get(feed_url).send().await.map_err(network_error)?;
    let metadata_response = metadata_response
        .error_for_status()
        .map_err(network_error)?;
    let metadata = read_bounded_response(
        metadata_response,
        MAX_MANIFEST_BYTES,
        "The update metadata is unexpectedly large.",
    )
    .await?;
    let signature_response = client
        .get(signature_url(feed_url))
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    let signature_bytes = read_bounded_response(
        signature_response,
        4096,
        "The update metadata signature is unexpectedly large.",
    )
    .await?;
    let signature = std::str::from_utf8(&signature_bytes).map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "The update metadata signature is malformed.",
        )
        .with_diagnostics(error.to_string())
    })?;
    verify_signed_feed(&metadata, signature, public_key)
}

async fn read_bounded_response(
    mut response: reqwest::Response,
    limit: u64,
    too_large_message: &'static str,
) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(update_error(ErrorKind::InvalidOutput, too_large_message));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if (body.len() as u64).saturating_add(chunk.len() as u64) > limit {
            return Err(update_error(ErrorKind::InvalidOutput, too_large_message));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn update_client() -> Result<Client, AppError> {
    Client::builder()
        .user_agent(concat!("P4FNV/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| {
            update_error(
                ErrorKind::CommandFailed,
                "Could not initialize update checks.",
            )
            .with_diagnostics(error.to_string())
        })
}

fn network_error(error: reqwest::Error) -> AppError {
    let kind = classify_update_transport_error(error.is_timeout(), error.status().is_some());
    update_error(kind, "Could not contact the update service.").with_diagnostics(error.to_string())
}

fn classify_update_transport_error(is_timeout: bool, has_http_status: bool) -> ErrorKind {
    if is_timeout {
        ErrorKind::Timeout
    } else if has_http_status {
        ErrorKind::InvalidOutput
    } else {
        ErrorKind::Offline
    }
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheckResult, AppError> {
    compare_release(fetch_signed_release(&update_client()?).await?)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    window: Window,
    coordinator: State<'_, UpdateCoordinator>,
    expected_version: String,
) -> Result<(), AppError> {
    if coordinator
        .installing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(update_error(
            ErrorKind::Conflict,
            "An application update is already in progress.",
        ));
    }
    coordinator.cancel_requested.store(false, Ordering::Release);
    let _guard = InstallGuard(&coordinator.installing);
    let client = update_client()?;
    let release = fetch_signed_release(&client).await?;
    ensure_expected_release(&release, &expected_version)?;
    let comparison = compare_release(release.clone())?;
    if comparison.status != UpdateCheckStatus::Available {
        return Err(update_error(
            ErrorKind::Stale,
            "The selected update is no longer available.",
        ));
    }

    let temp_guard = tempfile::Builder::new()
        .prefix("p4fnv-update-")
        .tempdir()
        .map_err(file_error("Could not create update staging."))?;
    let temp = temp_guard.path().to_path_buf();
    let archive_path = temp.join("update.zip");
    download_archive(
        &client,
        &release,
        &archive_path,
        &window,
        &coordinator.cancel_requested,
    )
    .await?;
    verify_file_signature(
        &archive_path,
        &release.archive_sha256,
        &release.archive_signature,
        configured_public_key()?,
    )?;

    let staging = temp.join("staging");
    let manifest = extract_and_verify_archive(&archive_path, &staging, &release.version)?;
    let target = std::env::current_exe()
        .map_err(file_error("Could not locate the running application."))?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            update_error(
                ErrorKind::CommandFailed,
                "Could not locate the application directory.",
            )
        })?;
    ensure_target_writable(&target)?;

    let bundled_helper = target.join("p4fnv-update-helper.exe");
    if !bundled_helper.is_file() {
        return Err(update_error(
            ErrorKind::UnsupportedCapability,
            "The portable update helper is missing. Download the release archive manually.",
        ));
    }
    let external_helper = temp.join("p4fnv-update-helper.exe");
    fs::copy(&bundled_helper, &external_helper)
        .map_err(file_error("Could not prepare the update helper."))?;
    let _ = fs::remove_file(&archive_path);
    let ready_path = temp.join("helper.ready");
    ensure_not_cancelled(&coordinator.cancel_requested)?;
    let persisted_temp = temp_guard.keep();
    let mut helper = match launch_helper(
        &external_helper,
        std::process::id(),
        &target,
        &staging,
        &ready_path,
        &manifest.version,
    ) {
        Ok(helper) => helper,
        Err(error) => {
            let _ = fs::remove_dir_all(&persisted_temp);
            return Err(error);
        }
    };
    if let Err(error) = wait_for_helper_ready(&ready_path) {
        stop_helper(&mut helper);
        let _ = fs::remove_dir_all(&persisted_temp);
        return Err(error);
    }
    if let Err(error) = ensure_not_cancelled(&coordinator.cancel_requested) {
        stop_helper(&mut helper);
        let _ = fs::remove_dir_all(&persisted_temp);
        return Err(error);
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn cancel_update(coordinator: State<'_, UpdateCoordinator>) -> Result<(), AppError> {
    if coordinator.installing.load(Ordering::Acquire) {
        coordinator.cancel_requested.store(true, Ordering::Release);
    }
    Ok(())
}

async fn download_archive(
    client: &Client,
    release: &UpdateRelease,
    destination: &Path,
    window: &Window,
    cancel_requested: &AtomicBool,
) -> Result<(), AppError> {
    let mut response = client
        .get(&release.archive_url)
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    let total = response.content_length();
    if total.is_some_and(|value| value > MAX_ARCHIVE_BYTES) {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The update archive is unexpectedly large.",
        ));
    }
    let mut output =
        File::create(destination).map_err(file_error("Could not create the update download."))?;
    let mut downloaded = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        ensure_not_cancelled(cancel_requested)?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_ARCHIVE_BYTES {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The update archive is unexpectedly large.",
            ));
        }
        output
            .write_all(&chunk)
            .map_err(file_error("Could not save the update download."))?;
        let _ = window.emit(
            "p4fnv://update-download-progress",
            UpdateDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: total,
            },
        );
    }
    output
        .sync_all()
        .map_err(file_error("Could not finish the update download."))?;
    Ok(())
}

fn verify_file_signature(
    path: &Path,
    expected_sha256: &str,
    encoded_signature: &str,
    encoded_public_key: &str,
) -> Result<(), AppError> {
    let bytes = fs::read(path).map_err(file_error("Could not read the update archive."))?;
    let actual_hash = format!("{:x}", Sha256::digest(&bytes));
    if !actual_hash.eq_ignore_ascii_case(expected_sha256) {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The downloaded update failed its SHA-256 check.",
        ));
    }
    let public_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(encoded_public_key.trim())
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The release public key is invalid.",
            )
        })?
        .try_into()
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The release public key has an invalid length.",
            )
        })?;
    let verifying_key = VerifyingKey::from_bytes(&public_bytes).map_err(|_| {
        update_error(
            ErrorKind::InvalidOutput,
            "The release public key is invalid.",
        )
    })?;
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_signature.trim())
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The archive signature is invalid.",
            )
        })?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
        update_error(
            ErrorKind::InvalidOutput,
            "The archive signature is invalid.",
        )
    })?;
    verifying_key
        .verify_strict(&bytes, &signature)
        .map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The downloaded update signature could not be verified.",
            )
        })
}

fn validate_relative_path(value: &str) -> Result<PathBuf, AppError> {
    if value.is_empty() || value.contains('\\') || value.contains(':') {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest contains an unsafe path.",
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest contains an unsafe path.",
        ));
    }
    Ok(path.to_path_buf())
}

pub fn validate_manifest(
    manifest: &ReleaseManifest,
    expected_version: &str,
) -> Result<(), AppError> {
    if manifest.schema_version != 1 || manifest.version != expected_version {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest does not match the selected update.",
        ));
    }
    if manifest.files.is_empty() || manifest.files.len() > MAX_MANAGED_FILES {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest contains an invalid file count.",
        ));
    }
    let mut managed = BTreeSet::new();
    for path in &manifest.managed_paths {
        validate_relative_path(path)?;
        if !managed.insert(path.as_str()) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The release manifest contains duplicate paths.",
            ));
        }
    }
    if !managed.contains("release-manifest.json") {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest is not a managed file.",
        ));
    }
    let mut files = BTreeSet::new();
    let mut total = 0_u64;
    for file in &manifest.files {
        validate_relative_path(&file.path)?;
        validate_sha256(&file.sha256)?;
        total = total.saturating_add(file.size);
        if total > MAX_EXPANDED_BYTES
            || !files.insert(file.path.as_str())
            || !managed.contains(file.path.as_str())
        {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The release manifest contains invalid file entries.",
            ));
        }
    }
    if files.len() + 1 != managed.len() {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The release manifest has unmanaged or unhashed files.",
        ));
    }
    for required in [
        "p4fnv.exe",
        "p4fnv-update-helper.exe",
        "THIRD_PARTY_NOTICES.md",
    ] {
        if !managed.contains(required) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                format!("The release is missing {required}."),
            ));
        }
    }
    Ok(())
}

fn extract_and_verify_archive(
    archive_path: &Path,
    staging: &Path,
    expected_version: &str,
) -> Result<ReleaseManifest, AppError> {
    fs::create_dir_all(staging).map_err(file_error("Could not create update staging."))?;
    let mut archive = zip::ZipArchive::new(
        File::open(archive_path).map_err(file_error("Could not open the update archive."))?,
    )
    .map_err(|error| {
        update_error(ErrorKind::InvalidOutput, "The update archive is invalid.")
            .with_diagnostics(error.to_string())
    })?;
    if archive.len() > MAX_MANAGED_FILES + 32 {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The update archive contains too many entries.",
        ));
    }
    let mut manifest_json = String::new();
    {
        let manifest_entry = archive.by_name("release-manifest.json").map_err(|_| {
            update_error(
                ErrorKind::InvalidOutput,
                "The update archive has no release manifest.",
            )
        })?;
        if manifest_entry.size() > MAX_MANIFEST_BYTES {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The release manifest is unexpectedly large.",
            ));
        }
        manifest_entry
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_string(&mut manifest_json)
            .map_err(file_error("Could not read the release manifest."))?;
        if manifest_json.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The release manifest is unexpectedly large.",
            ));
        }
    }
    let manifest: ReleaseManifest = serde_json::from_str(&manifest_json).map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "The release manifest is malformed.",
        )
        .with_diagnostics(error.to_string())
    })?;
    validate_manifest(&manifest, expected_version)?;
    let managed: BTreeSet<&str> = manifest.managed_paths.iter().map(String::as_str).collect();
    let files: BTreeMap<&str, &ReleaseFile> = manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let mut seen = BTreeSet::new();
    let mut expanded_bytes = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            update_error(ErrorKind::InvalidOutput, "The update archive is invalid.")
                .with_diagnostics(error.to_string())
        })?;
        let name = entry.name();
        if entry.is_dir() {
            let directory = name.trim_end_matches('/');
            validate_relative_path(directory)?;
            let prefix = format!("{directory}/");
            if !managed.iter().any(|path| path.starts_with(&prefix)) {
                return Err(update_error(
                    ErrorKind::InvalidOutput,
                    "The update archive contains an unmanaged directory.",
                ));
            }
            continue;
        }
        validate_relative_path(name)?;
        if !managed.contains(name) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The update archive contains an unmanaged file.",
            ));
        }
        if !seen.insert(name.to_owned()) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The update archive contains duplicate files.",
            ));
        }
        let expected_size = if name == "release-manifest.json" {
            if entry.size() > MAX_MANIFEST_BYTES {
                return Err(update_error(
                    ErrorKind::InvalidOutput,
                    "The release manifest is unexpectedly large.",
                ));
            }
            continue;
        } else {
            files
                .get(name)
                .ok_or_else(|| {
                    update_error(
                        ErrorKind::InvalidOutput,
                        "The update archive contains an unhashed file.",
                    )
                })?
                .size
        };
        if entry.size() != expected_size {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "A managed update file has the wrong size.",
            ));
        }
        expanded_bytes = expanded_bytes.saturating_add(entry.size());
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "The expanded update archive is unexpectedly large.",
            ));
        }
        let destination = staging.join(name);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(file_error("Could not create update staging."))?;
        }
        let mut output = File::create(&destination)
            .map_err(file_error("Could not extract the update archive."))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(file_error("Could not extract the update archive."))?;
    }
    if seen.len() != managed.len() || !managed.iter().all(|path| seen.contains(*path)) {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "The update archive is missing a managed file.",
        ));
    }
    fs::write(staging.join("release-manifest.json"), manifest_json)
        .map_err(file_error("Could not stage the release manifest."))?;
    for file in &manifest.files {
        let path = staging.join(validate_relative_path(&file.path)?);
        let metadata = fs::metadata(&path)
            .map_err(file_error("The update archive is missing a managed file."))?;
        if metadata.len() != file.size {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "A managed update file has the wrong size.",
            ));
        }
        let actual = sha256_file(&path)?;
        if !actual.eq_ignore_ascii_case(&file.sha256) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "A managed update file failed its SHA-256 check.",
            ));
        }
    }
    Ok(manifest)
}

fn sha256_file(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path).map_err(file_error("Could not read a managed update file."))?;
    let mut hash = Sha256::new();
    std::io::copy(&mut file, &mut hash)
        .map_err(file_error("Could not read a managed update file."))?;
    Ok(format!("{:x}", hash.finalize()))
}

fn file_error(message: &'static str) -> impl FnOnce(std::io::Error) -> AppError {
    move |error| update_error(ErrorKind::CommandFailed, message).with_diagnostics(error.to_string())
}

fn ensure_target_writable(target: &Path) -> Result<(), AppError> {
    let probe = target.join(format!(".p4fnv-write-test-{}", std::process::id()));
    File::create(&probe)
        .and_then(|mut file| file.write_all(b"write-test"))
        .and_then(|_| fs::remove_file(&probe))
        .map_err(|error| {
            update_error(
                ErrorKind::Permission,
                "The application directory is not writable. Download and extract the update manually.",
            )
            .with_diagnostics(error.to_string())
        })
}

fn ensure_managed_path_safe(root: &Path, relative: &Path) -> Result<(), AppError> {
    let component_count = relative.components().count();
    let mut candidate = root.to_path_buf();
    for (index, component) in relative.components().enumerate() {
        candidate.push(component.as_os_str());
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(update_error(
                    ErrorKind::Permission,
                    "Could not inspect a managed application path.",
                )
                .with_diagnostics(error.to_string()));
            }
        };
        #[cfg(windows)]
        let is_link = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes()
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                != 0
        };
        #[cfg(not(windows))]
        let is_link = metadata.file_type().is_symlink();

        if is_link {
            return Err(update_error(
                ErrorKind::Permission,
                "A managed application path crosses a symbolic link or junction. Extract the update manually.",
            ));
        }
        if index + 1 < component_count && !metadata.is_dir() {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "A managed application path has an invalid parent.",
            ));
        }
    }
    Ok(())
}

fn launch_helper(
    helper: &Path,
    parent_pid: u32,
    target: &Path,
    staging: &Path,
    ready: &Path,
    version: &str,
) -> Result<Child, AppError> {
    let mut command = Command::new(helper);
    command
        .arg("--parent-pid")
        .arg(parent_pid.to_string())
        .arg("--target")
        .arg(target)
        .arg("--staging")
        .arg(staging)
        .arg("--ready")
        .arg(ready)
        .arg("--version")
        .arg(version);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command
        .spawn()
        .map_err(file_error("Could not start the update helper."))?;
    Ok(child)
}

fn stop_helper(helper: &mut Child) {
    let _ = helper.kill();
    let _ = helper.wait();
}

fn wait_for_helper_ready(path: &Path) -> Result<(), AppError> {
    for _ in 0..100 {
        if path.is_file() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(update_error(
        ErrorKind::Timeout,
        "The update helper did not become ready.",
    ))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionState {
    target: PathBuf,
    backup: PathBuf,
    entries: Vec<TransactionEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionEntry {
    path: String,
    existed: bool,
}

pub fn recover_interrupted_update(target: &Path) -> Result<bool, AppError> {
    let state_path = target.join(UPDATE_STATE_FILE);
    if !state_path.is_file() {
        return Ok(false);
    }
    if fs::metadata(&state_path)
        .map_err(file_error("Could not inspect interrupted update state."))?
        .len()
        > MAX_UPDATE_STATE_BYTES
    {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "Interrupted update state is unexpectedly large.",
        ));
    }
    let state: TransactionState = serde_json::from_slice(
        &fs::read(&state_path).map_err(file_error("Could not read interrupted update state."))?,
    )
    .map_err(|error| {
        update_error(
            ErrorKind::InvalidOutput,
            "Interrupted update state is invalid.",
        )
        .with_diagnostics(error.to_string())
    })?;
    let canonical_target = fs::canonicalize(target)
        .map_err(file_error("Could not inspect the application directory."))?;
    let backup_parent = state
        .backup
        .parent()
        .and_then(|path| fs::canonicalize(path).ok());
    let backup_name_ok = state
        .backup
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".p4fnv-update-backup-"));
    if state.target != target
        || backup_parent.as_ref() != Some(&canonical_target)
        || !backup_name_ok
    {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "Interrupted update state contains unsafe paths.",
        ));
    }
    let backup_name = state.backup.file_name().ok_or_else(|| {
        update_error(
            ErrorKind::InvalidOutput,
            "Interrupted update state contains an unsafe backup path.",
        )
    })?;
    ensure_managed_path_safe(target, Path::new(backup_name))?;
    restore_transaction(target, &state)?;
    cleanup_replacement_temporaries(target, &state.entries);
    let _ = fs::remove_file(state_path);
    let _ = fs::remove_dir_all(&state.backup);
    write_update_diagnostic(
        target,
        "P4FNV restored the previous version after an interrupted update.",
    );
    Ok(true)
}

fn write_update_diagnostic(target: &Path, message: &str) {
    let bounded: String = message.chars().take(4000).collect();
    let _ = fs::write(target.join(UPDATE_ERROR_FILE), bounded);
}

pub(crate) fn record_recovery_error(target: &Path, error: &AppError) {
    write_update_diagnostic(
        target,
        &format!(
            "P4FNV could not recover an interrupted update automatically: {}",
            error.message
        ),
    );
}

#[tauri::command]
pub fn take_update_diagnostic() -> Result<Option<String>, AppError> {
    let executable =
        std::env::current_exe().map_err(file_error("Could not locate the running application."))?;
    let target = executable.parent().ok_or_else(|| {
        update_error(
            ErrorKind::CommandFailed,
            "Could not locate the application directory.",
        )
    })?;
    let path = target.join(UPDATE_ERROR_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let message =
        fs::read_to_string(&path).map_err(file_error("Could not read the update diagnostic."))?;
    let _ = fs::remove_file(path);
    Ok(Some(message.chars().take(4000).collect()))
}

fn restore_transaction(target: &Path, state: &TransactionState) -> Result<(), AppError> {
    if state.entries.is_empty() || state.entries.len() > MAX_MANAGED_FILES * 2 + 1 {
        return Err(update_error(
            ErrorKind::InvalidOutput,
            "Interrupted update state contains an invalid file count.",
        ));
    }
    let mut seen = BTreeSet::new();
    for entry in &state.entries {
        let relative = validate_relative_path(&entry.path)?;
        if !seen.insert(entry.path.as_str()) {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "Interrupted update state contains duplicate paths.",
            ));
        }
        ensure_managed_path_safe(target, &relative)?;
        let destination = target.join(&relative);
        if entry.existed {
            ensure_managed_path_safe(&state.backup, &relative)?;
            if !state.backup.join(&relative).is_file() {
                return Err(update_error(
                    ErrorKind::InvalidOutput,
                    "Interrupted update backup is incomplete.",
                ));
            }
        } else if destination.exists() && !destination.is_file() {
            return Err(update_error(
                ErrorKind::InvalidOutput,
                "Interrupted update state conflicts with an application directory.",
            ));
        }
    }
    for entry in &state.entries {
        let relative = validate_relative_path(&entry.path)?;
        let destination = target.join(&relative);
        if entry.existed {
            let source = state.backup.join(&relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(file_error(
                    "Could not restore the previous application version.",
                ))?;
            }
            fs::copy(source, destination).map_err(file_error(
                "Could not restore the previous application version.",
            ))?;
        } else if destination.is_file() {
            fs::remove_file(destination).map_err(file_error(
                "Could not restore the previous application version.",
            ))?;
        }
    }
    Ok(())
}

fn replacement_temporary(destination: &Path) -> PathBuf {
    destination.with_extension(format!("p4fnv-new-{}", std::process::id()))
}

fn cleanup_replacement_temporaries(target: &Path, entries: &[TransactionEntry]) {
    for entry in entries {
        if let Ok(relative) = validate_relative_path(&entry.path) {
            let _ = fs::remove_file(replacement_temporary(&target.join(relative)));
        }
    }
}

#[derive(Debug)]
struct HelperArgs {
    parent_pid: u32,
    target: PathBuf,
    staging: PathBuf,
    ready: PathBuf,
    version: String,
}

fn parse_helper_args() -> Result<HelperArgs, String> {
    let mut values = BTreeMap::new();
    let mut args = std::env::args_os().skip(1);
    while let Some(key) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {}", key.to_string_lossy()))?;
        values.insert(key.to_string_lossy().into_owned(), value);
    }
    let take = |name: &str| {
        values
            .get(name)
            .cloned()
            .ok_or_else(|| format!("missing {name}"))
    };
    let parent_pid = take("--parent-pid")?
        .to_string_lossy()
        .parse::<u32>()
        .map_err(|_| "invalid parent pid".to_owned())?;
    Ok(HelperArgs {
        parent_pid,
        target: PathBuf::from(take("--target")?),
        staging: PathBuf::from(take("--staging")?),
        ready: PathBuf::from(take("--ready")?),
        version: take("--version")?.to_string_lossy().into_owned(),
    })
}

pub fn helper_main() -> Result<(), String> {
    let args = parse_helper_args()?;
    let result = apply_helper_update(&args);
    if let Err(error) = &result {
        let message: String = error.chars().take(4000).collect();
        let _ = fs::write(args.target.join(UPDATE_ERROR_FILE), message);
    }
    result
}

fn apply_helper_update(args: &HelperArgs) -> Result<(), String> {
    ensure_target_writable(&args.target).map_err(|error| error.message)?;
    ensure_managed_path_safe(&args.target, Path::new("release-manifest.json"))
        .map_err(|error| error.message)?;
    let manifest_path = args.staging.join("release-manifest.json");
    let manifest: ReleaseManifest =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    validate_manifest(&manifest, &args.version).map_err(|error| error.message)?;
    for file in &manifest.files {
        let path = args
            .staging
            .join(validate_relative_path(&file.path).map_err(|error| error.message)?);
        if sha256_file(&path).map_err(|error| error.message)? != file.sha256.to_ascii_lowercase() {
            return Err(format!("staged file hash mismatch: {}", file.path));
        }
    }
    let parent_process = prepare_process_wait(args.parent_pid)?;
    fs::write(&args.ready, b"ready").map_err(|error| error.to_string())?;
    parent_process.wait(args.parent_pid)?;

    let old_manifest = read_existing_manifest(&args.target);
    let mut paths: BTreeSet<String> = manifest.managed_paths.iter().cloned().collect();
    if let Some(old) = &old_manifest {
        paths.extend(old.managed_paths.iter().cloned());
    }
    let transaction_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let backup = args
        .target
        .join(format!(".p4fnv-update-backup-{transaction_id}"));
    fs::create_dir(&backup).map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    for path in &paths {
        let relative = validate_relative_path(path).map_err(|error| error.message)?;
        ensure_managed_path_safe(&args.target, &relative).map_err(|error| error.message)?;
        let source = args.target.join(&relative);
        let existed = source.is_file();
        if existed {
            let destination = backup.join(&relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&source, destination).map_err(|error| error.to_string())?;
        }
        entries.push(TransactionEntry {
            path: path.clone(),
            existed,
        });
    }
    let state = TransactionState {
        target: args.target.clone(),
        backup: backup.clone(),
        entries,
    };
    fs::write(
        args.target.join(UPDATE_STATE_FILE),
        serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let replacement = replace_managed_files(&args.target, &args.staging, &paths, &manifest);
    if let Err(error) = replacement {
        return recover_failed_helper_update(
            args,
            &state,
            format!("The update failed and the previous version was restored: {error}"),
        );
    }
    if let Err(error) = fs::remove_file(args.target.join(UPDATE_STATE_FILE)) {
        return recover_failed_helper_update(
            args,
            &state,
            format!(
                "The update could not be committed and the previous version was restored: {error}"
            ),
        );
    }
    if let Err(error) = Command::new(args.target.join("p4fnv.exe")).spawn() {
        return recover_failed_helper_update(
            args,
            &state,
            format!(
                "The updated application could not be started and the previous version was restored: {error}"
            ),
        );
    }
    let _ = fs::remove_dir_all(&backup);
    cleanup_helper_workspace(args);
    Ok(())
}

fn recover_failed_helper_update(
    args: &HelperArgs,
    state: &TransactionState,
    message: String,
) -> Result<(), String> {
    restore_transaction(&args.target, state)
        .map_err(|rollback| format!("{message}; rollback failed: {}", rollback.message))?;
    cleanup_replacement_temporaries(&args.target, &state.entries);
    write_update_diagnostic(&args.target, &message);
    let _ = fs::remove_file(args.target.join(UPDATE_STATE_FILE));
    let _ = fs::remove_dir_all(&state.backup);
    Command::new(args.target.join("p4fnv.exe"))
        .spawn()
        .map_err(|error| {
            format!("{message}; previous application could not be restarted: {error}")
        })?;
    cleanup_helper_workspace(args);
    Ok(())
}

fn cleanup_helper_workspace(args: &HelperArgs) {
    let _ = fs::remove_file(&args.ready);
    let _ = fs::remove_dir_all(&args.staging);
    if let Ok(executable) = std::env::current_exe() {
        let parent = executable.parent().map(Path::to_path_buf);
        let _ = fs::remove_file(executable);
        if let Some(parent) = parent {
            let _ = fs::remove_dir(parent);
        }
    }
}

fn read_existing_manifest(target: &Path) -> Option<ReleaseManifest> {
    let bytes = fs::read(target.join("release-manifest.json")).ok()?;
    let manifest: ReleaseManifest = serde_json::from_slice(&bytes).ok()?;
    validate_manifest(&manifest, &manifest.version).ok()?;
    Some(manifest)
}

fn replace_managed_files(
    target: &Path,
    staging: &Path,
    all_paths: &BTreeSet<String>,
    new_manifest: &ReleaseManifest,
) -> Result<(), String> {
    let new_paths: BTreeSet<&str> = new_manifest
        .managed_paths
        .iter()
        .map(String::as_str)
        .collect();
    for path in all_paths {
        let relative = validate_relative_path(path).map_err(|error| error.message)?;
        ensure_managed_path_safe(target, &relative).map_err(|error| error.message)?;
        let destination = target.join(&relative);
        if new_paths.contains(path.as_str()) {
            let source = staging.join(&relative);
            if !source.is_file() {
                return Err(format!("staged managed file is missing: {path}"));
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let temporary = replacement_temporary(&destination);
            fs::copy(source, &temporary).map_err(|error| error.to_string())?;
            if destination.is_file()
                && let Err(error) = fs::remove_file(&destination)
            {
                let _ = fs::remove_file(&temporary);
                return Err(error.to_string());
            }
            if let Err(error) = fs::rename(&temporary, destination) {
                let _ = fs::remove_file(&temporary);
                return Err(error.to_string());
            }
        } else if destination.is_file() {
            fs::remove_file(destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
struct ParentProcessWait(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl ParentProcessWait {
    fn wait(self, pid: u32) -> Result<(), String> {
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::WaitForSingleObject;

        let result = unsafe { WaitForSingleObject(self.0, 120_000) };
        if result != WAIT_OBJECT_0 {
            return Err(format!("parent process {pid} did not exit in time"));
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for ParentProcessWait {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn prepare_process_wait(pid: u32) -> Result<ParentProcessWait, String> {
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::OpenProcess;

    let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return Err(format!("could not open parent process {pid}"));
    }
    Ok(ParentProcessWait(handle))
}

#[cfg(not(windows))]
struct ParentProcessWait;

#[cfg(not(windows))]
impl ParentProcessWait {
    fn wait(self, _pid: u32) -> Result<(), String> {
        Err("portable replacement is supported only on Windows".to_owned())
    }
}

#[cfg(not(windows))]
fn prepare_process_wait(_pid: u32) -> Result<ParentProcessWait, String> {
    Err("portable replacement is supported only on Windows".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use zip::write::SimpleFileOptions;

    fn signed_feed(version: &str) -> (Vec<u8>, String, String) {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let metadata = serde_json::to_vec(&UpdateRelease {
            version: version.to_owned(),
            notes: "Notes".to_owned(),
            published_at: "2026-08-02T12:00:00Z".to_owned(),
            archive_url: format!("https://github.com/Geckostya/PerforceFreshNewVisual/releases/download/v{version}/P4FNV.zip"),
            archive_sha256: "ab".repeat(32),
            archive_signature: base64::engine::general_purpose::STANDARD.encode([3_u8; 64]),
        })
        .unwrap();
        let signature =
            base64::engine::general_purpose::STANDARD.encode(signing.sign(&metadata).to_bytes());
        let public =
            base64::engine::general_purpose::STANDARD.encode(signing.verifying_key().to_bytes());
        (metadata, signature, public)
    }

    fn test_manifest() -> (ReleaseManifest, Vec<(&'static str, &'static [u8])>) {
        let contents = vec![
            ("p4fnv.exe", b"app".as_slice()),
            ("p4fnv-update-helper.exe", b"helper".as_slice()),
            ("THIRD_PARTY_NOTICES.md", b"notices".as_slice()),
        ];
        let files = contents
            .iter()
            .map(|(path, bytes)| ReleaseFile {
                path: (*path).to_owned(),
                sha256: format!("{:x}", Sha256::digest(bytes)),
                size: bytes.len() as u64,
            })
            .collect::<Vec<_>>();
        let mut managed_paths = files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        managed_paths.push("release-manifest.json".to_owned());
        (
            ReleaseManifest {
                schema_version: 1,
                version: "1.0.0".to_owned(),
                managed_paths,
                files,
            },
            contents,
        )
    }

    fn write_test_archive(path: &Path, manifest: &ReleaseManifest, contents: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive
            .start_file("release-manifest.json", options)
            .unwrap();
        archive
            .write_all(&serde_json::to_vec(manifest).unwrap())
            .unwrap();
        for (name, bytes) in contents {
            archive.start_file(*name, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.finish().unwrap();
    }

    #[test]
    fn verifies_signed_feed_and_rejects_tampering() {
        let (metadata, signature, public) = signed_feed("1.2.3");
        assert_eq!(
            verify_signed_feed(&metadata, &signature, &public)
                .unwrap()
                .version,
            "1.2.3"
        );
        let mut tampered = metadata;
        tampered[1] ^= 1;
        assert!(verify_signed_feed(&tampered, &signature, &public).is_err());
    }

    #[test]
    fn rejects_signed_but_malformed_metadata() {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let metadata = br#"{"version":"1.2.3""#;
        let signature =
            base64::engine::general_purpose::STANDARD.encode(signing.sign(metadata).to_bytes());
        let public =
            base64::engine::general_purpose::STANDARD.encode(signing.verifying_key().to_bytes());

        let error = verify_signed_feed(metadata, &signature, &public).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert_eq!(error.message, "The update metadata is malformed.");
    }

    #[test]
    fn rejects_untrusted_archive_url() {
        let (metadata, signature, public) = signed_feed("1.2.3");
        let mut release: UpdateRelease = serde_json::from_slice(&metadata).unwrap();
        release.archive_url = "https://example.com/update.zip".to_owned();
        let signing = SigningKey::from_bytes(&[7; 32]);
        let changed = serde_json::to_vec(&release).unwrap();
        let changed_signature =
            base64::engine::general_purpose::STANDARD.encode(signing.sign(&changed).to_bytes());
        assert!(verify_signed_feed(&changed, &changed_signature, &public).is_err());
        assert!(!signature.is_empty());
    }

    #[test]
    fn manifest_rejects_traversal_and_unhashed_paths() {
        let manifest = ReleaseManifest {
            schema_version: 1,
            version: "1.0.0".to_owned(),
            managed_paths: vec![
                "p4fnv.exe".to_owned(),
                "p4fnv-update-helper.exe".to_owned(),
                "THIRD_PARTY_NOTICES.md".to_owned(),
                "release-manifest.json".to_owned(),
                "../settings.json".to_owned(),
            ],
            files: vec![],
        };
        assert!(validate_manifest(&manifest, "1.0.0").is_err());
    }

    #[test]
    fn archive_rejects_a_declared_size_mismatch_before_extraction() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("update.zip");
        let staging = temp.path().join("staging");
        let (manifest, contents) = test_manifest();
        let altered = contents
            .iter()
            .map(|(name, bytes)| {
                if *name == "p4fnv.exe" {
                    (*name, b"oversized".as_slice())
                } else {
                    (*name, *bytes)
                }
            })
            .collect::<Vec<_>>();
        write_test_archive(&archive, &manifest, &altered);

        let error = extract_and_verify_archive(&archive, &staging, "1.0.0").unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert_eq!(error.message, "A managed update file has the wrong size.");
    }

    #[test]
    fn archive_rejects_an_oversized_manifest_before_parsing() {
        let temp = tempfile::tempdir().unwrap();
        let archive_path = temp.path().join("update.zip");
        let file = File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file("release-manifest.json", SimpleFileOptions::default())
            .unwrap();
        archive
            .write_all(&vec![b' '; MAX_MANIFEST_BYTES as usize + 1])
            .unwrap();
        archive.finish().unwrap();

        let error =
            extract_and_verify_archive(&archive_path, &temp.path().join("staging"), "1.0.0")
                .unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert_eq!(error.message, "The release manifest is unexpectedly large.");
    }

    #[test]
    fn compares_semantic_versions_without_string_ordering() {
        assert!(is_newer_version("0.9.0", "0.10.0").unwrap());
        assert!(!is_newer_version("1.0.0", "1.0.0-beta.1").unwrap());
    }

    #[test]
    fn reports_the_installed_version_as_current() {
        let current_version = env!("CARGO_PKG_VERSION");
        let (metadata, signature, public) = signed_feed(current_version);
        let release = verify_signed_feed(&metadata, &signature, &public).unwrap();
        let result = compare_release(release).unwrap();

        assert_eq!(result.status, UpdateCheckStatus::Current);
        assert_eq!(result.current_version, current_version);
    }

    #[test]
    fn refuses_to_install_a_release_the_user_did_not_review() {
        let (metadata, signature, public) = signed_feed("1.2.4");
        let release = verify_signed_feed(&metadata, &signature, &public).unwrap();

        let error = ensure_expected_release(&release, "1.2.3").unwrap_err();
        assert_eq!(error.kind, ErrorKind::Stale);
        assert!(error.message.contains("Review the new version"));
    }

    #[test]
    fn distinguishes_offline_timeout_and_unavailable_feed_failures() {
        assert_eq!(
            classify_update_transport_error(false, false),
            ErrorKind::Offline
        );
        assert_eq!(
            classify_update_transport_error(true, false),
            ErrorKind::Timeout
        );
        assert_eq!(
            classify_update_transport_error(false, true),
            ErrorKind::InvalidOutput
        );
    }

    #[test]
    fn archive_verification_rejects_hash_mismatch() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("update.zip");
        fs::write(&archive, b"portable bytes").unwrap();
        let signing = SigningKey::from_bytes(&[9; 32]);
        let signature = base64::engine::general_purpose::STANDARD
            .encode(signing.sign(b"portable bytes").to_bytes());
        let public =
            base64::engine::general_purpose::STANDARD.encode(signing.verifying_key().to_bytes());
        assert!(verify_file_signature(&archive, &"00".repeat(32), &signature, &public).is_err());
    }

    #[test]
    fn cancellation_is_observed_before_helper_launch() {
        let requested = AtomicBool::new(true);
        let error = ensure_not_cancelled(&requested).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Cancelled);
    }

    #[cfg(windows)]
    #[test]
    fn helper_refuses_an_unopenable_parent_before_signalling_ready() {
        assert!(prepare_process_wait(u32::MAX).is_err());
    }

    #[test]
    fn write_probe_rejects_a_non_directory_target() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("not-a-directory");
        fs::write(&target, b"occupied").unwrap();
        let error = ensure_target_writable(&target).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Permission);
        assert!(error.message.contains("extract the update manually"));
    }

    #[cfg(windows)]
    #[test]
    fn locked_managed_file_is_not_replaced() {
        use std::os::windows::fs::OpenOptionsExt;

        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("target");
        let staging = temp.path().join("staging");
        fs::create_dir(&target).unwrap();
        fs::create_dir(&staging).unwrap();
        fs::write(target.join("p4fnv.exe"), b"old").unwrap();
        fs::write(staging.join("p4fnv.exe"), b"new").unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(target.join("p4fnv.exe"))
            .unwrap();
        let manifest = ReleaseManifest {
            schema_version: 1,
            version: "1.0.0".to_owned(),
            managed_paths: vec!["p4fnv.exe".to_owned()],
            files: vec![],
        };
        let paths = BTreeSet::from(["p4fnv.exe".to_owned()]);

        assert!(replace_managed_files(&target, &staging, &paths, &manifest).is_err());
        drop(locked);
        assert_eq!(fs::read(target.join("p4fnv.exe")).unwrap(), b"old");
        assert!(!replacement_temporary(&target.join("p4fnv.exe")).exists());
    }

    #[test]
    fn interrupted_transaction_restores_old_files_and_removes_new_files() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path();
        let backup = target.join(".p4fnv-update-backup-test");
        fs::create_dir(&backup).unwrap();
        fs::write(backup.join("p4fnv.exe"), b"old").unwrap();
        fs::write(target.join("p4fnv.exe"), b"partial-new").unwrap();
        fs::write(target.join("new.dll"), b"new").unwrap();
        let state = TransactionState {
            target: target.to_path_buf(),
            backup,
            entries: vec![
                TransactionEntry {
                    path: "p4fnv.exe".to_owned(),
                    existed: true,
                },
                TransactionEntry {
                    path: "new.dll".to_owned(),
                    existed: false,
                },
            ],
        };
        fs::write(
            target.join(UPDATE_STATE_FILE),
            serde_json::to_vec(&state).unwrap(),
        )
        .unwrap();
        assert!(recover_interrupted_update(target).unwrap());
        assert_eq!(fs::read(target.join("p4fnv.exe")).unwrap(), b"old");
        assert!(!target.join("new.dll").exists());
    }

    #[test]
    fn rollback_preflights_every_entry_before_restoring_files() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path();
        let backup = target.join(".p4fnv-update-backup-test");
        fs::create_dir(&backup).unwrap();
        fs::write(backup.join("p4fnv.exe"), b"old").unwrap();
        fs::write(target.join("p4fnv.exe"), b"partial-new").unwrap();
        let state = TransactionState {
            target: target.to_path_buf(),
            backup,
            entries: vec![
                TransactionEntry {
                    path: "p4fnv.exe".to_owned(),
                    existed: true,
                },
                TransactionEntry {
                    path: "p4fnv.exe".to_owned(),
                    existed: true,
                },
            ],
        };

        let error = restore_transaction(target, &state).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert_eq!(fs::read(target.join("p4fnv.exe")).unwrap(), b"partial-new");
    }

    #[test]
    fn recovery_rejects_an_oversized_state_file() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(
            temp.path().join(UPDATE_STATE_FILE),
            vec![b' '; MAX_UPDATE_STATE_BYTES as usize + 1],
        )
        .unwrap();

        let error = recover_interrupted_update(temp.path()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidOutput);
        assert_eq!(
            error.message,
            "Interrupted update state is unexpectedly large."
        );
    }
}
