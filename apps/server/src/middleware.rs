use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use mongodb::bson::oid::ObjectId;

use crate::error::{AppError, AppResult};
use crate::jwt;
use crate::state::AppState;

pub struct AuthUser {
    pub user_id: ObjectId,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .ok_or(AppError::Unauthorized)?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        let claims = jwt::verify_access(token, &state.config.jwt_secret)?;
        let user_id = ObjectId::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;

        Ok(Self { user_id })
    }
}
