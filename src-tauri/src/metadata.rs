use crate::{
    media::{apply_overrides, digest, extension},
    models::*,
    store::{err, Store},
};
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    tag::{Accessor, ItemKey, Tag, TagType},
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

pub const EDITABLE: &[&str] = &[
    "title",
    "artist",
    "album",
    "albumArtist",
    "genre",
    "year",
    "track",
    "disc",
    "series",
    "season",
    "episode",
    "overview",
];

pub fn edit(
    store: &Store,
    id: &str,
    changes: HashMap<String, String>,
    write_file: bool,
) -> Result<MediaItem, String> {
    let mut item = store.item(id)?;
    for (key, value) in &changes {
        if !EDITABLE.contains(&key.as_str()) {
            return Err(format!("Cannot edit {key}"));
        }
        if value.len() > 32_000 {
            return Err("One of the fields is too long".into());
        }
        if ["track", "disc", "season", "episode"].contains(&key.as_str())
            && value.parse::<u32>().is_err()
        {
            return Err(format!("{key} must be a positive whole number"));
        }
    }
    item.overrides.extend(changes);
    apply_overrides(&mut item);
    if item.title.trim().is_empty() {
        return Err("Please enter a title".into());
    }
    if write_file {
        write_tags(store, &item)?;
    }
    store.save_item(&item)?;
    Ok(item)
}

fn set_fields(tag: &mut Tag, item: &MediaItem) {
    tag.set_title(item.title.clone());
    tag.set_artist(item.artist.clone());
    tag.set_album(item.album.clone());
    tag.set_genre(item.genre.clone());
    tag.insert_text(ItemKey::AlbumArtist, item.album_artist.clone());
    if item.track > 0 {
        tag.set_track(item.track);
    } else {
        tag.remove_track();
    }
    if item.disc > 0 {
        tag.set_disk(item.disc);
    } else {
        tag.remove_disk();
    }
    if let Ok(year) = item.year.parse::<u32>() {
        tag.set_year(year);
    } else if item.year.is_empty() {
        tag.remove_year();
    }
}

fn preserved(tag: &Tag) -> (Vec<String>, Vec<String>) {
    let changed = [
        ItemKey::TrackTitle,
        ItemKey::TrackArtist,
        ItemKey::AlbumTitle,
        ItemKey::AlbumArtist,
        ItemKey::Genre,
        ItemKey::TrackNumber,
        ItemKey::DiscNumber,
        ItemKey::Year,
        ItemKey::RecordingDate,
    ];
    let mut items: Vec<String> = tag
        .items()
        .filter(|i| !changed.contains(i.key()))
        .map(|i| format!("{i:?}"))
        .collect();
    items.sort();
    let pictures = tag.pictures().iter().map(|p| digest(p.data())).collect();
    (items, pictures)
}

pub fn write_tags(store: &Store, item: &MediaItem) -> Result<(), String> {
    let path = Path::new(&item.path);
    let ext = extension(path);
    if !["mp3", "flac"].contains(&ext.as_str()) {
        return Err("Embedded tag writing is currently enabled for MP3 and FLAC. Save this edit to the library instead.".into());
    }
    let before = path.metadata().map_err(err)?;
    if before.permissions().readonly() {
        return Err("This file is read-only. Save to the library instead.".into());
    }
    let mut tagged = lofty::read_from_path(path).map_err(err)?;
    if tagged.primary_tag().is_none() {
        tagged.insert_tag(Tag::new(if ext == "mp3" {
            TagType::Id3v2
        } else {
            TagType::VorbisComments
        }));
    }
    let tag = tagged.primary_tag_mut().ok_or("No writable tag found")?;
    if tag.has_format_specific_items() {
        return Err("This file contains specialized tag data. Elysium kept the original intact; save this edit to the library instead.".into());
    }
    let untouched = preserved(tag);
    set_fields(tag, item);
    let expected_title = item.title.clone();
    let expected_artist = item.artist.clone();
    let expected_album = item.album.clone();
    let original_hash = file_hash(path)?;
    let audio_before = audio_payload_hash(path)?;
    let backup = store.data_dir.join("backups").join(format!(
        "{}-{}-{}.{}",
        item.id,
        now(),
        uuid::Uuid::new_v4(),
        ext
    ));
    std::fs::copy(path, &backup).map_err(err)?;
    let mut staged = tempfile::Builder::new()
        .prefix(".elysium-")
        .suffix(&format!(".{ext}"))
        .tempfile_in(path.parent().ok_or("Missing parent folder")?)
        .map_err(err)?;
    std::io::copy(&mut File::open(path).map_err(err)?, staged.as_file_mut()).map_err(err)?;
    std::fs::set_permissions(staged.path(), before.permissions()).map_err(err)?;
    tagged
        .save_to_path(staged.path(), WriteOptions::default())
        .map_err(err)?;
    let checked = lofty::read_from_path(staged.path()).map_err(err)?;
    let tag = checked.primary_tag().ok_or("Tag validation failed")?;
    if tag.title().as_deref() != Some(expected_title.as_str())
        || tag.artist().as_deref().unwrap_or("") != expected_artist
        || tag.album().as_deref().unwrap_or("") != expected_album
        || preserved(tag) != untouched
    {
        return Err(
            "The tag writer could not preserve all metadata. The original file has been kept."
                .into(),
        );
    }
    if audio_payload_hash(staged.path())? != audio_before {
        return Err("Audio verification failed. The original file has been kept.".into());
    }
    let after = path.metadata().map_err(err)?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || file_hash(path)? != original_hash
    {
        return Err(
            "The file changed while it was being edited. Please rescan and try again.".into(),
        );
    }
    let journal = store
        .data_dir
        .join("backups")
        .join(format!("{}.json", item.id));
    let target_hash = file_hash(staged.path())?;
    let record = serde_json::json!({"itemId":item.id,"original":item.path,"backup":backup,"expectedHash":target_hash,"state":"prepared"});
    std::fs::write(&journal, serde_json::to_vec_pretty(&record).map_err(err)?).map_err(err)?;
    staged.as_file().sync_all().map_err(err)?;
    staged.persist(path).map_err(|e| {
        format!(
            "Could not replace the media file: {}. Its backup is retained.",
            e.error
        )
    })?;
    let mut committed = record;
    committed["state"] = "committed".into();
    std::fs::write(journal, serde_json::to_vec_pretty(&committed).map_err(err)?).map_err(err)?;
    Ok(())
}

