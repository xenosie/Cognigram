use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDateTime};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use validator::Validate;

use crate::email::render_otp_email;
use crate::error::{AppError, AppResult};
use crate::hash::{constant_time_eq, hash_password, hash_token, verify_password};
use crate::jwt;
use crate::middleware::AuthUser;
use crate::models::user::{PublicUser, User};
use crate::models::verification::{EmailVerification, LoginChallenge, RefreshToken};
use crate::state::AppState;
use crate::totp;

const EMAIL_CODE_TTL_SECS: i64 = 10 * 60;
const LOGIN_CHALLENGE_TTL_SECS: i64 = 5 * 60;
const REFRESH_BYTES: usize = 48;
const CHALLENGE_BYTES: usize = 32;
const MAX_FAILED_LOGINS: i32 = 5;
const LOCKOUT_SECS: i64 = 15 * 60;
const MAX_EMAIL_VERIFY_ATTEMPTS: i32 = 5;

fn future_dt(secs_from_now: i64) -> BsonDateTime {
    BsonDateTime::from_millis(Utc::now().timestamp_millis() + secs_from_now * 1000)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/verify-email", post(verify_email))
        .route("/auth/resend-verification", post(resend_verification))
        .route("/auth/login", post(login))
        .route("/auth/login/totp", post(login_totp))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/2fa/setup", post(totp_setup))
        .route("/auth/2fa/enable", post(totp_enable))
}

/* -------------------- helpers -------------------- */

fn now() -> BsonDateTime {
    BsonDateTime::now()
}

fn random_otp_6() -> String {
    let n: u32 = rand::thread_rng().gen_range(0..1_000_000);
    format!("{n:06}")
}

fn random_url_token(bytes: usize) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    URL_SAFE_NO_PAD.encode(buf)
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

async fn issue_token_pair(state: &AppState, user_id: ObjectId) -> AppResult<TokenPair> {
    let access = jwt::issue_access(
        &user_id.to_hex(),
        &state.config.jwt_secret,
        state.config.jwt_access_ttl_secs,
    )?;

    let refresh_plain = random_url_token(REFRESH_BYTES);
    let refresh_hash = hash_token(&refresh_plain);
    let expires_at = future_dt(state.config.jwt_refresh_ttl_secs as i64);

    state
        .db
        .database
        .collection::<RefreshToken>("refresh_tokens")
        .insert_one(RefreshToken {
            id: None,
            user_id,
            token_hash: refresh_hash,
            expires_at,
            created_at: now(),
            revoked: false,
        })
        .await?;

    Ok(TokenPair {
        access_token: access,
        refresh_token: refresh_plain,
        token_type: "Bearer".to_string(),
        expires_in: state.config.jwt_access_ttl_secs,
    })
}

#[derive(Debug, Serialize)]
struct TokenPair {
    access_token: String,
    refresh_token: String,
    token_type: String,
    expires_in: u64,
}

