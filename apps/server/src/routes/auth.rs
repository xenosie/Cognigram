use axum::extract::{Multipart, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncWriteExt;
use validator::Validate;

use crate::error::{AppError, AppResult};
use crate::hash::hash_token;
use crate::jwt;
use crate::middleware::AuthUser;
use crate::models::user::PublicUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/google", post(google_signin))
        // First-time username pick. Same handler as PATCH /me/username so the
        // existing client flow stays compatible.
        .route("/auth/username", post(set_username))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me).patch(patch_me))
        .route("/auth/me/avatar", post(upload_avatar))
        .route("/handles/check", get(check_handle))
}

#[derive(Debug, Serialize)]
struct TokenPair {
    access_token: String,
    refresh_token: String,
    token_type: &'static str,
    expires_in: u64,
}

#[derive(Debug, Serialize)]
struct GoogleAuthRes {
    user: PublicUser,
    tokens: TokenPair,
    /// `true` if this is a freshly created account that still needs to pick a
    /// username. Frontend uses this to route to /pick-username.
    needs_username: bool,
}

/* -------------------- POST /auth/google -------------------- */

#[derive(Debug, Deserialize)]
struct GoogleReq {
    id_token: String,
}

async fn google_signin(
    State(state): State<AppState>,
    Json(req): Json<GoogleReq>,
) -> AppResult<Json<GoogleAuthRes>> {
    if req.id_token.is_empty() {
        return Err(AppError::BadRequest("id_token required".into()));
    }

    let claims = state.oauth.verify(&req.id_token).await?;

    if !claims.email_verified {
        return Err(AppError::Forbidden("email_not_verified"));
    }
    if state.config.gmail_only
        && !claims
            .email
            .to_ascii_lowercase()
            .ends_with("@gmail.com")
    {
        return Err(AppError::Forbidden("gmail_only"));
    }

    let user = state
        .store
        .create_or_update_user_from_google(
            claims.sub,
            claims.email,
            claims.name,
            claims.picture,
        )
        .await?;

    let needs_username = user.username.is_none();
    let tokens = issue_token_pair(&state, user.id).await?;
    Ok(Json(GoogleAuthRes {
        user: PublicUser::from(&user),
        tokens,
        needs_username,
    }))
}

/* -------------------- POST /auth/username (first-time pick) -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct UsernameReq {
    #[validate(length(min = 5, max = 32))]
    username: String,
}

fn is_valid_username(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

async fn set_username(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UsernameReq>,
) -> AppResult<Json<PublicUser>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let username = req.username.trim().to_ascii_lowercase();
    if !is_valid_username(&username) {
        return Err(AppError::BadRequest(
            "username may only contain letters, numbers and underscores".into(),
        ));
    }
    let user = state
        .store
        .update_profile(auth.user_id, None, Some(username))
        .await?;
    Ok(Json(PublicUser::from(&user)))
}

/* -------------------- PATCH /auth/me -------------------- */

#[derive(Debug, Deserialize)]
struct PatchMeReq {
    display_name: Option<String>,
    username: Option<String>,
}

async fn patch_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<PatchMeReq>,
) -> AppResult<Json<PublicUser>> {
    // Validate username if provided
    if let Some(uname) = req.username.as_deref() {
        let uname = uname.trim();
        if uname.len() < 5 || uname.len() > 32 {
            return Err(AppError::BadRequest(
                "username must be 5-32 characters".into(),
            ));
        }
        if !is_valid_username(&uname.to_ascii_lowercase()) {
            return Err(AppError::BadRequest(
                "username may only contain letters, numbers and underscores".into(),
            ));
        }
    }
    if let Some(dn) = req.display_name.as_deref() {
        if dn.trim().len() > 64 {
            return Err(AppError::BadRequest(
                "display name must be 64 characters or fewer".into(),
            ));
        }
    }
    let user = state
        .store
        .update_profile(auth.user_id, req.display_name, req.username)
        .await?;
    Ok(Json(PublicUser::from(&user)))
}

/* -------------------- POST /auth/me/avatar -------------------- */

const AVATAR_MAX_BYTES: usize = 3 * 1024 * 1024;

