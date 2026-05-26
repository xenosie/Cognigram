use std::time::Duration;

use axum::http::{HeaderValue, Method};
use axum::Router;
use keracross_server::{
    config::Config, db::Db, email::Mailer, hub::Hub, routes, state::AppState,
};
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

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
                "keracross_server={lvl},tower_http=info",
                lvl = cfg.log_level
            ))
        }))
        .with_target(false)
        .compact()
        .init();

    tracing::info!(addr = %cfg.server_addr, "starting keracross-server");

    let db = Db::connect(&cfg).await?;
    tracing::info!("MongoDB connected & indexes ensured");

    let mailer = Mailer::new(&cfg)?;
    tracing::info!("SMTP transport built");

    let hub = Hub::new();

    let state = AppState::new(cfg.clone(), db, mailer, hub);

    let cors = build_cors(&cfg);

    let mut app = Router::new()
        .merge(routes::health::router())
        .merge(routes::auth::router())
        .merge(routes::chats::router())
        .merge(routes::users::router())
        .merge(routes::ws::router());
    if cfg.enable_test_endpoints {
        app = app.merge(routes::admin::router());
    }
    let app = app
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(RequestBodyLimitLayer::new(64 * 1024))
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
