//! In-memory WebSocket hub: maps user_id -> set of live mpsc senders.
//! Cluster-safe later via Redis pub/sub fan-out.

use std::sync::Arc;

use bytes::Bytes;
use dashmap::DashMap;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Default)]
pub struct Hub {
    inner: Arc<DashMap<u64, Vec<mpsc::UnboundedSender<Bytes>>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, user_id: u64) -> mpsc::UnboundedReceiver<Bytes> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.inner.entry(user_id).or_default().push(tx);
        rx
    }

    /// How many live sockets the user currently has. Used by the ws layer to
    /// detect transitions (0→1 = came online, last→0 = went offline) and
    /// drive presence broadcasts.
    pub fn connection_count(&self, user_id: u64) -> usize {
        self.inner
            .get(&user_id)
            .map(|v| v.iter().filter(|s| !s.is_closed()).count())
            .unwrap_or(0)
    }

    /// Snapshot of every currently-connected user. Used to render presence
    /// dots on the chat list. Cheap — DashMap iteration only.
    pub fn online_users(&self) -> Vec<u64> {
        self.inner
            .iter()
            .filter_map(|entry| {
                let any_live = entry.value().iter().any(|s| !s.is_closed());
                if any_live {
                    Some(*entry.key())
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn is_online(&self, user_id: u64) -> bool {
        self.connection_count(user_id) > 0
    }

    pub fn prune(&self, user_id: u64) {
        if let Some(mut entry) = self.inner.get_mut(&user_id) {
            entry.retain(|s| !s.is_closed());
        }
        if self
            .inner
            .get(&user_id)
            .map(|v| v.is_empty())
            .unwrap_or(false)
        {
            self.inner.remove(&user_id);
        }
    }

    /// Fan-out a pre-serialized JSON payload to every live connection for these users.
    /// Pass a `Bytes` so we only serialize once per broadcast, not once per recipient.
    pub fn deliver(&self, recipients: &[u64], payload: Bytes) {
        for uid in recipients {
            if let Some(senders) = self.inner.get(uid) {
                for s in senders.iter() {
                    let _ = s.send(payload.clone());
                }
            }
        }
    }
}