pub fn restore_tags(store: &Store, id: &str) -> Result<(), String> {
    let item = store.item(id)?;
    let journal = store.data_dir.join("backups").join(format!("{id}.json"));
    let record: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&journal).map_err(|_| "There is no tag backup for this item".to_owned())?,
    )
    .map_err(err)?;
    if record["original"].as_str() != Some(&item.path) {
        return Err("The file has moved since this backup was made".into());
    }
    if file_hash(Path::new(&item.path))? != record["expectedHash"].as_str().unwrap_or("") {
        return Err("This file has changed since the edit. Its backup is retained, but cannot be automatically restored.".into());
    }
    let backup = record["backup"].as_str().ok_or("Invalid backup record")?;
    let path = Path::new(&item.path);
    let mut staged =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing folder")?).map_err(err)?;
    std::io::copy(&mut File::open(backup).map_err(err)?, staged.as_file_mut()).map_err(err)?;
    staged.as_file().sync_all().map_err(err)?;
    staged.persist(path).map_err(|e| err(e.error))?;
    let mut refreshed = crate::media::read_raw_media(store, path, None)?;
    refreshed.id = item.id;
    refreshed.source_id = item.source_id;
    refreshed.relative_path = item.relative_path;
    refreshed.favorite = item.favorite;
    refreshed.rating = item.rating;
    refreshed.play_count = item.play_count;
    refreshed.added_at = item.added_at;
    refreshed.last_played = item.last_played;
    refreshed.resume = item.resume;
    refreshed.watched = item.watched;
    refreshed.overrides.clear();
    store.save_item(&refreshed)?;
    std::fs::remove_file(journal).map_err(err)?;
    Ok(())
}

