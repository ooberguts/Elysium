use super::{
    audio::Sink,
    protocol::{Chunk, Control, Packet, Track, BUFFER_US, FRAMES, RATE},
    Node,
};
use crate::{media::hidden_command, models::MediaItem};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Read,
    net::{Shutdown, TcpStream},
    path::PathBuf,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::Duration,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastRequest {
    pub name: String,
    pub item_ids: Vec<String>,
    pub mode: String,
    pub minutes: u32,
    pub finish_track: bool,
    #[serde(default)]
    pub resume_books: bool,
    pub shuffle: bool,
    pub play_here: bool,
    pub output_device: Option<String>,
}
impl BroadcastRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() || self.name.chars().count() > 80 {
            return Err("Give the station a name of up to 80 characters".into());
        }
        if self.item_ids.is_empty() || self.item_ids.len() > 10_000 {
            return Err("Choose between 1 and 10,000 media items".into());
        }
        if !["once", "repeat", "duration"].contains(&self.mode.as_str()) {
            return Err("Unknown broadcast run mode".into());
        }
        if self.mode == "duration" && !(1..=10080).contains(&self.minutes) {
            return Err("Choose a duration between 1 minute and 7 days".into());
        }
        Ok(())
    }
    fn limit_frames(&self) -> Option<u64> {
        (self.mode == "duration").then_some(self.minutes as u64 * 60 * RATE as u64)
    }
    fn can_start_track(&self, completed: usize, total_frames: u64) -> bool {
        if self.mode == "once" && completed >= self.item_ids.len() {
            return false;
        }
        !self
            .limit_frames()
            .is_some_and(|limit| total_frames >= limit)
    }
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StationView {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub track: Option<Track>,
    pub position: f64,
    pub elapsed: f64,
    pub mode: String,
    pub minutes: u32,
    pub finish_track: bool,
    pub play_here: bool,
    pub skipped: usize,
    pub message: String,
    pub output: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerView {
    pub id: String,
    pub device_id: String,
    pub name: String,
    pub address: String,
}
pub struct Subscriber {
    pub view: ListenerView,
    pub tx: SyncSender<Packet>,
    pub socket: TcpStream,
}
pub struct BookCheckpoint {
    id: String,
    at: i64,
    offset: f64,
    duration: f64,
    end: Option<i64>,
}
pub struct Station {
    pub id: String,
    pub name: String,
    pub alive: AtomicBool,
    pub epoch: AtomicU64,
    pub skip: AtomicU64,
    pub subscribers: Mutex<HashMap<String, Subscriber>>,
    pub sink: Option<Arc<Sink>>,
    pub blocked: Mutex<HashSet<String>>,
    pub view: Mutex<StationView>,
    pub child: Mutex<Option<Child>>,
    pub started: AtomicU64,
    pub tracks: Mutex<VecDeque<(Track, i64)>>,
    pub video_root: tempfile::TempDir,
    pub lookahead: i64,
    pub progress_store: Option<Arc<crate::store::Store>>,
    pub book_progress: Mutex<VecDeque<BookCheckpoint>>,
    pub origin: std::time::Instant,
}
impl Station {
    pub fn save_book_progress(&self, now: i64) {
        let Some(store) = &self.progress_store else {
            return;
        };
        let mut checkpoints = self.book_progress.lock().unwrap();
        for book in checkpoints.iter().filter(|book| book.at <= now) {
            let elapsed = (now.min(book.end.unwrap_or(i64::MAX)) - book.at).max(0) as f64 / 1e6;
            let position = (book.offset + elapsed).min(book.duration);
            if let Err(error) = store.update_progress(
                &book.id,
                position,
                book.duration,
                position >= book.duration - 0.08,
                false,
            ) {
                self.view.lock().unwrap().message =
                    format!("Could not save audiobook position: {error}");
            }
        }
        while checkpoints
            .front()
            .is_some_and(|book| book.end.is_some_and(|end| end <= now))
        {
            checkpoints.pop_front();
        }
    }
    pub fn emit(&self, packet: Packet) {
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.retain(|_, sub| {
                if sub.tx.try_send(packet.clone()).is_err() {
                    let _ = sub.socket.shutdown(Shutdown::Both);
                    false
                } else {
                    true
                }
            });
        }
    }
    pub fn stop_child(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
            }
        }
    }
    pub fn stop(&self, reason: &str) {
        self.save_book_progress(self.origin.elapsed().as_micros() as i64);
        self.alive.store(false, Ordering::Release);
        self.stop_child();
        self.emit(Packet::Control(Control::End {
            reason: reason.into(),
        }));
        if let Some(sink) = &self.sink {
            sink.stop();
        }
        if let Ok(mut view) = self.view.lock() {
            view.active = false;
            view.message = reason.into();
        }
    }
    pub fn remove(&self, id: &str) {
        if let Ok(mut subs) = self.subscribers.lock() {
            if let Some(sub) = subs.remove(id) {
                self.blocked
                    .lock()
                    .unwrap()
                    .insert(sub.view.device_id.clone());
                let _ = sub.tx.try_send(Packet::Control(Control::End {
                    reason: "Removed from this broadcast".into(),
                }));
                // The reader is released even if a slow connection cannot take End.
                let _ = sub.socket.shutdown(Shutdown::Both);
            }
        }
    }
    pub fn scheduled_tracks(&self, now: i64) -> Vec<(Track, i64)> {
        let mut tracks = self.tracks.lock().unwrap();
        while tracks.len() > 1 && tracks[1].1 <= now {
            tracks.pop_front();
        }
        tracks.iter().cloned().collect()
    }
    fn schedule_track(&self, track: Track, at: i64) {
        let mut tracks = self.tracks.lock().unwrap();
        if tracks.len() >= 64 {
            tracks.pop_front();
        }
        tracks.push_back((track.clone(), at));
        drop(tracks);
        self.emit(Packet::Control(Control::NowPlaying { track, at }));
    }
    pub fn snapshot(&self, now: i64) -> StationView {
        let mut view = self.view.lock().unwrap().clone();
        view.active = self.alive.load(Ordering::Acquire);
        view.elapsed = ((now - self.started.load(Ordering::Relaxed) as i64).max(0) as f64) / 1e6;
        let tracks = self.scheduled_tracks(now);
        view.track = tracks.first().map(|(track, _)| track.clone());
        view.position = tracks
            .first()
            .map(|(_, at)| (now - at).max(0) as f64 / 1e6)
            .unwrap_or(0.);
        if let Some(t) = &view.track {
            view.position = view.position.min(t.duration.max(0.));
        }
        if let Some(sink) = &self.sink {
            let error = sink.error.lock().unwrap().clone();
            if !error.is_empty() {
                view.message = error;
            }
        }
        view
    }
}

