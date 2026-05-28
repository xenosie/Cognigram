//! Embedded redb store with a single-writer actor.
//!
//! redb has single-writer semantics: all `begin_write()` txns serialize. To
//! avoid blocking Tokio's async executor on synchronous fsync calls, every
//! write is routed through a dedicated blocking thread that owns the
//! database and drains a bounded mpsc queue. Reads (MVCC, never blocked by
//! writers) go directly through `read_db.begin_read()` from any task.
//!
//! Schema (see plan: golden-humming-waterfall.md):
//! - USERS, EMAIL_IDX, GOOGLE_SUB_IDX, USERNAME_IDX
//! - CHATS, USER_CHATS, PARTICIPANT_PAIR_IDX
//! - MESSAGES (composite key (chat_id, msg_id))
//! - REFRESH_TOKENS, COUNTERS

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use redb::{
    Database, MultimapTableDefinition, ReadableMultimapTable, ReadableTable, TableDefinition,
};
use tokio::sync::{mpsc, oneshot};

use crate::error::{AppError, AppResult};
use crate::models::channel::{Channel, ChannelKind};
use crate::models::chat::{Attachment, Chat, Message, Upload};
use crate::models::sticker::{Sticker, StickerPack};
use crate::models::user::User;
use crate::models::verification::RefreshToken;

const COUNTERS: TableDefinition<&str, u64> = TableDefinition::new("counters");
const USERS: TableDefinition<u64, &[u8]> = TableDefinition::new("users");
const EMAIL_IDX: TableDefinition<&str, u64> = TableDefinition::new("email_idx");
const GOOGLE_SUB_IDX: TableDefinition<&str, u64> = TableDefinition::new("google_sub_idx");
const USERNAME_IDX: TableDefinition<&str, u64> = TableDefinition::new("username_idx");

const CHATS: TableDefinition<u64, &[u8]> = TableDefinition::new("chats");
const USER_CHATS: MultimapTableDefinition<u64, u64> = MultimapTableDefinition::new("user_chats");
const PARTICIPANT_PAIR_IDX: TableDefinition<(u64, u64), u64> =
    TableDefinition::new("participant_pair_idx");

const MESSAGES: TableDefinition<(u64, u64), &[u8]> = TableDefinition::new("messages");

const REFRESH_TOKENS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("refresh_tokens");
const UPLOADS: TableDefinition<&str, &[u8]> = TableDefinition::new("uploads");
/// Per-(chat, user) read cursor. Value = highest message id the user has
/// confirmed seeing. Drives unread badges and "seen" double-checks.
const CHAT_READS: TableDefinition<(u64, u64), u64> = TableDefinition::new("chat_reads");
/// Same idea, but keyed by (channel_id, user_id). We do NOT broadcast
/// channel reads — channels don't have a Telegram-style "seen by" indicator.
const CHANNEL_READS: TableDefinition<(u64, u64), u64> =
    TableDefinition::new("channel_reads");

/// Sticker packs (id → bincode).
const STICKER_PACKS: TableDefinition<u64, &[u8]> = TableDefinition::new("sticker_packs");
/// Unified handle lookup for packs — same namespace check happens against
/// USERNAME_IDX + CHANNEL_UNAME_IDX so @uname is unique across users,
/// channels, and packs.
const STICKER_PACK_UNAME_IDX: TableDefinition<&str, u64> =
    TableDefinition::new("sticker_pack_uname_idx");
/// Individual stickers (sticker_id → bincode).
const STICKERS: TableDefinition<u64, &[u8]> = TableDefinition::new("stickers");
/// pack_id → set of sticker_ids (membership). Mutated when a pack owner
/// adds/removes stickers.
const PACK_STICKERS: MultimapTableDefinition<u64, u64> =
    MultimapTableDefinition::new("pack_stickers");
/// user_id → set of installed pack_ids. Default packs are always considered
/// installed and are filtered in via `list_user_packs`.
const USER_STICKER_PACKS: MultimapTableDefinition<u64, u64> =
    MultimapTableDefinition::new("user_sticker_packs");

const CHANNELS: TableDefinition<u64, &[u8]> = TableDefinition::new("channels");
const CHANNEL_UNAME_IDX: TableDefinition<&str, u64> = TableDefinition::new("channel_uname_idx");
const CHANNEL_MEMBERS: MultimapTableDefinition<u64, u64> =
    MultimapTableDefinition::new("channel_members");
const USER_CHANNELS: MultimapTableDefinition<u64, u64> =
    MultimapTableDefinition::new("user_channels");
const CHANNEL_MESSAGES: TableDefinition<(u64, u64), &[u8]> =
    TableDefinition::new("channel_messages");

const COUNTER_USER: &str = "user";
const COUNTER_CHAT: &str = "chat";
const COUNTER_MSG: &str = "msg";
const COUNTER_CHANNEL: &str = "channel";
const COUNTER_CHANNEL_MSG: &str = "channel_msg";
const COUNTER_STICKER_PACK: &str = "sticker_pack";
const COUNTER_STICKER: &str = "sticker";

const WRITE_QUEUE_DEPTH: usize = 1024;

type WriteJob = Box<dyn FnOnce(&Database) + Send + 'static>;

#[derive(Clone)]
pub struct Store {
    read_db: Arc<Database>,
    writer_tx: mpsc::Sender<WriteJob>,
}

impl Store {
    /// Open (or create) the database file and start the writer actor. Must be
    /// called from inside a Tokio runtime — the writer needs to spawn a blocking
    /// thread.
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let db = Arc::new(Database::create(path.as_ref())?);

        // Initialise all tables once so opens-during-read don't fail.
        {
            let txn = db.begin_write()?;
            let _ = txn.open_table(COUNTERS)?;
            let _ = txn.open_table(USERS)?;
            let _ = txn.open_table(EMAIL_IDX)?;
            let _ = txn.open_table(GOOGLE_SUB_IDX)?;
            let _ = txn.open_table(USERNAME_IDX)?;
            let _ = txn.open_table(CHATS)?;
            let _ = txn.open_multimap_table(USER_CHATS)?;
            let _ = txn.open_table(PARTICIPANT_PAIR_IDX)?;
            let _ = txn.open_table(MESSAGES)?;
            let _ = txn.open_table(REFRESH_TOKENS)?;
            let _ = txn.open_table(UPLOADS)?;
            let _ = txn.open_table(CHANNELS)?;
            let _ = txn.open_table(CHANNEL_UNAME_IDX)?;
            let _ = txn.open_multimap_table(CHANNEL_MEMBERS)?;
            let _ = txn.open_multimap_table(USER_CHANNELS)?;
            let _ = txn.open_table(CHANNEL_MESSAGES)?;
            let _ = txn.open_table(CHAT_READS)?;
            let _ = txn.open_table(CHANNEL_READS)?;
            let _ = txn.open_table(STICKER_PACKS)?;
            let _ = txn.open_table(STICKER_PACK_UNAME_IDX)?;
            let _ = txn.open_table(STICKERS)?;
            let _ = txn.open_multimap_table(PACK_STICKERS)?;
            let _ = txn.open_multimap_table(USER_STICKER_PACKS)?;
            txn.commit()?;
        }

