use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::chat::{Chat, PublicChat, PublicMessage, PublicParticipant};
use crate::models::user::User;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", get(list_chats).post(create_chat))
        .route("/chats/:id/messages", get(list_messages).post(send_message))
}

/* -------------------- GET /chats -------------------- */

async fn list_chats(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<PublicChat>>> {
    let chats = state.store.list_chats_for_user(auth.user_id)?;
    Ok(Json(enrich_chats(&state, chats, auth.user_id)?))
}

/// Hydrate participant info, unread count, and the other party's read cursor
/// for the viewer.
fn enrich_chats(
    state: &AppState,
    chats: Vec<Chat>,
    viewer_id: u64,
) -> AppResult<Vec<PublicChat>> {
    if chats.is_empty() {
        return Ok(vec![]);
    }
    let mut user_ids: Vec<u64> =
        chats.iter().flat_map(|c| c.participants.iter().copied()).collect();
    user_ids.sort();
    user_ids.dedup();

    let mut by_id: HashMap<u64, User> = HashMap::with_capacity(user_ids.len());
    for uid in user_ids {
        if let Some(u) = state.store.find_user_by_id(uid)? {
            by_id.insert(uid, u);
        }
    }

    chats
        .into_iter()
        .map(|c| {
            // The "other" participant in a 1:1 chat — we only have two.
            let other_id = c
                .participants
                .iter()
                .find(|&&p| p != viewer_id)
                .copied()
                .unwrap_or(c.participants[0]);
            let unread_count = state.store.count_unread(c.id, viewer_id)?;
            let other_last_read = state.store.get_chat_read(c.id, other_id)?;
            let other_online = state.hub.is_online(other_id);
            Ok(PublicChat {
                id: c.id.to_string(),
                participants: c
                    .participants
                    .iter()
                    .map(|pid| match by_id.get(pid) {
                        Some(u) => PublicParticipant {
                            id: u.id.to_string(),
                            email: u.email.clone(),
                            username: u.username.clone(),
                            name: u.name.clone(),
                            picture: u.picture.clone(),
                        },
                        None => PublicParticipant {
                            id: pid.to_string(),
                            email: "unknown".into(),
                            username: None,
                            name: None,
                            picture: None,
                        },
                    })
                    .collect(),
                last_message_at: c.last_message_at,
                last_message_preview: c.last_message_preview,
                unread_count,
                other_last_read,
                other_online,
            })
        })
        .collect::<AppResult<Vec<PublicChat>>>()
}

/* -------------------- POST /chats -------------------- */

#[derive(Debug, Deserialize)]
struct CreateChatReq {
    /// Either an email or a username. Server resolves whichever matches.
    handle: String,
}

async fn create_chat(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateChatReq>,
) -> AppResult<Json<PublicChat>> {
    let handle = req.handle.trim();
    if handle.is_empty() {
        return Err(AppError::BadRequest("handle is required".into()));
    }
    let other = state
        .store
        .find_user_by_handle(handle)?
        .ok_or(AppError::NotFound)?;
    if other.id == auth.user_id {
        return Err(AppError::BadRequest("cannot chat with yourself".into()));
    }
    let chat = state.store.open_or_create_chat(auth.user_id, other.id).await?;
    let for_me = enrich_chats(&state, vec![chat.clone()], auth.user_id)?
        .into_iter()
        .next()
        .unwrap();
    // Push the chat into the OTHER participant's sidebar in real time. We
    // build it from their perspective (their unread + the other party's read
    // cursor) so the payload drops straight into their store with no
    // extra refetch. Idempotent on the client — duplicate ids are deduped.
    if let Ok(mut for_other) =
        enrich_chats(&state, vec![chat.clone()], other.id)
    {
        if let Some(payload_chat) = for_other.pop() {
            let payload = serde_json::json!({
                "type": "chat_opened",
                "payload": payload_chat,
            });
            if let Ok(bytes) = serde_json::to_vec(&payload) {
                state.hub.deliver(&[other.id], Bytes::from(bytes));
            }
        }
    }
    Ok(Json(for_me))
}

/* -------------------- GET /chats/:id/messages -------------------- */

#[derive(Debug, Deserialize)]
struct ListMessagesQuery {
    limit: Option<i64>,
    before: Option<String>,
}

async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(chat_id): Path<String>,
    Query(q): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<PublicMessage>>> {
    let chat_id: u64 = chat_id.parse().map_err(|_| AppError::BadRequest("bad chat id".into()))?;
    let chat = state.store.get_chat(chat_id)?.ok_or(AppError::NotFound)?;
    if !chat.participants.contains(&auth.user_id) {
        return Err(AppError::Forbidden("not a chat participant"));
    }
    let before = match q.before.as_deref() {
        Some(s) => Some(
            s.parse::<u64>()
                .map_err(|_| AppError::BadRequest("bad before cursor".into()))?,
        ),
        None => None,
    };
    let limit = q.limit.unwrap_or(50).clamp(1, 200) as usize;
    let msgs = state.store.list_messages(chat_id, limit, before)?;
    Ok(Json(msgs.iter().map(PublicMessage::from).collect()))
}

/* -------------------- POST /chats/:id/messages -------------------- */

#[derive(Debug, Deserialize)]
pub struct SendMessageReq {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub attachment_id: Option<String>,
}

async fn send_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(chat_id): Path<String>,
    Json(req): Json<SendMessageReq>,
) -> AppResult<Json<PublicMessage>> {
    let chat_id: u64 = chat_id.parse().map_err(|_| AppError::BadRequest("bad chat id".into()))?;
    let pub_msg = persist_and_broadcast(
        &state,
        chat_id,
        auth.user_id,
        req.body,
        req.attachment_id,
    )
    .await?;
    Ok(Json(pub_msg))
}

/* -------------------- internal: persist + broadcast -------------------- */

#[derive(Debug, Serialize)]
struct WsEvent<'a, T: Serialize> {
    #[serde(rename = "type")]
    typ: &'a str,
    payload: &'a T,
}

pub async fn persist_and_broadcast(
    state: &AppState,
    chat_id: u64,
    sender_id: u64,
    body: String,
    attachment_id: Option<String>,
) -> AppResult<PublicMessage> {
    let body = body.trim().to_string();
    if body.len() > 4096 {
        return Err(AppError::BadRequest("body too long".into()));
    }

    // Resolve and validate the attachment, if any. Owner must equal sender so
    // a malicious client can't attach someone else's upload by guessing IDs.
    // Stickers are the explicit exception — they're shared content and anyone
    // can send them once a pack is installed.
    let attachment = match attachment_id.as_deref() {
        Some(id) if !id.is_empty() => {
            let upload = state
                .store
                .find_upload(id)?
                .ok_or_else(|| AppError::BadRequest("unknown attachment".into()))?;
            let is_sticker = matches!(
                upload.attachment.kind,
                crate::models::chat::AttachmentKind::Sticker
            );
            if !is_sticker && upload.owner_id != sender_id {
                return Err(AppError::Forbidden("not your attachment"));
            }
            Some(upload.attachment)
        }
        _ => None,
    };

    if body.is_empty() && attachment.is_none() {
        return Err(AppError::BadRequest("empty message".into()));
    }

    let (msg, chat) = state
        .store
        .append_message(chat_id, sender_id, body, attachment)
        .await?;
    let public = PublicMessage::from(&msg);
    let event = WsEvent { typ: "message", payload: &public };
    let payload = serde_json::to_vec(&event)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("ws encode: {e}")))?;
    state.hub.deliver(&chat.participants, Bytes::from(payload));
    Ok(public)
}
