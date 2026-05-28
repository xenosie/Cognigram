use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/users", get(list_users))
}

#[derive(Debug, Deserialize)]
struct ListUsersQuery {
    q: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PublicContact {
    id: String,
    email: String,
    username: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

// Substring match on email or username. We scan the USERS table linearly
// (bounded by `limit`) — fine up to ~10k users. Above that, add a prefix
// trie or move to a SQL backend.
async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(q): Query<ListUsersQuery>,
) -> AppResult<Json<Vec<PublicContact>>> {
    let limit = q.limit.unwrap_or(100).clamp(1, 200) as usize;
    let users = state
        .store
        .list_users(q.q.as_deref(), limit, auth.user_id)?;
    Ok(Json(
        users
            .iter()
            .map(|u| PublicContact {
                id: u.id.to_string(),
                email: u.email.clone(),
                username: u.username.clone(),
                name: u.name.clone(),
                picture: u.picture.clone(),
            })
            .collect(),
    ))
}