async fn upload_avatar(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> AppResult<Json<PublicUser>> {
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

    // Stream the part to a temp file inside the avatars dir, then atomically
    // rename. This avoids a half-written file if the upload aborts.
    let avatars_dir = state.uploads_root.join("avatars");
    let final_path = avatars_dir.join(format!("{}.{}", auth.user_id, ext));
    let tmp_path = avatars_dir.join(format!(".{}.{}.part", auth.user_id, ext));

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

    // Remove any old avatar of a different extension so we don't leak stale
    // files; ignore failures (file may simply not exist).
    for old_ext in ["jpg", "png", "gif", "webp"] {
        if old_ext == ext {
            continue;
        }
        let stale = avatars_dir.join(format!("{}.{}", auth.user_id, old_ext));
        let _ = tokio::fs::remove_file(stale).await;
    }
    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("rename: {e}")))?;

    // Cache-bust the URL so the new image shows up immediately even if a
    // browser cached the old one at this path.
    let ts = Utc::now().timestamp_millis();
    let url = format!("/uploads/avatars/{}.{}?v={}", auth.user_id, ext, ts);
    let user = state.store.set_avatar(auth.user_id, Some(url)).await?;
    Ok(Json(PublicUser::from(&user)))
}

/* -------------------- GET /handles/check?uname= -------------------- */

#[derive(Debug, Deserialize)]
struct CheckHandleQuery {
    uname: String,
}

#[derive(Debug, Serialize)]
struct CheckHandleRes {
    available: bool,
}

async fn check_handle(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Query(q): axum::extract::Query<CheckHandleQuery>,
) -> AppResult<Json<CheckHandleRes>> {
    let uname = q.uname.trim().to_ascii_lowercase();
    if uname.len() < 5 || uname.len() > 32 || !is_valid_username(&uname) {
        return Ok(Json(CheckHandleRes { available: false }));
    }
    // Unified handle namespace: any user OR channel owning the handle wins.
    match state.store.find_user_by_username(&uname)? {
        Some(u) if u.id == auth.user_id => return Ok(Json(CheckHandleRes { available: true })),
        Some(_) => return Ok(Json(CheckHandleRes { available: false })),
        None => {}
    }
    if state.store.find_channel_by_uname(&uname)?.is_some() {
        return Ok(Json(CheckHandleRes { available: false }));
    }
    Ok(Json(CheckHandleRes { available: true }))
}

/* -------------------- POST /auth/refresh -------------------- */

#[derive(Debug, Deserialize)]
struct RefreshReq {
    refresh_token: String,
}

async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshReq>,
) -> AppResult<Json<TokenPair>> {
    let old_hash = hash_token(&req.refresh_token);
    let new_plain = random_refresh_token();
    let new_hash = hash_token(&new_plain);
    let expires_at = Utc::now().timestamp_millis()
        + (state.config.jwt_refresh_ttl_secs as i64) * 1000;

    let user_id = state
        .store
        .rotate_refresh_token(old_hash, new_hash, expires_at)
        .await?;

    let access = jwt::issue_access(
        user_id,
        &state.config.jwt_secret,
        state.config.jwt_access_ttl_secs,
    )?;

    Ok(Json(TokenPair {
        access_token: access,
        refresh_token: new_plain,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl_secs,
    }))
}

/* -------------------- POST /auth/logout -------------------- */

async fn logout(
    State(state): State<AppState>,
    Json(req): Json<RefreshReq>,
) -> AppResult<Json<serde_json::Value>> {
    let hash = hash_token(&req.refresh_token);
    state.store.revoke_refresh_token(hash).await?;
    Ok(Json(json!({ "status": "ok" })))
}

/* -------------------- GET /auth/me -------------------- */

async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<PublicUser>> {
    let user = state
        .store
        .find_user_by_id(auth.user_id)?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(PublicUser::from(&user)))
}

/* -------------------- helpers -------------------- */

fn random_refresh_token() -> String {
    let mut buf = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

async fn issue_token_pair(state: &AppState, user_id: u64) -> AppResult<TokenPair> {
    let access = jwt::issue_access(
        user_id,
        &state.config.jwt_secret,
        state.config.jwt_access_ttl_secs,
    )?;
    let refresh_plain = random_refresh_token();
    let refresh_hash = hash_token(&refresh_plain);
    let expires_at = Utc::now().timestamp_millis()
        + (state.config.jwt_refresh_ttl_secs as i64) * 1000;
    state
        .store
        .insert_refresh_token(user_id, refresh_hash, expires_at)
        .await?;
    Ok(TokenPair {
        access_token: access,
        refresh_token: refresh_plain,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl_secs,
    })
}
