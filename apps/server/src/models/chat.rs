use mongodb::bson::oid::ObjectId;
use mongodb::bson::DateTime as BsonDateTime;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chat {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    /// Always sorted ascending by ObjectId so a 1:1 chat has a canonical key.
    pub participants: Vec<ObjectId>,
    pub last_message_at: Option<BsonDateTime>,
    pub created_at: BsonDateTime,
    pub updated_at: BsonDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub chat_id: ObjectId,
    pub sender_id: ObjectId,
    pub body: String,
    pub created_at: BsonDateTime,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicMessage {
    pub id: String,
    pub chat_id: String,
    pub sender_id: String,
    pub body: String,
    pub created_at: i64,
}

impl From<&Message> for PublicMessage {
    fn from(m: &Message) -> Self {
        Self {
            id: m.id.map(|i| i.to_hex()).unwrap_or_default(),
            chat_id: m.chat_id.to_hex(),
            sender_id: m.sender_id.to_hex(),
            body: m.body.clone(),
            created_at: m.created_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicParticipant {
    pub id: String,
    pub email: String,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicChat {
    pub id: String,
    pub participants: Vec<PublicParticipant>,
    pub last_message_at: Option<i64>,
    pub last_message_preview: Option<String>,
}
