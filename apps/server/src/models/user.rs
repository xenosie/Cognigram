use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: u64,
    /// Google's stable `sub` claim — primary lookup key.
    pub google_sub: String,
    pub email: String,
    /// Set later via the one-time `/auth/username` step; `None` until then.
    pub username: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub username: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
}

impl From<&User> for PublicUser {
    fn from(u: &User) -> Self {
        Self {
            id: u.id.to_string(),
            email: u.email.clone(),
            username: u.username.clone(),
            name: u.name.clone(),
            picture: u.picture.clone(),
        }
    }
}
