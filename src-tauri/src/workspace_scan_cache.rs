use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::{models::WorkspaceScanCandidate, settings};

const CACHE_VERSION: u32 = 1;
const MAX_CACHE_ENTRIES: usize = 8;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct WorkspaceScanCacheFile {
    version: u32,
    entries: Vec<WorkspaceScanCacheEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct WorkspaceScanCacheEntry {
    pub scope_id: String,
    pub roots: Vec<WorkspaceScanRootCache>,
    pub candidates: Vec<WorkspaceScanCandidate>,
    #[serde(default)]
    pub resume: Option<WorkspaceScanResume>,
    #[serde(default)]
    pub validated_at_ms: u64,
    pub last_full_scan_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct WorkspaceScanResume {
    pub targets: Vec<WorkspaceScanResumeTarget>,
    pub next_target: usize,
    pub root_targets_remaining: Vec<usize>,
    pub completed_roots: usize,
    pub completed_directories: usize,
    pub total_directories: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct WorkspaceScanResumeTarget {
    pub root_index: usize,
    pub scopes: Vec<String>,
    pub local_directories: Vec<String>,
    pub add: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct WorkspaceScanRootCache {
    pub local_path: String,
    pub directories: BTreeMap<String, WorkspaceDirectoryFingerprint>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WorkspaceDirectoryFingerprint {
    pub entry_count: u64,
    pub file_count: u64,
    pub latest_file_modified_ns: u128,
    pub digest: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceRootFingerprint {
    pub local_path: String,
    pub directories: BTreeMap<String, WorkspaceDirectoryFingerprint>,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceRootSnapshotter {
    local_path: String,
    exclusions: Vec<String>,
    pending: Vec<PathBuf>,
    directories: BTreeMap<String, WorkspaceDirectoryFingerprint>,
}

impl WorkspaceRootSnapshotter {
    pub(crate) fn new(root: &Path, exclusions: &[String]) -> io::Result<Self> {
        let root = fs::canonicalize(root)?;
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "scan root is not a directory",
            ));
        }
        Ok(Self {
            local_path: display_path(&root),
            exclusions: exclusions.to_vec(),
            pending: vec![root],
            directories: BTreeMap::new(),
        })
    }

    pub(crate) fn scan_next(&mut self) -> io::Result<Option<String>> {
        let Some(directory) = self.pending.pop() else {
            return Ok(None);
        };
        let directory_key = display_path(&directory);
        let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        let mut entry_count = 0_u64;
        let mut file_count = 0_u64;
        let mut latest_file_modified_ns = 0_u128;
        let mut digest = 0xcbf29ce484222325_u64;
        for entry in entries {
            let path = entry.path();
            let file_type = entry.file_type()?;
            if is_excluded(&path, &self.exclusions) || file_type.is_symlink() {
                continue;
            }
            let metadata = entry.metadata()?;
            let modified_ns = modified_ns(&metadata);
            let kind = if file_type.is_dir() {
                2_u8
            } else if file_type.is_file() {
                1_u8
            } else {
                0_u8
            };
            if kind == 0 {
                continue;
            }
            entry_count += 1;
            if kind == 1 {
                file_count += 1;
                latest_file_modified_ns = latest_file_modified_ns.max(modified_ns);
            } else {
                self.pending.push(path);
            }
            digest = fnv_update(digest, entry.file_name().to_string_lossy().as_bytes());
            digest = fnv_update(digest, &[0]);
            digest = fnv_update(digest, &[kind]);
            if kind == 1 {
                digest = fnv_update(digest, &metadata.len().to_le_bytes());
                // Keep the v1 fingerprint encoding stable for existing caches.
                digest = fnv_update(digest, &metadata.len().to_le_bytes());
                digest = fnv_update(digest, &modified_ns.to_le_bytes());
            }
        }
        self.directories.insert(
            directory_key.clone(),
            WorkspaceDirectoryFingerprint {
                entry_count,
                file_count,
                latest_file_modified_ns,
                digest,
            },
        );
        Ok(Some(directory_key))
    }

    pub(crate) fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub(crate) fn scanned_count(&self) -> usize {
        self.directories.len()
    }

    pub(crate) fn finish(self) -> WorkspaceRootFingerprint {
        WorkspaceRootFingerprint {
            local_path: self.local_path,
            directories: self.directories,
        }
    }
}

#[derive(Clone)]
pub(crate) struct WorkspaceScanCacheStore {
    path: PathBuf,
}

impl WorkspaceScanCacheStore {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub(crate) fn load(&self) -> WorkspaceScanCacheFile {
        let Ok(bytes) = fs::read(&self.path) else {
            return WorkspaceScanCacheFile::default();
        };
        let mut decoder = GzDecoder::new(bytes.as_slice());
        let mut decoded = Vec::new();
        if decoder.read_to_end(&mut decoded).is_err() {
            return WorkspaceScanCacheFile::default();
        }
        let Ok(mut cache) = serde_json::from_slice::<WorkspaceScanCacheFile>(&decoded) else {
            return WorkspaceScanCacheFile::default();
        };
        if cache.version == CACHE_VERSION {
            normalize_cache_paths(&mut cache);
            cache
        } else {
            WorkspaceScanCacheFile::default()
        }
    }

    pub(crate) fn save(&self, mut cache: WorkspaceScanCacheFile) -> io::Result<()> {
        cache.version = CACHE_VERSION;
        cache.entries.truncate(MAX_CACHE_ENTRIES);
        normalize_cache_paths(&mut cache);
        let json = serde_json::to_vec(&cache).map_err(io::Error::other)?;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(&json)?;
        let compressed = encoder.finish()?;
        let parent = self.path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "cache path has no parent")
        })?;
        fs::create_dir_all(parent)?;
        let temporary = temporary_path(&self.path);
        if let Err(error) = fs::write(&temporary, compressed) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        if let Err(error) = settings::replace_file(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        Ok(())
    }
}

pub(crate) fn cache_entry(
    cache: &WorkspaceScanCacheFile,
    scope_id: &str,
) -> Option<WorkspaceScanCacheEntry> {
    cache
        .entries
        .iter()
        .find(|entry| entry.scope_id == scope_id)
        .cloned()
}

pub(crate) fn upsert_cache_entry(
    cache: &mut WorkspaceScanCacheFile,
    entry: WorkspaceScanCacheEntry,
) {
    cache
        .entries
        .retain(|existing| existing.scope_id != entry.scope_id);
    cache.entries.insert(0, entry);
    cache.entries.truncate(MAX_CACHE_ENTRIES);
}

#[cfg(test)]
pub(crate) fn snapshot_root(
    root: &Path,
    exclusions: &[String],
) -> io::Result<WorkspaceRootFingerprint> {
    let mut snapshotter = WorkspaceRootSnapshotter::new(root, exclusions)?;
    while snapshotter.scan_next()?.is_some() {}
    Ok(snapshotter.finish())
}

pub(crate) fn changed_directories(
    previous: Option<&WorkspaceScanRootCache>,
    current: &WorkspaceRootFingerprint,
) -> Vec<String> {
    let Some(previous) = previous else {
        return vec![current.local_path.clone()];
    };
    if !same_path(&previous.local_path, &current.local_path) {
        return vec![current.local_path.clone()];
    }
    let previous_directories = previous
        .directories
        .iter()
        .map(|(path, fingerprint)| (comparison_path(path), fingerprint))
        .collect::<BTreeMap<_, _>>();
    let current_directories = current
        .directories
        .iter()
        .map(|(path, fingerprint)| (comparison_path(path), fingerprint))
        .collect::<BTreeMap<_, _>>();
    let mut changed = current
        .directories
        .iter()
        .filter_map(|(path, fingerprint)| {
            (previous_directories.get(&comparison_path(path)).copied() != Some(fingerprint))
                .then_some(path.clone())
        })
        .collect::<Vec<_>>();
    changed.extend(
        previous_directories
            .keys()
            .filter(|path| !current_directories.contains_key(*path))
            .map(|path| normalize_path(path)),
    );
    changed.sort_by_key(|path| comparison_path(path));
    changed.dedup_by(|left, right| same_path(left, right));
    changed
}

fn normalize_cache_paths(cache: &mut WorkspaceScanCacheFile) {
    for entry in &mut cache.entries {
        for root in &mut entry.roots {
            root.local_path = normalize_path(&root.local_path);
            root.directories = std::mem::take(&mut root.directories)
                .into_iter()
                .map(|(path, fingerprint)| (normalize_path(&path), fingerprint))
                .collect();
        }
    }
}

pub(crate) fn collapse_directories(mut paths: Vec<String>) -> Vec<String> {
    paths.sort_by_key(|path| path.len());
    paths.dedup_by(|left, right| same_path(left, right));
    let mut collapsed: Vec<String> = Vec::new();
    for path in paths {
        if collapsed.iter().any(|parent| is_path_inside(&path, parent)) {
            continue;
        }
        collapsed.push(path);
    }
    collapsed
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    PathBuf::from(name)
}

fn display_path(path: &Path) -> String {
    normalize_path(&path.to_string_lossy())
}

pub(crate) fn same_path(left: &str, right: &str) -> bool {
    normalize_path(left)
        .trim_end_matches('/')
        .eq_ignore_ascii_case(normalize_path(right).trim_end_matches('/'))
}

pub(crate) fn normalize_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    if let Some(path) = path.strip_prefix("//?/UNC/") {
        format!("//{path}")
    } else {
        path.strip_prefix("//?/").unwrap_or(&path).to_owned()
    }
}

fn comparison_path(path: &str) -> String {
    normalize_path(path)
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn is_path_inside(path: &str, parent: &str) -> bool {
    let path = normalize_path(path);
    let path = path.trim_end_matches('/');
    let parent = normalize_path(parent);
    let parent = parent.trim_end_matches('/');
    path.eq_ignore_ascii_case(parent)
        || path.get(parent.len()..).is_some_and(|suffix| {
            suffix.starts_with('/')
                && path
                    .get(..parent.len())
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(parent))
        })
}

fn is_excluded(path: &Path, exclusions: &[String]) -> bool {
    let path = display_path(path);
    exclusions
        .iter()
        .any(|exclusion| is_path_inside(&path, exclusion))
}

fn modified_ns(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn fnv_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compressed_cache_round_trips_and_replaces_entries() {
        let directory =
            std::env::temp_dir().join(format!("p4fnv-scan-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let store = WorkspaceScanCacheStore::new(directory.join("workspace-scan-cache.gz"));
        let mut cache = WorkspaceScanCacheFile::default();
        upsert_cache_entry(
            &mut cache,
            WorkspaceScanCacheEntry {
                scope_id: "scope".to_owned(),
                roots: Vec::new(),
                candidates: Vec::new(),
                resume: None,
                validated_at_ms: 42,
                last_full_scan_ms: 42,
            },
        );
        store.save(cache).unwrap();
        let loaded = store.load();
        assert_eq!(cache_entry(&loaded, "scope").unwrap().last_full_scan_ms, 42);
        let bytes = fs::read(directory.join("workspace-scan-cache.gz")).unwrap();
        assert!(!bytes.starts_with(b"{"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn normalizes_extended_windows_paths_for_cache_and_display() {
        assert_eq!(
            normalize_path("//?/C:/Projects/DG/Content"),
            "C:/Projects/DG/Content"
        );
        assert_eq!(
            normalize_path("//?/UNC/server/share/Content"),
            "//server/share/Content"
        );
    }

    #[test]
    fn root_fingerprint_detects_file_changes() {
        let directory =
            std::env::temp_dir().join(format!("p4fnv-scan-fingerprint-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join("src/nested")).unwrap();
        fs::write(directory.join("src/nested/file.txt"), b"one").unwrap();
        let first = snapshot_root(&directory, &[]).unwrap();
        fs::write(directory.join("src/nested/file.txt"), b"two!").unwrap();
        let second = snapshot_root(&directory, &[]).unwrap();
        let previous = WorkspaceScanRootCache {
            local_path: first.local_path.clone(),
            directories: first.directories.clone(),
        };
        let changed = changed_directories(Some(&previous), &second);
        assert_eq!(changed.len(), 1);
        assert!(changed[0].ends_with("/src/nested"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn changed_directory_list_keeps_each_new_folder_for_direct_add_checks() {
        let directory =
            std::env::temp_dir().join(format!("p4fnv-scan-new-directories-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join("src")).unwrap();
        let first = snapshot_root(&directory, &[]).unwrap();
        fs::create_dir_all(directory.join("src/new/deep")).unwrap();
        fs::write(directory.join("src/new/deep/file.txt"), b"one").unwrap();
        let second = snapshot_root(&directory, &[]).unwrap();
        let previous = WorkspaceScanRootCache {
            local_path: first.local_path,
            directories: first.directories,
        };
        let changed = changed_directories(Some(&previous), &second);
        assert!(changed.iter().any(|path| path.ends_with("/src")));
        assert!(changed.iter().any(|path| path.ends_with("/src/new")));
        assert!(changed.iter().any(|path| path.ends_with("/src/new/deep")));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn legacy_extended_and_mixed_case_cache_paths_still_hit() {
        let directory =
            std::env::temp_dir().join(format!("p4fnv-scan-legacy-paths-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join("Source/Nested")).unwrap();
        fs::write(directory.join("Source/Nested/file.txt"), b"one").unwrap();
        let current = snapshot_root(&directory, &[]).unwrap();
        let legacy_path = |path: &str| format!("//?/{}", path.to_ascii_uppercase());
        let previous = WorkspaceScanRootCache {
            local_path: legacy_path(&current.local_path),
            directories: current
                .directories
                .iter()
                .map(|(path, fingerprint)| (legacy_path(path), fingerprint.clone()))
                .collect(),
        };
        assert!(changed_directories(Some(&previous), &current).is_empty());
        let _ = fs::remove_dir_all(directory);
    }
}
