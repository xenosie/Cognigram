use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;

use crate::error::AppResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/health/db", get(health_db))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

async fn health_db(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let latency_ms = state.store.ping()?;
    Ok(Json(json!({ "status": "ok", "latency_ms": latency_ms })))
}
