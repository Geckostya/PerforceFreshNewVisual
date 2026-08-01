use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
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
    pub last_full_scan_ms: u64,
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
        let Ok(cache) = serde_json::from_slice::<WorkspaceScanCacheFile>(&decoded) else {
            return WorkspaceScanCacheFile::default();
        };
        if cache.version == CACHE_VERSION {
            cache
        } else {
            WorkspaceScanCacheFile::default()
        }
    }

    pub(crate) fn save(&self, mut cache: WorkspaceScanCacheFile) -> io::Result<()> {
        cache.version = CACHE_VERSION;
        cache.entries.truncate(MAX_CACHE_ENTRIES);
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

pub(crate) fn snapshot_root(
    root: &Path,
    exclusions: &[String],
) -> io::Result<WorkspaceRootFingerprint> {
    let root = fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotADirectory,
            "scan root is not a directory",
        ));
    }
    let root_key = display_path(&root);
    let mut directories = BTreeMap::new();
    let mut pending = vec![root];
    while let Some(directory) = pending.pop() {
        let directory_key = display_path(&directory);
        let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
        let mut entry_count = 0_u64;
        let mut file_count = 0_u64;
        let mut latest_file_modified_ns = 0_u128;
        let mut digest = 0xcbf29ce484222325_u64;
        for entry in entries {
            let path = entry.path();
            if is_excluded(&path, exclusions) || entry.file_type()?.is_symlink() {
                continue;
            }
            let file_type = entry.file_type()?;
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
                pending.push(path.clone());
            }
            digest = fnv_update(digest, entry.file_name().to_string_lossy().as_bytes());
            digest = fnv_update(digest, &[0]);
            digest = fnv_update(digest, &[kind]);
            if kind == 1 {
                digest = fnv_update(digest, &metadata.len().to_le_bytes());
            }
            if kind == 1 {
                digest = fnv_update(digest, &metadata.len().to_le_bytes());
                digest = fnv_update(digest, &modified_ns.to_le_bytes());
            }
        }
        directories.insert(
            directory_key,
            WorkspaceDirectoryFingerprint {
                entry_count,
                file_count,
                latest_file_modified_ns,
                digest,
            },
        );
    }
    Ok(WorkspaceRootFingerprint {
        local_path: root_key,
        directories,
    })
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
    let previous_keys = previous.directories.keys().collect::<BTreeSet<_>>();
    let current_keys = current.directories.keys().collect::<BTreeSet<_>>();
    let mut changed = current
        .directories
        .iter()
        .filter_map(|(path, fingerprint)| {
            (previous.directories.get(path) != Some(fingerprint)).then_some(path.clone())
        })
        .collect::<Vec<_>>();
    for removed in previous_keys.difference(&current_keys) {
        let mut ancestor = (*removed).clone();
        let mut found = false;
        while let Some(separator) = ancestor.rfind('/') {
            ancestor.truncate(separator);
            if current.directories.contains_key(&ancestor) {
                changed.push(ancestor.clone());
                found = true;
                break;
            }
        }
        if !found {
            changed.push(current.local_path.clone());
        }
    }
    collapse_directories(changed)
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
    path.to_string_lossy().replace('\\', "/")
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
    fn root_fingerprint_detects_file_changes_and_collapses_nested_directories() {
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
}
