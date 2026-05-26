use mongodb::bson::oid::ObjectId;
use mongodb::bson::DateTime as BsonDateTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub email: String,
    /// Globally unique handle. Optional on the model so legacy rows still load,
    /// but required for any new signup (enforced in the signup handler).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub password_hash: String,
    pub email_verified: bool,
    pub totp_secret: Option<String>,
    pub totp_enabled: bool,
    #[serde(default)]
    pub failed_login_attempts: i32,
    #[serde(default)]
    pub locked_until: Option<BsonDateTime>,
    pub created_at: BsonDateTime,
    pub updated_at: BsonDateTime,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub username: Option<String>,
    pub email_verified: bool,
    pub totp_enabled: bool,
}

impl From<&User> for PublicUser {
    fn from(u: &User) -> Self {
        Self {
            id: u.id.map(|i| i.to_hex()).unwrap_or_default(),
            email: u.email.clone(),
            username: u.username.clone(),
            email_verified: u.email_verified,
            totp_enabled: u.totp_enabled,
        }
    }
}
