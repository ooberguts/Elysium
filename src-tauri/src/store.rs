use crate::models::*;
use rusqlite::{params, Connection};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};

pub struct Store {
    pub db: Mutex<Connection>,
    pub tag_edits: Mutex<()>,
    pub data_dir: PathBuf,
    pub ffmpeg: PathBuf,
    pub scanning: AtomicBool,
    pub cancel_scan: AtomicBool,
    pub conversion_generation: AtomicU64,
    pub conversion: Mutex<Option<(u64, std::process::Child)>>,
}

impl Store {
    pub fn new(data_dir: PathBuf, ffmpeg: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir).map_err(err)?;
        for folder in ["artwork", "compatible", "backups"] {
            std::fs::create_dir_all(data_dir.join(folder)).map_err(err)?;
        }
        let conn = Connection::open(data_dir.join("library.sqlite3")).map_err(err)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, source_id TEXT, path TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
          CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          PRAGMA user_version=1;").map_err(err)?;
        Ok(Self {
            db: Mutex::new(conn),
            tag_edits: Mutex::new(()),
            data_dir,
            ffmpeg,
            scanning: AtomicBool::new(false),
            cancel_scan: AtomicBool::new(false),
            conversion_generation: AtomicU64::new(0),
            conversion: Mutex::new(None),
        })
    }
    pub fn stop_conversion(&self) {
        self.conversion_generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut slot) = self.conversion.lock() {
            if let Some((_, mut child)) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    pub fn library(&self) -> Result<Library, String> {
        let conn = self.db.lock().map_err(err)?;
        let items = read_table::<MediaItem>(&conn, "items")?;
        let mut sources = read_table::<Source>(&conn, "sources")?;
        for source in &mut sources {
            source.online = Path::new(&source.path).is_dir();
        }
        let playlists = read_table::<Playlist>(&conn, "playlists")?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(err)?;
        let settings = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(err)?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(err)?;
        Ok(Library {
            items,
            sources,
            playlists,
            settings,
        })
    }
    pub fn item(&self, id: &str) -> Result<MediaItem, String> {
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM items WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "This item is no longer in the library".to_owned())?;
        serde_json::from_str(&json).map_err(err)
    }
    pub fn item_by_path(&self, path: &str) -> Option<MediaItem> {
        let conn = self.db.lock().ok()?;
        let json: String = conn
            .query_row("SELECT data FROM items WHERE path=?1", [path], |r| r.get(0))
            .ok()?;
        serde_json::from_str(&json).ok()
    }
    pub fn save_item(&self, item: &MediaItem) -> Result<(), String> {
        let conn = self.db.lock().map_err(err)?;
        conn.execute("INSERT INTO items(id,source_id,path,data) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,path=excluded.path,data=excluded.data",
            params![item.id, item.source_id, item.path, serde_json::to_string(item).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    /// Merge an edit into the latest row so a slow file write cannot roll back playback progress.
    pub fn change_item(
        &self,
        id: &str,
        change: impl FnOnce(&mut MediaItem),
    ) -> Result<MediaItem, String> {
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM items WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        let mut item: MediaItem = serde_json::from_str(&json).map_err(err)?;
        change(&mut item);
        conn.execute(
            "UPDATE items SET data=?2 WHERE id=?1",
            params![id, serde_json::to_string(&item).map_err(err)?],
        )
        .map_err(err)?;
        Ok(item)
    }
    pub fn update_progress(
        &self,
        id: &str,
        position: f64,
        duration: f64,
        completed: bool,
        count_play: bool,
    ) -> Result<(), String> {
        if !position.is_finite() || !duration.is_finite() {
            return Err("Invalid playback time".into());
        }
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM items WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        let mut item: MediaItem = serde_json::from_str(&json).map_err(err)?;
        if duration > 0. {
            item.duration = duration;
        }
        item.progress_updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        item.resume = if completed {
            0.
        } else if item.duration > 0. {
            position.clamp(0., item.duration)
        } else {
            position.max(0.)
        };
        if count_play {
            item.play_count = item.play_count.saturating_add(1);
            item.last_played = now();
        }
        if item.kind == "audiobook" {
            item.last_played = now();
            item.watched = completed;
        } else if completed && item.kind != "music" {
            item.watched = true;
        }
        conn.execute(
            "UPDATE items SET data=?2 WHERE id=?1",
            params![id, serde_json::to_string(&item).map_err(err)?],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn source(&self, id: &str) -> Result<Source, String> {
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM sources WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        serde_json::from_str(&json).map_err(err)
    }
    pub fn save_source(&self, source: &Source) -> Result<(), String> {
        let conn = self.db.lock().map_err(err)?;
        conn.execute(
            "INSERT OR REPLACE INTO sources(id,data) VALUES(?1,?2)",
            params![source.id, serde_json::to_string(source).map_err(err)?],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn save_playlist(&self, playlist: &Playlist) -> Result<(), String> {
        let conn = self.db.lock().map_err(err)?;
        conn.execute(
            "INSERT OR REPLACE INTO playlists(id,data) VALUES(?1,?2)",
            params![playlist.id, serde_json::to_string(playlist).map_err(err)?],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn playlist(&self, id: &str) -> Result<Playlist, String> {
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM playlists WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        serde_json::from_str(&json).map_err(err)
    }
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn read_table<T: serde::de::DeserializeOwned>(
    conn: &Connection,
    table: &str,
) -> Result<Vec<T>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT data FROM {table} ORDER BY rowid"))
        .map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_preferences_and_playlists() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        let playlist = Playlist {
            id: "a".into(),
            name: "Night drives".into(),
            rule: None,
            item_ids: vec![],
        };
        store.save_playlist(&playlist).unwrap();
        drop(store);
        let restored = Store::new(dir.path().to_owned(), PathBuf::new())
            .unwrap()
            .library()
            .unwrap();
        assert_eq!(restored.playlists[0].name, "Night drives");
    }
}
