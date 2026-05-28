//! Sticker packs — create / inspect / install / search, plus owner-only
//! sticker uploads. Files live under `./data/uploads/stickers/<pack_id>/...`
//! and are served by the global ServeDir.

use axum::extract::{Multipart, Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::chat::{Attachment, AttachmentKind, Upload};
use crate::models::sticker::{PublicSticker, PublicStickerPack};
use crate::state::AppState;

const STICKER_MAX_BYTES: usize = 512 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/sticker-packs",
            post(create_pack).get(list_my_packs),
        )
        .route("/sticker-packs/by-uname/:uname", get(get_pack_by_uname))
        .route("/sticker-packs/:id", get(get_pack))
        .route("/sticker-packs/:id/install", post(install))
        .route("/sticker-packs/:id/uninstall", post(uninstall))
        .route("/sticker-packs/:id/stickers", post(upload_sticker))
}

const UNAME_RE_OK: fn(&str) -> bool = |s: &str| {
    !s.is_empty()
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
};

/* -------------------- POST /sticker-packs -------------------- */

#[derive(Debug, Deserialize)]
struct CreatePackReq {
    uname: String,
    name: String,
}

async fn create_pack(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreatePackReq>,
) -> AppResult<Json<PublicStickerPack>> {
    let uname = req.uname.trim().to_ascii_lowercase();
    if uname.len() < 5 || uname.len() > 32 || !UNAME_RE_OK(&uname) {
        return Err(AppError::BadRequest(
            "uname must be 5-32 chars, lowercase letters / digits / _".into(),
        ));
    }
    let name = req.name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::BadRequest("name must be 1-64 chars".into()));
    }
    let pack = state
        .store
        .create_sticker_pack(auth.user_id, uname, name.to_string(), false)
        .await?;
    // Auto-install for the owner so it shows up in their picker immediately.
    let _ = state
        .store
        .install_sticker_pack(auth.user_id, pack.id)
        .await;
    Ok(Json(PublicStickerPack::new(&pack, true, true)))
}

/* -------------------- GET /sticker-packs (my installed + defaults) ----- */

#[derive(Debug, Serialize)]
struct PackWithStickers {
    pack: PublicStickerPack,
    stickers: Vec<PublicSticker>,
}

