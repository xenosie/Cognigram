use mongodb::bson::doc;
use mongodb::options::{ClientOptions, IndexOptions};
use mongodb::{Client, Database, IndexModel};

use crate::config::Config;

#[derive(Clone)]
pub struct Db {
    pub client: Client,
    pub database: Database,
}

impl Db {
    pub async fn connect(cfg: &Config) -> anyhow::Result<Self> {
        let mut opts = ClientOptions::parse(&cfg.mongodb_uri).await?;
        opts.app_name = Some("keracross-server".to_string());
        // Connection pool tuning — auth path is hit by login/signup, not chat
        opts.max_pool_size = Some(50);
        opts.min_pool_size = Some(2);

        let client = Client::with_options(opts)?;
        let database = client.database(&cfg.mongodb_db);

        // ping to verify connection at boot
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await?;

        let db = Self { client, database };
        db.ensure_indexes().await?;
        Ok(db)
    }

    pub async fn ping(&self) -> anyhow::Result<u64> {
        let start = std::time::Instant::now();
        self.client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await?;
        Ok(start.elapsed().as_millis() as u64)
    }

    async fn ensure_indexes(&self) -> anyhow::Result<()> {
        // users.email — unique
        self.database
            .collection::<crate::models::user::User>("users")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "email": 1 })
                    .options(IndexOptions::builder().unique(true).build())
                    .build(),
            )
            .await?;

        // users.username — unique sparse (legacy users with null are allowed)
        self.database
            .collection::<crate::models::user::User>("users")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "username": 1 })
                    .options(
                        IndexOptions::builder()
                            .unique(true)
                            .sparse(true)
                            .build(),
                    )
                    .build(),
            )
            .await?;

        // email_verifications.expires_at — TTL
        self.database
            .collection::<crate::models::verification::EmailVerification>("email_verifications")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "expires_at": 1 })
                    .options(
                        IndexOptions::builder()
                            .expire_after(std::time::Duration::from_secs(0))
                            .build(),
                    )
                    .build(),
            )
            .await?;

        // refresh_tokens.expires_at — TTL
        self.database
            .collection::<crate::models::verification::RefreshToken>("refresh_tokens")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "expires_at": 1 })
                    .options(
                        IndexOptions::builder()
                            .expire_after(std::time::Duration::from_secs(0))
                            .build(),
                    )
                    .build(),
            )
            .await?;

        // login_challenges.expires_at — TTL
        self.database
            .collection::<crate::models::verification::LoginChallenge>("login_challenges")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "expires_at": 1 })
                    .options(
                        IndexOptions::builder()
                            .expire_after(std::time::Duration::from_secs(0))
                            .build(),
                    )
                    .build(),
            )
            .await?;

        // chats.participants — multi-key for lookup
        self.database
            .collection::<crate::models::chat::Chat>("chats")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "participants": 1, "last_message_at": -1 })
                    .build(),
            )
            .await?;

        // messages.chat_id + _id desc for paginated history
        self.database
            .collection::<crate::models::chat::Message>("messages")
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "chat_id": 1, "_id": -1 })
                    .build(),
            )
            .await?;

        Ok(())
    }
}
