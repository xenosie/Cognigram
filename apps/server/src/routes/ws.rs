use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::error::AppError;
use crate::jwt;
use crate::models::channel::ChannelKind;
use crate::routes::channels::persist_and_broadcast_channel;
use crate::routes::chats::persist_and_broadcast;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_handler(
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claims = jwt::verify_access(&q.token, &state.config.jwt_secret)?;
    let user_id: u64 = claims.sub.parse().map_err(|_| AppError::Unauthorized)?;
    Ok(upgrade.on_upgrade(move |socket| handle_socket(state, socket, user_id)))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Incoming {
    /// Direct-message send.
    Send {
        chat_id: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        attachment_id: Option<String>,
    },
    /// Channel / group send. Permission checks happen in the channel layer.
    SendChannel {
        channel_id: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        attachment_id: Option<String>,
    },
    /// Ephemeral typing indicator. `target_kind` is "dm" (chat_id) or "group"
    /// (channel of kind=Group; broadcast channels intentionally drop typing).
    Typing {
        target_kind: TypingTarget,
        target_id: String,
        #[serde(default)]
        started: bool,
    },
    /// Mark a DM chat read up to `msg_id`. Persists to CHAT_READS and
    /// broadcasts a `read` event to the other participants so the sender can
    /// show double-check / "seen" indicators.
    Read {
        chat_id: String,
        msg_id: String,
    },
    /// Mark a channel/group read up to `msg_id`. No broadcast — channels
    /// don't show per-user seen state, the cursor just resets the unread
    /// badge for the viewer.
    ReadChannel {
        channel_id: String,
        msg_id: String,
    },
    Ping,
}

#[derive(Debug, Clone, Copy, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum TypingTarget {
    Dm,
    Group,
}

