//! Boot-time seeders. Currently just plants the default sticker pack on
//! first launch — scans `./data/uploads/stickers/default` for image files and
//! registers each as a sticker on a system-owned `@cogfun` pack.
//!
//! Safe to call on every startup: it's a no-op if the pack already exists.

use std::path::PathBuf;

use crate::db::Store;
use crate::models::chat::{Attachment, AttachmentKind, Upload};

const DEFAULT_PACK_UNAME: &str = "cogfun";
const DEFAULT_PACK_NAME: &str = "Cognigram Classics";
/// System owner id used for the default pack. Real users always have id >= 1
/// (the COUNTER table is monotonic from zero), so this never collides.
const SYSTEM_OWNER: u64 = 0;

pub async fn seed_default_stickers(
    store: &Store,
    uploads_root: &PathBuf,
) -> anyhow::Result<()> {
    // Already seeded? Nothing to do.
    if store
        .find_sticker_pack_by_uname(DEFAULT_PACK_UNAME)?
        .is_some()
    {
        return Ok(());
    }

    let default_dir = uploads_root.join("stickers").join("default");
    if !default_dir.exists() {
        tracing::info!(
            path = %default_dir.display(),
            "default stickers dir missing — skipping seed (run scripts/fetch-default-stickers.sh first)"
        );
        return Ok(());
    }

    // Collect candidate sticker files.
    let mut entries: Vec<_> = match std::fs::read_dir(&default_dir) {
        Ok(it) => it.filter_map(|e| e.ok()).collect(),
        Err(e) => {
            tracing::warn!(error = %e, "could not read default stickers dir");
            return Ok(());
        }
    };
    entries.sort_by_key(|e| e.file_name());

    let mut to_register: Vec<(String, String)> = Vec::new(); // (filename, mime)
    for entry in entries {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_string();
        let mime = match fname.rsplit('.').next() {
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            Some("gif") => "image/gif",
            Some("webm") => "video/webm",
            _ => continue,
        };
        to_register.push((fname, mime.to_string()));
    }

    if to_register.is_empty() {
        tracing::info!(
            path = %default_dir.display(),
            "default stickers dir empty — pack not created"
        );
        return Ok(());
    }

    // Create the pack first.
    let pack = store
        .create_sticker_pack(
            SYSTEM_OWNER,
            DEFAULT_PACK_UNAME.into(),
            DEFAULT_PACK_NAME.into(),
            true, // is_default
        )
        .await?;

    // Register each file: this both creates a Sticker row and an Upload row
    // pointing at the on-disk file, so message-send can resolve the
    // attachment by upload_id like any other attachment.
    for (fname, mime) in &to_register {
        let url = format!("/uploads/stickers/default/{}", fname);
        let upload_id = uuid::Uuid::new_v4().to_string();
        let attachment = Attachment {
            id: upload_id.clone(),
            kind: AttachmentKind::Sticker,
            mime: mime.clone(),
            name: fname.clone(),
            size: 0, // not measured for pre-bundled files; doesn't affect anything
            url: url.clone(),
            width: None,
            height: None,
        };
        store
            .insert_upload(Upload {
                attachment,
                owner_id: SYSTEM_OWNER,
                created_at: chrono::Utc::now().timestamp_millis(),
            })
            .await?;

        store
            .add_sticker_to_pack(
                pack.id,
                SYSTEM_OWNER,
                upload_id,
                url,
                mime.clone(),
                None,
                None,
                None,
            )
            .await?;
    }

    tracing::info!(
        count = to_register.len(),
        pack = DEFAULT_PACK_UNAME,
        "default sticker pack seeded"
    );
    Ok(())
}
