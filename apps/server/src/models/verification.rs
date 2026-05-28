use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshToken {
    pub user_id: u64,
    pub token_hash: [u8; 32],
    pub expires_at: i64,
    pub created_at: i64,
    pub revoked: bool,
}