async fn handle_socket(state: AppState, socket: WebSocket, user_id: u64) {
    // Detect the 0→1 transition BEFORE registering. If this is the user's
    // first live socket, fan out a presence-online event to everyone they
    // share a chat with.
    let was_offline = state.hub.connection_count(user_id) == 0;
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.hub.register(user_id);
    if was_offline {
        broadcast_presence(&state, user_id, true).await;
    }

    // Forward hub messages to client. axum 0.7's WsMessage::Text takes a
    // String; payload is already valid UTF-8 (serde_json output).
    let mut writer = tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            let text = match String::from_utf8(payload.to_vec()) {
                Ok(t) => t,
                Err(_) => break,
            };
            if sender.send(WsMessage::Text(text)).await.is_err() {
                break;
            }
        }
    });

    let state_inner = state.clone();
    let mut reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                WsMessage::Text(t) => {
                    let Ok(inc) = serde_json::from_str::<Incoming>(t.as_str()) else {
                        continue;
                    };
                    match inc {
                        Incoming::Send { chat_id, body, attachment_id } => {
                            let Ok(cid) = chat_id.parse::<u64>() else { continue };
                            let body = body.trim().to_string();
                            if body.len() > 4096 {
                                continue;
                            }
                            if body.is_empty() && attachment_id.is_none() {
                                continue;
                            }
                            if let Err(e) = persist_and_broadcast(
                                &state_inner,
                                cid,
                                user_id,
                                body,
                                attachment_id,
                            )
                            .await
                            {
                                tracing::warn!(error = ?e, "ws send failed");
                            }
                        }
                        Incoming::SendChannel { channel_id, body, attachment_id } => {
                            let Ok(cid) = channel_id.parse::<u64>() else { continue };
                            let body = body.trim().to_string();
                            if body.len() > 4096 {
                                continue;
                            }
                            if body.is_empty() && attachment_id.is_none() {
                                continue;
                            }
                            if let Err(e) = persist_and_broadcast_channel(
                                &state_inner,
                                cid,
                                user_id,
                                body,
                                attachment_id,
                            )
                            .await
                            {
                                tracing::warn!(error = ?e, "ws channel send failed");
                            }
                        }
                        Incoming::Typing { target_kind, target_id, started } => {
                            let Ok(tid) = target_id.parse::<u64>() else { continue };
                            let recipients: Vec<u64> = match target_kind {
                                TypingTarget::Dm => {
                                    let Ok(Some(chat)) = state_inner.store.get_chat(tid) else { continue };
                                    if !chat.participants.contains(&user_id) {
                                        continue;
                                    }
                                    chat.participants
                                        .iter()
                                        .copied()
                                        .filter(|&p| p != user_id)
                                        .collect()
                                }
                                TypingTarget::Group => {
                                    let Ok(Some(chan)) = state_inner.store.get_channel(tid) else { continue };
                                    // Broadcast channels deliberately drop typing.
                                    if !matches!(chan.kind, ChannelKind::Group) {
                                        continue;
                                    }
                                    let members = state_inner
                                        .store
                                        .channel_members(tid)
                                        .unwrap_or_default();
                                    if !members.contains(&user_id) {
                                        continue;
                                    }
                                    members
                                        .into_iter()
                                        .filter(|&m| m != user_id)
                                        .collect()
                                }
                            };
                            if recipients.is_empty() {
                                continue;
                            }
                            // Resolve the sender's display name so the client
                            // can render "X is typing…" without an extra lookup.
                            let user_name = state_inner
                                .store
                                .find_user_by_id(user_id)
                                .ok()
                                .flatten()
                                .map(|u| {
                                    u.name
                                        .clone()
                                        .filter(|n| !n.trim().is_empty())
                                        .or_else(|| u.username.clone())
                                        .unwrap_or_else(|| u.email.clone())
                                })
                                .unwrap_or_default();
                            let payload = serde_json::json!({
                                "type": "typing",
                                "payload": {
                                    "target_kind": target_kind,
                                    "target_id": target_id,
                                    "user_id": user_id.to_string(),
                                    "user_name": user_name,
                                    "started": started,
                                }
                            });
                            if let Ok(bytes) = serde_json::to_vec(&payload) {
                                state_inner.hub.deliver(&recipients, Bytes::from(bytes));
                            }
                        }
                        Incoming::Read { chat_id, msg_id } => {
                            let Ok(cid) = chat_id.parse::<u64>() else { continue };
                            let Ok(mid) = msg_id.parse::<u64>() else { continue };
                            let Ok(Some(chat)) = state_inner.store.get_chat(cid) else { continue };
                            if !chat.participants.contains(&user_id) {
                                continue;
                            }
                            let Ok(final_mid) = state_inner
                                .store
                                .mark_chat_read(cid, user_id, mid)
                                .await
                            else { continue };
                            let recipients: Vec<u64> = chat
                                .participants
                                .iter()
                                .copied()
                                .filter(|&p| p != user_id)
                                .collect();
                            let payload = serde_json::json!({
                                "type": "read",
                                "payload": {
                                    "chat_id": chat_id,
                                    "user_id": user_id.to_string(),
                                    "msg_id": final_mid.to_string(),
                                }
                            });
                            if let Ok(bytes) = serde_json::to_vec(&payload) {
                                state_inner.hub.deliver(&recipients, Bytes::from(bytes));
                            }
                        }
                        Incoming::ReadChannel { channel_id, msg_id } => {
                            let Ok(cid) = channel_id.parse::<u64>() else { continue };
                            let Ok(mid) = msg_id.parse::<u64>() else { continue };
                            if !state_inner
                                .store
                                .is_channel_member(cid, user_id)
                                .unwrap_or(false)
                            {
                                continue;
                            }
                            let _ = state_inner
                                .store
                                .mark_channel_read(cid, user_id, mid)
                                .await;
                            // No broadcast — channel reads are private to
                            // the reader.
                        }
                        Incoming::Ping => {}
                    }
                }
                WsMessage::Close(_) => break,
                _ => {}
            }
        }
    });

    // If either side errors out, abort the other so the connection unwinds
    // cleanly instead of leaking a half-dead task.
    tokio::select! {
        _ = &mut writer => { reader.abort(); }
        _ = &mut reader => { writer.abort(); }
    }
    state.hub.prune(user_id);
    // The final→0 transition is the offline event. We only broadcast if no
    // other socket for this user is still live (multi-device support).
    if state.hub.connection_count(user_id) == 0 {
        broadcast_presence(&state, user_id, false).await;
    }
}

/// Notify every user who shares a 1:1 chat with `user_id` that their
/// presence has changed. Cheap: snapshot the chat list, dedupe partner ids,
/// fire one fan-out via the hub.
async fn broadcast_presence(state: &AppState, user_id: u64, online: bool) {
    let Ok(chats) = state.store.list_chats_for_user(user_id) else {
        return;
    };
    let mut contacts = std::collections::HashSet::<u64>::new();
    for c in &chats {
        for &p in &c.participants {
            if p != user_id {
                contacts.insert(p);
            }
        }
    }
    if contacts.is_empty() {
        return;
    }
    let payload = serde_json::json!({
        "type": "presence",
        "payload": {
            "user_id": user_id.to_string(),
            "online": online,
        }
    });
    if let Ok(bytes) = serde_json::to_vec(&payload) {
        let recipients: Vec<u64> = contacts.into_iter().collect();
        state.hub.deliver(&recipients, Bytes::from(bytes));
    }
}
