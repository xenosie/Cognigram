use std::time::Duration;

use axum::http::{HeaderValue, Method};
use axum::Router;
use cognigram_server::{
    config::Config, db::Store, hub::Hub, oauth::Verifier, routes, seed,
    state::AppState,
};
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

// Faster allocator for async workloads (~5-15% p99 latency win on Linux).
#[cfg(not(target_env = "msvc"))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    for path in ["apps/server/.env", "../server/.env", ".env"] {
        if dotenvy::from_path(path).is_ok() {
            break;
        }
    }

    let cfg = Config::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new(format!(
                "cognigram_server={lvl},tower_http=info",
                lvl = cfg.log_level
            ))
        }))
        .with_target(false)
        .compact()
        .init();

    tracing::info!(addr = %cfg.server_addr, "starting cognigram-server");

    let store = Store::open(&cfg.db_path)?;
    tracing::info!(path = %cfg.db_path.display(), "redb opened");

    // Make sure the uploads directory tree exists before we mount the file
    // server on top of it.
    std::fs::create_dir_all(cfg.uploads_dir.join("avatars"))?;
    std::fs::create_dir_all(cfg.uploads_dir.join("channel-avatars"))?;
    std::fs::create_dir_all(cfg.uploads_dir.join("files"))?;
    std::fs::create_dir_all(cfg.uploads_dir.join("stickers/default"))?;
    let uploads_root = cfg.uploads_dir.clone();
    tracing::info!(root = %uploads_root.display(), "uploads directory ready");

    // Plant the default sticker pack if it isn't there yet. No-op if already
    // seeded or if the directory is empty.
    if let Err(e) = seed::seed_default_stickers(&store, &uploads_root).await {
        tracing::warn!(error = ?e, "default sticker seeding failed (continuing)");
    }

    let hub = Hub::new();
    let oauth = Verifier::new(cfg.google_client_id.clone())?;

    // Periodic sweep of expired refresh tokens (redb has no native TTL).
    {
        let store_for_sweep = store.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // Skip the first immediate tick.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                match store_for_sweep.sweep_expired_tokens().await {
                    Ok(n) if n > 0 => tracing::debug!(removed = n, "expired tokens swept"),
                    Ok(_) => {}
                    Err(e) => tracing::warn!(error = ?e, "token sweep failed"),
                }
            }
        });
    }

    let state = AppState::new(cfg.clone(), store, hub, oauth, uploads_root.clone());

    let cors = build_cors(&cfg);

    let app = Router::new()
        .merge(routes::health::router())
        .merge(routes::auth::router())
        .merge(routes::channels::router())
        .merge(routes::chats::router())
        .merge(routes::search::router())
        .merge(routes::stickers::router())
        .merge(routes::uploads::router())
        .merge(routes::users::router())
        .merge(routes::ws::router())
        .with_state(state)
        // Public static serving for avatars / future attachments.
        .nest_service("/uploads", ServeDir::new(uploads_root))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        // 26 MB ceiling = 25 MB attachment + multipart overhead. Per-route
        // tighter caps live on JSON-only endpoints; axum's Json extractor has
        // its own 2 MB default that keeps small endpoints safe.
        .layer(RequestBodyLimitLayer::new(26 * 1024 * 1024))
        .layer(cors);

    let listener = TcpListener::bind(cfg.server_addr).await?;
    tracing::info!("listening on http://{}", cfg.server_addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn build_cors(cfg: &Config) -> CorsLayer {
    let mut cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ])
        .allow_credentials(true)
        .max_age(Duration::from_secs(600));

    if cfg.cors_origins.iter().any(|o| o == "*") {
        cors = cors
            .allow_origin(tower_http::cors::Any)
            .allow_credentials(false);
    } else {
        let origins: Vec<HeaderValue> = cfg
            .cors_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        cors = cors.allow_origin(origins);
    }
    cors
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
