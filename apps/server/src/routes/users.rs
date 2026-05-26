use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::stream::TryStreamExt;
use mongodb::bson::doc;
use mongodb::options::FindOptions;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::models::user::User;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/users", get(list_users))
}

#[derive(Debug, Deserialize)]
struct ListUsersQuery {
    /// Case-insensitive substring match on either email or username.
    q: Option<String>,
    /// Max results — clamped to [1, 200], default 100.
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PublicContact {
    id: String,
    email: String,
    username: Option<String>,
}

async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListUsersQuery>,
) -> AppResult<Json<Vec<PublicContact>>> {
    let limit = query.limit.unwrap_or(100).clamp(1, 200);

    let mut filter = doc! { "_id": { "$ne": auth.user_id } };
    if let Some(term) = query.q.as_ref() {
        let term = term.trim();
        if !term.is_empty() {
            let escaped = regex_escape(term);
            // Match either field via $or
            filter.insert(
                "$or",
                vec![
                    doc! { "email": { "$regex": &escaped, "$options": "i" } },
                    doc! { "username": { "$regex": &escaped, "$options": "i" } },
                ],
            );
        }
    }

    let opts = FindOptions::builder()
        .sort(doc! { "username": 1, "email": 1 })
        .limit(limit)
        .build();

    let users: Vec<User> = state
        .db
        .database
        .collection::<User>("users")
        .find(filter)
        .with_options(opts)
        .await?
        .try_collect()
        .await?;

    Ok(Json(
        users
            .iter()
            .filter_map(|u| {
                u.id.map(|id| PublicContact {
                    id: id.to_hex(),
                    email: u.email.clone(),
                    username: u.username.clone(),
                })
            })
            .collect(),
    ))
}

fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if "\\^$.|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
