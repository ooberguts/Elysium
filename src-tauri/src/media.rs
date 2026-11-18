use crate::{
    models::*,
    store::{err, Store},
};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    process::Command,
    sync::atomic::Ordering,
};
use tauri::Emitter;

pub const AUDIO: &[&str] = &[
    "mp3", "flac", "m4a", "m4b", "aac", "alac", "wav", "wave", "aif", "aiff", "ogg", "oga", "opus",
    "wma", "ape", "wv",
];
pub const VIDEO: &[&str] = &[
    "mp4", "m4v", "mkv", "mov", "webm", "avi", "wmv", "mpg", "mpeg", "ts", "m2ts", "ogv",
];

pub fn digest(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value.as_ref()))
}
pub fn extension(path: &Path) -> String {
    path.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
}

pub fn parse_episode(name: &str) -> (String, u32, u32) {
    let lower = name.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] != b's' {
            continue;
        }
        let mut j = i + 1;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == i + 1 || j >= bytes.len() || bytes[j] != b'e' {
            continue;
        }
        let mut k = j + 1;
        while k < bytes.len() && bytes[k].is_ascii_digit() {
            k += 1;
        }
        if k == j + 1 {
            continue;
        }
        let season = lower[i + 1..j].parse().unwrap_or(0);
        let episode = lower[j + 1..k].parse().unwrap_or(0);
        return (
            name[..i]
                .trim_matches([' ', '.', '-', '_'])
                .replace(['.', '_'], " "),
            season,
            episode,
        );
    }
    (String::new(), 0, 0)
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Nfo {
    title: String,
    plot: String,
    year: String,
    showtitle: String,
    season: u32,
    episode: u32,
    genre: String,
}

