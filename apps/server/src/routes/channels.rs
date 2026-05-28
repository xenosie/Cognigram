use std::collections::HashMap;

use axum::extract::{Multipart, Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::Bytes;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::channel::{Channel, ChannelKind, PublicChannel};
use crate::models::chat::{PublicMessage, PublicParticipant};
use crate::state::AppState;

/// Build a `PublicChannel` with the viewer's membership / owner / unread
/// state filled in. One call site for everywhere we return a channel to a
/// client.
pub(crate) fn build_public(
    state: &AppState,
    c: &Channel,
    viewer_id: u64,
) -> PublicChannel {
    let is_member = state
        .store
        .is_channel_member(c.id, viewer_id)
        .unwrap_or(false);
    let is_owner = c.owner_id == viewer_id;
    let unread = if is_member {
        state
            .store
            .count_channel_unread(c.id, viewer_id)
            .unwrap_or(0)
    } else {
        0
    };
    PublicChannel::new(c, is_member, is_owner, unread)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels", post(create_channel).get(list_my_channels))
        .route("/channels/by-uname/:uname", get(get_by_uname))
        .route("/channels/:id", get(get_channel).patch(patch_channel))
        .route("/channels/:id/join", post(join))
        .route("/channels/:id/leave", post(leave))
        .route("/channels/:id/avatar", post(upload_avatar))
        .route(
            "/channels/:id/messages",
            get(list_messages).post(send_message),
        )
}

const AVATAR_MAX_BYTES: usize = 3 * 1024 * 1024;

const HANDLE_RE_OK: fn(&str) -> bool = |s: &str| {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
};

/* -------------------- POST /channels -------------------- */

#[derive(Debug, Deserialize)]
struct CreateChannelReq {
    kind: ChannelKind,
    uname: String,
    name: String,
    description: Option<String>,
}

async fn create_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateChannelReq>,
) -> AppResult<Json<PublicChannel>> {
    let uname = req.uname.trim().to_ascii_lowercase();
    if uname.len() < 5 || uname.len() > 32 || !HANDLE_RE_OK(&uname) {
        return Err(AppError::BadRequest(
            "uname must be 5-32 chars, lowercase letters / digits / _".into(),
        ));
    }
    let name = req.name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::BadRequest("name must be 1-64 chars".into()));
    }

    let channel = state
        .store
        .create_channel(
            auth.user_id,
            req.kind,
            uname,
            name.to_string(),
            req.description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        )
        .await?;
    Ok(Json(build_public(&state, &channel, auth.user_id)))
}

/* -------------------- GET /channels (my channels) -------------------- */

async fn list_my_channels(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<PublicChannel>>> {
    let chans = state.store.list_user_channels(auth.user_id)?;
    Ok(Json(
        chans
            .iter()
            .map(|c| build_public(&state, c, auth.user_id))
            .collect(),
    ))
}

/* -------------------- GET /channels/by-uname/:uname -------------------- */

async fn get_by_uname(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(uname): Path<String>,
) -> AppResult<Json<PublicChannel>> {
    let c = state
        .store
        .find_channel_by_uname(&uname)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(build_public(&state, &c, auth.user_id)))
}

/* -------------------- GET /channels/:id -------------------- */

async fn get_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<PublicChannel>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    let c = state.store.get_channel(id)?.ok_or(AppError::NotFound)?;
    Ok(Json(build_public(&state, &c, auth.user_id)))
}

/* -------------------- PATCH /channels/:id -------------------- */

#[derive(Debug, Deserialize)]
struct PatchChannelReq {
    name: Option<String>,
    uname: Option<String>,
    /// Send the new description string (empty string clears it). Omit the
    /// field entirely to leave it unchanged.
    description: Option<String>,
}

async fn patch_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<PatchChannelReq>,
) -> AppResult<Json<PublicChannel>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    if let Some(uname) = req.uname.as_deref() {
        let u = uname.trim().to_ascii_lowercase();
        if u.len() < 5 || u.len() > 32 || !HANDLE_RE_OK(&u) {
            return Err(AppError::BadRequest(
                "uname must be 5-32 chars, lowercase letters / digits / _".into(),
            ));
        }
    }
    let c = state
        .store
        .update_channel(id, auth.user_id, req.name, req.uname, req.description)
        .await?;
    Ok(Json(build_public(&state, &c, auth.user_id)))
}

/* -------------------- join / leave -------------------- */

async fn join(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<PublicChannel>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    let c = state.store.join_channel(id, auth.user_id).await?;

    // Notify existing members (besides the joiner) so they can pop a
    // "<name> joined" notification and bump the member count live.
    let user = state.store.find_user_by_id(auth.user_id)?;
    let user_name = user
        .as_ref()
        .map(|u| {
            u.name
                .clone()
                .filter(|n| !n.trim().is_empty())
                .or_else(|| u.username.clone())
                .unwrap_or_else(|| u.email.clone())
        })
        .unwrap_or_default();
    let members = state.store.channel_members(c.id).unwrap_or_default();
    let recipients: Vec<u64> = members
        .into_iter()
        .filter(|&m| m != auth.user_id)
        .collect();
    if !recipients.is_empty() {
        let payload = serde_json::json!({
            "type": "channel_joined",
            "payload": {
                "channel_id": c.id.to_string(),
                "channel_name": c.name,
                "channel_uname": c.uname,
                "user_id": auth.user_id.to_string(),
                "user_name": user_name,
            }
        });
        if let Ok(bytes) = serde_json::to_vec(&payload) {
            state.hub.deliver(&recipients, Bytes::from(bytes));
        }
    }

    Ok(Json(build_public(&state, &c, auth.user_id)))
}

