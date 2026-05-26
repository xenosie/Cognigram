use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct Config {
    pub mongodb_uri: String,
    pub mongodb_db: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_from_name: String,
    pub smtp_from_email: String,
    pub jwt_secret: String,
    pub jwt_access_ttl_secs: u64,
    pub jwt_refresh_ttl_secs: u64,
    pub server_addr: SocketAddr,
    pub cors_origins: Vec<String>,
    pub totp_issuer: String,
    pub app_name: String,
    pub log_level: String,
    pub enable_test_endpoints: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        fn req(name: &str) -> anyhow::Result<String> {
            std::env::var(name)
                .map_err(|_| anyhow::anyhow!("missing required env var: {name}"))
        }
        fn opt(name: &str, default: &str) -> String {
            std::env::var(name).unwrap_or_else(|_| default.to_string())
        }

        let host = opt("SERVER_HOST", "0.0.0.0");
        let port: u16 = opt("SERVER_PORT", "3001").parse()?;
        let server_addr: SocketAddr = format!("{host}:{port}").parse()?;

        let cors_origins = opt("CORS_ORIGINS", "http://localhost:5173")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Self {
            mongodb_uri: req("MONGODB_URI")?,
            mongodb_db: opt("MONGODB_DB", "app"),
            smtp_host: req("SMTP_HOST")?,
            smtp_port: opt("SMTP_PORT", "465").parse()?,
            smtp_username: req("SMTP_USERNAME")?,
            smtp_password: req("SMTP_PASSWORD")?,
            smtp_from_name: opt("SMTP_FROM_NAME", "Keracross"),
            smtp_from_email: req("SMTP_FROM_EMAIL")?,
            jwt_secret: req("JWT_SECRET")?,
            jwt_access_ttl_secs: opt("JWT_ACCESS_TTL_SECS", "900").parse()?,
            jwt_refresh_ttl_secs: opt("JWT_REFRESH_TTL_SECS", "2592000").parse()?,
            server_addr,
            cors_origins,
            totp_issuer: opt("TOTP_ISSUER", "Keracross"),
            app_name: opt("APP_NAME", "Keracross"),
            log_level: opt("LOG_LEVEL", "info"),
            enable_test_endpoints: opt("ENABLE_TEST_ENDPOINTS", "false") == "true",
        })
    }
}