async fn list_my_packs(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<PackWithStickers>>> {
    let packs = state.store.list_user_sticker_packs(auth.user_id)?;
    let mut out = Vec::with_capacity(packs.len());
    for p in packs {
        let stickers = state.store.list_stickers_in_pack(p.id)?;
        let is_installed =
            p.is_default || state.store.is_pack_installed(auth.user_id, p.id)?;
        out.push(PackWithStickers {
            pack: PublicStickerPack::new(&p, is_installed, p.owner_id == auth.user_id),
            stickers: stickers.iter().map(PublicSticker::from).collect(),
        });
    }
    Ok(Json(out))
}

/* -------------------- GET /sticker-packs/by-uname/:uname --------------- */

async fn get_pack_by_uname(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(uname): Path<String>,
) -> AppResult<Json<PackWithStickers>> {
    let p = state
        .store
        .find_sticker_pack_by_uname(&uname)?
        .ok_or(AppError::NotFound)?;
    let stickers = state.store.list_stickers_in_pack(p.id)?;
    let is_installed = p.is_default || state.store.is_pack_installed(auth.user_id, p.id)?;
    Ok(Json(PackWithStickers {
        pack: PublicStickerPack::new(&p, is_installed, p.owner_id == auth.user_id),
        stickers: stickers.iter().map(PublicSticker::from).collect(),
    }))
}

/* -------------------- GET /sticker-packs/:id --------------------------- */

async fn get_pack(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<PackWithStickers>> {
    let id: u64 = id
        .parse()
        .map_err(|_| AppError::BadRequest("bad pack id".into()))?;
    let p = state.store.get_sticker_pack(id)?.ok_or(AppError::NotFound)?;
    let stickers = state.store.list_stickers_in_pack(p.id)?;
    let is_installed = p.is_default || state.store.is_pack_installed(auth.user_id, p.id)?;
    Ok(Json(PackWithStickers {
        pack: PublicStickerPack::new(&p, is_installed, p.owner_id == auth.user_id),
        stickers: stickers.iter().map(PublicSticker::from).collect(),
    }))
}

/* -------------------- POST /sticker-packs/:id/install ------------------ */

async fn install(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<PublicStickerPack>> {
    let id: u64 = id
        .parse()
        .map_err(|_| AppError::BadRequest("bad pack id".into()))?;
    state.store.install_sticker_pack(auth.user_id, id).await?;
    let p = state.store.get_sticker_pack(id)?.ok_or(AppError::NotFound)?;
    Ok(Json(PublicStickerPack::new(
        &p,
        true,
        p.owner_id == auth.user_id,
    )))
}

async fn uninstall(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let id: u64 = id
        .parse()
        .map_err(|_| AppError::BadRequest("bad pack id".into()))?;
    state.store.uninstall_sticker_pack(auth.user_id, id).await?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/* -------------------- POST /sticker-packs/:id/stickers ----------------- */

#[derive(Debug, Deserialize)]
struct UploadStickerQuery {
    #[serde(default)]
    emoji: Option<String>,
}

async fn upload_sticker(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<UploadStickerQuery>,
    mut multipart: Multipart,
) -> AppResult<Json<PublicSticker>> {
    let pack_id: u64 = id
        .parse()
        .map_err(|_| AppError::BadRequest("bad pack id".into()))?;
    let pack = state
        .store
        .get_sticker_pack(pack_id)?
        .ok_or(AppError::NotFound)?;
    if pack.owner_id != auth.user_id {
        return Err(AppError::Forbidden("not the pack owner"));
    }

    let mut field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart: {e}")))?
        .ok_or_else(|| AppError::BadRequest("missing file field".into()))?;

    let mime = field
        .content_type()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/webm" => "webm",
        _ => {
            return Err(AppError::BadRequest(
                "sticker must be PNG, WEBP, GIF, or WebM".into(),
            ))
        }
    };

    let pack_dir = state.uploads_root.join("stickers").join(pack_id.to_string());
    tokio::fs::create_dir_all(&pack_dir)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("create dir: {e}")))?;
    let fname = format!("{}.{}", Uuid::new_v4(), ext);
    let target = pack_dir.join(&fname);

    let mut file = tokio::fs::File::create(&target)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("create file: {e}")))?;
    let mut total: usize = 0;
    loop {
        let chunk = field
            .chunk()
            .await
            .map_err(|e| AppError::BadRequest(format!("read part: {e}")))?;
        let Some(chunk) = chunk else { break };
        total += chunk.len();
        if total > STICKER_MAX_BYTES {
            let _ = tokio::fs::remove_file(&target).await;
            return Err(AppError::BadRequest(
                "sticker must be 512 KB or smaller".into(),
            ));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write: {e}")))?;
    }
    file.flush().await.ok();

    let url = format!("/uploads/stickers/{}/{}", pack_id, fname);
    // Mirror the file into the UPLOADS table — message-send resolves
    // attachments by upload_id, so a sticker needs a real Upload row to be
    // sendable. We use a fresh UUID as the upload id (the URL is also unique
    // but UUIDs keep the lookup keyed cleanly).
    let upload_id = Uuid::new_v4().to_string();
    let attachment = Attachment {
        id: upload_id.clone(),
        kind: AttachmentKind::Sticker,
        mime: mime.clone(),
        name: fname.clone(),
        size: total as u64,
        url: url.clone(),
        width: None,
        height: None,
    };
    state
        .store
        .insert_upload(Upload {
            attachment,
            owner_id: auth.user_id,
            created_at: Utc::now().timestamp_millis(),
        })
        .await?;

    let sticker = state
        .store
        .add_sticker_to_pack(
            pack_id,
            auth.user_id,
            upload_id,
            url,
            mime,
            q.emoji,
            None,
            None,
        )
        .await?;
    Ok(Json(PublicSticker::from(&sticker)))
}
