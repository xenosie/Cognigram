use rand::RngCore;
use totp_rs::{Algorithm, Secret, TOTP};

use crate::error::{AppError, AppResult};

const SECRET_BYTES: usize = 20; // 160 bits — RFC 6238 recommended

pub struct TotpSetup {
    pub secret_base32: String,
    pub otpauth_url: String,
}

pub fn generate_secret_base32() -> String {
    let mut buf = [0u8; SECRET_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    Secret::Raw(buf.to_vec()).to_encoded().to_string()
}

pub fn build_setup(issuer: &str, email: &str, secret_base32: &str) -> AppResult<TotpSetup> {
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        Secret::Encoded(secret_base32.to_string())
            .to_bytes()
            .map_err(|e| AppError::Internal(anyhow::anyhow!("totp secret decode: {e}")))?,
        Some(issuer.to_string()),
        email.to_string(),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("totp build: {e}")))?;

    Ok(TotpSetup {
        secret_base32: secret_base32.to_string(),
        otpauth_url: totp.get_url(),
    })
}

pub fn verify_code(secret_base32: &str, code: &str) -> bool {
    let bytes = match Secret::Encoded(secret_base32.to_string()).to_bytes() {
        Ok(b) => b,
        Err(_) => return false,
    };
    let Ok(totp) = TOTP::new(Algorithm::SHA1, 6, 1, 30, bytes, None, "user".to_string()) else {
        return false;
    };
    totp.check_current(code).unwrap_or(false)
}

