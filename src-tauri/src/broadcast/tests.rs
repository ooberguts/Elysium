use super::*;
use protocol::{read_packet, write_packet, Chunk, FRAMES, RATE};
use std::{collections::HashSet, sync::atomic::AtomicU64};

fn node() -> Arc<Node> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let proxy = TcpListener::bind("127.0.0.1:0").unwrap();
    proxy.set_nonblocking(true).unwrap();
    let node = Arc::new(Node {
        id: uuid::Uuid::new_v4().to_string(),
        name: Mutex::new("Test room".into()),
        origin: Instant::now(),
        alive: AtomicBool::new(true),
        port: listener.local_addr().unwrap().port(),
        proxy_port: proxy.local_addr().unwrap().port(),
        proxy_token: uuid::Uuid::new_v4().to_string(),
        video_connections: AtomicUsize::new(0),
        app: None,
        mdns: None,
        peers: Mutex::new(HashMap::new()),
        station: Mutex::new(None),
        client: Mutex::new(None),
        invitations: Mutex::new(Vec::new()),
        allow_requests: AtomicBool::new(false),
        media_busy: AtomicBool::new(false),
        output_device: Mutex::new(None),
        volume: AtomicU32::new(0.75f32.to_bits()),
        delay_ms: AtomicI64::new(0),
        connections: AtomicUsize::new(0),
        message: Mutex::new(String::new()),
        operation: Mutex::new(()),
    });
    network::serve(node.clone(), listener);
    video::serve_proxy(node.clone(), proxy);
    node
}
struct Cleanup(Arc<Node>);
impl Drop for Cleanup {
    fn drop(&mut self) {
        self.0.shutdown();
    }
}
fn fake_station(node: &Node) -> Arc<Station> {
    let station = Arc::new(Station {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Test radio".into(),
        alive: AtomicBool::new(true),
        epoch: AtomicU64::new(1),
        skip: AtomicU64::new(0),
        transport: Mutex::new(station::Transport::default()),
        subscribers: Mutex::new(HashMap::new()),
        sink: None,
        blocked: Mutex::new(HashSet::new()),
        view: Mutex::new(StationView::default()),
        child: Mutex::new(None),
        started: AtomicU64::new(0),
        tracks: Mutex::new(std::collections::VecDeque::new()),
        video_root: tempfile::tempdir().unwrap(),
        lookahead: std::sync::atomic::AtomicI64::new(protocol::BUFFER_US),
        progress_store: None,
        book_progress: Mutex::new(std::collections::VecDeque::new()),
        origin: node.origin,
    });
    *node.station.lock().unwrap() = Some(station.clone());
    station
}
fn socket(node: &Node) -> TcpStream {
    let socket = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, node.port)).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    socket
}
fn hello(node: &Node, id: &str, version: u32) -> TcpStream {
    let mut socket = socket(node);
    write_packet(
        &mut socket,
        &Packet::Control(Control::Hello {
            version,
            id: id.into(),
            name: "Living room".into(),
            station: String::new(),
        }),
    )
    .unwrap();
    socket
}
fn wait_for(mut condition: impl FnMut() -> bool) {
    let start = Instant::now();
    while !condition() {
        assert!(start.elapsed() < Duration::from_secs(3), "timed out");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn headless_listener(host: &Arc<Node>) -> Arc<Node> {
    let receiver = node();
    let mut socket = hello(host, &uuid::Uuid::new_v4().to_string(), 1);
    let Packet::Control(Control::Welcome {
        station,
        name,
        epoch,
        ..
    }) = read_packet(&mut socket).unwrap()
    else {
        panic!("expected welcome")
    };
    let sink = Sink::new(receiver.origin, false, 0.75, 0);
    sink.reset(epoch);
    let address = format!("127.0.0.1:{}", host.port);
    let client = Arc::new(Client {
        address: address.clone(),
        station: station.clone(),
        track_at: AtomicI64::new(0),
        alive: AtomicBool::new(true),
        sink,
        socket: Mutex::new(Some(socket.try_clone().unwrap())),
        view: Mutex::new(ListeningView {
            active: true,
            name,
            phase: "buffering".into(),
            ..Default::default()
        }),
    });
    *receiver.client.lock().unwrap() = Some(client.clone());
    let worker = receiver.clone();
    std::thread::spawn(move || {
        network::listen(
            worker,
            client,
            JoinRequest {
                address,
                station,
                output_device: None,
            },
            socket,
        )
    });
    receiver
}

#[test]
fn seeking_moves_all_rooms_and_preserves_pause() {
    let temp = tempfile::tempdir().unwrap();
    let resources = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let store = Arc::new(
        Store::new(
            temp.path().join("library"),
            resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        )
        .unwrap(),
    );
    let first =
        crate::media::read_media(&store, &resources.join("demo/01 - Glass Horizon.mp3"), None)
            .unwrap();
    let host = node();
    let _host = Cleanup(host.clone());
    let station = station::launch(
        host.clone(),
        station::BroadcastRequest {
            name: "Seek test".into(),
            item_ids: vec![first.id.clone()],
            mode: "repeat".into(),
            minutes: 1,
            finish_track: true,
            resume_books: false,
            start_position: None,
            shuffle: false,
            play_here: false,
            output_device: None,
        },
        vec![first],
        store,
    )
    .unwrap();
    *host.station.lock().unwrap() = Some(station.clone());
    let a = headless_listener(&host);
    let _a = Cleanup(a.clone());
    let b = headless_listener(&host);
    let _b = Cleanup(b.clone());
    wait_for(|| {
        a.snapshot()
            .listening
            .is_some_and(|view| view.phase == "playing")
    });
    assert!(station.seek(f64::NAN).is_err());
    assert!(station.seek(-1.).is_err());
    station.seek(5.).unwrap();
    wait_for(|| {
        [a.snapshot(), b.snapshot()].into_iter().all(|snapshot| {
            snapshot.listening.is_some_and(|view| {
                view.track
                    .is_some_and(|track| (track.start_position - 5.).abs() < 0.01)
            })
        })
    });
    assert_eq!(station.subscribers.lock().unwrap().len(), 2);
    station.pause(true).unwrap();
    station.seek(8.).unwrap();
    wait_for(|| {
        [a.snapshot(), b.snapshot()].into_iter().all(|snapshot| {
            snapshot.listening.is_some_and(|view| {
                view.phase == "paused"
                    && view
                        .track
                        .is_some_and(|track| (track.start_position - 8.).abs() < 0.01)
            })
        })
    });
    let frozen = station.snapshot(host.now());
    assert!(frozen.paused);
    assert!((frozen.track.unwrap().start_position - 8.).abs() < 0.01);
    station.pause(false).unwrap();
    wait_for(|| {
        a.snapshot().listening.is_some_and(|view| {
            view.phase == "playing"
                && view
                    .track
                    .is_some_and(|track| (track.start_position - 8.).abs() < 0.01)
        })
    });
    assert!(station.alive.load(Ordering::Acquire));
}

#[test]
fn replacing_queue_keeps_connected_rooms_and_resumes_a_paused_station() {
    let temp = tempfile::tempdir().unwrap();
    let resources = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let store = Arc::new(
        Store::new(
            temp.path().join("library"),
            resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        )
        .unwrap(),
    );
    let first =
        crate::media::read_media(&store, &resources.join("demo/01 - Glass Horizon.mp3"), None)
            .unwrap();
    let second = crate::media::read_media(
        &store,
        &resources.join("demo/02 - After the Rain.mp3"),
        None,
    )
    .unwrap();
    let host = node();
    let _host = Cleanup(host.clone());
    let station = station::launch(
        host.clone(),
        station::BroadcastRequest {
            name: "Queue switch".into(),
            item_ids: vec![first.id.clone()],
            mode: "once".into(),
            minutes: 1,
            finish_track: true,
            resume_books: false,
            start_position: None,
            shuffle: false,
            play_here: false,
            output_device: None,
        },
        vec![first],
        store,
    )
    .unwrap();
    *host.station.lock().unwrap() = Some(station.clone());
    let receiver = headless_listener(&host);
    let _receiver = Cleanup(receiver.clone());
    wait_for(|| {
        receiver
            .snapshot()
            .listening
            .is_some_and(|view| view.phase == "playing")
    });
    station.pause(true).unwrap();
    wait_for(|| {
        receiver
            .snapshot()
            .listening
            .is_some_and(|view| view.phase == "paused")
    });
    let station_id = station.id.clone();
    station.replace_queue(vec![second.clone()]).unwrap();
    wait_for(|| {
        receiver.snapshot().listening.is_some_and(|view| {
            view.phase == "playing" && view.track.is_some_and(|track| track.title == second.title)
        })
    });
    assert_eq!(
        host.station.lock().unwrap().as_ref().unwrap().id,
        station_id
    );
    assert!(station.alive.load(Ordering::Acquire));
    assert_eq!(station.subscribers.lock().unwrap().len(), 1);
}

#[test]
fn host_transport_pauses_every_room_resumes_at_the_same_position_and_navigates_tracks() {
    let temp = tempfile::tempdir().unwrap();
    let resources = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let store = Arc::new(
        Store::new(
            temp.path().join("library"),
            resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        )
        .unwrap(),
    );
    let mut first =
        crate::media::read_media(&store, &resources.join("demo/01 - Glass Horizon.mp3"), None)
            .unwrap();
    // Include audiobook checkpoints to make sure a pause does not save decoded
    // lookahead or advance listening progress while the station is frozen.
    first.kind = "audiobook".into();
    store.save_item(&first).unwrap();
    let second = crate::media::read_media(
        &store,
        &resources.join("demo/02 - After the Rain.mp3"),
        None,
    )
    .unwrap();
    let host = node();
    let _host = Cleanup(host.clone());
    let station = station::launch(
        host.clone(),
        station::BroadcastRequest {
            name: "Transport test".into(),
            item_ids: vec![first.id.clone(), second.id.clone()],
            mode: "once".into(),
            minutes: 1,
            finish_track: true,
            resume_books: false,
            start_position: None,
            shuffle: false,
            play_here: false,
            output_device: None,
        },
        vec![first.clone(), second],
        store.clone(),
    )
    .unwrap();
    *host.station.lock().unwrap() = Some(station.clone());
    let a = headless_listener(&host);
    let _a = Cleanup(a.clone());
    let b = headless_listener(&host);
    let _b = Cleanup(b.clone());
    wait_for(|| {
        a.snapshot().listening.unwrap().phase == "playing"
            && b.snapshot().listening.unwrap().phase == "playing"
    });
    std::thread::sleep(Duration::from_millis(150));
    station.pause(true).unwrap();
    wait_for(|| {
        a.snapshot().listening.unwrap().phase == "paused"
            && b.snapshot().listening.unwrap().phase == "paused"
    });
    let frozen = station.snapshot(host.now());
    assert!(frozen.paused);
    let paused_a = a.snapshot().listening.unwrap().position;
    let paused_b = b.snapshot().listening.unwrap().position;
    assert!((paused_a - frozen.position).abs() < 0.001);
    assert!((paused_b - frozen.position).abs() < 0.001);
    let saved = store.item(&first.id).unwrap().resume;
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(station.snapshot(host.now()).position, frozen.position);
    assert_eq!(a.snapshot().listening.unwrap().position, paused_a);
    assert_eq!(store.item(&first.id).unwrap().resume, saved);
    // Joining a paused station must also receive its frozen metadata.
    let c = headless_listener(&host);
    let _c = Cleanup(c.clone());
    wait_for(|| c.snapshot().listening.unwrap().phase == "paused");
    station.pause(false).unwrap();
    wait_for(|| a.snapshot().listening.unwrap().phase == "playing");
    let resumed = station.snapshot(host.now());
    assert!(!resumed.paused);
    assert!((resumed.track.unwrap().start_position - frozen.position).abs() < 0.05);
    station.navigate(1).unwrap();
    wait_for(|| {
        station
            .snapshot(host.now())
            .track
            .is_some_and(|track| track.index == 1)
    });
    station.navigate(-1).unwrap();
    wait_for(|| {
        station
            .snapshot(host.now())
            .track
            .is_some_and(|track| track.index == 0)
    });
    station.pause(true).unwrap();
    station.stop("Stopped while paused");
    assert!(!station.alive.load(Ordering::Acquire));
    assert!(station.child.lock().unwrap().is_none());
}
#[test]
fn tcp_fanout_preserves_audio_clock_and_disconnect_policy() {
    let node = node();
    let _cleanup = Cleanup(node.clone());
    let station = fake_station(&node);
    let id = uuid::Uuid::new_v4().to_string();
    let mut a = hello(&node, &id, 1);
    let mut b = hello(&node, &uuid::Uuid::new_v4().to_string(), 1);
    for s in [&mut a, &mut b] {
        assert!(matches!(
            read_packet(s).unwrap(),
            Packet::Control(Control::Welcome { .. })
        ));
    }
    wait_for(|| station.subscribers.lock().unwrap().len() == 2);
    let at = node.now() + protocol::BUFFER_US;
    station.emit(Packet::Audio(Arc::new(Chunk {
        epoch: 1,
        at,
        samples: Arc::new(vec![12000; FRAMES * 2]),
    })));
    let mut timelines = [timing::Timeline::default(), timing::Timeline::default()];
    for (index, s) in [&mut a, &mut b].into_iter().enumerate() {
        let Packet::Audio(chunk) = read_packet(s).unwrap() else {
            panic!("expected PCM")
        };
        assert_eq!(chunk.at, at);
        assert_eq!(chunk.samples.len(), FRAMES * 2);
        timelines[index].push(chunk, node.now());
    }
    assert_eq!(
        timelines[0].sample(at as f64 + 333.),
        timelines[1].sample(at as f64 + 333.)
    );
    write_packet(&mut b, &Packet::Control(Control::Ping { sent: 42 })).unwrap();
    assert!(
        matches!(read_packet(&mut b).unwrap(),Packet::Control(Control::Pong{sent:42,received,replied}) if replied>=received)
    );
    let connection = station
        .subscribers
        .lock()
        .unwrap()
        .iter()
        .find(|(_, s)| s.view.device_id == id)
        .unwrap()
        .0
        .clone();
    station.remove(&connection);
    let mut retry = hello(&node, &id, 1);
    assert!(
        matches!(read_packet(&mut retry).unwrap(),Packet::Control(Control::Error{message}) if message.contains("disconnected"))
    );
    station.stop("Test complete");
    assert!(matches!(
        read_packet(&mut b).unwrap(),
        Packet::Control(Control::End { .. })
    ));
}
#[test]
fn invitations_require_consent_and_busy_rooms_are_not_interrupted() {
    let node = node();
    let _cleanup = Cleanup(node.clone());
    let invite = Control::Invite {
        station: uuid::Uuid::new_v4().to_string(),
        name: "House radio".into(),
        port: 12345,
    };
    let mut s = socket(&node);
    write_packet(&mut s, &Packet::Control(invite.clone())).unwrap();
    assert!(
        matches!(read_packet(&mut s).unwrap(),Packet::Control(Control::InviteReply{status}) if status=="invitation sent")
    );
    assert_eq!(node.snapshot().invitations.len(), 1);
    assert!(node.client.lock().unwrap().is_none());
    node.media_busy.store(true, Ordering::Release);
    node.allow_requests.store(true, Ordering::Release);
    let mut s = socket(&node);
    write_packet(&mut s, &Packet::Control(invite)).unwrap();
    assert!(
        matches!(read_packet(&mut s).unwrap(),Packet::Control(Control::InviteReply{status}) if status=="busy")
    );
    assert!(node.client.lock().unwrap().is_none());
    let mut old = hello(&node, &uuid::Uuid::new_v4().to_string(), 99);
    assert!(matches!(
        read_packet(&mut old).unwrap(),
        Packet::Control(Control::Error { .. })
    ));
    assert!(address("8.8.8.8:5000").is_err());
    assert!(address("127.0.0.1:0").is_err());
    assert!(address("192.168.1.9:5000").is_ok());
}

#[test]
fn decoded_music_reaches_two_tcp_rooms_and_once_mode_ends() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("radio.wav");
    let frames = RATE * 2;
    let mut wav = Vec::new();
    wav.extend(b"RIFF");
    wav.extend((36 + frames * 4).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(RATE.to_le_bytes());
    wav.extend((RATE * 4).to_le_bytes());
    wav.extend(4u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend((frames * 4).to_le_bytes());
    for i in 0..frames {
        let v = ((i as f64 * 440. * std::f64::consts::TAU / RATE as f64).sin() * 12000.) as i16;
        wav.extend(v.to_le_bytes());
        wav.extend((-v).to_le_bytes());
    }
    std::fs::write(&path, wav).unwrap();
    let ffmpeg = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "resources/bin/ffmpeg{}",
        std::env::consts::EXE_SUFFIX
    ));
    assert!(
        ffmpeg.is_file(),
        "Run npm run prepare:media before native integration tests"
    );
    let store = Store::new(temp.path().join("library"), ffmpeg.clone()).unwrap();
    let item = crate::media::read_media(&store, &path, None).unwrap();
    let node = node();
    let _cleanup = Cleanup(node.clone());
    let request = station::BroadcastRequest {
        name: "Decoded radio".into(),
        item_ids: vec![item.id.clone()],
        mode: "once".into(),
        minutes: 1,
        finish_track: true,
        resume_books: false,
        start_position: None,
        shuffle: false,
        play_here: false,
        output_device: None,
    };
    let station = station::launch(node.clone(), request, vec![item], Arc::new(store)).unwrap();
    *node.station.lock().unwrap() = Some(station.clone());
    let collect = |mut socket: TcpStream| {
        std::thread::spawn(move || {
            let mut chunks = HashMap::new();
            let mut track = false;
            loop {
                match read_packet(&mut socket).unwrap() {
                    Packet::Audio(c) => {
                        chunks.insert(c.at, c.samples.clone());
                    }
                    Packet::Control(Control::NowPlaying { .. }) => track = true,
                    Packet::Control(Control::End { .. }) => break,
                    _ => {}
                }
            }
            assert!(track);
            chunks
        })
    };
    let a = collect(hello(&node, &uuid::Uuid::new_v4().to_string(), 1));
    let b = collect(hello(&node, &uuid::Uuid::new_v4().to_string(), 1));
    let a = a.join().unwrap();
    let b = b.join().unwrap();
    let shared: Vec<_> = a
        .iter()
        .filter_map(|(at, s)| b.get(at).map(|other| (s, other)))
        .collect();
    assert!(shared.len() > 40, "Both rooms receive the decoded stream");
    assert!(shared.iter().all(|(a, b)| a == b));
    assert!(shared
        .iter()
        .any(|(samples, _)| samples.iter().any(|s| *s != 0)));
    assert!(!station.alive.load(Ordering::Acquire));
    assert!(station.child.lock().unwrap().is_none());
}

#[test]
fn video_proxy_relays_only_active_assets_and_pause_keeps_live_clock() {
    use std::io::{Read, Write};
    let host = node();
    let _host = Cleanup(host.clone());
    let receiver = node();
    let _receiver = Cleanup(receiver.clone());
    let station = fake_station(&host);
    let key = uuid::Uuid::new_v4().to_string();
    let folder = station.video_root.path().join(&key);
    std::fs::create_dir(&folder).unwrap();
    let manifest = b"#EXTM3U\n#EXT-X-VERSION:7\n";
    std::fs::write(folder.join("master.m3u8"), manifest).unwrap();
    let sink = Sink::new(receiver.origin, true, 0.75, 0);
    let client = Arc::new(Client {
        address: format!("127.0.0.1:{}", host.port),
        station: station.id.clone(),
        track_at: AtomicI64::new(-10_000_000),
        alive: AtomicBool::new(true),
        sink: sink.clone(),
        socket: Mutex::new(None),
        view: Mutex::new(ListeningView {
            active: true,
            phase: "playing".into(),
            track: Some(protocol::Track {
                title: "Video".into(),
                artist: String::new(),
                album: String::new(),
                duration: 120.,
                start_position: 0.,
                index: 0,
                total: 1,
                kind: "movie".into(),
                video_key: Some(key.clone()),
            }),
            ..Default::default()
        }),
    });
    *receiver.client.lock().unwrap() = Some(client.clone());
    let get = |path: &str, origin: &str| {
        let mut socket =
            TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, receiver.proxy_port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
        write!(
            socket,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nOrigin: {origin}\r\n\r\n"
        )
        .unwrap();
        let mut data = String::new();
        socket.read_to_string(&mut data).unwrap();
        data
    };
    let path = format!("/{}/{key}/master.m3u8", receiver.proxy_token);
    let response = get(&path, "tauri://localhost");
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.ends_with(std::str::from_utf8(manifest).unwrap()));
    assert!(get(&path, "https://untrusted.example").starts_with("HTTP/1.1 404"));
    assert!(get(
        &path.replace(&receiver.proxy_token, "wrong-token"),
        "tauri://localhost"
    )
    .starts_with("HTTP/1.1 404"));
    assert!(get(
        &format!("/{}/{key}/../library.sqlite3", receiver.proxy_token),
        "tauri://localhost"
    )
    .starts_with("HTTP/1.1 404"));
    let before = receiver.snapshot().video.unwrap().position;
    sink.paused.store(true, Ordering::Release);
    std::thread::sleep(Duration::from_millis(30));
    let paused = receiver.snapshot();
    assert!(paused.paused);
    assert!(!paused.video.as_ref().unwrap().playing);
    assert!(
        paused.video.unwrap().position > before,
        "Pausing a room must not stop the broadcast clock"
    );
    sink.paused.store(false, Ordering::Release);
    let resumed = receiver.snapshot().video.unwrap();
    assert!(resumed.playing);
    assert!(resumed.position > before);
    station.stop("finished");
    assert!(get(&path, "tauri://localhost").starts_with("HTTP/1.1 404"));
}

