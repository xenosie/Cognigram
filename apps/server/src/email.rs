use lettre::message::{header::ContentType, Mailbox};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::config::Config;
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct Mailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl Mailer {
    pub fn new(cfg: &Config) -> anyhow::Result<Self> {
        let creds = Credentials::new(cfg.smtp_username.clone(), cfg.smtp_password.clone());

        // Port 465 = implicit TLS; port 587 = STARTTLS. We default to 465.
        let transport = if cfg.smtp_port == 587 {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.smtp_host)?
                .port(cfg.smtp_port)
                .credentials(creds)
                .build()
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.smtp_host)?
                .port(cfg.smtp_port)
                .credentials(creds)
                .build()
        };

        let from = format!("{} <{}>", cfg.smtp_from_name, cfg.smtp_from_email).parse()?;

        Ok(Self { transport, from })
    }

    pub async fn test_connection(&self) -> anyhow::Result<()> {
        self.transport.test_connection().await?;
        Ok(())
    }

    pub async fn send(&self, to: &str, subject: &str, html: String) -> AppResult<()> {
        let to_mbox: Mailbox = to
            .parse()
            .map_err(|e: lettre::address::AddressError| AppError::BadRequest(format!("bad email: {e}")))?;

        let msg = Message::builder()
            .from(self.from.clone())
            .to(to_mbox)
            .subject(subject)
            .header(ContentType::TEXT_HTML)
            .body(html)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("message build: {e}")))?;

        self.transport
            .send(msg)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("smtp send: {e}")))?;

        Ok(())
    }

    /// Spawn a non-blocking send; ignore errors but log them.
    pub fn send_in_background(&self, to: String, subject: String, html: String) {
        let mailer = self.clone();
        tokio::spawn(async move {
            if let Err(e) = mailer.send(&to, &subject, html).await {
                tracing::error!(error = %e, recipient = %to, "background email send failed");
            }
        });
    }
}

pub fn render_otp_email(app_name: &str, code: &str) -> String {
    format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:32px;background:#f7f7f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #ececec">
    <h1 style="margin:0 0 16px;font-size:22px;color:#B91C1C;letter-spacing:-0.2px">{app_name}</h1>
    <p style="margin:0 0 24px;color:#444;line-height:1.5">Use the code below to verify your email. It expires in <strong>10 minutes</strong>.</p>
    <div style="font-size:32px;font-weight:600;letter-spacing:6px;text-align:center;padding:18px 0;border:1px dashed #B91C1C;border-radius:8px;color:#1a1a1a">{code}</div>
    <p style="margin:24px 0 0;color:#888;font-size:13px;line-height:1.5">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>"#
    )
}
