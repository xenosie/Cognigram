use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDateTime};
use mongodb::options::FindOptions;
use serde::{Deserialize, Serialize};
use serde_json::json;
use validator::Validate;
use futures_util::stream::TryStreamExt;

use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::chat::{Chat, Message, PublicChat, PublicMessage, PublicParticipant};
use crate::models::user::User;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/chats", get(list_chats).post(create_chat))
        .route("/chats/:id/messages", get(list_messages).post(send_message))
}

fn now() -> BsonDateTime {
    BsonDateTime::now()
}

fn sort_participants(a: ObjectId, b: ObjectId) -> Vec<ObjectId> {
    if a <= b { vec![a, b] } else { vec![b, a] }
}

/* -------------------- list user's chats -------------------- */

async fn list_chats(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<PublicChat>>> {
    let chats = state
        .db
        .database
        .collection::<Chat>("chats")
        .find(doc! { "participants": auth.user_id })
        .sort(doc! { "last_message_at": -1 })
        .await?
        .try_collect::<Vec<_>>()
        .await?;

    let enriched = enrich_chats(&state, chats).await?;
    Ok(Json(enriched))
}

/// Single batched lookup of all participant users + last-message preview per chat.
async fn enrich_chats(state: &AppState, chats: Vec<Chat>) -> AppResult<Vec<PublicChat>> {
    if chats.is_empty() {
        return Ok(vec![]);
    }

    let mut user_ids: Vec<ObjectId> = chats.iter().flat_map(|c| c.participants.clone()).collect();
    user_ids.sort();
    user_ids.dedup();

    let users: Vec<User> = state
        .db
        .database
        .collection::<User>("users")
        .find(doc! { "_id": { "$in": &user_ids } })
        .await?
        .try_collect()
        .await?;
    let by_id: HashMap<ObjectId, &User> =
        users.iter().filter_map(|u| u.id.map(|id| (id, u))).collect();

    let chat_ids: Vec<ObjectId> = chats.iter().filter_map(|c| c.id).collect();
    let mut previews: HashMap<ObjectId, String> = HashMap::new();
    if !chat_ids.is_empty() {
        // Fetch the latest message per chat. Aggregation $group is the cleanest.
        let pipeline = vec![
            doc! { "$match": { "chat_id": { "$in": &chat_ids } } },
            doc! { "$sort": { "_id": -1 } },
            doc! {
                "$group": {
                    "_id": "$chat_id",
                    "body": { "$first": "$body" }
                }
            },
        ];
        let mut cursor = state
            .db
            .database
            .collection::<mongodb::bson::Document>("messages")
            .aggregate(pipeline)
            .await?;
        while let Some(doc) = cursor.try_next().await? {
            if let (Ok(chat_id), Ok(body)) = (doc.get_object_id("_id"), doc.get_str("body")) {
                previews.insert(chat_id, body.to_string());
            }
        }
    }

    Ok(chats
        .into_iter()
        .map(|c| PublicChat {
            id: c.id.map(|i| i.to_hex()).unwrap_or_default(),
            participants: c
                .participants
                .iter()
                .map(|pid| {
                    let user = by_id.get(pid);
                    let email = user
                        .map(|u| u.email.clone())
                        .unwrap_or_else(|| "unknown".to_string());
                    let username = user.and_then(|u| u.username.clone());
                    PublicParticipant {
                        id: pid.to_hex(),
                        email,
                        username,
                    }
                })
                .collect(),
            last_message_at: c.last_message_at.map(|d| d.timestamp_millis()),
            last_message_preview: c.id.and_then(|id| previews.get(&id).cloned()),
        })
        .collect())
}

/* -------------------- find or create a 1:1 chat -------------------- */

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
    let handle = req.handle.trim().to_lowercase();
    if handle.is_empty() {
        return Err(AppError::BadRequest("handle is required".into()));
    }

    let users = state.db.database.collection::<User>("users");
    let other = users
        .find_one(doc! {
            "$or": [
                { "email": &handle },
                { "username": &handle },
            ]
        })
        .await?
        .ok_or(AppError::NotFound)?;
    let other_id = other.id.ok_or(AppError::NotFound)?;

    if other_id == auth.user_id {
        return Err(AppError::BadRequest("cannot chat with yourself".into()));
    }

    let parts = sort_participants(auth.user_id, other_id);
    let chats = state.db.database.collection::<Chat>("chats");

    if let Some(existing) = chats
        .find_one(doc! { "participants": &parts })
        .await?
    {
        let enriched = enrich_chats(&state, vec![existing]).await?;
        return Ok(Json(enriched.into_iter().next().unwrap()));
    }

    let chat = Chat {
        id: None,
        participants: parts,
        last_message_at: None,
        created_at: now(),
        updated_at: now(),
    };
    let res = chats.insert_one(&chat).await?;
    let mut created = chat;
    created.id = res.inserted_id.as_object_id();
    let enriched = enrich_chats(&state, vec![created]).await?;
    Ok(Json(enriched.into_iter().next().unwrap()))
}