/* -------------------- signup -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct SignupReq {
    #[validate(email)]
    email: String,
    #[validate(length(min = 5, max = 32))]
    username: String,
    #[validate(length(min = 8, max = 128))]
    password: String,
}

fn is_valid_username(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupReq>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let email = normalize_email(&req.email);
    let username = req.username.trim().to_lowercase();
    if !is_valid_username(&username) {
        return Err(AppError::BadRequest(
            "username may only contain letters, numbers and underscores".into(),
        ));
    }

    let users = state.db.database.collection::<User>("users");

    if users.find_one(doc! { "email": &email }).await?.is_some() {
        return Err(AppError::Conflict("email already registered".into()));
    }
    if users
        .find_one(doc! { "username": &username })
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("username already taken".into()));
    }

    let password_hash = hash_password(&req.password)?;
    let user = User {
        id: None,
        email: email.clone(),
        username: Some(username.clone()),
        password_hash,
        email_verified: false,
        totp_secret: None,
        totp_enabled: false,
        failed_login_attempts: 0,
        locked_until: None,
        created_at: now(),
        updated_at: now(),
    };

    let inserted = users.insert_one(&user).await?;
    let user_id = inserted
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert returned no id")))?;

    // Generate + store verification code
    let code = random_otp_6();
    let code_hash = hash_token(&code);
    state
        .db
        .database
        .collection::<EmailVerification>("email_verifications")
        .insert_one(EmailVerification {
            id: None,
            user_id,
            code_hash,
            attempts: 0,
            expires_at: future_dt(EMAIL_CODE_TTL_SECS),
            created_at: now(),
        })
        .await?;

    // Send in the background — don't make the user wait for SMTP
    let html = render_otp_email(&state.config.app_name, &code);
    state
        .mailer
        .send_in_background(email.clone(), "Verify your Keracross email".into(), html);

    Ok(Json(json!({
        "status": "verification_sent",
        "email": email,
    })))
}

/* -------------------- verify-email -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct VerifyEmailReq {
    #[validate(email)]
    email: String,
    #[validate(length(equal = 6))]
    code: String,
}

async fn verify_email(
    State(state): State<AppState>,
    Json(req): Json<VerifyEmailReq>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let email = normalize_email(&req.email);

    let users = state.db.database.collection::<User>("users");
    let user = users
        .find_one(doc! { "email": &email })
        .await?
        .ok_or(AppError::NotFound)?;
    let user_id = user.id.ok_or(AppError::NotFound)?;

    let verifications = state
        .db
        .database
        .collection::<EmailVerification>("email_verifications");
    let v = verifications
        .find_one(doc! { "user_id": user_id })
        .await?
        .ok_or(AppError::BadRequest("no pending verification".into()))?;

    let provided = hash_token(&req.code);
    if !constant_time_eq(&provided, &v.code_hash) {
        let v_id = v.id.unwrap();
        // After too many failed attempts, drop the record so user must resend.
        if v.attempts + 1 >= MAX_EMAIL_VERIFY_ATTEMPTS {
            verifications.delete_one(doc! { "_id": v_id }).await?;
        } else {
            verifications
                .update_one(doc! { "_id": v_id }, doc! { "$inc": { "attempts": 1 } })
                .await?;
        }
        return Err(AppError::Unauthorized);
    }

    users
        .update_one(
            doc! { "_id": user_id },
            doc! { "$set": { "email_verified": true, "updated_at": now() } },
        )
        .await?;
    verifications
        .delete_one(doc! { "user_id": user_id })
        .await?;

    let tokens = issue_token_pair(&state, user_id).await?;
    Ok(Json(serde_json::to_value(tokens).unwrap()))
}

/* -------------------- resend verification -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct ResendReq {
    #[validate(email)]
    email: String,
}

async fn resend_verification(
    State(state): State<AppState>,
    Json(req): Json<ResendReq>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let email = normalize_email(&req.email);

    let user = state
        .db
        .database
        .collection::<User>("users")
        .find_one(doc! { "email": &email })
        .await?;
    // Always return 200 so we don't leak whether the email exists
    if let Some(user) = user {
        if !user.email_verified {
            let user_id = user.id.unwrap();
            let code = random_otp_6();
            let code_hash = hash_token(&code);

            let verifications = state
                .db
                .database
                .collection::<EmailVerification>("email_verifications");
            verifications.delete_one(doc! { "user_id": user_id }).await?;
            verifications
                .insert_one(EmailVerification {
                    id: None,
                    user_id,
                    code_hash,
                    attempts: 0,
                    expires_at: future_dt(EMAIL_CODE_TTL_SECS),
                    created_at: now(),
                })
                .await?;

            let html = render_otp_email(&state.config.app_name, &code);
            state.mailer.send_in_background(
                email.clone(),
                "Verify your Keracross email".into(),
                html,
            );
        }
    }
    Ok(Json(json!({ "status": "ok" })))
}

/* -------------------- login (step 1) -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct LoginReq {
    #[validate(email)]
    email: String,
    #[validate(length(min = 1))]
    password: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum LoginRes {
    Authenticated(TokenPair),
    NeedsEmailVerification,
    NeedsTotp { challenge_token: String, expires_in: u64 },
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginReq>,
) -> AppResult<Json<LoginRes>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let email = normalize_email(&req.email);

    let users = state.db.database.collection::<User>("users");
    let user = users
        .find_one(doc! { "email": &email })
        .await?
        .ok_or(AppError::Unauthorized)?;

    // Check lockout
    if let Some(locked_until) = user.locked_until {
        if locked_until.timestamp_millis() > Utc::now().timestamp_millis() {
            return Err(AppError::Forbidden);
        }
    }

    let user_id = user.id.ok_or(AppError::Unauthorized)?;

    if !verify_password(&req.password, &user.password_hash) {
        let new_count = user.failed_login_attempts + 1;
        let mut update = doc! {
            "$set": { "failed_login_attempts": new_count, "updated_at": now() }
        };
        if new_count >= MAX_FAILED_LOGINS {
            update.insert(
                "$set",
                doc! {
                    "failed_login_attempts": new_count,
                    "locked_until": future_dt(LOCKOUT_SECS),
                    "updated_at": now(),
                },
            );
        }
        users.update_one(doc! { "_id": user_id }, update).await?;
        return Err(AppError::Unauthorized);
    }

    // Reset failed attempts on success
    if user.failed_login_attempts != 0 || user.locked_until.is_some() {
        users
            .update_one(
                doc! { "_id": user_id },
                doc! { "$set": { "failed_login_attempts": 0, "locked_until": null, "updated_at": now() } },
            )
            .await?;
    }

    if !user.email_verified {
        return Ok(Json(LoginRes::NeedsEmailVerification));
    }

    if user.totp_enabled {
        let challenge = random_url_token(CHALLENGE_BYTES);
        let token_hash = hash_token(&challenge);
        state
            .db
            .database
            .collection::<LoginChallenge>("login_challenges")
            .insert_one(LoginChallenge {
                id: None,
                user_id,
                token_hash,
                expires_at: future_dt(LOGIN_CHALLENGE_TTL_SECS),
                created_at: now(),
            })
            .await?;
        return Ok(Json(LoginRes::NeedsTotp {
            challenge_token: challenge,
            expires_in: LOGIN_CHALLENGE_TTL_SECS as u64,
        }));
    }

    let tokens = issue_token_pair(&state, user_id).await?;
    Ok(Json(LoginRes::Authenticated(tokens)))
}

/* -------------------- login totp -------------------- */

