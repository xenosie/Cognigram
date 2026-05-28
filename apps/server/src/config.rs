use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub db_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub jwt_secret: String,
    pub jwt_access_ttl_secs: u64,
    pub jwt_refresh_ttl_secs: u64,
    pub server_addr: SocketAddr,
    pub cors_origins: Vec<String>,
    pub google_client_id: String,
    pub gmail_only: bool,
    pub app_name: String,
    pub log_level: String,
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
        fn bool_opt(name: &str, default: bool) -> bool {
            std::env::var(name)
                .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
                .unwrap_or(default)
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
            db_path: PathBuf::from(opt("DB_PATH", "./cognigram.redb")),
            uploads_dir: PathBuf::from(opt("UPLOADS_DIR", "./data/uploads")),
            jwt_secret: req("JWT_SECRET")?,
            jwt_access_ttl_secs: opt("JWT_ACCESS_TTL_SECS", "900").parse()?,
            jwt_refresh_ttl_secs: opt("JWT_REFRESH_TTL_SECS", "2592000").parse()?,
            server_addr,
            cors_origins,
            google_client_id: req("GOOGLE_CLIENT_ID")?,
            gmail_only: bool_opt("GMAIL_ONLY", true),
            app_name: opt("APP_NAME", "Cognigram"),
            log_level: opt("LOG_LEVEL", "info"),
        })
    }
}
