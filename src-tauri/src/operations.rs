use std::{
    collections::HashMap,
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{Receiver, Sender},
    },
    thread,
    time::Duration,
};

pub struct OperationHandle {
    pub kind: &'static str,
    pub workspace: String,
    pub started_at_ms: u64,
    pub cancel: Sender<()>,
    pub cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancelRequest {
    pub kind: &'static str,
    pub workspace: String,
    pub started_at_ms: u64,
}

pub fn wait_for_process(mut child: Child, cancellation: Receiver<()>) -> bool {
    wait_for_process_with_cancellation(&mut child, &cancellation)
}

pub fn wait_for_process_with_cancellation(child: &mut Child, cancellation: &Receiver<()>) -> bool {
    loop {
        if cancellation.try_recv().is_ok() {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => return false,
        }
    }
}

#[derive(Clone, Default)]
pub struct OperationRegistry {
    inner: Arc<RegistryInner>,
}

#[derive(Default)]
struct RegistryInner {
    next_id: AtomicU64,
    handles: Mutex<HashMap<String, OperationHandle>>,
}

impl OperationRegistry {
    pub fn new_id(&self) -> String {
        format!(
            "op-{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1
        )
    }

    pub fn insert_if_kind_idle(&self, id: String, handle: OperationHandle) -> bool {
        let Ok(mut handles) = self.inner.handles.lock() else {
            return false;
        };
        if handles.values().any(|active| {
            active.workspace == handle.workspace
                && operation_kinds_conflict(active.kind, handle.kind)
        }) {
            return false;
        }
        handles.insert(id, handle);
        true
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut handles) = self.inner.handles.lock() {
            handles.remove(id);
        }
    }

    pub fn cancel(&self, id: &str) -> Option<CancelRequest> {
        let Ok(handles) = self.inner.handles.lock() else {
            return None;
        };
        let handle = handles.get(id)?;
        handle.cancel.send(()).is_ok().then(|| {
            handle.cancelled.store(true, Ordering::Release);
            CancelRequest {
                kind: handle.kind,
                workspace: handle.workspace.clone(),
                started_at_ms: handle.started_at_ms,
            }
        })
    }
}

fn operation_kinds_conflict(active: &str, candidate: &str) -> bool {
    if active == candidate {
        return true;
    }
    matches!(active, "sync" | "submit" | "reconcile" | "integrate")
        && matches!(candidate, "sync" | "submit" | "reconcile" | "integrate")
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    };

    use super::{OperationHandle, OperationRegistry};

    #[test]
    fn operation_ids_are_unique_and_monotonic() {
        let registry = OperationRegistry::default();
        assert_eq!(registry.new_id(), "op-1");
        assert_eq!(registry.new_id(), "op-2");
    }

    #[test]
    fn cancelling_unknown_operation_is_safe() {
        assert!(OperationRegistry::default().cancel("op-missing").is_none());
    }

    #[test]
    fn rejected_cancellation_does_not_mark_the_operation_cancelled() {
        let registry = OperationRegistry::default();
        let (cancel, cancellation) = mpsc::channel();
        drop(cancellation);
        let cancelled = Arc::new(AtomicBool::new(false));
        assert!(registry.insert_if_kind_idle(
            "op-1".to_owned(),
            OperationHandle {
                kind: "submit",
                workspace: "server/alex/main".to_owned(),
                started_at_ms: 42,
                cancel,
                cancelled: cancelled.clone(),
            },
        ));

        assert!(registry.cancel("op-1").is_none());
        assert!(!cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn cancellation_is_delivered_without_waiting_for_the_process_lock() {
        let registry = OperationRegistry::default();
        let (cancel, cancellation) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        assert!(registry.insert_if_kind_idle(
            "op-1".to_owned(),
            OperationHandle {
                kind: "sync",
                workspace: "server/alex/main".to_owned(),
                started_at_ms: 42,
                cancel,
                cancelled: cancelled.clone(),
            },
        ));

        assert_eq!(
            registry.cancel("op-1"),
            Some(super::CancelRequest {
                kind: "sync",
                workspace: "server/alex/main".to_owned(),
                started_at_ms: 42
            })
        );
        assert!(
            cancellation
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_ok()
        );
        assert!(cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn prevents_conflicting_workspace_mutations_without_global_locking() {
        let registry = OperationRegistry::default();
        let handle = |kind, workspace: &str| {
            let (cancel, _) = mpsc::channel();
            OperationHandle {
                kind,
                workspace: workspace.to_owned(),
                started_at_ms: 42,
                cancel,
                cancelled: Arc::new(AtomicBool::new(false)),
            }
        };

        assert!(
            registry.insert_if_kind_idle("op-1".to_owned(), handle("sync", "server/alex/main"))
        );
        assert!(
            !registry.insert_if_kind_idle("op-2".to_owned(), handle("sync", "server/alex/main"))
        );
        assert!(registry.insert_if_kind_idle(
            "op-3".to_owned(),
            handle("reconcile_preview", "server/alex/main")
        ));
        assert!(!registry.insert_if_kind_idle(
            "op-conflict".to_owned(),
            handle("submit", "server/alex/main")
        ));
        assert!(!registry.insert_if_kind_idle(
            "op-integrate".to_owned(),
            handle("integrate", "server/alex/main")
        ));
        assert!(
            registry.insert_if_kind_idle("op-4".to_owned(), handle("sync", "server/alex/other"))
        );
        registry.remove("op-1");
        assert!(
            registry.insert_if_kind_idle("op-5".to_owned(), handle("sync", "server/alex/main"))
        );
    }
}
