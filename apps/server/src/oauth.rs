//! Google ID-token verification using the public JWKS at
//! https://www.googleapis.com/oauth2/v3/certs. We cache the key set, refresh
//! it when it expires (respecting Google's `Cache-Control: max-age`), and
//! force a refresh once on `kid` cache miss to handle key rotation.

use std::sync::Arc;
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::error::{AppError, AppResult};

const JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const FALLBACK_TTL: Duration = Duration::from_secs(60 * 60); // 1h
const MIN_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
pub struct GoogleClaims {
    pub sub: String,
    pub email: String,
    #[serde(default)]
    pub email_verified: bool,
    pub name: Option<String>,
    pub picture: Option<String>,
}

struct CachedJwks {
    expires_at: Instant,
    set: JwkSet,
}

#[derive(Clone)]
pub struct Verifier {
    client_id: Arc<String>,
    http: reqwest::Client,
    cache: Arc<RwLock<Option<CachedJwks>>>,
}

impl Verifier {
    pub fn new(client_id: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("cognigram-server/0.1")
            .build()?;
        Ok(Self {
            client_id: Arc::new(client_id),
            http,
            cache: Arc::new(RwLock::new(None)),
        })
    }

    /// Verify a Google-issued ID token. On success returns the parsed claims.
    pub async fn verify(&self, id_token: &str) -> AppResult<GoogleClaims> {
        let header = decode_header(id_token).map_err(|_| AppError::Unauthorized)?;
        let kid = header.kid.ok_or(AppError::Unauthorized)?;

        // Try the cache, falling back to a forced refresh on miss.
        let jwk_owned = match self.find_in_cache(&kid).await? {
            Some(j) => j,
            None => {
                self.refresh_cache().await?;
                self.find_in_cache(&kid)
                    .await?
                    .ok_or(AppError::Unauthorized)?
            }
        };

        let key = DecodingKey::from_jwk(&jwk_owned).map_err(|_| AppError::Unauthorized)?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[self.client_id.as_str()]);
        validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
        // jsonwebtoken validates `exp`/`nbf` by default.

        let data = decode::<GoogleClaims>(id_token, &key, &validation)
            .map_err(|_| AppError::Unauthorized)?;
        Ok(data.claims)
    }

    async fn find_in_cache(&self, kid: &str) -> AppResult<Option<jsonwebtoken::jwk::Jwk>> {
        // Refresh first if expired (or never populated).
        let needs_refresh = {
            let g = self.cache.read().await;
            match g.as_ref() {
                None => true,
                Some(c) => Instant::now() >= c.expires_at,
            }
        };
        if needs_refresh {
            self.refresh_cache().await?;
        }
        let g = self.cache.read().await;
        let set = g
            .as_ref()
            .map(|c| &c.set)
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("jwks not initialised")))?;
        Ok(set.find(kid).cloned())
    }

    async fn refresh_cache(&self) -> AppResult<()> {
        let resp = self
            .http
            .get(JWKS_URL)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("jwks fetch: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Internal(anyhow::anyhow!(
                "jwks fetch http {}",
                resp.status()
            )));
        }
        let ttl = parse_max_age(resp.headers()).unwrap_or(FALLBACK_TTL).max(MIN_TTL);
        let set: JwkSet = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("jwks parse: {e}")))?;
        let mut g = self.cache.write().await;
        *g = Some(CachedJwks {
            expires_at: Instant::now() + ttl,
            set,
        });
        Ok(())
    }
}

fn parse_max_age(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let cc = headers.get(reqwest::header::CACHE_CONTROL)?.to_str().ok()?;
    for part in cc.split(',') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("max-age=") {
            if let Ok(secs) = rest.parse::<u64>() {
                return Some(Duration::from_secs(secs));
            }
        }
    }
    None
}
