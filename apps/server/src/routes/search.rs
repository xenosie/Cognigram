use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::models::channel::PublicChannel;
use crate::models::sticker::PublicStickerPack;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/search", get(search))
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct UserHit {
    id: String,
    email: String,
    username: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

#[derive(Debug, Serialize)]
struct SearchResults {
    users: Vec<UserHit>,
    channels: Vec<PublicChannel>,
    sticker_packs: Vec<PublicStickerPack>,
}

async fn search(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<SearchResults>> {
    let limit = q.limit.unwrap_or(20).clamp(1, 100) as usize;

    let users = state
        .store
        .list_users(Some(&q.q), limit, auth.user_id)?
        .into_iter()
        .map(|u| UserHit {
            id: u.id.to_string(),
            email: u.email,
            username: u.username,
            name: u.name,
            picture: u.picture,
        })
        .collect();

    let channels: Vec<PublicChannel> = state
        .store
        .search_channels(&q.q, limit)?
        .into_iter()
        .map(|c| crate::routes::channels::build_public(&state, &c, auth.user_id))
        .collect();

    let sticker_packs: Vec<PublicStickerPack> = state
        .store
        .search_sticker_packs(&q.q, limit)?
        .into_iter()
        .map(|p| {
            let is_installed = p.is_default
                || state
                    .store
                    .is_pack_installed(auth.user_id, p.id)
                    .unwrap_or(false);
            let is_owner = p.owner_id == auth.user_id;
            PublicStickerPack::new(&p, is_installed, is_owner)
        })
        .collect();

    Ok(Json(SearchResults {
        users,
        channels,
        sticker_packs,
    }))
}
