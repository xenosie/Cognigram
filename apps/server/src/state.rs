use std::sync::Arc;

use crate::config::Config;
use crate::db::Db;
use crate::email::Mailer;
use crate::hub::Hub;

#[derive(Clone)]
pub struct AppState(pub Arc<AppStateInner>);

pub struct AppStateInner {
    pub config: Config,
    pub db: Db,
    pub mailer: Mailer,
    pub hub: Hub,
}

impl AppState {
    pub fn new(config: Config, db: Db, mailer: Mailer, hub: Hub) -> Self {
        Self(Arc::new(AppStateInner {
            config,
            db,
            mailer,
            hub,
        }))
    }
}

impl std::ops::Deref for AppState {
    type Target = AppStateInner;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
