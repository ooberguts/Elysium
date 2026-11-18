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
          CREATE TABLE IF NOT EXISTS excluded_paths (path TEXT PRIMARY KEY);
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
    pub fn is_excluded(&self, path: &str) -> Result<bool, String> {
        let conn = self.db.lock().map_err(err)?;
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM excluded_paths WHERE path=?1)",
            [path],
            |r| r.get(0),
        )
        .map_err(err)
    }
    pub fn include_path(&self, path: &str) -> Result<(), String> {
        let conn = self.db.lock().map_err(err)?;
        conn.execute("DELETE FROM excluded_paths WHERE path=?1", [path])
            .map_err(err)?;
        Ok(())
    }
    pub fn remove_items(&self, ids: &[String]) -> Result<(), String> {
        let mut conn = self.db.lock().map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        for id in ids {
            tx.execute(
                "INSERT OR IGNORE INTO excluded_paths(path) SELECT path FROM items WHERE id=?1",
                [id],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM items WHERE id=?1", [id])
                .map_err(err)?;
        }
        let lists = read_table::<Playlist>(&tx, "playlists")?;
        for mut list in lists {
            list.item_ids.retain(|id| !ids.contains(id));
            tx.execute(
                "UPDATE playlists SET data=?2 WHERE id=?1",
                params![list.id, serde_json::to_string(&list).map_err(err)?],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn set_artist_artwork(&self, artist: &str, artwork: Option<&str>) -> Result<(), String> {
        if artist.trim().is_empty() || artist.len() > 1000 {
            return Err("Choose a valid artist".into());
        }
        let mut conn = self.db.lock().map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        let current: Option<String> = tx
            .query_row(
                "SELECT value FROM settings WHERE key='artistArtwork'",
                [],
                |r| r.get(0),
            )
            .ok();
        let mut images: HashMap<String, String> = current
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(err)?
            .unwrap_or_default();
        if let Some(path) = artwork {
            images.insert(artist.to_owned(), path.to_owned());
        } else {
            images.remove(artist);
        }
        let value = serde_json::to_string(&images).map_err(err)?;
        if value.len() > 500_000 {
            return Err("Artist artwork list is too large".into());
        }
        tx.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('artistArtwork',?1)",
            [value],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
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
    pub fn edit_playlist(
        &self,
        id: &str,
        name: &str,
        artwork: Option<Option<String>>,
    ) -> Result<(), String> {
        if name.trim().is_empty() {
            return Err("Give the playlist a name".into());
        }
        let conn = self.db.lock().map_err(err)?;
        let json: String = conn
            .query_row("SELECT data FROM playlists WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        let mut list: Playlist = serde_json::from_str(&json).map_err(err)?;
        list.name = name.trim().chars().take(150).collect();
        if let Some(image) = artwork {
            list.artwork = image;
        }
        conn.execute(
            "UPDATE playlists SET data=?2 WHERE id=?1",
            params![id, serde_json::to_string(&list).map_err(err)?],
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
    fn artist_artwork_is_independent_and_persistent() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        store
            .set_artist_artwork("First artist", Some("/cached/first.img"))
            .unwrap();
        store
            .set_artist_artwork("Second artist", Some("/cached/second.img"))
            .unwrap();
        store.set_artist_artwork("First artist", None).unwrap();
        drop(store);
        let reopened = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        let settings = reopened.library().unwrap().settings;
        let images: HashMap<String, String> =
            serde_json::from_str(&settings["artistArtwork"]).unwrap();
        assert!(!images.contains_key("First artist"));
        assert_eq!(images["Second artist"], "/cached/second.img");
    }
    #[test]
    fn removing_items_keeps_files_and_excludes_them_until_reimported() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("song.mp3");
        std::fs::write(&file, b"original media").unwrap();
        let store = Store::new(dir.path().join("data"), PathBuf::new()).unwrap();
        let item = crate::media::read_media(&store, &file, None).unwrap();
        store.save_item(&item).unwrap();
        store
            .save_playlist(&Playlist {
                id: "list".into(),
                name: "List".into(),
                rule: None,
                item_ids: vec![item.id.clone(), item.id.clone()],
                artwork: None,
            })
            .unwrap();
        store.remove_items(std::slice::from_ref(&item.id)).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"original media");
        assert!(store.item(&item.id).is_err());
        assert!(store.playlist("list").unwrap().item_ids.is_empty());
        assert!(store.is_excluded(&item.path).unwrap());
        drop(store);
        let reopened = Store::new(dir.path().join("data"), PathBuf::new()).unwrap();
        assert!(reopened.is_excluded(&item.path).unwrap());
        reopened.include_path(&item.path).unwrap();
        assert!(!reopened.is_excluded(&item.path).unwrap());
    }
    #[test]
    fn playlist_edits_preserve_tracks_and_support_legacy_artwork() {
        let legacy = r#"{"id":"legacy","name":"Old","rule":null,"itemIds":["track"]}"#;
        let playlist: Playlist = serde_json::from_str(legacy).unwrap();
        assert!(playlist.artwork.is_none());
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        store.save_playlist(&playlist).unwrap();
        store
            .edit_playlist("legacy", " Renamed ", Some(Some("/art/cover".into())))
            .unwrap();
        store.edit_playlist("legacy", "Final", None).unwrap();
        drop(store);
        let store = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        let saved = store.playlist("legacy").unwrap();
        assert_eq!(saved.name, "Final");
        assert_eq!(saved.item_ids, vec!["track"]);
        assert_eq!(saved.artwork.as_deref(), Some("/art/cover"));
        store.edit_playlist("legacy", "Final", Some(None)).unwrap();
        assert!(store.playlist("legacy").unwrap().artwork.is_none());
    }
    #[test]
    fn persists_preferences_and_playlists() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_owned(), PathBuf::new()).unwrap();
        let playlist = Playlist {
            id: "a".into(),
            name: "Night drives".into(),
            rule: None,
            item_ids: vec![],
            artwork: None,
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
