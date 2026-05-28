//! Maintenance tool — opens the redb file, tries to bincode-decode every
//! record in every struct-bearing table, reports the first failure per
//! table, and (with `--clean`) deletes any record that can't be deserialized
//! by the current schema.
//!
//! Usage:
//!   inspect [path]              # report only
//!   inspect [path] --clean      # report + delete bad records
//!
//! Run with the cognigram-server process stopped so redb has exclusive
//! access.

use redb::{
    Database, MultimapTableDefinition, ReadableMultimapTable, ReadableTable, TableDefinition,
};
use std::env;

use cognigram_server::models::channel::Channel;
use cognigram_server::models::chat::{Chat, Message, Upload};
use cognigram_server::models::sticker::{Sticker, StickerPack};
use cognigram_server::models::user::User;
use cognigram_server::models::verification::RefreshToken;

const USERS: TableDefinition<u64, &[u8]> = TableDefinition::new("users");
const CHATS: TableDefinition<u64, &[u8]> = TableDefinition::new("chats");
const MESSAGES: TableDefinition<(u64, u64), &[u8]> = TableDefinition::new("messages");
const REFRESH_TOKENS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("refresh_tokens");
const UPLOADS: TableDefinition<&str, &[u8]> = TableDefinition::new("uploads");
const CHANNELS: TableDefinition<u64, &[u8]> = TableDefinition::new("channels");
const CHANNEL_MESSAGES: TableDefinition<(u64, u64), &[u8]> =
    TableDefinition::new("channel_messages");
const STICKER_PACKS: TableDefinition<u64, &[u8]> = TableDefinition::new("sticker_packs");
const STICKERS: TableDefinition<u64, &[u8]> = TableDefinition::new("stickers");
const USER_CHATS: MultimapTableDefinition<u64, u64> = MultimapTableDefinition::new("user_chats");

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let clean = args.iter().any(|a| a == "--clean");
    let path = args
        .iter()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .cloned()
        .unwrap_or_else(|| {
            env::var("DB_PATH").unwrap_or_else(|_| "./cognigram.redb".to_string())
        });
    println!("Opening {path} (clean={clean})");
    let db = Database::create(&path)?;

    macro_rules! scan {
        ($table:expr, $ty:ty, $label:expr, $key_ty:ty) => {{
            // Read pass to find bad keys.
            let mut bad_keys: Vec<$key_ty> = Vec::new();
            {
                let txn = db.begin_read()?;
                let t = txn.open_table($table)?;
                let mut ok = 0;
                for r in t.iter()? {
                    let (k, v) = r?;
                    match bincode::deserialize::<$ty>(v.value()) {
                        Ok(_) => ok += 1,
                        Err(e) => {
                            bad_keys.push(k.value());
                            if bad_keys.len() <= 3 {
                                println!("  BAD in {} key={:?}: {}", $label, bad_keys.last().unwrap(), e);
                            }
                        }
                    }
                }
                println!("[{}] ok={} bad={}", $label, ok, bad_keys.len());
            }
            // Optional cleanup pass.
            if clean && !bad_keys.is_empty() {
                let txn = db.begin_write()?;
                {
                    let mut t = txn.open_table($table)?;
                    for k in &bad_keys {
                        let _ = t.remove(*k)?;
                    }
                }
                txn.commit()?;
                println!("  ✓ removed {} bad records from {}", bad_keys.len(), $label);
            }
        }};
    }

    scan!(USERS, User, "users", u64);
    scan!(CHATS, Chat, "chats", u64);
    scan!(MESSAGES, Message, "messages", (u64, u64));
    scan!(CHANNELS, Channel, "channels", u64);
    scan!(CHANNEL_MESSAGES, Message, "channel_messages", (u64, u64));
    scan!(STICKER_PACKS, StickerPack, "sticker_packs", u64);
    scan!(STICKERS, Sticker, "stickers", u64);

    // Refresh tokens / uploads keyed by bytes / str — separate handling.
    {
        let txn = db.begin_read()?;
        let t = txn.open_table(REFRESH_TOKENS)?;
        let mut ok = 0;
        let mut bad: Vec<Vec<u8>> = Vec::new();
        for r in t.iter()? {
            let (k, v) = r?;
            match bincode::deserialize::<RefreshToken>(v.value()) {
                Ok(_) => ok += 1,
                Err(_) => bad.push(k.value().to_vec()),
            }
        }
        println!("[refresh_tokens] ok={} bad={}", ok, bad.len());
        if clean && !bad.is_empty() {
            drop(t);
            drop(txn);
            let txn = db.begin_write()?;
            {
                let mut t = txn.open_table(REFRESH_TOKENS)?;
                for k in &bad {
                    let _ = t.remove(k.as_slice())?;
                }
            }
            txn.commit()?;
            println!("  ✓ removed {} bad refresh tokens", bad.len());
        }
    }
    {
        let txn = db.begin_read()?;
        let t = txn.open_table(UPLOADS)?;
        let mut ok = 0;
        let mut bad: Vec<String> = Vec::new();
        for r in t.iter()? {
            let (k, v) = r?;
            match bincode::deserialize::<Upload>(v.value()) {
                Ok(_) => ok += 1,
                Err(_) => bad.push(k.value().to_string()),
            }
        }
        println!("[uploads] ok={} bad={}", ok, bad.len());
        if clean && !bad.is_empty() {
            drop(t);
            drop(txn);
            let txn = db.begin_write()?;
            {
                let mut t = txn.open_table(UPLOADS)?;
                for k in &bad {
                    let _ = t.remove(k.as_str())?;
                }
            }
            txn.commit()?;
            println!("  ✓ removed {} bad uploads", bad.len());
        }
    }

    // Print USER_CHATS multimap for context.
    let txn = db.begin_read()?;
    let mm = txn.open_multimap_table(USER_CHATS)?;
    for r in mm.iter()? {
        let (k, vs) = r?;
        println!("USER_CHATS[user={}] = {} chats", k.value(), vs.count());
    }

    Ok(())
}
