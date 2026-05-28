use std::path::PathBuf;
use std::sync::Arc;

use crate::config::Config;
use crate::db::Store;
use crate::hub::Hub;
use crate::oauth::Verifier;

#[derive(Clone)]
pub struct AppState(pub Arc<AppStateInner>);

pub struct AppStateInner {
    pub config: Config,
    pub store: Store,
    pub hub: Hub,
    pub oauth: Verifier,
    pub uploads_root: PathBuf,
}

impl AppState {
    pub fn new(
        config: Config,
        store: Store,
        hub: Hub,
        oauth: Verifier,
        uploads_root: PathBuf,
    ) -> Self {
        Self(Arc::new(AppStateInner {
            config,
            store,
            hub,
            oauth,
            uploads_root,
        }))
    }
}

impl std::ops::Deref for AppState {
    type Target = AppStateInner;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