pub fn file_hash(path: &Path) -> Result<String, String> {
    hash_range(path, 0, None)
}
fn hash_range(path: &Path, start: u64, end: Option<u64>) -> Result<String, String> {
    let mut file = File::open(path).map_err(err)?;
    let size = file.metadata().map_err(err)?.len();
    let mut remaining = end.unwrap_or(size).saturating_sub(start);
    file.seek(SeekFrom::Start(start)).map_err(err)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    while remaining > 0 {
        let length = buf.len().min(remaining as usize);
        let n = file.read(&mut buf[..length]).map_err(err)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        remaining -= n as u64;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn audio_payload_hash(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(err)?;
    let size = f.metadata().map_err(err)?.len();
    let mut start = 0u64;
    let mut end = size;
    let mut head = [0u8; 10];
    f.read_exact(&mut head).map_err(err)?;
    if &head[..3] == b"ID3" {
        if head[6..10].iter().any(|b| b & 0x80 != 0) {
            return Err("Invalid ID3 tag length".into());
        }
        let tag_size = head[6..10].iter().fold(0u64, |n, b| (n << 7) | (*b as u64));
        start = 10 + tag_size + if head[5] & 0x10 != 0 { 10 } else { 0 };
    }
    if extension(path) == "flac" {
        f.seek(SeekFrom::Start(start)).map_err(err)?;
        let mut magic = [0; 4];
        f.read_exact(&mut magic).map_err(err)?;
        if &magic != b"fLaC" {
            return Err("Invalid FLAC header".into());
        }
        start += 4;
        loop {
            let mut block = [0; 4];
            f.read_exact(&mut block).map_err(err)?;
            let len = ((block[1] as u64) << 16) | ((block[2] as u64) << 8) | (block[3] as u64);
            start += 4 + len;
            if start > size {
                return Err("Invalid FLAC metadata".into());
            }
            f.seek(SeekFrom::Start(start)).map_err(err)?;
            if block[0] & 0x80 != 0 {
                break;
            }
        }
    } else if size >= 128 {
        f.seek(SeekFrom::Start(size - 128)).map_err(err)?;
        let mut tag = [0; 3];
        f.read_exact(&mut tag).map_err(err)?;
        if &tag == b"TAG" {
            end -= 128;
        }
    }
    if start >= end {
        return Err("No audio payload found".into());
    }
    hash_range(path, start, Some(end))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_digest_ignores_id3_but_detects_audio_changes() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mp3");
        let b = dir.path().join("b.mp3");
        let audio = vec![0xff; 256];
        std::fs::write(&a, &audio).unwrap();
        let mut tagged = b"ID3\x04\x00\x00\x00\x00\x00\x05hello".to_vec();
        tagged.extend(&audio);
        std::fs::write(&b, &tagged).unwrap();
        assert_eq!(
            audio_payload_hash(&a).unwrap(),
            audio_payload_hash(&b).unwrap()
        );
        tagged.push(0);
        std::fs::write(&b, &tagged).unwrap();
        assert_ne!(
            audio_payload_hash(&a).unwrap(),
            audio_payload_hash(&b).unwrap()
        );
    }
    fn sample_setup() -> (tempfile::TempDir, Store, std::path::PathBuf, MediaItem) {
        let temp = tempfile::tempdir().unwrap();
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let sample = root.join("resources/demo/01 - Glass Horizon.mp3");
        assert!(
            sample.is_file(),
            "Run npm run prepare:media before native tests"
        );
        let path = temp.path().join("song.mp3");
        std::fs::copy(sample, &path).unwrap();
        let ffmpeg = root.join(if cfg!(windows) {
            "resources/bin/ffmpeg.exe"
        } else {
            "resources/bin/ffmpeg"
        });
        let store = Store::new(temp.path().join("data"), ffmpeg).unwrap();
        let item = crate::media::read_media(&store, &path, None).unwrap();
        store.save_item(&item).unwrap();
        (temp, store, path, item)
    }
    #[test]
    fn library_edits_survive_rescan_without_touching_original() {
        let (_temp, store, path, item) = sample_setup();
        let original = file_hash(&path).unwrap();
        let changes = HashMap::from([("title".into(), "A personal title".into())]);
        edit(&store, &item.id, changes, false).unwrap();
        let rescanned = crate::media::read_media(&store, &path, None).unwrap();
        assert_eq!(rescanned.title, "A personal title");
        assert_eq!(file_hash(&path).unwrap(), original);
    }
    #[test]
    fn mp3_write_preserves_audio_and_restore_recovers_original() {
        let (_temp, store, path, mut item) = sample_setup();
        let original = file_hash(&path).unwrap();
        let payload = audio_payload_hash(&path).unwrap();
        item.favorite = true;
        item.rating = 5;
        store.save_item(&item).unwrap();
        edit(
            &store,
            &item.id,
            HashMap::from([("title".into(), "Verified title".into())]),
            true,
        )
        .unwrap();
        assert_eq!(audio_payload_hash(&path).unwrap(), payload);
        assert_ne!(file_hash(&path).unwrap(), original);
        assert_eq!(
            lofty::read_from_path(&path)
                .unwrap()
                .primary_tag()
                .unwrap()
                .title()
                .as_deref(),
            Some("Verified title")
        );
        restore_tags(&store, &item.id).unwrap();
        assert_eq!(file_hash(&path).unwrap(), original);
        let restored = store.item(&item.id).unwrap();
        assert!(restored.favorite);
        assert_eq!(restored.rating, 5);
        assert_eq!(restored.title, "Glass Horizon");
    }
    #[test]
    fn flac_write_preserves_encoded_audio() {
        let (temp, store, path, _) = sample_setup();
        let flac = temp.path().join("song.flac");
        assert!(crate::media::hidden_command(&store.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&path)
            .arg(&flac)
            .status()
            .unwrap()
            .success());
        let item = crate::media::read_media(&store, &flac, None).unwrap();
        store.save_item(&item).unwrap();
        let original = audio_payload_hash(&flac).unwrap();
        edit(
            &store,
            &item.id,
            HashMap::from([("title".into(), "FLAC title".into())]),
            true,
        )
        .unwrap();
        assert_eq!(original, audio_payload_hash(&flac).unwrap());
    }
    #[test]
    fn backup_restore_rejects_external_file_changes() {
        let (_temp, store, path, item) = sample_setup();
        edit(
            &store,
            &item.id,
            HashMap::from([("title".into(), "Changed".into())]),
            true,
        )
        .unwrap();
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.push(0);
        std::fs::write(&path, &bytes).unwrap();
        assert!(restore_tags(&store, &item.id)
            .unwrap_err()
            .contains("changed since"));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}