#[derive(Debug, Deserialize, Validate)]
struct LoginTotpReq {
    #[validate(length(min = 1))]
    challenge_token: String,
    #[validate(length(equal = 6))]
    code: String,
}

async fn login_totp(
    State(state): State<AppState>,
    Json(req): Json<LoginTotpReq>,
) -> AppResult<Json<TokenPair>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let hash = hash_token(&req.challenge_token);

    let challenges = state
        .db
        .database
        .collection::<LoginChallenge>("login_challenges");
    let challenge = challenges
        .find_one(doc! { "token_hash": &hash })
        .await?
        .ok_or(AppError::Unauthorized)?;

    let user = state
        .db
        .database
        .collection::<User>("users")
        .find_one(doc! { "_id": challenge.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;

    let secret = user.totp_secret.as_deref().ok_or(AppError::Unauthorized)?;
    if !totp::verify_code(secret, &req.code) {
        return Err(AppError::Unauthorized);
    }

    challenges.delete_one(doc! { "_id": challenge.id.unwrap() }).await?;

    let tokens = issue_token_pair(&state, challenge.user_id).await?;
    Ok(Json(tokens))
}

/* -------------------- refresh -------------------- */

#[derive(Debug, Deserialize)]
struct RefreshReq {
    refresh_token: String,
}

async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshReq>,
) -> AppResult<Json<TokenPair>> {
    let token_hash = hash_token(&req.refresh_token);
    let coll = state
        .db
        .database
        .collection::<RefreshToken>("refresh_tokens");

    let existing = coll
        .find_one(doc! { "token_hash": &token_hash, "revoked": false })
        .await?
        .ok_or(AppError::Unauthorized)?;

    // rotate: revoke old, issue new
    coll.update_one(
        doc! { "_id": existing.id.unwrap() },
        doc! { "$set": { "revoked": true } },
    )
    .await?;

    let tokens = issue_token_pair(&state, existing.user_id).await?;
    Ok(Json(tokens))
}

/* -------------------- logout -------------------- */

async fn logout(
    State(state): State<AppState>,
    Json(req): Json<RefreshReq>,
) -> AppResult<Json<serde_json::Value>> {
    let token_hash = hash_token(&req.refresh_token);
    state
        .db
        .database
        .collection::<RefreshToken>("refresh_tokens")
        .update_one(
            doc! { "token_hash": &token_hash },
            doc! { "$set": { "revoked": true } },
        )
        .await?;
    Ok(Json(json!({ "status": "ok" })))
}

/* -------------------- me -------------------- */

async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<PublicUser>> {
    let user = state
        .db
        .database
        .collection::<User>("users")
        .find_one(doc! { "_id": auth.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(PublicUser::from(&user)))
}

/* -------------------- 2FA setup / enable -------------------- */

#[derive(Debug, Serialize)]
struct TotpSetupRes {
    secret: String,
    otpauth_url: String,
}

async fn totp_setup(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<TotpSetupRes>> {
    let users = state.db.database.collection::<User>("users");
    let user = users
        .find_one(doc! { "_id": auth.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;

    if user.totp_enabled {
        return Err(AppError::Conflict("2FA already enabled".into()));
    }

    let secret = totp::generate_secret_base32();
    let setup = totp::build_setup(&state.config.totp_issuer, &user.email, &secret)?;

    users
        .update_one(
            doc! { "_id": auth.user_id },
            doc! { "$set": { "totp_secret": &secret, "updated_at": now() } },
        )
        .await?;

    Ok(Json(TotpSetupRes {
        secret: setup.secret_base32,
        otpauth_url: setup.otpauth_url,
    }))
}

#[derive(Debug, Deserialize, Validate)]
struct TotpEnableReq {
    #[validate(length(equal = 6))]
    code: String,
}

async fn totp_enable(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<TotpEnableReq>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate().map_err(|e| AppError::BadRequest(e.to_string()))?;
    let users = state.db.database.collection::<User>("users");
    let user = users
        .find_one(doc! { "_id": auth.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;

    let secret = user
        .totp_secret
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("call /auth/2fa/setup first".into()))?;
    if !totp::verify_code(secret, &req.code) {
        return Err(AppError::Unauthorized);
    }

    users
        .update_one(
            doc! { "_id": auth.user_id },
            doc! { "$set": { "totp_enabled": true, "updated_at": now() } },
        )
        .await?;

    Ok(Json(json!({ "status": "enabled" })))
}
