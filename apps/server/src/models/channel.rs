use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    /// Any joined member can post.
    Group,
    /// Broadcast: only the owner can post; everyone else can only read.
    Channel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: u64,
    pub kind: ChannelKind,
    pub uname: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub owner_id: u64,
    pub member_count: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicChannel {
    pub id: String,
    pub kind: ChannelKind,
    pub uname: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub owner_id: String,
    pub member_count: u64,
    /// Whether the requesting user is currently a member.
    pub is_member: bool,
    /// Whether the requesting user is the owner.
    pub is_owner: bool,
    /// Unread messages for the viewer (capped at 100; UI renders `99+`).
    pub unread_count: u64,
    pub created_at: i64,
}

impl PublicChannel {
    pub fn new(
        c: &Channel,
        is_member: bool,
        is_owner: bool,
        unread_count: u64,
    ) -> Self {
        Self {
            id: c.id.to_string(),
            kind: c.kind,
            uname: c.uname.clone(),
            name: c.name.clone(),
            description: c.description.clone(),
            avatar: c.avatar.clone(),
            owner_id: c.owner_id.to_string(),
            member_count: c.member_count,
            is_member,
            is_owner,
            unread_count,
            created_at: c.created_at,
        }
    }
}
