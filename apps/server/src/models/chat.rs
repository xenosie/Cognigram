use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Video,
    Audio,
    File,
    /// Transparent sticker (static PNG/WEBP or animated WebM). Rendered
    /// without bubble chrome on the client.
    Sticker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub kind: AttachmentKind,
    pub mime: String,
    pub name: String,
    pub size: u64,
    /// Relative URL the client should use to fetch the bytes.
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Upload {
    pub attachment: Attachment,
    pub owner_id: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chat {
    pub id: u64,
    /// Always sorted ascending so a 1:1 chat has a canonical key.
    pub participants: [u64; 2],
    pub last_message_at: Option<i64>,
    pub last_message_preview: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: u64,
    pub chat_id: u64,
    pub sender_id: u64,
    pub body: String,
    #[serde(default)]
    pub attachment: Option<Attachment>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicMessage {
    pub id: String,
    pub chat_id: String,
    pub sender_id: String,
    pub body: String,
    pub attachment: Option<Attachment>,
    pub created_at: i64,
}

impl From<&Message> for PublicMessage {
    fn from(m: &Message) -> Self {
        Self {
            id: m.id.to_string(),
            chat_id: m.chat_id.to_string(),
            sender_id: m.sender_id.to_string(),
            body: m.body.clone(),
            attachment: m.attachment.clone(),
            created_at: m.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicParticipant {
    pub id: String,
    pub email: String,
    pub username: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicChat {
    pub id: String,
    pub participants: Vec<PublicParticipant>,
    pub last_message_at: Option<i64>,
    pub last_message_preview: Option<String>,
    /// Unread count for the requesting user (capped at 100; UI renders `99+`).
    pub unread_count: u64,
    /// Highest message id read by the OTHER participant (for the requesting
    /// user's perspective). Drives the "seen" / double-check display on
    /// outgoing messages.
    pub other_last_read: u64,
    /// Whether the OTHER participant currently has at least one live WS
    /// connection. Seed for the chat-header presence dot; live updates
    /// arrive via `presence` WS events.
    pub other_online: bool,
}
