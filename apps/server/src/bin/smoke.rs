//! One-shot smoke test: load env, ping MongoDB, send a test email, exit.
//! Run with:  cargo run --bin smoke -- <recipient-email>
use keracross_server::{config::Config, db::Db, email::{render_otp_email, Mailer}};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    for path in ["apps/server/.env", "../server/.env", ".env"] {
        if dotenvy::from_path(path).is_ok() {
            break;
        }
    }

    let to = std::env::args().nth(1).unwrap_or_else(|| {
        std::env::var("SMOKE_TEST_EMAIL").unwrap_or_else(|_| "sylwestereee25@gmail.com".to_string())
    });

    println!("→ loading config");
    let cfg = Config::from_env()?;

    println!("→ connecting to MongoDB");
    let db = Db::connect(&cfg).await?;
    let latency = db.ping().await?;
    println!("✓ MongoDB ping ok ({}ms)", latency);
    println!("  database: {}", cfg.mongodb_db);

    println!("→ testing SMTP connection (TLS)");
    let mailer = Mailer::new(&cfg)?;
    mailer.test_connection().await?;
    println!("✓ SMTP connection ok");

    println!("→ sending test email to {to}");
    let html = render_otp_email(&cfg.app_name, "424242");
    mailer
        .send(&to, "Keracross — smoke test", html)
        .await
        .map_err(|e| anyhow::anyhow!("send failed: {e:?}"))?;
    println!("✓ email sent");

    println!("\nAll smoke checks passed.");
    Ok(())
}
