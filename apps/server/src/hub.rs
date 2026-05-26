//! In-memory WebSocket hub: maps user_id -> set of live mpsc senders.
//! Cluster-safe later via Redis pub/sub fan-out.

use std::sync::Arc;

use dashmap::DashMap;
use mongodb::bson::oid::ObjectId;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Default)]
pub struct Hub {
    inner: Arc<DashMap<ObjectId, Vec<mpsc::UnboundedSender<String>>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new connection. Returns its sender so the WS task can write to it.
    pub fn register(&self, user_id: ObjectId) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.inner.entry(user_id).or_default().push(tx);
        rx
    }

    /// Drop dead senders (channel closed). Call after a recipient connection disconnects
    /// or whenever we discover a closed channel during a fan-out.
    pub fn prune(&self, user_id: ObjectId) {
        if let Some(mut entry) = self.inner.get_mut(&user_id) {
            entry.retain(|s| !s.is_closed());
        }
        // Remove the bucket entirely if empty.
        if self
            .inner
            .get(&user_id)
            .map(|v| v.is_empty())
            .unwrap_or(false)
        {
            self.inner.remove(&user_id);
        }
    }

    /// Send a JSON-encoded event to all live connections for these users.
    pub fn deliver(&self, recipients: &[ObjectId], payload: String) {
        for uid in recipients {
            if let Some(senders) = self.inner.get(uid) {
                for s in senders.iter() {
                    let _ = s.send(payload.clone());
                }
            }
        }
    }
}
