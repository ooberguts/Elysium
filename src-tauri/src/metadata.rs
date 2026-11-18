use crate::{
    media::{apply_overrides, digest, extension},
    models::*,
    store::{err, Store},
};
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFile, TaggedFileExt},
    id3::v2::{Frame, Id3v2Tag},
    picture::{MimeType, Picture, PictureInformation, PictureType},
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
    "rating",
    "artwork",
];

pub fn edit(
    store: &Store,
    id: &str,
    changes: HashMap<String, String>,
    write_file: bool,
) -> Result<MediaItem, String> {
    let _guard = store.tag_edits.lock().map_err(err)?;
    let mut item = store.item(id)?;
    for (key, value) in &changes {
        if !EDITABLE.contains(&key.as_str()) {
            return Err(format!("Cannot edit {key}"));
        }
        if key == "rating" && value.parse::<u8>().map_or(true, |n| n > 5) {
            return Err("Rating must be 0 (unrated) or 1–5 stars".into());
        }
        if key == "artwork" && !value.is_empty() {
            validated_cover(store, value)?;
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
    let reset_video_artwork = matches!(item.kind.as_str(), "movie" | "tv")
        && changes.get("artwork").is_some_and(|value| value.is_empty());
    let fallback_artwork = if reset_video_artwork {
        crate::media::read_raw_media(store, Path::new(&item.path), None)
            .ok()
            .and_then(|raw| raw.artwork)
    } else {
        None
    };
    item.overrides.extend(changes.clone());
    if reset_video_artwork {
        item.overrides.remove("artwork");
        item.artwork = fallback_artwork.clone();
    }
    apply_overrides(&mut item);
    if item.title.trim().is_empty() {
        return Err("Please enter a title".into());
    }
    if write_file {
        write_tags(store, &item, &changes)?;
    }
    store.change_item(id, |latest| {
        latest.overrides.extend(changes);
        if reset_video_artwork {
            latest.overrides.remove("artwork");
            latest.artwork = fallback_artwork;
        }
        apply_overrides(latest);
    })
}

#[derive(serde::Serialize)]
pub struct EditResult {
    pub saved: usize,
    pub embedded: usize,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

pub fn edit_many(
    store: &Store,
    ids: Vec<String>,
    changes: HashMap<String, String>,
    write_files: bool,
) -> Result<EditResult, String> {
    if ids.is_empty() || ids.len() > 1000 {
        return Err("Choose between 1 and 1,000 items to edit.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut result = EditResult {
        saved: 0,
        embedded: 0,
        warnings: vec![],
        errors: vec![],
    };
    for id in ids.into_iter().filter(|id| seen.insert(id.clone())) {
        match edit(store, &id, changes.clone(), write_files) {
            Ok(_) => {
                result.saved += 1;
                if write_files {
                    result.embedded += 1;
                }
            }
            Err(error) => {
                let title = store.item(&id).map(|i| i.title).unwrap_or(id.clone());
                if write_files && edit(store, &id, changes.clone(), false).is_ok() {
                    result.saved += 1;
                    result
                        .warnings
                        .push(format!("{title}: saved in Elysium only. {error}"));
                } else {
                    result.errors.push(format!("{title}: {error}"));
                }
            }
        }
    }
    Ok(result)
}

const MAX_COVER_BYTES: u64 = 8 * 1024 * 1024;

fn read_cover(path: &Path) -> Result<Picture, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(err)?
        .take(MAX_COVER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_COVER_BYTES {
        return Err("Choose a JPEG or PNG cover smaller than 8 MB.".into());
    }
    let mut picture = Picture::from_reader(&mut &bytes[..])
        .map_err(|_| "Choose a valid JPEG or PNG cover.".to_owned())?;
    if !matches!(picture.mime_type(), Some(MimeType::Jpeg | MimeType::Png)) {
        return Err("Cover art must be JPEG or PNG.".into());
    }
    let info = PictureInformation::from_picture(&picture).map_err(err)?;
    if info.width == 0
        || info.height == 0
        || info.width > 8192
        || info.height > 8192
        || u64::from(info.width) * u64::from(info.height) > 32_000_000
    {
        return Err("Choose a valid cover up to 8192 pixels per side and 32 megapixels.".into());
    }
    picture.set_pic_type(PictureType::CoverFront);
    Ok(picture)
}

pub fn prepare_cover(store: &Store, path: &Path) -> Result<String, String> {
    let picture = read_cover(path)?;
    let target = store
        .data_dir
        .join("artwork")
        .join(format!("{}.img", digest(picture.data())));
    if !target.exists() {
        std::fs::write(&target, picture.data()).map_err(err)?;
    }
    Ok(target.to_string_lossy().into_owned())
}
fn validated_cover(store: &Store, value: &str) -> Result<Picture, String> {
    let path = std::fs::canonicalize(value).map_err(err)?;
    let directory = std::fs::canonicalize(store.data_dir.join("artwork")).map_err(err)?;
    if path.parent() != Some(directory.as_path()) {
        return Err("Choose a cover through the artwork picker.".into());
    }
    read_cover(&path)
}

// Snapshot every tag, including extra pictures and user-defined fields. Only the
// explicitly edited fields differ in the expected snapshot after mutation.
fn tag_snapshot(file: &TaggedFile) -> Vec<String> {
    let mut snapshots = Vec::new();
    for tag in file.tags() {
        let mut items: Vec<_> = tag.items().map(|i| format!("{i:?}")).collect();
        if tag.tag_type() == TagType::Id3v2 {
            let id3 = Id3v2Tag::from(tag.clone());
            items.extend((&id3).into_iter().filter_map(|frame| match frame {
                Frame::Popularimeter(popm) => Some(format!("POPM:{popm:?}")),
                _ => None,
            }));
        }
        items.sort();
        let pictures: Vec<_> = tag
            .pictures()
            .iter()
            .map(|p| {
                format!(
                    "{:?}|{:?}|{:?}|{}",
                    p.pic_type(),
                    p.mime_type(),
                    p.description().unwrap_or(""),
                    digest(p.data())
                )
            })
            .collect();
        snapshots.push(format!("{:?}|{items:?}|{pictures:?}", tag.tag_type()));
    }
    snapshots.sort();
    snapshots
}

fn apply_tag_changes(
    store: &Store,
    tag: &mut Tag,
    changes: &HashMap<String, String>,
) -> Result<(), String> {
    for (key, value) in changes {
        match key.as_str() {
            "title" => tag.set_title(value.clone()),
            "artist" => tag.set_artist(value.clone()),
            "album" => tag.set_album(value.clone()),
            "genre" => tag.set_genre(value.clone()),
            "albumArtist" => {
                tag.insert_text(ItemKey::AlbumArtist, value.clone());
            }
            "year" => {
                if let Ok(n) = value.parse::<u32>() {
                    tag.set_year(n)
                } else if value.is_empty() {
                    tag.remove_year()
                } else {
                    return Err("Use a four-digit year for file tags.".into());
                }
            }
            "track" => {
                let n = value.parse::<u32>().map_err(err)?;
                if n == 0 {
                    tag.remove_track()
                } else {
                    tag.set_track(n)
                }
            }
            "disc" => {
                let n = value.parse::<u32>().map_err(err)?;
                if n == 0 {
                    tag.remove_disk()
                } else {
                    tag.set_disk(n)
                }
            }
            "rating" => crate::ratings::set(tag, value.parse().map_err(err)?)?,
            "artwork" => {
                tag.remove_picture_type(PictureType::CoverFront);
                if !value.is_empty() {
                    tag.push_picture(validated_cover(store, value)?);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn supports_file_tags(item: &MediaItem) -> bool {
    ["mp3", "flac"].contains(&extension(Path::new(&item.path)).as_str())
}
fn write_tags(
    store: &Store,
    item: &MediaItem,
    changes: &HashMap<String, String>,
) -> Result<(), String> {
    let path = Path::new(&item.path);
    let ext = extension(path);
    if !supports_file_tags(item) {
        return Err(
            "Embedded tag writing supports MP3 and FLAC; this file keeps its edits in Elysium."
                .into(),
        );
    }
    let before = path.metadata().map_err(err)?;
    if before.permissions().readonly() {
        return Err("This file is read-only.".into());
    }
    let mut tagged = lofty::read_from_path(path).map_err(err)?;
    if tagged.tags().iter().any(|tag| {
        if tag.tag_type() != TagType::Id3v2 {
            return tag.has_format_specific_items();
        }
        let mut id3 = Id3v2Tag::from(tag.clone());
        id3.retain(|frame| !matches!(frame, Frame::Popularimeter(_)));
        Tag::from(id3).has_format_specific_items()
    }) {
        return Err(
            "This file contains specialized tag data that cannot be safely rewritten.".into(),
        );
    }
    let original_tags = tag_snapshot(&tagged);
    if tagged.primary_tag().is_none() {
        tagged.insert_tag(Tag::new(if ext == "mp3" {
            TagType::Id3v2
        } else {
            TagType::VorbisComments
        }));
    }
    apply_tag_changes(
        store,
        tagged.primary_tag_mut().ok_or("No writable tag found")?,
        changes,
    )?;
    let expected_tags = tag_snapshot(&tagged);
    if original_tags == expected_tags {
        return Ok(());
    }
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
    if tag_snapshot(&checked) != expected_tags {
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingResult {
    pub embedded: bool,
    pub warning: Option<String>,
}

pub fn set_rating(store: &Store, id: &str, rating: u8) -> Result<RatingResult, String> {
    if rating > 5 {
        return Err("Choose 1–5 stars, or 0 to clear the rating.".into());
    }
    let _guard = store.tag_edits.lock().map_err(err)?;
    let changes = HashMap::from([("rating".into(), rating.to_string())]);
    let item = store.change_item(id, |item| {
        item.rating = rating;
        item.overrides.extend(changes.clone());
    })?;
    if !supports_file_tags(&item) {
        return Ok(RatingResult {
            embedded: false,
            warning: Some(
                "Rating saved in Elysium. File ratings are currently supported for MP3 and FLAC."
                    .into(),
            ),
        });
    }
    match write_tags(store, &item, &changes) {
        Ok(()) => Ok(RatingResult {
            embedded: true,
            warning: None,
        }),
        Err(error) => Ok(RatingResult {
            embedded: false,
            warning: Some(format!("Rating saved in Elysium; file unchanged: {error}")),
        }),
    }
}

pub fn restore_tags(store: &Store, id: &str) -> Result<(), String> {
    let _guard = store.tag_edits.lock().map_err(err)?;
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
    if let Some(rating) = item.overrides.get("rating") {
        refreshed.overrides.insert("rating".into(), rating.clone());
    }
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
    #[test]
    fn video_cover_can_be_set_and_reset_to_automatic_frame() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("film.mp4");
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        std::fs::copy(resources.join("demo/The Aurora Study.mp4"), &path).unwrap();
        let ffmpeg = resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX));
        if !ffmpeg.is_file() {
            return;
        }
        let store = Store::new(dir.path().join("data"), ffmpeg).unwrap();
        let original = std::fs::read(&path).unwrap();
        let item = crate::media::read_media(&store, &path, None).unwrap();
        let automatic = item.artwork.clone().expect("automatic video still");
        store.save_item(&item).unwrap();
        let picture_dir = dir.path().join("pictures");
        std::fs::create_dir_all(&picture_dir).unwrap();
        let poster = cover_fixture(&store, &picture_dir);
        let edited = edit(
            &store,
            &item.id,
            HashMap::from([("artwork".into(), poster.clone())]),
            false,
        )
        .unwrap();
        assert_eq!(edited.artwork.as_deref(), Some(poster.as_str()));
        assert_eq!(
            crate::media::read_media(&store, &path, None)
                .unwrap()
                .artwork
                .as_deref(),
            Some(poster.as_str())
        );
        let reset = edit(
            &store,
            &item.id,
            HashMap::from([("artwork".into(), String::new())]),
            false,
        )
        .unwrap();
        assert_eq!(reset.artwork.as_deref(), Some(automatic.as_str()));
        assert!(!reset.overrides.contains_key("artwork"));
        assert_eq!(
            crate::media::read_media(&store, &path, None)
                .unwrap()
                .artwork
                .as_deref(),
            Some(automatic.as_str())
        );
        assert_eq!(std::fs::read(path).unwrap(), original);
    }
    fn cover_fixture(store: &Store, directory: &Path) -> String {
        use base64::Engine;
        // Original one-pixel PNG fixture; cover data is validated and cached, not transcoded.
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cKkAAAAASUVORK5CYII=").unwrap();
        let path = directory.join("cover.png");
        std::fs::write(&path, png).unwrap();
        prepare_cover(store, &path).unwrap()
    }
    #[test]
    fn mp3_ratings_roundtrip_clear_and_preserve_other_owners_and_metadata() {
        use lofty::tag::{ItemValue, TagItem};
        let (_temp, store, path, item) = sample_setup();
        let mut file = lofty::read_from_path(&path).unwrap();
        let tag = file.primary_tag_mut().unwrap();
        tag.insert_text(ItemKey::Lyrics, "Words to preserve".into());
        let mut other = b"Windows Media Player 9 Series\0".to_vec();
        other.extend([128, 0, 0, 3, 219]);
        tag.push(TagItem::new(
            ItemKey::Popularimeter,
            ItemValue::Binary(other.clone()),
        ));
        file.save_to_path(&path, WriteOptions::default()).unwrap();
        let payload = audio_payload_hash(&path).unwrap();
        assert_eq!(
            crate::media::read_raw_media(&store, &path, None)
                .unwrap()
                .rating,
            3
        );
        for stars in [1, 2, 3, 4, 5, 0] {
            let result = set_rating(&store, &item.id, stars).unwrap();
            assert!(result.embedded, "{:?}", result.warning);
            let file = lofty::read_from_path(&path).unwrap();
            let tag = file.primary_tag().unwrap();
            assert_eq!(crate::ratings::read(tag), Some(stars));
            assert_eq!(tag.get_string(&ItemKey::Lyrics), Some("Words to preserve"));
            let typed = Id3v2Tag::from(tag.clone());
            assert!((&typed).into_iter().any(|f| matches!(f, Frame::Popularimeter(p) if p.email == "Windows Media Player 9 Series" && p.rating == 128 && p.counter == 987)));
            assert_eq!(audio_payload_hash(&path).unwrap(), payload);
            assert_eq!(
                crate::media::read_media(&store, &path, None)
                    .unwrap()
                    .rating,
                stars
            );
        }
        drop(store);
        let reopened = Store::new(_temp.path().join("data"), Default::default()).unwrap();
        assert_eq!(reopened.item(&item.id).unwrap().rating, 0);
        assert_eq!(reopened.item(&item.id).unwrap().overrides["rating"], "0");
        let before = file_hash(&path).unwrap();
        assert!(set_rating(&reopened, &item.id, 6).is_err());
        assert_eq!(file_hash(&path).unwrap(), before);
    }
    #[test]
    fn album_cover_and_rating_edit_preserves_audio_titles_and_back_covers() {
        let (temp, store, mp3, _) = sample_setup();
        let cover = cover_fixture(&store, temp.path());
        let flac = temp.path().join("second.flac");
        assert!(crate::media::hidden_command(&store.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&mp3)
            .arg(&flac)
            .status()
            .unwrap()
            .success());
        for path in [&mp3, &flac] {
            let mut tagged = lofty::read_from_path(path).unwrap();
            let mut back = validated_cover(&store, &cover).unwrap();
            back.set_pic_type(PictureType::CoverBack);
            back.set_description(Some("Keep this back cover".into()));
            tagged.primary_tag_mut().unwrap().push_picture(back.clone());
            tagged.save_to_path(path, WriteOptions::default()).unwrap();
            let item = crate::media::read_media(&store, path, None).unwrap();
            store.save_item(&item).unwrap();
            let original = file_hash(path).unwrap();
            let payload = audio_payload_hash(path).unwrap();
            edit(
                &store,
                &item.id,
                HashMap::from([
                    ("album".into(), "My collection".into()),
                    ("albumArtist".into(), "Various Artists".into()),
                    ("artwork".into(), cover.clone()),
                    ("rating".into(), "4".into()),
                ]),
                true,
            )
            .unwrap();
            let raw = crate::media::read_raw_media(&store, path, None).unwrap();
            assert_eq!(raw.album, "My collection");
            assert_eq!(raw.album_artist, "Various Artists");
            assert_eq!(raw.title, item.title);
            assert_eq!(raw.artist, item.artist);
            assert_eq!(raw.rating, 4);
            assert_eq!(raw.artwork.as_deref(), Some(cover.as_str()));
            assert_eq!(audio_payload_hash(path).unwrap(), payload);
            let tagged = lofty::read_from_path(path).unwrap();
            assert!(tagged
                .primary_tag()
                .unwrap()
                .pictures()
                .iter()
                .any(|p| p.pic_type() == PictureType::CoverBack
                    && p.data() == back.data()
                    && p.description() == back.description()));
            restore_tags(&store, &item.id).unwrap();
            assert_eq!(file_hash(path).unwrap(), original);
        }
    }
    #[test]
    fn personal_cover_and_clear_rating_survive_rescans_without_changing_files() {
        let (temp, store, path, item) = sample_setup();
        let cover = cover_fixture(&store, temp.path());
        let before = file_hash(&path).unwrap();
        store
            .update_progress(&item.id, 4.5, 20.0, false, true)
            .unwrap();
        edit(
            &store,
            &item.id,
            HashMap::from([
                ("artwork".into(), cover.clone()),
                ("album".into(), "Personal album".into()),
                ("rating".into(), "0".into()),
            ]),
            false,
        )
        .unwrap();
        let scan = crate::media::read_media(&store, &path, None).unwrap();
        assert_eq!(scan.artwork, Some(cover));
        assert_eq!(scan.album, "Personal album");
        assert_eq!(scan.resume, 4.5);
        assert_eq!(scan.play_count, 1);
        edit(
            &store,
            &item.id,
            HashMap::from([("artwork".into(), "".into())]),
            false,
        )
        .unwrap();
        assert_eq!(
            crate::media::read_media(&store, &path, None)
                .unwrap()
                .artwork,
            None
        );
        assert_eq!(file_hash(&path).unwrap(), before);
    }
    #[test]
    fn read_only_rating_is_retained_in_library_and_reports_file_failure() {
        let (_temp, store, path, item) = sample_setup();
        let before = file_hash(&path).unwrap();
        let original_permissions = path.metadata().unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        let result = set_rating(&store, &item.id, 5).unwrap();
        assert!(!result.embedded);
        assert!(result.warning.unwrap().contains("read-only"));
        assert_eq!(store.item(&item.id).unwrap().rating, 5);
        assert_eq!(file_hash(&path).unwrap(), before);
        std::fs::set_permissions(path, original_permissions).unwrap();
    }
    #[test]
    fn invalid_cover_and_rating_cannot_change_library_or_file() {
        let (temp, store, path, item) = sample_setup();
        let junk = temp.path().join("bad.png");
        std::fs::write(&junk, b"not an image").unwrap();
        assert!(prepare_cover(&store, &junk).is_err());
        let before = file_hash(&path).unwrap();
        assert!(edit(
            &store,
            &item.id,
            HashMap::from([("artwork".into(), junk.to_string_lossy().into_owned())]),
            true
        )
        .is_err());
        assert!(edit(
            &store,
            &item.id,
            HashMap::from([("rating".into(), "8".into())]),
            false
        )
        .is_err());
        assert_eq!(store.item(&item.id).unwrap().rating, item.rating);
        assert_eq!(file_hash(&path).unwrap(), before);
    }
    #[test]
    fn bulk_edit_reports_partial_file_writes_and_keeps_each_tracks_other_fields() {
        let (temp, store, path, item) = sample_setup();
        let second = temp.path().join("read-only.mp3");
        std::fs::copy(&path, &second).unwrap();
        let other = crate::media::read_media(&store, &second, None).unwrap();
        store.save_item(&other).unwrap();
        let original = file_hash(&second).unwrap();
        let permissions = second.metadata().unwrap().permissions();
        let mut readonly = permissions.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&second, readonly).unwrap();
        let result = edit_many(
            &store,
            vec![item.id.clone(), other.id.clone(), item.id.clone()],
            HashMap::from([
                ("album".into(), "One collection".into()),
                ("rating".into(), "4".into()),
            ]),
            true,
        )
        .unwrap();
        assert_eq!(result.saved, 2);
        assert_eq!(result.embedded, 1);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.errors.is_empty());
        for id in [&item.id, &other.id] {
            let saved = store.item(id).unwrap();
            assert_eq!(saved.album, "One collection");
            assert_eq!(saved.rating, 4);
            assert_eq!(saved.title, item.title);
        }
        assert_eq!(file_hash(&second).unwrap(), original);
        std::fs::set_permissions(second, permissions).unwrap();
    }
    #[test]
    fn row_rating_only_writes_rating_and_unsupported_formats_keep_personal_edits() {
        let (temp, store, path, item) = sample_setup();
        edit(
            &store,
            &item.id,
            HashMap::from([("album".into(), "Private library album".into())]),
            false,
        )
        .unwrap();
        assert!(set_rating(&store, &item.id, 4).unwrap().embedded);
        assert_eq!(
            crate::media::read_raw_media(&store, &path, None)
                .unwrap()
                .album,
            item.album
        );
        assert_eq!(store.item(&item.id).unwrap().album, "Private library album");
        let m4a = temp.path().join("song.m4a");
        assert!(crate::media::hidden_command(&store.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&path)
            .args(["-t", "1"])
            .arg(&m4a)
            .status()
            .unwrap()
            .success());
        let other = crate::media::read_media(&store, &m4a, None).unwrap();
        store.save_item(&other).unwrap();
        let original = file_hash(&m4a).unwrap();
        let result = set_rating(&store, &other.id, 5).unwrap();
        assert!(!result.embedded);
        assert!(result.warning.is_some());
        assert_eq!(file_hash(&m4a).unwrap(), original);
        assert_eq!(
            crate::media::read_media(&store, &m4a, None).unwrap().rating,
            5
        );
    }
}