/* -------------------- list messages in a chat -------------------- */

#[derive(Debug, Deserialize)]
struct ListMessagesQuery {
    limit: Option<i64>,
    before: Option<String>, // ObjectId hex
}

async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(chat_id): Path<String>,
    Query(q): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<PublicMessage>>> {
    let chat_oid = ObjectId::parse_str(&chat_id)
        .map_err(|_| AppError::BadRequest("bad chat id".into()))?;

    let chat = state
        .db
        .database
        .collection::<Chat>("chats")
        .find_one(doc! { "_id": chat_oid })
        .await?
        .ok_or(AppError::NotFound)?;
    if !chat.participants.contains(&auth.user_id) {
        return Err(AppError::Forbidden);
    }

    let mut filter = doc! { "chat_id": chat_oid };
    if let Some(before) = q.before.as_ref() {
        let before_oid = ObjectId::parse_str(before)
            .map_err(|_| AppError::BadRequest("bad before cursor".into()))?;
        filter.insert("_id", doc! { "$lt": before_oid });
    }

    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let opts = FindOptions::builder()
        .sort(doc! { "_id": -1 })
        .limit(limit)
        .build();

    let mut messages = state
        .db
        .database
        .collection::<Message>("messages")
        .find(filter)
        .with_options(opts)
        .await?
        .try_collect::<Vec<_>>()
        .await?;
    // Return in ascending order for UI
    messages.reverse();
    Ok(Json(messages.iter().map(PublicMessage::from).collect()))
}

/* -------------------- send a message (REST fallback + WS-fanout) -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct SendMessageReq {
    #[validate(length(min = 1, max = 4096))]
    body: String,
}

#[derive(Debug, Serialize)]
struct WsEvent<'a, T: Serialize> {
    #[serde(rename = "type")]
    typ: &'a str,
    payload: &'a T,
}

pub async fn persist_and_broadcast(
    state: &AppState,
    chat_id: ObjectId,
    sender_id: ObjectId,
    body: String,
) -> AppResult<PublicMessage> {
    // Validate the sender is a participant
    let chats = state.db.database.collection::<Chat>("chats");
    let chat = chats
        .find_one(doc! { "_id": chat_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if !chat.participants.contains(&sender_id) {
        return Err(AppError::Forbidden);
    }

    let msg = Message {
        id: None,
        chat_id,
        sender_id,
        body,
        created_at: now(),
    };
    let res = state
        .db
        .database
        .collection::<Message>("messages")
        .insert_one(&msg)
        .await?;
    let mut stored = msg;
    stored.id = res.inserted_id.as_object_id();

    // bump chat
    chats
        .update_one(
            doc! { "_id": chat_id },
            doc! { "$set": { "last_message_at": stored.created_at, "updated_at": stored.created_at } },
        )
        .await?;

    let public = PublicMessage::from(&stored);
    let event = WsEvent { typ: "message", payload: &public };
    let payload = serde_json::to_string(&event).unwrap();
    // fan out to all participants (including sender — for multi-device sync)
    state.hub.deliver(&chat.participants, payload);

    Ok(public)
}

async fn send_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(chat_id): Path<String>,
    Json(req): Json<SendMessageReq>,
) -> AppResult<Json<PublicMessage>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let chat_oid = ObjectId::parse_str(&chat_id)
        .map_err(|_| AppError::BadRequest("bad chat id".into()))?;
    let m = persist_and_broadcast(&state, chat_oid, auth.user_id, req.body).await?;
    Ok(Json(m))
}

#[allow(dead_code)]
fn ack_response() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
