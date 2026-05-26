use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use mongodb::bson::oid::ObjectId;
use serde::Deserialize;

use crate::error::AppError;
use crate::jwt;
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
    let user_id = ObjectId::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;
    Ok(upgrade.on_upgrade(move |socket| handle_socket(state, socket, user_id)))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Incoming {
    Send { chat_id: String, body: String },
    Ping,
}

async fn handle_socket(state: AppState, socket: WebSocket, user_id: ObjectId) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.hub.register(user_id);

    // Forward hub messages to client
    let writer = tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            if sender.send(WsMessage::Text(payload)).await.is_err() {
                break;
            }
        }
    });

    // Read incoming frames
    let state_inner = state.clone();
    let reader = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                WsMessage::Text(t) => {
                    let parsed: Result<Incoming, _> = serde_json::from_str(&t);
                    if let Ok(inc) = parsed {
                        match inc {
                            Incoming::Send { chat_id, body } => {
                                let body = body.trim().to_string();
                                if body.is_empty() || body.len() > 4096 {
                                    continue;
                                }
                                if let Ok(oid) = ObjectId::parse_str(&chat_id) {
                                    if let Err(e) =
                                        persist_and_broadcast(&state_inner, oid, user_id, body)
                                            .await
                                    {
                                        tracing::warn!(error = ?e, "ws send failed");
                                    }
                                }
                            }
                            Incoming::Ping => {
                                // No reply needed — keepalive only.
                            }
                        }
                    }
                }
                WsMessage::Close(_) => break,
                _ => {}
            }
        }
    });

    let _ = tokio::join!(writer, reader);
    state.hub.prune(user_id);
}
