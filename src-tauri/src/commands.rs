use crate::{
    media, metadata,
    models::*,
    store::{err, Store},
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};
use tauri::{Manager, State};

#[tauri::command]
pub async fn get_library(store: State<'_, Arc<Store>>) -> Result<Library, String> {
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.library())
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn fill_video_artwork(store: State<'_, Arc<Store>>) -> Result<usize, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut updated = 0;
        for item in store.library()?.items {
            if !matches!(item.kind.as_str(), "movie" | "tv")
                || item.artwork.is_some()
                || !item.available
                || item.overrides.contains_key("artwork")
            {
                continue;
            }
            if let Ok(read) = media::read_media(&store, Path::new(&item.path), None) {
                if let Some(artwork) = read.artwork {
                    if store
                        .change_item(&item.id, |current| {
                            if current.artwork.is_none()
                                && !current.overrides.contains_key("artwork")
                            {
                                current.artwork = Some(artwork);
                            }
                        })
                        .is_ok()
                    {
                        updated += 1;
                    }
                }
            }
        }
        Ok(updated)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn add_source(
    path: String,
    kind: String,
    name: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<Source, String> {
    if !["mixed", "music", "movie", "tv", "audiobook"].contains(&kind.as_str()) {
        return Err("Choose a library type".into());
    }
    let s = store.inner().clone();
    let source = tauri::async_runtime::spawn_blocking(move || -> Result<Source, String> {
        let canonical = std::fs::canonicalize(&path).map_err(|_| {
            "This folder is unavailable. Mount the network share first, then select its folder."
                .to_owned()
        })?;
        if !canonical.is_dir() {
            return Err("Select a folder to add a source".into());
        }
        let full = canonical.to_string_lossy().to_string();
        if let Some(mut existing) = s
            .library()?
            .sources
            .into_iter()
            .find(|source| source.path == full)
        {
            if existing.kind != kind {
                existing.kind = kind;
                s.save_source(&existing)?;
            }
            return Ok(existing);
        }
        let source = Source {
            id: uuid::Uuid::new_v4().to_string(),
            name: if name.trim().is_empty() {
                canonical
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            } else {
                name.chars().take(150).collect()
            },
            path: full,
            kind,
            online: true,
            scanned_at: 0,
            count: 0,
        };
        s.save_source(&source)?;
        Ok(source)
    })
    .await
    .map_err(err)??;
    app.asset_protocol_scope()
        .allow_directory(&source.path, true)
        .map_err(err)?;
    Ok(source)
}

#[tauri::command]
pub async fn scan_source(
    source_id: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<media::ScanReport, String> {
    if store.scanning.swap(true, Ordering::SeqCst) {
        return Err("A library scan is already running".into());
    }
    store.cancel_scan.store(false, Ordering::SeqCst);
    let s = store.inner().clone();
    let finish = s.clone();
    let result = tauri::async_runtime::spawn_blocking(move || media::scan(&s, &app, &source_id))
        .await
        .map_err(err);
    finish.scanning.store(false, Ordering::SeqCst);
    result?
}

#[tauri::command]
pub fn cancel_scan(store: State<'_, Arc<Store>>) {
    store.cancel_scan.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn cancel_conversion(store: State<'_, Arc<Store>>) {
    store.stop_conversion();
}

#[tauri::command]
pub fn remove_from_library(ids: Vec<String>, store: State<'_, Arc<Store>>) -> Result<(), String> {
    if ids.len() > 10_000 {
        return Err("Remove up to 10,000 items at a time".into());
    }
    if store.scanning.swap(true, Ordering::SeqCst) {
        return Err("Wait for the library scan to finish before removing items".into());
    }
    let result = store.remove_items(&ids);
    store.scanning.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub async fn import_files(
    paths: Vec<String>,
    kind: Option<String>,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<usize, String> {
    if kind.as_deref().is_some_and(|k| k != "audiobook") {
        return Err("Invalid import type".into());
    }
    if paths.len() > 10_000 {
        return Err("Import up to 10,000 files at a time, or add a folder".into());
    }
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut count = 0;
        let mut errors = 0;
        for path in paths {
            match media::read_media(&s, Path::new(&path), None) {
                Ok(mut item) => {
                    if kind.as_deref() == Some("audiobook") {
                        if item.kind != "music" && item.kind != "audiobook" {
                            errors += 1;
                            continue;
                        }
                        item.kind = "audiobook".into();
                    }
                    app.asset_protocol_scope()
                        .allow_file(&item.path)
                        .map_err(err)?;
                    if let Some(art) = &item.artwork {
                        let _ = app.asset_protocol_scope().allow_file(art);
                    }
                    s.include_path(&item.path)?;
                    s.save_item(&item)?;
                    count += 1;
                }
                Err(_) => errors += 1,
            }
        }
        if count == 0 && errors > 0 {
            return Err("No readable music or video files were found in this selection".into());
        }
        Ok(count)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn import_samples(
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<Source, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(err)?
        .join("resources/demo");
    let source_path = if bundled.is_dir() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/demo")
    };
    let target = store.data_dir.join("demo");
    std::fs::create_dir_all(&target).map_err(err)?;
    for entry in std::fs::read_dir(source_path)
        .map_err(|_| "Sample media is missing. Run npm run prepare:media and rebuild.".to_owned())?
    {
        let entry = entry.map_err(err)?;
        if entry.file_type().map_err(err)?.is_file() {
            let dest = target.join(entry.file_name());
            if !dest.exists() {
                std::fs::copy(entry.path(), dest).map_err(err)?;
            }
        }
    }
    add_source(
        target.to_string_lossy().to_string(),
        "mixed".into(),
        "Elysium Samples".into(),
        app,
        store,
    )
    .await
}

#[tauri::command]
pub async fn rebind_source(
    source_id: String,
    path: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).map_err(err)?;
    if !canonical.is_dir() {
        return Err("Choose the replacement folder".into());
    }
    let mut source = store.source(&source_id)?;
    source.path = canonical.to_string_lossy().to_string();
    source.online = true;
    for mut item in store
        .library()?
        .items
        .into_iter()
        .filter(|i| i.source_id.as_deref() == Some(&source_id))
    {
        let relative = Path::new(&item.relative_path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            continue;
        }
        item.path = canonical.join(relative).to_string_lossy().to_string();
        item.available = Path::new(&item.path).is_file();
        store.save_item(&item)?;
    }
    store.save_source(&source)?;
    app.asset_protocol_scope()
        .allow_directory(canonical, true)
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn set_favorite(
    id: String,
    favorite: bool,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store.change_item(&id, |item| item.favorite = favorite)?;
    Ok(())
}

#[tauri::command]
pub async fn set_rating(
    id: String,
    rating: u8,
    store: State<'_, Arc<Store>>,
) -> Result<metadata::RatingResult, String> {
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || metadata::set_rating(&s, &id, rating))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn set_artist_artwork(
    artist: String,
    path: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let artwork = path
            .map(|p| metadata::prepare_cover(&store, Path::new(&p)))
            .transpose()?;
        store.set_artist_artwork(&artist, artwork.as_deref())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn prepare_cover(path: String, store: State<'_, Arc<Store>>) -> Result<String, String> {
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        metadata::prepare_cover(&s, std::path::Path::new(&path))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn update_progress(
    id: String,
    position: f64,
    duration: f64,
    completed: bool,
    count_play: bool,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store.update_progress(&id, position, duration, completed, count_play)
}

#[tauri::command]
pub fn set_watched(id: String, watched: bool, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.change_item(&id, |item| {
        item.watched = watched;
        if watched {
            item.resume = 0.0;
        }
    })?;
    Ok(())
}

#[tauri::command]
pub async fn update_metadata(
    ids: Vec<String>,
    changes: HashMap<String, String>,
    write_files: bool,
    store: State<'_, Arc<Store>>,
) -> Result<metadata::EditResult, String> {
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || metadata::edit_many(&s, ids, changes, write_files))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn restore_tags(id: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    let s = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || metadata::restore_tags(&s, &id))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn prepare_playback(
    id: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<String, String> {
    let s = store.inner().clone();
    let path = tauri::async_runtime::spawn_blocking(move || media::compatible_copy(&s, &id))
        .await
        .map_err(err)??;
    app.asset_protocol_scope().allow_file(&path).map_err(err)?;
    Ok(path)
}

#[tauri::command]
pub fn create_playlist(
    name: String,
    rule: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<Playlist, String> {
    if name.trim().is_empty() {
        return Err("Give the playlist a name".into());
    }
    if rule
        .as_ref()
        .is_some_and(|r| !["favorites", "unplayed", "lossless", "recent"].contains(&r.as_str()))
    {
        return Err("Unknown smart playlist rule".into());
    }
    let list = Playlist {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().chars().take(150).collect(),
        rule,
        item_ids: vec![],
        artwork: None,
    };
    store.save_playlist(&list)?;
    Ok(list)
}

#[tauri::command]
pub fn update_playlist(
    id: String,
    item_ids: Vec<String>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let mut list = store.playlist(&id)?;
    if list.rule.is_some() {
        return Err("Smart playlists update automatically".into());
    }
    let known: std::collections::HashSet<String> =
        store.library()?.items.into_iter().map(|i| i.id).collect();
    list.item_ids = item_ids
        .into_iter()
        .filter(|id| known.contains(id))
        .collect();
    store.save_playlist(&list)
}

#[tauri::command]
pub async fn edit_playlist(
    id: String,
    name: String,
    change_artwork: bool,
    artwork_path: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let artwork = if change_artwork {
            Some(
                artwork_path
                    .map(|path| metadata::prepare_cover(&store, Path::new(&path)))
                    .transpose()?,
            )
        } else {
            None
        };
        store.edit_playlist(&id, &name, artwork)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn delete_playlist(id: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .db
        .lock()
        .map_err(err)?
        .execute("DELETE FROM playlists WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn save_settings(
    values: HashMap<String, String>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let mut conn = store.db.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for (key, value) in values {
        if key.len() > 100 || value.len() > 500_000 {
            return Err("Preference is too large".into());
        }
        tx.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![key, value],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn export_library(path: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    let data = serde_json::json!({"version":1,"library":store.library()?});
    std::fs::write(path, serde_json::to_vec_pretty(&data).map_err(err)?).map_err(err)
}

#[tauri::command]
pub fn export_playlist(
    id: String,
    path: String,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    let list = store.playlist(&id)?;
    let library = store.library()?;
    let items: Vec<_> = library
        .items
        .iter()
        .filter(|i| match list.rule.as_deref() {
            Some("favorites") => i.favorite,
            Some("unplayed") => i.play_count == 0,
            Some("lossless") => ["FLAC", "ALAC", "WAV", "AIFF"].contains(&i.format.as_str()),
            Some("recent") => now().saturating_sub(i.added_at) < 30 * 86400,
            _ => list.item_ids.contains(&i.id),
        })
        .collect();
    let mut output = "#EXTM3U\n".to_string();
    if list.rule.is_none() {
        for id in &list.item_ids {
            if let Some(i) = items.iter().find(|i| &i.id == id) {
                output.push_str(&format!(
                    "#EXTINF:{},{} - {}\n{}\n",
                    i.duration as u64,
                    i.artist.replace(['\r', '\n'], " "),
                    i.title.replace(['\r', '\n'], " "),
                    i.path
                ));
            }
        }
    } else {
        for i in items {
            output.push_str(&format!(
                "#EXTINF:{},{}\n{}\n",
                i.duration as u64,
                i.title.replace(['\r', '\n'], " "),
                i.path
            ));
        }
    }
    std::fs::write(path, output).map_err(err)
}

#[tauri::command]
pub fn export_nfo(id: String, path: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    let item = store.item(&id)?;
    if item.kind == "music" {
        return Err("NFO export is for movies and TV episodes".into());
    }
    std::fs::write(path, media::nfo_xml(&item)).map_err(err)
}

#[tauri::command]
pub fn load_subtitle(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    let ext = media::extension(path);
    if !["srt", "vtt"].contains(&ext.as_str()) {
        return Err("Select an SRT or WebVTT subtitle file".into());
    }
    if path.metadata().map_err(err)?.len() > 8_000_000 {
        return Err("Subtitle files must be smaller than 8 MB".into());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|_| "This subtitle file must use UTF-8 text encoding".to_owned())?
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    if ext == "vtt" {
        return Ok(content);
    }
    let converted = content
        .lines()
        .map(|line| {
            if line.contains(" --> ") {
                line.replace(',', ".")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!("WEBVTT\n\n{converted}"))
}

#[tauri::command]
pub async fn import_playlist(
    path: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<Playlist, String> {
    let file = PathBuf::from(&path);
    if !["m3u", "m3u8"].contains(&media::extension(&file).as_str()) {
        return Err("Select an M3U or M3U8 playlist".into());
    }
    if file.metadata().map_err(err)?.len() > 8_000_000 {
        return Err("This playlist is too large".into());
    }
    let text = std::fs::read_to_string(&file)
        .map_err(|_| "Please save the playlist as UTF-8 (M3U8)".to_owned())?;
    let mut ids = Vec::new();
    for line in text.lines().take(20000) {
        let line = line.trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('#') || line.contains("://") {
            continue;
        }
        let raw = PathBuf::from(line);
        let resolved = if raw.is_absolute() {
            raw
        } else {
            file.parent().unwrap_or(Path::new(".")).join(raw)
        };
        if let Ok(item) = media::read_media(&store, &resolved, None) {
            let _ = app.asset_protocol_scope().allow_file(&item.path);
            if let Some(art) = &item.artwork {
                let _ = app.asset_protocol_scope().allow_file(art);
            }
            store.save_item(&item)?;
            ids.push(item.id);
        }
    }
    if ids.is_empty() {
        return Err("No accessible local media files were found in this playlist".into());
    }
    let list = Playlist {
        id: uuid::Uuid::new_v4().to_string(),
        name: file
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        rule: None,
        item_ids: ids,
        artwork: None,
    };
    store.save_playlist(&list)?;
    Ok(list)
}

#[tauri::command]
pub fn restore_library(
    path: String,
    app: tauri::AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<usize, String> {
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > 100_000_000 {
        return Err("This backup is too large".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).map_err(err)?).map_err(err)?;
    if value["version"].as_u64() != Some(1) {
        return Err("This backup version is not supported".into());
    }
    let library: Library = serde_json::from_value(value["library"].clone()).map_err(err)?;
    // Merge a validated backup; existing unrelated library entries are retained.
    for source in library.sources {
        if Path::new(&source.path).is_dir() {
            let _ = app
                .asset_protocol_scope()
                .allow_directory(&source.path, true);
        }
        store.save_source(&source)?;
    }
    let count = library.items.len();
    for item in library.items {
        if item.id.len() != 64 || !item.id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("The backup contains an invalid item identity".into());
        }
        let _ = app.asset_protocol_scope().allow_file(&item.path);
        if let Some(art) = &item.artwork {
            let _ = app.asset_protocol_scope().allow_file(art);
        }
        store.save_item(&item)?;
    }
    for playlist in library.playlists {
        store.save_playlist(&playlist)?;
    }
    Ok(count)
}