        let (tx, rx) = mpsc::channel::<WriteJob>(WRITE_QUEUE_DEPTH);
        spawn_writer(db.clone(), rx);

        Ok(Self {
            read_db: db,
            writer_tx: tx,
        })
    }

    /// Lightweight ping — opens a read txn and pokes the counters table.
    pub fn ping(&self) -> AppResult<u64> {
        let start = Instant::now();
        let txn = self.read_db.begin_read()?;
        let _ = txn.open_table(COUNTERS)?;
        Ok(start.elapsed().as_millis() as u64)
    }

    /* ---------------- read helpers ---------------- */

    pub fn find_user_by_id(&self, id: u64) -> AppResult<Option<User>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(USERS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(decode_user(v.value())?),
            None => None,
        })
    }

    pub fn find_user_by_google_sub(&self, sub: &str) -> AppResult<Option<User>> {
        let txn = self.read_db.begin_read()?;
        let idx = txn.open_table(GOOGLE_SUB_IDX)?;
        let Some(uid) = idx.get(sub)?.map(|v| v.value()) else {
            return Ok(None);
        };
        drop(idx);
        let t = txn.open_table(USERS)?;
        Ok(match t.get(uid)? {
            Some(v) => Some(decode_user(v.value())?),
            None => None,
        })
    }

    pub fn find_user_by_email(&self, email: &str) -> AppResult<Option<User>> {
        let email = email.to_ascii_lowercase();
        let txn = self.read_db.begin_read()?;
        let idx = txn.open_table(EMAIL_IDX)?;
        let Some(uid) = idx.get(email.as_str())?.map(|v| v.value()) else {
            return Ok(None);
        };
        drop(idx);
        let t = txn.open_table(USERS)?;
        Ok(match t.get(uid)? {
            Some(v) => Some(decode_user(v.value())?),
            None => None,
        })
    }

    pub fn find_user_by_username(&self, username: &str) -> AppResult<Option<User>> {
        let username = username.to_ascii_lowercase();
        let txn = self.read_db.begin_read()?;
        let idx = txn.open_table(USERNAME_IDX)?;
        let Some(uid) = idx.get(username.as_str())?.map(|v| v.value()) else {
            return Ok(None);
        };
        drop(idx);
        let t = txn.open_table(USERS)?;
        Ok(match t.get(uid)? {
            Some(v) => Some(decode_user(v.value())?),
            None => None,
        })
    }

    /// Lookup by username (preferred) then by email (fallback).
    pub fn find_user_by_handle(&self, handle: &str) -> AppResult<Option<User>> {
        let handle = handle.trim().to_ascii_lowercase();
        if handle.is_empty() {
            return Ok(None);
        }
        if let Some(u) = self.find_user_by_username(&handle)? {
            return Ok(Some(u));
        }
        self.find_user_by_email(&handle)
    }

    pub fn get_chat(&self, chat_id: u64) -> AppResult<Option<Chat>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHATS)?;
        Ok(match t.get(chat_id)? {
            Some(v) => Some(decode_chat(v.value())?),
            None => None,
        })
    }

    pub fn list_chats_for_user(&self, user_id: u64) -> AppResult<Vec<Chat>> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(USER_CHATS)?;
        let chat_ids: Vec<u64> = mm
            .get(user_id)?
            .filter_map(|r| r.ok().map(|v| v.value()))
            .collect();
        drop(mm);

        let t = txn.open_table(CHATS)?;
        let mut out: Vec<Chat> = Vec::with_capacity(chat_ids.len());
        for cid in chat_ids {
            if let Some(v) = t.get(cid)? {
                match decode_chat(v.value()) {
                    Ok(c) => out.push(c),
                    Err(e) => tracing::warn!(
                        error = ?e,
                        chat_id = cid,
                        "skipping undecodable chat for user"
                    ),
                }
            }
        }
        out.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
        Ok(out)
    }

    /// Cursor-paginated message history. `before` is the lowest msg_id NOT to
    /// include (excluded upper bound). Returns ascending order.
    /// Undecodable records (older serialization) are skipped.
    pub fn list_messages(
        &self,
        chat_id: u64,
        limit: usize,
        before: Option<u64>,
    ) -> AppResult<Vec<Message>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(MESSAGES)?;
        let upper = before.unwrap_or(u64::MAX);
        let range = (chat_id, 0u64)..(chat_id, upper);
        let mut out: Vec<Message> = Vec::with_capacity(limit.min(64));
        for r in t.range(range)?.rev() {
            let (_, v) = r?;
            match decode_message(v.value()) {
                Ok(m) => out.push(m),
                Err(e) => {
                    tracing::warn!(error = ?e, chat_id, "skipping undecodable DM in list_messages");
                    continue;
                }
            }
            if out.len() >= limit {
                break;
            }
        }
        out.reverse();
        Ok(out)
    }

    /// Bounded scan over USERS for substring match on email / username.
    /// Suitable below ~10k users; flag if we ever cross that.
    pub fn list_users(
        &self,
        q: Option<&str>,
        limit: usize,
        exclude_id: u64,
    ) -> AppResult<Vec<User>> {
        let needle = q
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty());
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(USERS)?;
        let mut out: Vec<User> = Vec::with_capacity(limit.min(64));
        for r in t.iter()? {
            let (_, v) = r?;
            let user = match decode_user(v.value()) {
                Ok(u) => u,
                Err(e) => {
                    tracing::warn!(error = ?e, "skipping undecodable user in list_users");
                    continue;
                }
            };
            if user.id == exclude_id {
                continue;
            }
            if let Some(n) = &needle {
                let email_hit = user.email.to_ascii_lowercase().contains(n);
                let username_hit = user
                    .username
                    .as_ref()
                    .map(|u| u.to_ascii_lowercase().contains(n))
                    .unwrap_or(false);
                if !email_hit && !username_hit {
                    continue;
                }
            }
            out.push(user);
            if out.len() >= limit {
                break;
            }
        }
        out.sort_by(|a, b| {
            a.username
                .clone()
                .unwrap_or_default()
                .cmp(&b.username.clone().unwrap_or_default())
                .then_with(|| a.email.cmp(&b.email))
        });
        Ok(out)
    }

    /// Highest message id the given user has confirmed reading in this chat.
    /// Returns 0 when they've never opened it.
    pub fn get_chat_read(&self, chat_id: u64, user_id: u64) -> AppResult<u64> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHAT_READS)?;
        Ok(t.get((chat_id, user_id))?.map(|v| v.value()).unwrap_or(0))
    }

    /// Count unread messages for `user_id` in `chat_id`. "Unread" = msg_id >
    /// last_read AND sender != user_id (own outgoing don't count). Capped at
    /// 100 so the iteration is bounded for very busy chats; the UI renders
    /// `99+` when we return 100. Records that fail to deserialize (schema
    /// drift from an older binary) are skipped with a warning rather than
    /// erroring the whole request.
    pub fn count_unread(&self, chat_id: u64, user_id: u64) -> AppResult<u64> {
        let last_read = self.get_chat_read(chat_id, user_id)?;
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(MESSAGES)?;
        let mut count: u64 = 0;
        for r in t.range((chat_id, last_read.saturating_add(1))..(chat_id, u64::MAX))? {
            let (_, v) = r?;
            let m: Message = match bincode::deserialize(v.value()) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(error = ?e, chat_id, "skipping undecodable message in count_unread");
                    continue;
                }
            };
            if m.sender_id != user_id {
                count += 1;
                if count >= 100 {
                    break;
                }
            }
        }
        Ok(count)
    }

    /// Mark this chat read up to `msg_id` for `user_id`. Idempotent and
    /// monotonic — never moves the cursor backwards. Returns the final
    /// (post-update) cursor so the caller can broadcast the canonical value.
    pub async fn mark_chat_read(
        &self,
        chat_id: u64,
        user_id: u64,
        msg_id: u64,
    ) -> AppResult<u64> {
        self.run_write(move |db| -> AppResult<u64> {
            let txn = db.begin_write()?;
            let final_value;
            {
                let mut t = txn.open_table(CHAT_READS)?;
                let current = t.get((chat_id, user_id))?.map(|v| v.value()).unwrap_or(0);
                final_value = current.max(msg_id);
                if final_value > current {
                    t.insert((chat_id, user_id), final_value)?;
                }
            }
            txn.commit()?;
            Ok(final_value)
        })
        .await
    }

    pub fn get_channel_read(&self, channel_id: u64, user_id: u64) -> AppResult<u64> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHANNEL_READS)?;
        Ok(t.get((channel_id, user_id))?.map(|v| v.value()).unwrap_or(0))
    }

    /// Same logic as `count_unread` but against CHANNEL_MESSAGES. Capped at
    /// 100. Undecodable records are skipped.
    pub fn count_channel_unread(
        &self,
        channel_id: u64,
        user_id: u64,
    ) -> AppResult<u64> {
        let last_read = self.get_channel_read(channel_id, user_id)?;
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHANNEL_MESSAGES)?;
        let mut count: u64 = 0;
        for r in t.range((channel_id, last_read.saturating_add(1))..(channel_id, u64::MAX))? {
            let (_, v) = r?;
            let m: Message = match bincode::deserialize(v.value()) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if m.sender_id != user_id {
                count += 1;
                if count >= 100 {
                    break;
                }
            }
        }
        Ok(count)
    }

    pub async fn mark_channel_read(
        &self,
        channel_id: u64,
        user_id: u64,
        msg_id: u64,
    ) -> AppResult<u64> {
        self.run_write(move |db| -> AppResult<u64> {
            let txn = db.begin_write()?;
            let final_value;
            {
                let mut t = txn.open_table(CHANNEL_READS)?;
                let current =
                    t.get((channel_id, user_id))?.map(|v| v.value()).unwrap_or(0);
                final_value = current.max(msg_id);
                if final_value > current {
                    t.insert((channel_id, user_id), final_value)?;
                }
            }
            txn.commit()?;
            Ok(final_value)
        })
        .await
    }

    pub fn find_refresh_token(&self, token_hash: &[u8; 32]) -> AppResult<Option<RefreshToken>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(REFRESH_TOKENS)?;
        Ok(match t.get(token_hash.as_slice())? {
            Some(v) => Some(decode_refresh(v.value())?),
            None => None,
        })
    }

    pub fn find_upload(&self, id: &str) -> AppResult<Option<Upload>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(UPLOADS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<Upload>(v.value())?),
            None => None,
        })
    }

    /* ---------------- write helpers (queued through actor) ---------------- */

    pub async fn create_or_update_user_from_google(
        &self,
        google_sub: String,
        email: String,
        name: Option<String>,
        picture: Option<String>,
    ) -> AppResult<User> {
        self.run_write(move |db| -> AppResult<User> {
            let now = now_ms();
            let email_lc = email.to_ascii_lowercase();
            let txn = db.begin_write()?;
            let user;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut users = txn.open_table(USERS)?;
                let mut sub_idx = txn.open_table(GOOGLE_SUB_IDX)?;
                let mut email_idx = txn.open_table(EMAIL_IDX)?;

                let existing_uid = sub_idx
                    .get(google_sub.as_str())?
                    .map(|v| v.value());

                if let Some(uid) = existing_uid {
                    let bytes = users
                        .get(uid)?
                        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("user index drift")))?
                        .value()
                        .to_vec();
                    let mut u: User = bincode::deserialize(&bytes)?;
                    let mut dirty = false;
                    if u.email != email_lc {
                        // Re-point the email index.
                        email_idx.remove(u.email.as_str())?;
                        email_idx.insert(email_lc.as_str(), u.id)?;
                        u.email = email_lc.clone();
                        dirty = true;
                    }
                    if u.name != name {
                        u.name = name.clone();
                        dirty = true;
                    }
                    if u.picture != picture {
                        u.picture = picture.clone();
                        dirty = true;
                    }
                    if dirty {
                        u.updated_at = now;
                        let buf = bincode::serialize(&u)?;
                        users.insert(uid, buf.as_slice())?;
                    }
                    user = u;
                } else {
                    let next_id = next_counter(&mut counters, COUNTER_USER)?;
                    let u = User {
                        id: next_id,
                        google_sub: google_sub.clone(),
                        email: email_lc.clone(),
                        username: None,
                        name: name.clone(),
                        picture: picture.clone(),
                        created_at: now,
                        updated_at: now,
                    };
                    let buf = bincode::serialize(&u)?;
                    users.insert(next_id, buf.as_slice())?;
                    sub_idx.insert(google_sub.as_str(), next_id)?;
                    // Email is unique by Google's own contract on `sub`,
                    // but if a different sub already claimed it we'd hit this:
                    if email_idx.get(email_lc.as_str())?.is_some() {
                        return Err(AppError::Conflict(
                            "email already linked to another account".into(),
                        ));
                    }
                    email_idx.insert(email_lc.as_str(), next_id)?;
                    user = u;
                }
            }
            txn.commit()?;
            Ok(user)
        })
        .await
    }

    /// Update display name and/or username. Both are optional — `None` means
    /// "leave unchanged." Empty `display_name` clears the field. Username
    /// changes are validated for uniqueness against `USERNAME_IDX`; the old
    /// entry is removed atomically. Allowed any number of times — Telegram-
    /// style free rename.
    pub async fn update_profile(
        &self,
        user_id: u64,
        display_name: Option<String>,
        new_username: Option<String>,
    ) -> AppResult<User> {
        self.run_write(move |db| -> AppResult<User> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let user;
            {
                let mut users = txn.open_table(USERS)?;
                let mut idx = txn.open_table(USERNAME_IDX)?;

                let bytes = users
                    .get(user_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut u: User = bincode::deserialize(&bytes)?;

                if let Some(dn) = display_name {
                    let trimmed = dn.trim();
                    u.name = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
                }

                if let Some(uname) = new_username {
                    let new_handle = uname.trim().to_ascii_lowercase();
                    if u.username.as_deref() != Some(new_handle.as_str()) {
                        // Unified handle namespace — refuse if claimed by
                        // another user OR by any channel.
                        let claimed_by =
                            idx.get(new_handle.as_str())?.map(|v| v.value());
                        if let Some(owner) = claimed_by {
                            if owner != user_id {
                                return Err(AppError::Conflict("username taken".into()));
                            }
                        }
                        let chan_idx = txn.open_table(CHANNEL_UNAME_IDX)?;
                        if chan_idx.get(new_handle.as_str())?.is_some() {
                            return Err(AppError::Conflict("username taken".into()));
                        }
                        drop(chan_idx);
                        // Free the old handle (if any), then claim the new one.
                        if let Some(old) = u.username.as_deref() {
                            idx.remove(old)?;
                        }
                        idx.insert(new_handle.as_str(), user_id)?;
                        u.username = Some(new_handle);
                    }
                }

                u.updated_at = now;
                let buf = bincode::serialize(&u)?;
                users.insert(user_id, buf.as_slice())?;
                user = u;
            }
            txn.commit()?;
            Ok(user)
        })
        .await
    }

    /// Update only the avatar (picture) URL on the user record.
    pub async fn set_avatar(
        &self,
        user_id: u64,
        picture: Option<String>,
    ) -> AppResult<User> {
        self.run_write(move |db| -> AppResult<User> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let user;
            {
                let mut users = txn.open_table(USERS)?;
                let bytes = users
                    .get(user_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut u: User = bincode::deserialize(&bytes)?;
                u.picture = picture;
                u.updated_at = now;
                let buf = bincode::serialize(&u)?;
                users.insert(user_id, buf.as_slice())?;
                user = u;
            }
            txn.commit()?;
            Ok(user)
        })
        .await
    }

    pub async fn insert_refresh_token(
        &self,
        user_id: u64,
        token_hash: [u8; 32],
        expires_at: i64,
    ) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let now = now_ms();
            let txn = db.begin_write()?;
            {
                let mut t = txn.open_table(REFRESH_TOKENS)?;
                let rt = RefreshToken {
                    user_id,
                    token_hash,
                    expires_at,
                    created_at: now,
                    revoked: false,
                };
                let buf = bincode::serialize(&rt)?;
                t.insert(token_hash.as_slice(), buf.as_slice())?;
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    pub async fn rotate_refresh_token(
        &self,
        old_hash: [u8; 32],
        new_hash: [u8; 32],
        expires_at: i64,
    ) -> AppResult<u64> {
        self.run_write(move |db| -> AppResult<u64> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let user_id;
            {
                let mut t = txn.open_table(REFRESH_TOKENS)?;
                let bytes = t
                    .get(old_hash.as_slice())?
                    .ok_or(AppError::Unauthorized)?
                    .value()
                    .to_vec();
                let old: RefreshToken = bincode::deserialize(&bytes)?;
                if old.revoked || old.expires_at < now {
                    return Err(AppError::Unauthorized);
                }
                t.remove(old_hash.as_slice())?;
                let new_rt = RefreshToken {
                    user_id: old.user_id,
                    token_hash: new_hash,
                    expires_at,
                    created_at: now,
                    revoked: false,
                };
                let buf = bincode::serialize(&new_rt)?;
                t.insert(new_hash.as_slice(), buf.as_slice())?;
                user_id = old.user_id;
            }
            txn.commit()?;
            Ok(user_id)
        })
        .await
    }

    pub async fn revoke_refresh_token(&self, token_hash: [u8; 32]) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let txn = db.begin_write()?;
            {
                let mut t = txn.open_table(REFRESH_TOKENS)?;
                let _ = t.remove(token_hash.as_slice())?;
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    pub async fn open_or_create_chat(&self, a: u64, b: u64) -> AppResult<Chat> {
        if a == b {
            return Err(AppError::BadRequest("cannot chat with yourself".into()));
        }
        let (lo, hi) = if a < b { (a, b) } else { (b, a) };
        self.run_write(move |db| -> AppResult<Chat> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let chat;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut chats = txn.open_table(CHATS)?;
                let mut pair_idx = txn.open_table(PARTICIPANT_PAIR_IDX)?;
                let mut user_chats = txn.open_multimap_table(USER_CHATS)?;

                let existing_cid: Option<u64> =
                    pair_idx.get((lo, hi))?.map(|v| v.value());

                if let Some(cid) = existing_cid {
                    let bytes = chats
                        .get(cid)?
                        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("chat index drift")))?
                        .value()
                        .to_vec();
                    chat = bincode::deserialize::<Chat>(&bytes)?;
                } else {
                    let new_id = next_counter(&mut counters, COUNTER_CHAT)?;
                    let c = Chat {
                        id: new_id,
                        participants: [lo, hi],
                        last_message_at: None,
                        last_message_preview: None,
                        created_at: now,
                        updated_at: now,
                    };
                    let buf = bincode::serialize(&c)?;
                    chats.insert(new_id, buf.as_slice())?;
                    pair_idx.insert((lo, hi), new_id)?;
                    user_chats.insert(lo, new_id)?;
                    user_chats.insert(hi, new_id)?;
                    chat = c;
                }
            }
            txn.commit()?;
            Ok(chat)
        })
        .await
    }

    /// Persist a message + bump the chat's `last_message_*` fields in ONE
    /// transaction. Returns the stored message and the updated chat. Optional
    /// `attachment` is attached verbatim (its owner check happens in the
    /// route layer before this call).
    pub async fn append_message(
        &self,
        chat_id: u64,
        sender_id: u64,
        body: String,
        attachment: Option<Attachment>,
    ) -> AppResult<(Message, Chat)> {
        self.run_write(move |db| -> AppResult<(Message, Chat)> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let stored_msg;
            let stored_chat;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut chats = txn.open_table(CHATS)?;
                let mut messages = txn.open_table(MESSAGES)?;

                let bytes = chats
                    .get(chat_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut chat: Chat = bincode::deserialize(&bytes)?;
                if !chat.participants.contains(&sender_id) {
                    return Err(AppError::Forbidden("not a chat participant"));
                }

                let msg_id = next_counter(&mut counters, COUNTER_MSG)?;
                let msg = Message {
                    id: msg_id,
                    chat_id,
                    sender_id,
                    body: body.clone(),
                    attachment: attachment.clone(),
                    created_at: now,
                };
                let mbuf = bincode::serialize(&msg)?;
                messages.insert((chat_id, msg_id), mbuf.as_slice())?;

                chat.last_message_at = Some(now);
                chat.last_message_preview = Some(preview_for(&body, attachment.as_ref()));
                chat.updated_at = now;
                let cbuf = bincode::serialize(&chat)?;
                chats.insert(chat_id, cbuf.as_slice())?;

                stored_msg = msg;
                stored_chat = chat;
            }
            txn.commit()?;
            Ok((stored_msg, stored_chat))
        })
        .await
    }

    pub async fn insert_upload(&self, upload: Upload) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let txn = db.begin_write()?;
            {
                let mut t = txn.open_table(UPLOADS)?;
                let buf = bincode::serialize(&upload)?;
                t.insert(upload.attachment.id.as_str(), buf.as_slice())?;
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    /// Delete any refresh token whose `expires_at < now`. Called from a 60s
    /// background tick.
    pub async fn sweep_expired_tokens(&self) -> AppResult<usize> {
        self.run_write(move |db| -> AppResult<usize> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let removed;
            {
                let mut t = txn.open_table(REFRESH_TOKENS)?;
                // Collect candidates first to avoid mutating during iter.
                let mut victims: Vec<Vec<u8>> = Vec::new();
                for r in t.iter()? {
                    let (k, v) = r?;
                    let rt: RefreshToken = bincode::deserialize(v.value())?;
                    if rt.expires_at < now {
                        victims.push(k.value().to_vec());
                    }
                }
                removed = victims.len();
                for k in victims {
                    let _ = t.remove(k.as_slice())?;
                }
            }
            txn.commit()?;
            Ok(removed)
        })
        .await
    }

    /* ---------------- channels: reads ---------------- */

    pub fn get_channel(&self, id: u64) -> AppResult<Option<Channel>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHANNELS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<Channel>(v.value())?),
            None => None,
        })
    }

    pub fn find_channel_by_uname(&self, uname: &str) -> AppResult<Option<Channel>> {
        let uname = uname.trim().to_ascii_lowercase();
        let txn = self.read_db.begin_read()?;
        let idx = txn.open_table(CHANNEL_UNAME_IDX)?;
        let Some(id) = idx.get(uname.as_str())?.map(|v| v.value()) else {
            return Ok(None);
        };
        drop(idx);
        let t = txn.open_table(CHANNELS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<Channel>(v.value())?),
            None => None,
        })
    }

    pub fn is_channel_member(&self, channel_id: u64, user_id: u64) -> AppResult<bool> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(CHANNEL_MEMBERS)?;
        let mut iter = mm.get(channel_id)?;
        while let Some(r) = iter.next() {
            if r?.value() == user_id {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Just the member ID list for a channel. Used by typing fan-out + other
    /// transient broadcasts where we don't need the full channel record.
    pub fn channel_members(&self, channel_id: u64) -> AppResult<Vec<u64>> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(CHANNEL_MEMBERS)?;
        let mut out: Vec<u64> = Vec::new();
        let mut iter = mm.get(channel_id)?;
        while let Some(r) = iter.next() {
            out.push(r?.value());
        }
        Ok(out)
    }

    pub fn list_user_channels(&self, user_id: u64) -> AppResult<Vec<Channel>> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(USER_CHANNELS)?;
        let channel_ids: Vec<u64> = mm
            .get(user_id)?
            .filter_map(|r| r.ok().map(|v| v.value()))
            .collect();
        drop(mm);
        let t = txn.open_table(CHANNELS)?;
        let mut out: Vec<Channel> = Vec::with_capacity(channel_ids.len());
        for cid in channel_ids {
            if let Some(v) = t.get(cid)? {
                match bincode::deserialize::<Channel>(v.value()) {
                    Ok(c) => out.push(c),
                    Err(e) => tracing::warn!(
                        error = ?e,
                        channel_id = cid,
                        "skipping undecodable channel"
                    ),
                }
            }
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    pub fn list_channel_messages(
        &self,
        channel_id: u64,
        limit: usize,
        before: Option<u64>,
    ) -> AppResult<Vec<Message>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHANNEL_MESSAGES)?;
        let upper = before.unwrap_or(u64::MAX);
        let range = (channel_id, 0u64)..(channel_id, upper);
        let mut out: Vec<Message> = Vec::with_capacity(limit.min(64));
        for r in t.range(range)?.rev() {
            let (_, v) = r?;
            match bincode::deserialize::<Message>(v.value()) {
                Ok(m) => out.push(m),
                Err(e) => {
                    tracing::warn!(
                        error = ?e,
                        channel_id,
                        "skipping undecodable channel message"
                    );
                    continue;
                }
            }
            if out.len() >= limit {
                break;
            }
        }
        out.reverse();
        Ok(out)
    }

    /// Substring search over channels by uname / name. Bounded scan; fine
    /// below a few thousand channels.
    pub fn search_channels(
        &self,
        q: &str,
        limit: usize,
    ) -> AppResult<Vec<Channel>> {
        let needle = q.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Ok(vec![]);
        }
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(CHANNELS)?;
        let mut out: Vec<Channel> = Vec::with_capacity(limit.min(64));
        for r in t.iter()? {
            let (_, v) = r?;
            let c: Channel = match bincode::deserialize(v.value()) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = ?e, "skipping undecodable channel in search");
                    continue;
                }
            };
            let uname_hit = c.uname.to_ascii_lowercase().contains(&needle);
            let name_hit = c.name.to_ascii_lowercase().contains(&needle);
            if uname_hit || name_hit {
                out.push(c);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    }

    /* ---------------- channels: writes ---------------- */

    pub async fn create_channel(
        &self,
        owner_id: u64,
        kind: ChannelKind,
        uname: String,
        name: String,
        description: Option<String>,
    ) -> AppResult<Channel> {
        let uname = uname.trim().to_ascii_lowercase();
        let name = name.trim().to_string();
        self.run_write(move |db| -> AppResult<Channel> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let channel;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut channels = txn.open_table(CHANNELS)?;
                let mut uname_idx = txn.open_table(CHANNEL_UNAME_IDX)?;
                let mut user_uname_idx = txn.open_table(USERNAME_IDX)?;
                let mut members = txn.open_multimap_table(CHANNEL_MEMBERS)?;
                let mut user_chans = txn.open_multimap_table(USER_CHANNELS)?;

                // Unified handle namespace: refuse if uname is taken by a user
                // OR another channel.
                if uname_idx.get(uname.as_str())?.is_some()
                    || user_uname_idx.get(uname.as_str())?.is_some()
                {
                    return Err(AppError::Conflict("handle taken".into()));
                }

                let id = next_counter(&mut counters, COUNTER_CHANNEL)?;
                let c = Channel {
                    id,
                    kind,
                    uname: uname.clone(),
                    name,
                    description,
                    avatar: None,
                    owner_id,
                    member_count: 1,
                    created_at: now,
                    updated_at: now,
                };
                let buf = bincode::serialize(&c)?;
                channels.insert(id, buf.as_slice())?;
                uname_idx.insert(uname.as_str(), id)?;
                members.insert(id, owner_id)?;
                user_chans.insert(owner_id, id)?;
                channel = c;
            }
            txn.commit()?;
            Ok(channel)
        })
        .await
    }

    pub async fn update_channel(
        &self,
        channel_id: u64,
        owner_id: u64,
        new_name: Option<String>,
        new_uname: Option<String>,
        new_description: Option<String>,
    ) -> AppResult<Channel> {
        self.run_write(move |db| -> AppResult<Channel> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let channel;
            {
                let mut channels = txn.open_table(CHANNELS)?;
                let mut uname_idx = txn.open_table(CHANNEL_UNAME_IDX)?;
                let user_uname_idx = txn.open_table(USERNAME_IDX)?;

                let bytes = channels
                    .get(channel_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut c: Channel = bincode::deserialize(&bytes)?;
                if c.owner_id != owner_id {
                    return Err(AppError::Forbidden("not the owner"));
                }
                if let Some(name) = new_name {
                    let trimmed = name.trim().to_string();
                    if !trimmed.is_empty() {
                        c.name = trimmed;
                    }
                }
                if let Some(desc) = new_description {
                    let trimmed = desc.trim();
                    c.description = if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    };
                }
                if let Some(uname) = new_uname {
                    let new_handle = uname.trim().to_ascii_lowercase();
                    if !new_handle.is_empty() && new_handle != c.uname {
                        // Refuse if taken by a user or another channel.
                        if let Some(other) =
                            uname_idx.get(new_handle.as_str())?.map(|v| v.value())
                        {
                            if other != channel_id {
                                return Err(AppError::Conflict("handle taken".into()));
                            }
                        }
                        if user_uname_idx.get(new_handle.as_str())?.is_some() {
                            return Err(AppError::Conflict("handle taken".into()));
                        }
                        uname_idx.remove(c.uname.as_str())?;
                        uname_idx.insert(new_handle.as_str(), channel_id)?;
                        c.uname = new_handle;
                    }
                }
                c.updated_at = now;
                let buf = bincode::serialize(&c)?;
                channels.insert(channel_id, buf.as_slice())?;
                channel = c;
            }
            txn.commit()?;
            Ok(channel)
        })
        .await
    }

    pub async fn set_channel_avatar(
        &self,
        channel_id: u64,
        owner_id: u64,
        avatar: Option<String>,
    ) -> AppResult<Channel> {
        self.run_write(move |db| -> AppResult<Channel> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let channel;
            {
                let mut channels = txn.open_table(CHANNELS)?;
                let bytes = channels
                    .get(channel_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut c: Channel = bincode::deserialize(&bytes)?;
                if c.owner_id != owner_id {
                    return Err(AppError::Forbidden("not the owner"));
                }
                c.avatar = avatar;
                c.updated_at = now;
                let buf = bincode::serialize(&c)?;
                channels.insert(channel_id, buf.as_slice())?;
                channel = c;
            }
            txn.commit()?;
            Ok(channel)
        })
        .await
    }

    pub async fn join_channel(
        &self,
        channel_id: u64,
        user_id: u64,
    ) -> AppResult<Channel> {
        self.run_write(move |db| -> AppResult<Channel> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let channel;
            {
                let mut channels = txn.open_table(CHANNELS)?;
                let mut members = txn.open_multimap_table(CHANNEL_MEMBERS)?;
                let mut user_chans = txn.open_multimap_table(USER_CHANNELS)?;

                let bytes = channels
                    .get(channel_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut c: Channel = bincode::deserialize(&bytes)?;

                // Already a member?
                let mut already = false;
                {
                    let mut iter = members.get(channel_id)?;
                    while let Some(r) = iter.next() {
                        if r?.value() == user_id {
                            already = true;
                            break;
                        }
                    }
                }
                if !already {
                    members.insert(channel_id, user_id)?;
                    user_chans.insert(user_id, channel_id)?;
                    c.member_count = c.member_count.saturating_add(1);
                    c.updated_at = now;
                    let buf = bincode::serialize(&c)?;
                    channels.insert(channel_id, buf.as_slice())?;
                }
                channel = c;
            }
            txn.commit()?;
            Ok(channel)
        })
        .await
    }

    pub async fn leave_channel(
        &self,
        channel_id: u64,
        user_id: u64,
    ) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let now = now_ms();
            let txn = db.begin_write()?;
            {
                let mut channels = txn.open_table(CHANNELS)?;
                let mut members = txn.open_multimap_table(CHANNEL_MEMBERS)?;
                let mut user_chans = txn.open_multimap_table(USER_CHANNELS)?;

                let bytes = channels
                    .get(channel_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut c: Channel = bincode::deserialize(&bytes)?;
                if c.owner_id == user_id {
                    return Err(AppError::BadRequest(
                        "owner cannot leave their own channel".into(),
                    ));
                }
                let removed = members.remove(channel_id, user_id)?;
                let _ = user_chans.remove(user_id, channel_id)?;
                if removed {
                    c.member_count = c.member_count.saturating_sub(1);
                    c.updated_at = now;
                    let buf = bincode::serialize(&c)?;
                    channels.insert(channel_id, buf.as_slice())?;
                }
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    /// Append a message to a channel. `kind` is consulted: for `Channel`
    /// (broadcast), only the owner may post; for `Group` any member can.
    /// Returns the persisted Message plus the channel's updated metadata
    /// (caller uses participants list to fan out via the hub).
    pub async fn append_channel_message(
        &self,
        channel_id: u64,
        sender_id: u64,
        body: String,
        attachment: Option<Attachment>,
    ) -> AppResult<(Message, Channel, Vec<u64>)> {
        self.run_write(move |db| -> AppResult<(Message, Channel, Vec<u64>)> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let stored_msg;
            let stored_chan;
            let members_list: Vec<u64>;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut channels = txn.open_table(CHANNELS)?;
                let mut messages = txn.open_table(CHANNEL_MESSAGES)?;
                let members = txn.open_multimap_table(CHANNEL_MEMBERS)?;

                let bytes = channels
                    .get(channel_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut c: Channel = bincode::deserialize(&bytes)?;

                // Permission check
                if c.kind == ChannelKind::Channel && c.owner_id != sender_id {
                    return Err(AppError::Forbidden("only the owner can post here"));
                }
                // For groups, sender must be a member.
                if c.kind == ChannelKind::Group {
                    let mut is_member = false;
                    let mut iter = members.get(channel_id)?;
                    while let Some(r) = iter.next() {
                        if r?.value() == sender_id {
                            is_member = true;
                            break;
                        }
                    }
                    if !is_member {
                        return Err(AppError::Forbidden("not a channel member"));
                    }
                }

                let msg_id = next_counter(&mut counters, COUNTER_CHANNEL_MSG)?;
                let msg = Message {
                    id: msg_id,
                    chat_id: channel_id,
                    sender_id,
                    body: body.clone(),
                    attachment: attachment.clone(),
                    created_at: now,
                };
                let mbuf = bincode::serialize(&msg)?;
                messages.insert((channel_id, msg_id), mbuf.as_slice())?;

                c.updated_at = now;
                let cbuf = bincode::serialize(&c)?;
                channels.insert(channel_id, cbuf.as_slice())?;

                // Snapshot the member list so the caller can fan out without
                // re-opening a read txn.
                let mut snap: Vec<u64> = Vec::with_capacity(c.member_count as usize);
                let mut iter = members.get(channel_id)?;
                while let Some(r) = iter.next() {
                    if let Ok(v) = r {
                        snap.push(v.value());
                    }
                }

                stored_msg = msg;
                stored_chan = c;
                members_list = snap;
            }
            txn.commit()?;
            Ok((stored_msg, stored_chan, members_list))
        })
        .await
    }

    /* ---------------- sticker packs: reads ---------------- */

    pub fn get_sticker_pack(&self, id: u64) -> AppResult<Option<StickerPack>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(STICKER_PACKS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<StickerPack>(v.value())?),
            None => None,
        })
    }

    pub fn find_sticker_pack_by_uname(&self, uname: &str) -> AppResult<Option<StickerPack>> {
        let uname = uname.trim().to_ascii_lowercase();
        let txn = self.read_db.begin_read()?;
        let idx = txn.open_table(STICKER_PACK_UNAME_IDX)?;
        let Some(id) = idx.get(uname.as_str())?.map(|v| v.value()) else {
            return Ok(None);
        };
        drop(idx);
        let t = txn.open_table(STICKER_PACKS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<StickerPack>(v.value())?),
            None => None,
        })
    }

    pub fn list_stickers_in_pack(&self, pack_id: u64) -> AppResult<Vec<Sticker>> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(PACK_STICKERS)?;
        let sticker_ids: Vec<u64> = mm
            .get(pack_id)?
            .filter_map(|r| r.ok().map(|v| v.value()))
            .collect();
        drop(mm);
        let t = txn.open_table(STICKERS)?;
        let mut out: Vec<Sticker> = Vec::with_capacity(sticker_ids.len());
        for sid in sticker_ids {
            if let Some(v) = t.get(sid)? {
                match bincode::deserialize::<Sticker>(v.value()) {
                    Ok(s) => out.push(s),
                    Err(e) => tracing::warn!(
                        error = ?e,
                        sticker_id = sid,
                        "skipping undecodable sticker"
                    ),
                }
            }
        }
        out.sort_by_key(|s| s.order_index);
        Ok(out)
    }

    pub fn get_sticker(&self, id: u64) -> AppResult<Option<Sticker>> {
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(STICKERS)?;
        Ok(match t.get(id)? {
            Some(v) => Some(bincode::deserialize::<Sticker>(v.value())?),
            None => None,
        })
    }

    pub fn is_pack_installed(&self, user_id: u64, pack_id: u64) -> AppResult<bool> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(USER_STICKER_PACKS)?;
        let mut iter = mm.get(user_id)?;
        while let Some(r) = iter.next() {
            if r?.value() == pack_id {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Packs the picker should show for a user: every installed pack PLUS
    /// every default pack (default packs are always available).
    pub fn list_user_sticker_packs(&self, user_id: u64) -> AppResult<Vec<StickerPack>> {
        let txn = self.read_db.begin_read()?;
        let mm = txn.open_multimap_table(USER_STICKER_PACKS)?;
        let mut ids: Vec<u64> = mm
            .get(user_id)?
            .filter_map(|r| r.ok().map(|v| v.value()))
            .collect();
        drop(mm);
        let packs = txn.open_table(STICKER_PACKS)?;
        // Fold in every default pack we haven't already collected.
        for r in packs.iter()? {
            let (id, v) = r?;
            let p: StickerPack = match bincode::deserialize(v.value()) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(error = ?e, "skipping undecodable sticker pack");
                    continue;
                }
            };
            if p.is_default && !ids.contains(&id.value()) {
                ids.push(id.value());
            }
        }
        let mut out: Vec<StickerPack> = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(v) = packs.get(id)? {
                if let Ok(p) = bincode::deserialize::<StickerPack>(v.value()) {
                    out.push(p);
                }
            }
        }
        // Default packs first, then installed by recency.
        out.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        Ok(out)
    }

    pub fn search_sticker_packs(&self, q: &str, limit: usize) -> AppResult<Vec<StickerPack>> {
        let needle = q.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Ok(vec![]);
        }
        let txn = self.read_db.begin_read()?;
        let t = txn.open_table(STICKER_PACKS)?;
        let mut out: Vec<StickerPack> = Vec::with_capacity(limit.min(64));
        for r in t.iter()? {
            let (_, v) = r?;
            let p: StickerPack = match bincode::deserialize(v.value()) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(error = ?e, "skipping undecodable sticker pack in search");
                    continue;
                }
            };
            let uname_hit = p.uname.to_ascii_lowercase().contains(&needle);
            let name_hit = p.name.to_ascii_lowercase().contains(&needle);
            if uname_hit || name_hit {
                out.push(p);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    }

    /* ---------------- sticker packs: writes ---------------- */

    pub async fn create_sticker_pack(
        &self,
        owner_id: u64,
        uname: String,
        name: String,
        is_default: bool,
    ) -> AppResult<StickerPack> {
        let uname = uname.trim().to_ascii_lowercase();
        let name = name.trim().to_string();
        self.run_write(move |db| -> AppResult<StickerPack> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let pack;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut packs = txn.open_table(STICKER_PACKS)?;
                let mut idx = txn.open_table(STICKER_PACK_UNAME_IDX)?;
                let user_idx = txn.open_table(USERNAME_IDX)?;
                let chan_idx = txn.open_table(CHANNEL_UNAME_IDX)?;

                if idx.get(uname.as_str())?.is_some()
                    || user_idx.get(uname.as_str())?.is_some()
                    || chan_idx.get(uname.as_str())?.is_some()
                {
                    return Err(AppError::Conflict("handle taken".into()));
                }

                let id = next_counter(&mut counters, COUNTER_STICKER_PACK)?;
                let p = StickerPack {
                    id,
                    uname: uname.clone(),
                    name,
                    owner_id,
                    sticker_count: 0,
                    is_animated: false,
                    is_default,
                    created_at: now,
                    updated_at: now,
                };
                let buf = bincode::serialize(&p)?;
                packs.insert(id, buf.as_slice())?;
                idx.insert(uname.as_str(), id)?;
                pack = p;
            }
            txn.commit()?;
            Ok(pack)
        })
        .await
    }

    pub async fn add_sticker_to_pack(
        &self,
        pack_id: u64,
        owner_id: u64,
        upload_id: String,
        url: String,
        mime: String,
        emoji: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> AppResult<Sticker> {
        self.run_write(move |db| -> AppResult<Sticker> {
            let now = now_ms();
            let txn = db.begin_write()?;
            let sticker;
            {
                let mut counters = txn.open_table(COUNTERS)?;
                let mut packs = txn.open_table(STICKER_PACKS)?;
                let mut stickers = txn.open_table(STICKERS)?;
                let mut pack_stickers = txn.open_multimap_table(PACK_STICKERS)?;

                let bytes = packs
                    .get(pack_id)?
                    .ok_or(AppError::NotFound)?
                    .value()
                    .to_vec();
                let mut p: StickerPack = bincode::deserialize(&bytes)?;
                // Default packs are owned by the boot-time seeder (owner_id 0)
                // — anyone whose owner_id matches the pack's may add stickers.
                if p.owner_id != owner_id {
                    return Err(AppError::Forbidden("not the pack owner"));
                }
                let is_animated = mime == "video/webm";
                let sticker_id = next_counter(&mut counters, COUNTER_STICKER)?;
                let s = Sticker {
                    id: sticker_id,
                    pack_id,
                    upload_id,
                    url,
                    mime,
                    width,
                    height,
                    emoji,
                    order_index: p.sticker_count as u32,
                    created_at: now,
                };
                let sbuf = bincode::serialize(&s)?;
                stickers.insert(sticker_id, sbuf.as_slice())?;
                pack_stickers.insert(pack_id, sticker_id)?;

                p.sticker_count += 1;
                if is_animated {
                    p.is_animated = true;
                }
                p.updated_at = now;
                let pbuf = bincode::serialize(&p)?;
                packs.insert(pack_id, pbuf.as_slice())?;

                sticker = s;
            }
            txn.commit()?;
            Ok(sticker)
        })
        .await
    }

    pub async fn install_sticker_pack(
        &self,
        user_id: u64,
        pack_id: u64,
    ) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let txn = db.begin_write()?;
            {
                let packs = txn.open_table(STICKER_PACKS)?;
                if packs.get(pack_id)?.is_none() {
                    return Err(AppError::NotFound);
                }
                drop(packs);
                let mut mm = txn.open_multimap_table(USER_STICKER_PACKS)?;
                mm.insert(user_id, pack_id)?;
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    pub async fn uninstall_sticker_pack(
        &self,
        user_id: u64,
        pack_id: u64,
    ) -> AppResult<()> {
        self.run_write(move |db| -> AppResult<()> {
            let txn = db.begin_write()?;
            {
                let mut mm = txn.open_multimap_table(USER_STICKER_PACKS)?;
                let _ = mm.remove(user_id, pack_id)?;
            }
            txn.commit()?;
            Ok(())
        })
        .await
    }

    /* ---------------- actor plumbing ---------------- */

    async fn run_write<R, F>(&self, work: F) -> AppResult<R>
    where
        R: Send + 'static,
        F: FnOnce(&Database) -> AppResult<R> + Send + 'static,
    {
        let (tx, rx) = oneshot::channel::<AppResult<R>>();
        let job: WriteJob = Box::new(move |db: &Database| {
            let res = work(db);
            let _ = tx.send(res);
        });
        self.writer_tx
            .send(job)
            .await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("writer queue closed")))?;
        rx.await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("writer dropped result")))?
    }
}

