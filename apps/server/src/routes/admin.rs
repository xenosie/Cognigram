use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use validator::Validate;

use crate::email::render_otp_email;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/test-email", post(test_email))
}

#[derive(Debug, Deserialize, Validate)]
struct TestEmailReq {
    #[validate(email)]
    to: String,
}

async fn test_email(
    State(state): State<AppState>,
    Json(req): Json<TestEmailReq>,
) -> AppResult<Json<serde_json::Value>> {
    if !state.config.enable_test_endpoints {
        return Err(AppError::Forbidden);
    }
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;

    let html = render_otp_email(&state.config.app_name, "123456");
    state
        .mailer
        .send(&req.to, "Keracross — test email", html)
        .await?;

    Ok(Json(json!({ "status": "sent", "to": req.to })))
}