pub fn launch(
    node: Arc<Node>,
    request: BroadcastRequest,
    items: Vec<MediaItem>,
    store: Arc<crate::store::Store>,
) -> Result<Arc<Station>, String> {
    request.validate()?;
    let ffmpeg = store.ffmpeg.clone();
    if !ffmpeg.is_file() {
        return Err("The bundled audio decoder is missing. Reinstall Elysium.".into());
    }
    let sink = if request.play_here {
        let sink = Sink::new(
            node.origin,
            true,
            node.volume(),
            node.delay_ms.load(Ordering::Relaxed),
        );
        let output = sink.start(request.output_device.as_deref(), node.app.clone())?;
        Some((sink, output))
    } else {
        None
    };
    let id = uuid::Uuid::new_v4().to_string();
    let station = Arc::new(Station {
        id: id.clone(),
        progress_store: Some(store),
        book_progress: Mutex::new(VecDeque::new()),
        origin: node.origin,
        name: request.name.trim().into(),
        alive: AtomicBool::new(true),
        epoch: AtomicU64::new(1),
        skip: AtomicU64::new(0),
        subscribers: Mutex::new(HashMap::new()),
        sink: sink.as_ref().map(|s| s.0.clone()),
        child: Mutex::new(None),
        blocked: Mutex::new(HashSet::new()),
        started: AtomicU64::new(0),
        tracks: Mutex::new(VecDeque::new()),
        video_root: tempfile::tempdir().map_err(|e| e.to_string())?,
        lookahead: if items.iter().any(|i| i.kind == "movie" || i.kind == "tv") {
            super::video::LOOKAHEAD
        } else {
            BUFFER_US
        },
        view: Mutex::new(StationView {
            id,
            name: request.name.trim().into(),
            active: true,
            mode: request.mode.clone(),
            minutes: request.minutes,
            finish_track: request.finish_track,
            play_here: request.play_here,
            output: sink.map(|s| s.1).unwrap_or_default(),
            ..Default::default()
        }),
    });
    if items.iter().any(|item| item.kind == "audiobook") {
        let progress = station.clone();
        std::thread::spawn(move || {
            while progress.alive.load(Ordering::Acquire) {
                progress.save_book_progress(progress.origin.elapsed().as_micros() as i64);
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
    let running = station.clone();
    std::thread::spawn(move || produce(node, running, request, items, ffmpeg));
    Ok(station)
}

fn shuffle(items: &mut [MediaItem]) {
    let mut seed = uuid::Uuid::new_v4().as_u128() as u64;
    for i in (1..items.len()).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        items.swap(i, (seed as usize) % (i + 1));
    }
}

fn produce(
    node: Arc<Node>,
    station: Arc<Station>,
    request: BroadcastRequest,
    mut items: Vec<MediaItem>,
    ffmpeg: PathBuf,
) {
    let _awake = super::power::Awake::new();
    let mut completed = 0;
    let mut total_frames = 0u64;
    let mut cycle_index = 0;
    let mut failures = 0;
    let mut observed_skip = 0;
    let mut base = node.now() + station.lookahead;
    station.started.store(base as u64, Ordering::Relaxed);
    if request.shuffle {
        shuffle(&mut items);
    }
    while node.alive.load(Ordering::Acquire)
        && station.alive.load(Ordering::Acquire)
        && request.can_start_track(completed, total_frames)
    {
        if cycle_index == items.len() {
            cycle_index = 0;
            if request.shuffle {
                shuffle(&mut items);
            }
        }
        let item = &items[cycle_index];
        let offset = if item.kind == "audiobook" && request.resume_books && completed < items.len()
        {
            item.resume.max(0.).min((item.duration - 0.1).max(0.))
        } else {
            0.
        };
        let mut command = hidden_command(&ffmpeg);
        if offset > 0. {
            command.args(["-ss", &offset.to_string()]);
        }
        command
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(&item.path);
        let video_key = if item.kind == "movie" || item.kind == "tv" {
            let key = uuid::Uuid::new_v4().to_string();
            super::video::prune(&station, node.now());
            let mut probe = hidden_command(&ffmpeg);
            probe
                .args(["-nostdin", "-v", "error", "-i"])
                .arg(&item.path)
                .args(["-map", "0:a:0", "-t", "0", "-f", "null", "-"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let has_audio = if let Ok(child) = probe.spawn() {
                *station.child.lock().unwrap() = Some(child);
                let started = std::time::Instant::now();
                loop {
                    if !station.alive.load(Ordering::Acquire) {
                        station.stop_child();
                        return;
                    }
                    let result = station
                        .child
                        .lock()
                        .unwrap()
                        .as_mut()
                        .and_then(|c| c.try_wait().ok().flatten());
                    if let Some(status) = result {
                        station.stop_child();
                        break status.success();
                    }
                    if started.elapsed() > Duration::from_secs(10) {
                        station.stop_child();
                        break false;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            } else {
                false
            };
            if let Err(e) = super::video::configure_encoder(
                &mut command,
                station.video_root.path(),
                &key,
                item.duration,
                has_audio,
            ) {
                station.stop(&format!("Could not prepare video: {e}"));
                return;
            }
            Some(key)
        } else {
            None
        };
        command
            .args([
                "-vn", "-sn", "-dn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let child = command.spawn();
        let mut track_frames = 0u64;
        if let Ok(mut child) = child {
            let mut stdout = child.stdout.take().unwrap();
            *station.child.lock().unwrap() = Some(child);
            let (tx, rx) = mpsc::sync_channel::<Vec<i16>>(12);
            std::thread::spawn(move || loop {
                let mut bytes = vec![0u8; FRAMES * 4];
                let mut used = 0;
                while used < bytes.len() {
                    match stdout.read(&mut bytes[used..]) {
                        Ok(0) => break,
                        Ok(n) => used += n,
                        Err(_) => break,
                    }
                }
                used -= used % 4;
                if used == 0 {
                    break;
                }
                let samples = bytes[..used]
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect();
                if tx.send(samples).is_err() {
                    break;
                }
            });
            let track = Track {
                title: item.title.chars().take(256).collect(),
                artist: item.artist.chars().take(256).collect(),
                album: item.album.chars().take(256).collect(),
                duration: (item.duration - offset).max(0.),
                start_position: offset,
                index: cycle_index,
                total: items.len(),
                kind: item.kind.clone(),
                video_key,
            };
            let at = base + (total_frames * 1_000_000 / RATE as u64) as i64;
            station.schedule_track(track.clone(), at);
            if item.kind == "audiobook" {
                station
                    .book_progress
                    .lock()
                    .unwrap()
                    .push_back(BookCheckpoint {
                        id: item.id.clone(),
                        at,
                        offset,
                        duration: item.duration,
                        end: None,
                    });
            }
            let mut empty_polls = 0;
            loop {
                if !node.alive.load(Ordering::Acquire)
                    || !station.alive.load(Ordering::Acquire)
                    || station.skip.load(Ordering::Acquire) != observed_skip
                {
                    break;
                }
                let mut samples = match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(s) => {
                        empty_polls = 0;
                        s
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        empty_polls += 1;
                        if empty_polls >= 25 {
                            break;
                        }
                        continue;
                    }
                    Err(_) => break,
                };
                if !request.finish_track {
                    if let Some(limit) = request.limit_frames() {
                        samples.truncate(
                            (limit.saturating_sub(total_frames) as usize * 2).min(samples.len()),
                        );
                    }
                }
                if samples.is_empty() {
                    break;
                }
                let at = base + (total_frames * 1_000_000 / RATE as u64) as i64;
                while station.alive.load(Ordering::Acquire)
                    && station.skip.load(Ordering::Acquire) == observed_skip
                    && node.now() + station.lookahead < at
                {
                    std::thread::sleep(Duration::from_millis(5));
                }
                if !node.alive.load(Ordering::Acquire)
                    || !station.alive.load(Ordering::Acquire)
                    || station.skip.load(Ordering::Acquire) != observed_skip
                {
                    break;
                }
                // If a decoder stalls beyond the lookahead, move every room onto
                // the same fresh timeline instead of sending already-late sound.
                let at = if at < node.now() + 100_000 {
                    base = node.now() + station.lookahead
                        - (total_frames * 1_000_000 / RATE as u64) as i64;
                    reset(&station);
                    station.schedule_track(
                        track.clone(),
                        base + ((total_frames - track_frames) * 1_000_000 / RATE as u64) as i64,
                    );
                    if item.kind == "audiobook" {
                        station
                            .book_progress
                            .lock()
                            .unwrap()
                            .push_back(BookCheckpoint {
                                id: item.id.clone(),
                                at: base
                                    + ((total_frames - track_frames) * 1_000_000 / RATE as u64)
                                        as i64,
                                offset,
                                duration: item.duration,
                                end: None,
                            });
                    }
                    base + (total_frames * 1_000_000 / RATE as u64) as i64
                } else {
                    at
                };
                let frames = (samples.len() / 2) as u64;
                let chunk = Arc::new(Chunk {
                    epoch: station.epoch.load(Ordering::Relaxed),
                    at,
                    samples: Arc::new(samples),
                });
                if let Some(sink) = &station.sink {
                    sink.push(chunk.clone());
                }
                station.emit(Packet::Audio(chunk));
                total_frames += frames;
                track_frames += frames;
            }
            if item.kind == "audiobook" {
                if let Some(book) = station.book_progress.lock().unwrap().back_mut() {
                    book.end = Some(book.at + (track_frames * 1_000_000 / RATE as u64) as i64);
                }
            }
            station.stop_child();
        }
        if track_frames == 0 {
            failures += 1;
            let mut view = station.view.lock().unwrap();
            view.skipped += 1;
            view.message = format!("Skipped unavailable track: {}", item.title);
        } else {
            failures = 0;
        }
        if failures >= items.len() {
            station.stop("No selected tracks could be played. Check your library folders.");
            node.advertise();
            return;
        }
        let skip = station.skip.load(Ordering::Acquire);
        if skip != observed_skip {
            observed_skip = skip;
            reset(&station);
            base = node.now() + station.lookahead - (total_frames * 1_000_000 / RATE as u64) as i64;
        }
        completed += 1;
        cycle_index += 1;
    }
    let end = base + (total_frames * 1_000_000 / RATE as u64) as i64;
    while node.alive.load(Ordering::Acquire)
        && station.alive.load(Ordering::Acquire)
        && node.now() < end + 50_000
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    if station.alive.load(Ordering::Acquire) {
        station.stop("Broadcast finished");
        node.advertise();
    }
}
fn reset(station: &Station) {
    station.save_book_progress(station.origin.elapsed().as_micros() as i64);
    station.book_progress.lock().unwrap().clear();
    station.tracks.lock().unwrap().clear();
    let epoch = station.epoch.fetch_add(1, Ordering::AcqRel) + 1;
    if let Some(sink) = &station.sink {
        sink.reset(epoch);
    }
    station.emit(Packet::Control(Control::Reset { epoch }));
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(mode: &str) -> BroadcastRequest {
        BroadcastRequest {
            name: "Kitchen radio".into(),
            item_ids: vec!["a".into(), "b".into()],
            mode: mode.into(),
            minutes: 1,
            finish_track: true,
            resume_books: false,
            shuffle: false,
            play_here: false,
            output_device: None,
        }
    }
    #[test]
    fn run_policy_distinguishes_once_repeat_and_timed_loops() {
        assert!(!request("once").can_start_track(2, 100));
        assert!(request("repeat").can_start_track(2000, 10_000_000));
        assert!(request("duration").can_start_track(4, 59 * RATE as u64));
        assert!(!request("duration").can_start_track(4, 60 * RATE as u64));
        assert!(request("duration").validate().is_ok());
        let mut invalid = request("duration");
        invalid.minutes = 0;
        assert!(invalid.validate().is_err());
    }
}