async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    state.store.leave_channel(id, auth.user_id).await?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/* -------------------- channel avatar upload -------------------- */

async fn upload_avatar(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> AppResult<Json<PublicChannel>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    let chan = state.store.get_channel(id)?.ok_or(AppError::NotFound)?;
    if chan.owner_id != auth.user_id {
        return Err(AppError::Forbidden("not the owner"));
    }

    let mut field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart: {e}")))?
        .ok_or_else(|| AppError::BadRequest("missing file field".into()))?;

    let content_type = field
        .content_type()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let ext = match content_type.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => {
            return Err(AppError::BadRequest(
                "unsupported image type (use jpeg / png / gif / webp)".into(),
            ))
        }
    };

    let dir = state.uploads_root.join("channel-avatars");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("create dir: {e}")))?;
    let final_path = dir.join(format!("{}.{}", id, ext));
    let tmp_path = dir.join(format!(".{}.{}.part", id, ext));

    {
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("create tmp: {e}")))?;
        let mut total: usize = 0;
        loop {
            let chunk = field
                .chunk()
                .await
                .map_err(|e| AppError::BadRequest(format!("read part: {e}")))?;
            let Some(chunk) = chunk else { break };
            total += chunk.len();
            if total > AVATAR_MAX_BYTES {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(AppError::BadRequest("avatar must be 3 MB or smaller".into()));
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("write: {e}")))?;
        }
        file.flush().await.ok();
    }

    for old_ext in ["jpg", "png", "gif", "webp"] {
        if old_ext == ext {
            continue;
        }
        let stale = dir.join(format!("{}.{}", id, old_ext));
        let _ = tokio::fs::remove_file(stale).await;
    }
    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("rename: {e}")))?;

    let ts = Utc::now().timestamp_millis();
    let url = format!("/uploads/channel-avatars/{}.{}?v={}", id, ext, ts);
    let updated = state
        .store
        .set_channel_avatar(id, auth.user_id, Some(url))
        .await?;
    Ok(Json(build_public(&state, &updated, auth.user_id)))
}

/* -------------------- messages -------------------- */

#[derive(Debug, Deserialize)]
struct ListMessagesQuery {
    limit: Option<i64>,
    before: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChannelMessageList {
    messages: Vec<PublicMessage>,
    senders: HashMap<String, PublicParticipant>,
}

async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<ListMessagesQuery>,
) -> AppResult<Json<ChannelMessageList>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    let c = state.store.get_channel(id)?.ok_or(AppError::NotFound)?;
    if !state.store.is_channel_member(id, auth.user_id)? {
        return Err(AppError::Forbidden("not a channel member"));
    }
    let before = match q.before.as_deref() {
        Some(s) => Some(
            s.parse::<u64>()
                .map_err(|_| AppError::BadRequest("bad before cursor".into()))?,
        ),
        None => None,
    };
    let limit = q.limit.unwrap_or(50).clamp(1, 200) as usize;
    let msgs = state.store.list_channel_messages(id, limit, before)?;

    // Hydrate senders so the client can render avatars + names without an
    // extra round-trip per author.
    let mut sender_ids: Vec<u64> = msgs.iter().map(|m| m.sender_id).collect();
    sender_ids.sort();
    sender_ids.dedup();
    let mut senders: HashMap<String, PublicParticipant> = HashMap::new();
    for uid in sender_ids {
        if let Some(u) = state.store.find_user_by_id(uid)? {
            senders.insert(
                u.id.to_string(),
                PublicParticipant {
                    id: u.id.to_string(),
                    email: u.email.clone(),
                    username: u.username.clone(),
                    name: u.name.clone(),
                    picture: u.picture.clone(),
                },
            );
        }
    }
    let _ = c;
    Ok(Json(ChannelMessageList {
        messages: msgs.iter().map(PublicMessage::from).collect(),
        senders,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SendChannelMessageReq {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub attachment_id: Option<String>,
}

async fn send_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SendChannelMessageReq>,
) -> AppResult<Json<PublicMessage>> {
    let id: u64 = id.parse().map_err(|_| AppError::BadRequest("bad channel id".into()))?;
    let m = persist_and_broadcast_channel(&state, id, auth.user_id, req.body, req.attachment_id)
        .await?;
    Ok(Json(m))
}

/* -------------------- internal: persist + broadcast (channel) -------------------- */

#[derive(Debug, Serialize)]
struct WsEvent<'a, T: Serialize> {
    #[serde(rename = "type")]
    typ: &'a str,
    payload: &'a T,
}

pub async fn persist_and_broadcast_channel(
    state: &AppState,
    channel_id: u64,
    sender_id: u64,
    body: String,
    attachment_id: Option<String>,
) -> AppResult<PublicMessage> {
    let body = body.trim().to_string();
    if body.len() > 4096 {
        return Err(AppError::BadRequest("body too long".into()));
    }
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

    let (msg, _channel, members) = state
        .store
        .append_channel_message(channel_id, sender_id, body, attachment)
        .await?;
    let public = PublicMessage::from(&msg);
    let event = WsEvent { typ: "channel_message", payload: &public };
    let payload = serde_json::to_vec(&event)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("ws encode: {e}")))?;
    state.hub.deliver(&members, Bytes::from(payload));
    Ok(public)
}
