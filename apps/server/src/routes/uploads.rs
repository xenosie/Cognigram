//! Generic file/image upload endpoint. The uploaded bytes are streamed to
//! disk under `./data/uploads/files/<uuid>/<sanitized-filename>`; the
//! metadata is stored in the redb `UPLOADS` table; the returned URL is the
//! same path served by the global ServeDir at `/uploads`.

use axum::extract::{Multipart, State};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::models::chat::{Attachment, AttachmentKind, Upload};
use crate::state::AppState;

const MAX_BYTES: usize = 25 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    // POST endpoint lives at /upload (singular) so it doesn't collide with the
    // ServeDir nested at /uploads/* used for downloads.
    Router::new().route("/upload", post(upload))
}

async fn upload(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> AppResult<Json<Attachment>> {
    let mut field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart: {e}")))?
        .ok_or_else(|| AppError::BadRequest("missing file field".into()))?;

    let mime = field
        .content_type()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".into());
    let raw_name = field.file_name().unwrap_or("file").to_string();
    let safe_name = sanitize_filename(&raw_name);

    let kind = kind_for(&mime);
    let id = Uuid::new_v4().to_string();

    let files_root = state.uploads_root.join("files").join(&id);
    tokio::fs::create_dir_all(&files_root)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("create upload dir: {e}")))?;
    let target = files_root.join(&safe_name);

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
        if total > MAX_BYTES {
            // Best-effort cleanup; ignore errors.
            let _ = tokio::fs::remove_file(&target).await;
            let _ = tokio::fs::remove_dir(&files_root).await;
            return Err(AppError::BadRequest(
                "attachment exceeds 25 MB limit".into(),
            ));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("write: {e}")))?;
    }
    file.flush().await.ok();

    let url = format!(
        "/uploads/files/{}/{}",
        id,
        url_encode_segment(&safe_name)
    );

    let attachment = Attachment {
        id: id.clone(),
        kind,
        mime,
        name: safe_name,
        size: total as u64,
        url,
        width: None,
        height: None,
    };

    state
        .store
        .insert_upload(Upload {
            attachment: attachment.clone(),
            owner_id: auth.user_id,
            created_at: Utc::now().timestamp_millis(),
        })
        .await?;

    Ok(Json(attachment))
}

fn kind_for(mime: &str) -> AttachmentKind {
    if mime.starts_with("image/") {
        AttachmentKind::Image
    } else if mime.starts_with("video/") {
        AttachmentKind::Video
    } else if mime.starts_with("audio/") {
        AttachmentKind::Audio
    } else {
        AttachmentKind::File
    }
}

/// Keep ASCII alphanumeric + `.`, `-`, `_`. Anything else becomes `_`.
/// Strip path separators outright. Fall back to "file" if everything got
/// stripped.
fn sanitize_filename(input: &str) -> String {
    let base = input
        .rsplit(|c: char| c == '/' || c == '\\')
        .next()
        .unwrap_or(input);
    let mut out = String::with_capacity(base.len());
    for c in base.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
            out.push(c);
        } else if c == ' ' {
            out.push('_');
        }
    }
    // Avoid hidden files / empty names.
    let trimmed = out.trim_start_matches('.');
    if trimmed.is_empty() {
        "file".into()
    } else {
        trimmed.to_string()
    }
}

/// Minimal URL-segment encoding — we already restrict characters in
/// `sanitize_filename` so this is just a defensive pass.
fn url_encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}