/* ---------------- internals ---------------- */

fn spawn_writer(db: Arc<Database>, mut rx: mpsc::Receiver<WriteJob>) {
    // One dedicated thread on the blocking pool. Loops until the channel
    // closes (i.e. the Store is dropped).
    tokio::task::spawn_blocking(move || {
        let handle = tokio::runtime::Handle::current();
        while let Some(job) = handle.block_on(rx.recv()) {
            job(&db);
        }
    });
}

fn next_counter(
    counters: &mut redb::Table<&str, u64>,
    key: &'static str,
) -> AppResult<u64> {
    let curr = counters.get(key)?.map(|v| v.value()).unwrap_or(0);
    let next = curr + 1;
    counters.insert(key, next)?;
    Ok(next)
}

fn decode_user(b: &[u8]) -> AppResult<User> {
    bincode::deserialize::<User>(b).map_err(Into::into)
}
fn decode_chat(b: &[u8]) -> AppResult<Chat> {
    bincode::deserialize::<Chat>(b).map_err(Into::into)
}
fn decode_message(b: &[u8]) -> AppResult<Message> {
    bincode::deserialize::<Message>(b).map_err(Into::into)
}
fn decode_refresh(b: &[u8]) -> AppResult<RefreshToken> {
    bincode::deserialize::<RefreshToken>(b).map_err(Into::into)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn truncate_preview(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Truncate on a char boundary
        let mut idx = max;
        while !s.is_char_boundary(idx) {
            idx -= 1;
        }
        s[..idx].to_string()
    }
}

/// Last-message preview used in the chat list. Body wins; otherwise we render
/// a generic label for the attachment kind so the row isn't blank.
fn preview_for(body: &str, attachment: Option<&Attachment>) -> String {
    if !body.is_empty() {
        return truncate_preview(body, 200);
    }
    match attachment.map(|a| a.kind) {
        Some(crate::models::chat::AttachmentKind::Image) => "📷 Photo".into(),
        Some(crate::models::chat::AttachmentKind::Video) => "🎬 Video".into(),
        Some(crate::models::chat::AttachmentKind::Audio) => "🎵 Audio".into(),
        Some(crate::models::chat::AttachmentKind::File) => "📎 File".into(),
        Some(crate::models::chat::AttachmentKind::Sticker) => "✨ Sticker".into(),
        None => String::new(),
    }
}