#[test]
fn audiobook_broadcast_seeks_and_saves_the_presented_position() {
    let temp = tempfile::tempdir().unwrap();
    let resources = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let store = Arc::new(
        Store::new(
            temp.path().join("library"),
            resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX)),
        )
        .unwrap(),
    );
    let mut book =
        crate::media::read_media(&store, &resources.join("demo/01 - Glass Horizon.mp3"), None)
            .unwrap();
    book.kind = "audiobook".into();
    book.resume = 5.25;
    store.save_item(&book).unwrap();
    let host = node();
    let _host = Cleanup(host.clone());
    let request = station::BroadcastRequest {
        name: "Storytime".into(),
        item_ids: vec![book.id.clone()],
        mode: "once".into(),
        minutes: 1,
        finish_track: true,
        resume_books: true,
        start_position: None,
        shuffle: false,
        play_here: false,
        output_device: None,
    };
    let station =
        station::launch(host.clone(), request, vec![book.clone()], store.clone()).unwrap();
    *host.station.lock().unwrap() = Some(station.clone());
    let mut receiver = hello(&host, &uuid::Uuid::new_v4().to_string(), 1);
    let mut metadata = None;
    while metadata.is_none() {
        match read_packet(&mut receiver).unwrap() {
            Packet::Control(Control::NowPlaying { track, at, .. }) => metadata = Some((track, at)),
            _ => {}
        }
    }
    let (track, at) = metadata.unwrap();
    assert_eq!(track.kind, "audiobook");
    assert_eq!(track.start_position, 5.25);
    assert!((track.duration - (book.duration - 5.25)).abs() < 0.01);
    // Let the *presentation* clock pass the resume point; decoding runs ahead.
    while host.now() < at + 1_000_000 {
        std::thread::sleep(Duration::from_millis(10));
    }
    station.stop("Stopped by reader");
    let saved = store.item(&book.id).unwrap();
    assert!(
        saved.resume >= 6.2 && saved.resume < 6.8,
        "Saved {}, expected the presented point, not decoded lookahead",
        saved.resume
    );
    assert!(!saved.watched);
    assert!(saved.progress_updated_at > 0);
}
