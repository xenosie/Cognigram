use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerPack {
    pub id: u64,
    pub uname: String,
    pub name: String,
    pub owner_id: u64,
    pub sticker_count: u64,
    /// True if the pack contains animated stickers (WebM). Static-only packs
    /// can render with a plain `<img>`; animated ones use `<video>` on the
    /// client.
    pub is_animated: bool,
    /// `default` packs are the curated set we seed at boot. Users can't
    /// uninstall them; they always appear in the picker.
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sticker {
    pub id: u64,
    pub pack_id: u64,
    /// The UPLOADS table key. The client passes this as `attachment_id` when
    /// sending a sticker, and the existing message-send code resolves it
    /// against the same lookup path it already uses for images / files.
    pub upload_id: String,
    /// Path served by ServeDir at `/uploads`.
    pub url: String,
    pub mime: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Optional emoji tag used for searching from the picker (e.g. "🎉").
    pub emoji: Option<String>,
    pub order_index: u32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicStickerPack {
    pub id: String,
    pub uname: String,
    pub name: String,
    pub owner_id: String,
    pub sticker_count: u64,
    pub is_animated: bool,
    pub is_default: bool,
    pub is_installed: bool,
    pub is_owner: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicSticker {
    pub id: String,
    pub pack_id: String,
    /// The id the client should pass as `attachment_id` when sending.
    pub upload_id: String,
    pub url: String,
    pub mime: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub emoji: Option<String>,
}

impl PublicStickerPack {
    pub fn new(p: &StickerPack, is_installed: bool, is_owner: bool) -> Self {
        Self {
            id: p.id.to_string(),
            uname: p.uname.clone(),
            name: p.name.clone(),
            owner_id: p.owner_id.to_string(),
            sticker_count: p.sticker_count,
            is_animated: p.is_animated,
            is_default: p.is_default,
            is_installed,
            is_owner,
            created_at: p.created_at,
        }
    }
}

impl From<&Sticker> for PublicSticker {
    fn from(s: &Sticker) -> Self {
        Self {
            id: s.id.to_string(),
            pack_id: s.pack_id.to_string(),
            upload_id: s.upload_id.clone(),
            url: s.url.clone(),
            mime: s.mime.clone(),
            width: s.width,
            height: s.height,
            emoji: s.emoji.clone(),
        }
    }
}
