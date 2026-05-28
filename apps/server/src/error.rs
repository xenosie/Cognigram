use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("invalid input: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden: {0}")]
    Forbidden(&'static str),

    #[error("not found")]
    NotFound,

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("too many requests")]
    TooManyRequests,

    #[error("internal error")]
    Internal(#[from] anyhow::Error),

    #[error("database error")]
    Db(#[from] redb::Error),
}

impl From<redb::TransactionError> for AppError {
    fn from(e: redb::TransactionError) -> Self {
        Self::Db(e.into())
    }
}
impl From<redb::TableError> for AppError {
    fn from(e: redb::TableError) -> Self {
        Self::Db(e.into())
    }
}
impl From<redb::StorageError> for AppError {
    fn from(e: redb::StorageError) -> Self {
        Self::Db(e.into())
    }
}
impl From<redb::CommitError> for AppError {
    fn from(e: redb::CommitError) -> Self {
        Self::Db(e.into())
    }
}
impl From<redb::DatabaseError> for AppError {
    fn from(e: redb::DatabaseError) -> Self {
        Self::Internal(anyhow::anyhow!("redb open: {e}"))
    }
}

impl From<bincode::Error> for AppError {
    fn from(e: bincode::Error) -> Self {
        Self::Internal(anyhow::anyhow!("bincode: {e}"))
    }
}

impl AppError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden(code) => (StatusCode::FORBIDDEN, code),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            Self::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            Self::Internal(_) | Self::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        if matches!(self, Self::Internal(_) | Self::Db(_)) {
            tracing::error!(error = ?self, "server error");
        } else {
            tracing::debug!(error = ?self, "client error");
        }

        let message = match &self {
            Self::Internal(_) | Self::Db(_) => "Something went wrong.".to_string(),
            other => other.to_string(),
        };

        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
