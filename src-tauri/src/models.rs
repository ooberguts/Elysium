use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub source_id: Option<String>,
    pub relative_path: String,
    pub kind: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: String,
    pub track: u32,
    pub disc: u32,
    pub duration: f64,
    pub format: String,
    pub sample_rate: u32,
    pub bitrate: u32,
    pub artwork: Option<String>,
    pub favorite: bool,
    pub rating: u8,
    pub play_count: u32,
    pub added_at: u64,
    pub last_played: u64,
    pub resume: f64,
    #[serde(default)]
    pub progress_updated_at: u64,
    pub watched: bool,
    pub available: bool,
    pub series: String,
    pub season: u32,
    pub episode: u32,
    pub overview: String,
    pub overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub online: bool,
    pub scanned_at: u64,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub rule: Option<String>,
    pub item_ids: Vec<String>,
    #[serde(default)]
    pub artwork: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Library {
    pub items: Vec<MediaItem>,
    pub sources: Vec<Source>,
    pub playlists: Vec<Playlist>,
    pub settings: HashMap<String, String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub source_id: String,
    pub processed: usize,
    pub current: String,
}

#[derive(Clone, Serialize)]
pub struct Match {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub score: u32,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