pub fn read_media(
    store: &Store,
    path: &Path,
    source: Option<&Source>,
) -> Result<MediaItem, String> {
    read_media_inner(store, path, source, true)
}
pub fn read_raw_media(
    store: &Store,
    path: &Path,
    source: Option<&Source>,
) -> Result<MediaItem, String> {
    read_media_inner(store, path, source, false)
}
fn read_media_inner(
    store: &Store,
    path: &Path,
    source: Option<&Source>,
    preserve: bool,
) -> Result<MediaItem, String> {
    let canonical = std::fs::canonicalize(path).map_err(err)?;
    let meta = canonical.metadata().map_err(err)?;
    let ext = extension(&canonical);
    if !AUDIO.contains(&ext.as_str()) && !VIDEO.contains(&ext.as_str()) {
        return Err("Unsupported media file".into());
    }
    let relative = source
        .and_then(|s| canonical.strip_prefix(&s.path).ok())
        .unwrap_or(&canonical)
        .to_string_lossy()
        .to_string();
    let identity = source
        .map(|s| format!("{}:{relative}", s.id))
        .unwrap_or_else(|| canonical.to_string_lossy().to_string());
    let id = digest(identity);
    let stem = canonical
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .replace('_', " ");
    let (series, season, episode) = parse_episode(&stem);
    let kind = if AUDIO.contains(&ext.as_str()) {
        if ext == "m4b" || source.is_some_and(|s| s.kind == "audiobook") {
            "audiobook"
        } else {
            "music"
        }
    } else if source.is_some_and(|s| s.kind == "tv")
        || (episode > 0 && !source.is_some_and(|s| s.kind == "movie"))
    {
        "tv"
    } else {
        "movie"
    };
    let mut item = MediaItem {
        id,
        path: canonical.to_string_lossy().to_string(),
        source_id: source.map(|s| s.id.clone()),
        relative_path: relative,
        kind: kind.into(),
        title: stem,
        artist: String::new(),
        album: String::new(),
        album_artist: String::new(),
        genre: String::new(),
        year: String::new(),
        track: 0,
        disc: 0,
        duration: 0.0,
        format: ext.to_uppercase(),
        sample_rate: 0,
        bitrate: 0,
        artwork: None,
        favorite: false,
        rating: 0,
        play_count: 0,
        added_at: now(),
        last_played: 0,
        resume: 0.0,
        progress_updated_at: 0,
        watched: false,
        available: true,
        series,
        season,
        episode,
        overview: String::new(),
        overrides: HashMap::new(),
    };
    if kind == "music" || kind == "audiobook" {
        if let Ok(tagged) = lofty::read_from_path(&canonical) {
            item.duration = tagged.properties().duration().as_secs_f64();
            item.sample_rate = tagged.properties().sample_rate().unwrap_or(0);
            item.bitrate = tagged.properties().audio_bitrate().unwrap_or(0);
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(v) = tag.title() {
                    item.title = v.to_string();
                }
                item.rating = crate::ratings::read(tag).unwrap_or(0);
                item.artist = tag.artist().map(|x| x.to_string()).unwrap_or_default();
                item.album = tag.album().map(|x| x.to_string()).unwrap_or_default();
                item.genre = tag.genre().map(|x| x.to_string()).unwrap_or_default();
                item.year = tag.year().map(|x| x.to_string()).unwrap_or_default();
                item.track = tag.track().unwrap_or(0);
                item.disc = tag.disk().unwrap_or(0);
                item.album_artist = tag
                    .get_string(&lofty::tag::ItemKey::AlbumArtist)
                    .unwrap_or("")
                    .to_owned();
                if let Some(picture) = tag
                    .pictures()
                    .iter()
                    .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
                    .or_else(|| tag.pictures().first())
                {
                    if picture.data().len() < 12_000_000 {
                        let art_path = store
                            .data_dir
                            .join("artwork")
                            .join(format!("{}.img", digest(picture.data())));
                        if !art_path.exists() {
                            let _ = std::fs::write(&art_path, picture.data());
                        }
                        item.artwork = Some(art_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    } else {
        if store.ffmpeg.is_file() {
            if let Ok(output) = hidden_command(&store.ffmpeg)
                .args(["-hide_banner", "-i"])
                .arg(&canonical)
                .output()
            {
                let info = String::from_utf8_lossy(&output.stderr);
                if let Some(s) = info
                    .split("Duration: ")
                    .nth(1)
                    .and_then(|s| s.split(',').next())
                {
                    let parts: Vec<f64> =
                        s.split(':').filter_map(|s| s.trim().parse().ok()).collect();
                    if parts.len() == 3 {
                        item.duration = parts[0] * 3600.0 + parts[1] * 60.0 + parts[2];
                    }
                }
            }
        }
        let nfo_path = canonical.with_extension("nfo");
        if let Ok(m) = nfo_path.metadata() {
            if m.len() < 2_000_000 {
                if let Ok(text) = std::fs::read_to_string(nfo_path) {
                    if let Ok(nfo) = quick_xml::de::from_str::<Nfo>(&text) {
                        if !nfo.title.is_empty() {
                            item.title = nfo.title;
                        }
                        item.overview = nfo.plot;
                        item.year = nfo.year;
                        item.genre = nfo.genre;
                        if !nfo.showtitle.is_empty() {
                            item.series = nfo.showtitle;
                        }
                        if nfo.season > 0 {
                            item.season = nfo.season;
                        }
                        if nfo.episode > 0 {
                            item.episode = nfo.episode;
                        }
                    }
                }
            }
        }
    }
    if item.artwork.is_none() {
        if let Some(parent) = canonical.parent() {
            for name in [
                "cover.jpg",
                "cover.png",
                "folder.jpg",
                "poster.jpg",
                "poster.png",
            ] {
                let art = parent.join(name);
                if art.is_file() {
                    item.artwork = Some(art.to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
    if item.artwork.is_none() && VIDEO.contains(&ext.as_str()) {
        item.artwork = video_thumbnail(store, &canonical, &meta, item.duration);
    }
    let existing = store
        .item(&item.id)
        .ok()
        .or_else(|| store.item_by_path(&item.path));
    if preserve {
        if let Some(existing) = existing {
            item.id = existing.id;
            if source.is_none()
                || existing.source_id.is_some()
                    && source.is_some_and(|s| existing.source_id.as_deref() != Some(&s.id))
            {
                item.source_id = existing.source_id;
                item.relative_path = existing.relative_path;
            }
            if existing.kind == "audiobook"
                && source.is_none_or(|s| s.kind == "mixed" || s.kind == "audiobook")
            {
                item.kind = existing.kind;
            }
            item.favorite = existing.favorite;
            if existing.rating > 0 || existing.overrides.contains_key("rating") {
                item.rating = existing.rating;
            }
            item.play_count = existing.play_count;
            item.added_at = existing.added_at;
            item.last_played = existing.last_played;
            item.resume = existing.resume;
            item.progress_updated_at = existing.progress_updated_at;
            item.watched = existing.watched;
            item.overrides = existing.overrides;
            apply_overrides(&mut item);
        }
    }
    let _ = meta;
    Ok(item)
}

fn video_thumbnail(
    store: &Store,
    path: &Path,
    metadata: &std::fs::Metadata,
    duration: f64,
) -> Option<String> {
    if !store.ffmpeg.is_file() {
        return None;
    }
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let key = digest(format!(
        "{}:{}:{}",
        path.display(),
        metadata.len(),
        modified
    ));
    let target = store
        .data_dir
        .join("artwork")
        .join(format!("video-{key}.jpg"));
    if target.is_file() {
        return Some(target.to_string_lossy().into_owned());
    }
    let temp = store
        .data_dir
        .join("artwork")
        .join(format!("thumbnail-{}.jpg", uuid::Uuid::new_v4()));
    let position = if duration > 0. {
        (duration * 0.1).min(60.)
    } else {
        0.
    };
    let extract = |at: f64| {
        hidden_command(&store.ffmpeg)
            .args(["-nostdin", "-v", "error", "-ss", &at.to_string(), "-i"])
            .arg(path)
            .args([
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=640:-2:force_original_aspect_ratio=decrease",
                "-q:v",
                "4",
                "-update",
                "1",
                "-y",
            ])
            .arg(&temp)
            .output()
            .is_ok_and(|result| {
                result.status.success() && temp.metadata().is_ok_and(|m| m.len() > 0)
            })
    };
    let success = extract(position) || (position > 0. && extract(0.));
    if success && std::fs::rename(&temp, &target).is_ok() {
        Some(target.to_string_lossy().into_owned())
    } else {
        let _ = std::fs::remove_file(temp);
        None
    }
}

pub fn apply_overrides(item: &mut MediaItem) {
    for (key, value) in item.overrides.clone() {
        match key.as_str() {
            "title" => item.title = value,
            "rating" => item.rating = value.parse::<u8>().unwrap_or(0).min(5),
            "artwork" => item.artwork = if value.is_empty() { None } else { Some(value) },
            "artist" => item.artist = value,
            "album" => item.album = value,
            "albumArtist" => item.album_artist = value,
            "genre" => item.genre = value,
            "year" => item.year = value,
            "series" => item.series = value,
            "overview" => item.overview = value,
            "track" => item.track = value.parse().unwrap_or(0),
            "disc" => item.disc = value.parse().unwrap_or(0),
            "season" => item.season = value.parse().unwrap_or(0),
            "episode" => item.episode = value.parse().unwrap_or(0),
            _ => {}
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub imported: usize,
    pub skipped: usize,
    pub cancelled: bool,
}

pub fn scan(store: &Store, app: &tauri::AppHandle, source_id: &str) -> Result<ScanReport, String> {
    let mut source = store.source(source_id)?;
    if !Path::new(&source.path).is_dir() {
        source.online = false;
        store.save_source(&source)?;
        return Err(
            "This folder is offline or unavailable. Your library entries have been kept.".into(),
        );
    }
    let mut seen = HashSet::new();
    let mut skipped = 0;
    let mut complete = true;
    for entry in walkdir::WalkDir::new(&source.path)
        .follow_links(false)
        .into_iter()
    {
        if store.cancel_scan.load(Ordering::Relaxed) {
            complete = false;
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                complete = false;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = extension(entry.path());
        if !AUDIO.contains(&ext.as_str()) && !VIDEO.contains(&ext.as_str()) {
            continue;
        }
        let is_audio = AUDIO.contains(&ext.as_str());
        if (matches!(source.kind.as_str(), "music" | "audiobook") && !is_audio)
            || (matches!(source.kind.as_str(), "movie" | "tv") && is_audio)
        {
            continue;
        }
        let canonical = match std::fs::canonicalize(entry.path()) {
            Ok(path) => path,
            Err(_) => {
                skipped += 1;
                complete = false;
                continue;
            }
        };
        if store.is_excluded(&canonical.to_string_lossy())? {
            continue;
        }
        match read_media(store, entry.path(), Some(&source)) {
            Ok(item) => {
                seen.insert(item.id.clone());
                store.save_item(&item)?;
            }
            Err(_) => {
                skipped += 1;
                complete = false;
            }
        }
        if seen.len() % 10 == 0 || seen.len() == 1 {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    source_id: source_id.into(),
                    processed: seen.len(),
                    current: entry.file_name().to_string_lossy().to_string(),
                },
            );
        }
    }
    if complete {
        for mut item in store
            .library()?
            .items
            .into_iter()
            .filter(|i| i.source_id.as_deref() == Some(source_id))
        {
            if !seen.contains(&item.id) {
                item.available = false;
                store.save_item(&item)?;
            }
        }
    }
    source.online = true;
    source.scanned_at = now();
    source.count = seen.len();
    store.save_source(&source)?;
    Ok(ScanReport {
        imported: seen.len(),
        skipped,
        cancelled: store.cancel_scan.load(Ordering::Relaxed),
    })
}

pub fn compatible_copy(store: &Store, id: &str) -> Result<String, String> {
    let item = store.item(id)?;
    let path = Path::new(&item.path);
    if !store.ffmpeg.is_file() {
        return Err("The FFmpeg helper is missing. Rebuild with npm run package.".into());
    }
    let meta = path
        .metadata()
        .map_err(|_| "This media file is offline".to_string())?;
    let key = digest(format!(
        "{}:{}:{:?}",
        item.path,
        meta.len(),
        meta.modified().ok()
    ));
    let ext = if item.kind == "music" || item.kind == "audiobook" {
        "m4a"
    } else {
        "mp4"
    };
    let target = store
        .data_dir
        .join("compatible")
        .join(format!("{key}.{ext}"));
    if target.is_file() {
        return Ok(target.to_string_lossy().to_string());
    }
    let free_target = store
        .data_dir
        .join("compatible")
        .join(format!("{key}-{}.part.{ext}", uuid::Uuid::new_v4()));
    let mut cmd = hidden_command(&store.ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
        .arg(path);
    if item.kind == "music" || item.kind == "audiobook" {
        cmd.args(["-vn", "-c:a", "aac", "-b:a", "256k"]);
    } else {
        cmd.args([
            "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf",
            "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        ]);
    }
    cmd.args(["-movflags", "+faststart"]).arg(&free_target);
    store.stop_conversion();
    let generation = store.conversion_generation.load(Ordering::SeqCst);
    let mut slot = store.conversion.lock().map_err(err)?;
    if store.conversion_generation.load(Ordering::SeqCst) != generation {
        return Err("Preparation cancelled".into());
    }
    let child = cmd
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(err)?;
    *slot = Some((generation, child));
    drop(slot);
    let status = loop {
        let mut slot = store.conversion.lock().map_err(err)?;
        if store.conversion_generation.load(Ordering::SeqCst) != generation {
            let _ = std::fs::remove_file(&free_target);
            return Err("Preparation cancelled".into());
        }
        let Some((id, child)) = slot.as_mut() else {
            let _ = std::fs::remove_file(&free_target);
            return Err("Preparation cancelled".into());
        };
        if *id != generation {
            return Err("Preparation cancelled".into());
        }
        if let Some(status) = child.try_wait().map_err(err)? {
            slot.take();
            break status;
        }
        drop(slot);
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    if !status.success() {
        let _ = std::fs::remove_file(&free_target);
        return Err("This file could not be prepared for playback. It may be damaged, protected, or unsupported.".into());
    }
    std::fs::rename(&free_target, &target).map_err(err)?;
    Ok(target.to_string_lossy().to_string())
}

pub fn hidden_command(path: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

pub fn nfo_xml(item: &MediaItem) -> String {
    fn esc(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    let root = if item.kind == "tv" {
        "episodedetails"
    } else {
        "movie"
    };
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<{root}>\n  <title>{}</title>\n  <plot>{}</plot>\n  <year>{}</year>\n  <genre>{}</genre>\n  <showtitle>{}</showtitle>\n  <season>{}</season>\n  <episode>{}</episode>\n</{root}>\n",esc(&item.title),esc(&item.overview),esc(&item.year),esc(&item.genre),esc(&item.series),item.season,item.episode)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_episode_and_preserves_unicode_title() {
        assert_eq!(
            parse_episode("Étoile.Station.S02E07.1080p"),
            ("Étoile Station".into(), 2, 7)
        );
        assert_eq!(parse_episode("A song"), (String::new(), 0, 0));
    }
    #[test]
    fn content_identity_is_deterministic() {
        assert_eq!(digest("x"), digest("x"));
        assert_ne!(digest("x"), digest("y"));
    }
    #[test]
    fn video_thumbnails_are_cached_and_supplied_art_takes_precedence() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("film.mp4");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/demo/The Aurora Study.mp4"),
            &path,
        )
        .unwrap();
        let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "resources/bin/ffmpeg{}",
            std::env::consts::EXE_SUFFIX
        ));
        if !ffmpeg.is_file() {
            return;
        }
        let store = Store::new(temp.path().join("data"), ffmpeg).unwrap();
        let original = std::fs::read(&path).unwrap();
        let item = read_media(&store, &path, None).unwrap();
        let thumbnail = item.artwork.expect("video frame");
        assert!(std::fs::read(&thumbnail)
            .unwrap()
            .starts_with(&[0xff, 0xd8]));
        assert_eq!(
            read_media(&store, &path, None).unwrap().artwork.as_deref(),
            Some(thumbnail.as_str())
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let poster = temp.path().join("poster.jpg");
        std::fs::write(&poster, b"supplied artwork").unwrap();
        assert_eq!(
            read_media(&store, &path, None).unwrap().artwork.as_deref(),
            std::fs::canonicalize(poster).unwrap().to_str()
        );
    }
    #[test]
    fn reimporting_a_loose_file_into_a_source_preserves_its_identity() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("track.mp3");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/demo/01 - Glass Horizon.mp3"),
            &path,
        )
        .unwrap();
        let store = Store::new(temp.path().join("data"), std::path::PathBuf::new()).unwrap();
        let original = read_media(&store, &path, None).unwrap();
        store.save_item(&original).unwrap();
        let source = Source {
            id: "source".into(),
            name: "Test".into(),
            path: std::fs::canonicalize(temp.path())
                .unwrap()
                .to_string_lossy()
                .to_string(),
            kind: "mixed".into(),
            online: true,
            scanned_at: 0,
            count: 0,
        };
        let imported = read_media(&store, &path, Some(&source)).unwrap();
        assert_eq!(original.id, imported.id);
        assert_eq!(imported.source_id.as_deref(), Some("source"));
        assert_eq!(imported.relative_path, "track.mp3");
        store.save_item(&imported).unwrap();
        assert_eq!(store.library().unwrap().items.len(), 1);
    }
    #[test]
    fn audiobook_resume_survives_rescan_and_database_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("book.mp3");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/demo/01 - Glass Horizon.mp3"),
            &path,
        )
        .unwrap();
        let data = temp.path().join("data");
        let id;
        {
            let store = Store::new(data.clone(), std::path::PathBuf::new()).unwrap();
            let source = Source {
                id: "books".into(),
                name: "Books".into(),
                path: temp.path().to_string_lossy().into_owned(),
                kind: "audiobook".into(),
                online: true,
                scanned_at: 0,
                count: 0,
            };
            let item = read_media(&store, &path, Some(&source)).unwrap();
            assert_eq!(item.kind, "audiobook");
            assert!(item.duration > 0.);
            id = item.id.clone();
            store.save_item(&item).unwrap();
            store
                .update_progress(&id, 7.25, item.duration, false, true)
                .unwrap();
            let rescanned = read_media(&store, &path, None).unwrap();
            assert_eq!(rescanned.kind, "audiobook");
            assert_eq!(rescanned.resume, 7.25);
            store.save_item(&rescanned).unwrap();
        }
        let store = Store::new(data, std::path::PathBuf::new()).unwrap();
        assert_eq!(store.item(&id).unwrap().resume, 7.25);
        store.update_progress(&id, 3.5, 16., false, false).unwrap();
        assert_eq!(store.item(&id).unwrap().resume, 3.5);
        store.update_progress(&id, 16., 16., true, false).unwrap();
        let item = store.item(&id).unwrap();
        assert!(item.watched);
        assert_eq!(item.resume, 0.);
        assert!(store
            .update_progress(&id, f64::NAN, 16., false, false)
            .is_err());
        let m4b = temp.path().join("recognized.m4b");
        std::fs::write(&m4b, []).unwrap();
        assert_eq!(read_media(&store, &m4b, None).unwrap().kind, "audiobook");
    }
}
