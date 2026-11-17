use super::*;
use protocol::{read_packet, write_packet};
use station::Subscriber;
use std::sync::mpsc;
use timing::ClockEstimate;

struct ConnectionGuard(Arc<Node>);
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.connections.fetch_sub(1, Ordering::AcqRel);
    }
}
pub(super) fn serve(node: Arc<Node>, listener: TcpListener) {
    std::thread::spawn(move || {
        while node.alive.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((socket, remote)) => {
                    if !local_ip(remote.ip()) {
                        continue;
                    }
                    if node.connections.fetch_add(1, Ordering::AcqRel) >= 32 {
                        node.connections.fetch_sub(1, Ordering::AcqRel);
                        continue;
                    }
                    let node = node.clone();
                    std::thread::spawn(move || {
                        let _guard = ConnectionGuard(node.clone());
                        let _ = accept(node, socket, remote);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(_) => break,
            }
        }
    });
}
fn configure(socket: &TcpStream) -> std::io::Result<()> {
    // Accepted sockets inherit O_NONBLOCK on macOS. Each connection has its
    // own worker and must block between packets rather than disconnect on EAGAIN.
    socket.set_nonblocking(false)?;
    socket.set_nodelay(true)?;
    socket.set_read_timeout(Some(Duration::from_secs(8)))?;
    socket.set_write_timeout(Some(Duration::from_secs(2)))
}
fn send(socket: &mut TcpStream, control: Control) -> std::io::Result<()> {
    write_packet(socket, &Packet::Control(control))
}
fn accept(node: Arc<Node>, mut socket: TcpStream, remote: SocketAddr) -> std::io::Result<()> {
    configure(&socket)?;
    match read_packet(&mut socket)? {
        Packet::Control(Control::VideoRequest { station, key, file }) => {
            super::video::serve_asset(&node, &mut socket, &station, &key, &file)
        }
        Packet::Control(Control::Invite {
            station,
            name,
            port,
        }) => {
            if port == 0 || uuid::Uuid::parse_str(&station).is_err() {
                return Ok(());
            }
            let address = SocketAddr::new(remote.ip(), port).to_string();
            let occupied = node
                .station
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|s| s.alive.load(Ordering::Acquire))
                || node
                    .client
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|c| c.alive.load(Ordering::Acquire));
            let occupied = occupied || node.media_busy.load(Ordering::Acquire);
            let status = if occupied {
                "busy".to_owned()
            } else if node.allow_requests.load(Ordering::Acquire) {
                let output_device = node.output_device.lock().unwrap().clone();
                match join_if_idle(
                    node.clone(),
                    JoinRequest {
                        address,
                        station,
                        output_device,
                    },
                    true,
                ) {
                    Ok(()) => "joined".into(),
                    Err(e) => format!("Could not join: {e}"),
                }
            } else {
                let mut invitations = node.invitations.lock().unwrap();
                invitations.retain(|(i, time)| {
                    i.address != address && time.elapsed() < Duration::from_secs(60)
                });
                if invitations.len() >= 8 {
                    "unavailable".into()
                } else {
                    invitations.push((
                        Invitation {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: name.chars().take(80).collect(),
                            address,
                            station,
                        },
                        Instant::now(),
                    ));
                    "invitation sent".into()
                }
            };
            send(&mut socket, Control::InviteReply { status })
        }
        Packet::Control(Control::Hello {
            version,
            id,
            name,
            station: requested,
        }) => {
            if version != 1 || uuid::Uuid::parse_str(&id).is_err() {
                return send(
                    &mut socket,
                    Control::Error {
                        message: "This Elysium version is not compatible".into(),
                    },
                );
            }
            let station = node
                .station
                .lock()
                .unwrap()
                .clone()
                .filter(|s| s.alive.load(Ordering::Acquire));
            let Some(station) = station else {
                return send(
                    &mut socket,
                    Control::Error {
                        message: "This station is no longer broadcasting".into(),
                    },
                );
            };
            if station.blocked.lock().unwrap().contains(&id) {
                return send(
                    &mut socket,
                    Control::Error {
                        message: "This room was disconnected by the broadcaster".into(),
                    },
                );
            }
            if !requested.is_empty() && requested != station.id {
                return send(
                    &mut socket,
                    Control::Error {
                        message: "That broadcast has ended".into(),
                    },
                );
            }
            send(
                &mut socket,
                Control::Welcome {
                    station: station.id.clone(),
                    name: station.name.clone(),
                    epoch: station.epoch.load(Ordering::Relaxed),
                    buffer_ms: (protocol::BUFFER_US / 1000) as u32,
                },
            )?;
            let connection = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = mpsc::sync_channel::<Packet>(80);
            let sub = Subscriber {
                view: ListenerView {
                    id: connection.clone(),
                    device_id: id.clone(),
                    name: name.chars().take(60).collect(),
                    address: remote.ip().to_string(),
                },
                tx: tx.clone(),
                socket: socket.try_clone()?,
            };
            {
                let mut subscribers = station.subscribers.lock().unwrap();
                subscribers.retain(|_, old| {
                    if old.view.device_id == id {
                        let _ = old.socket.shutdown(Shutdown::Both);
                        false
                    } else {
                        true
                    }
                });
                subscribers.insert(connection.clone(), sub);
            }
            let view = station.snapshot(node.now());
            for (track, at) in station.scheduled_tracks(node.now()) {
                let _ = tx.try_send(Packet::Control(Control::NowPlaying {
                    track,
                    at,
                    paused: view.paused,
                    position: view.position,
                }));
            }
            let mut writer = socket.try_clone()?;
            let writer_node = node.clone();
            let writer_station = station.clone();
            std::thread::spawn(move || {
                while writer_node.alive.load(Ordering::Acquire) {
                    let packet = match rx.recv_timeout(Duration::from_millis(250)) {
                        Ok(mut packet) => {
                            if let Packet::Control(Control::Pong { replied, .. }) = &mut packet {
                                *replied = writer_node.now();
                            }
                            packet
                        }
                        Err(mpsc::RecvTimeoutError::Timeout)
                            if writer_station.alive.load(Ordering::Acquire) =>
                        {
                            continue
                        }
                        Err(_) => {
                            let _ = send(
                                &mut writer,
                                Control::End {
                                    reason: "Broadcast ended".into(),
                                },
                            );
                            break;
                        }
                    };
                    let end = matches!(packet, Packet::Control(Control::End { .. }));
                    if write_packet(&mut writer, &packet).is_err() || end {
                        break;
                    }
                }
                let _ = writer.shutdown(Shutdown::Both);
            });
            while node.alive.load(Ordering::Acquire) {
                match read_packet(&mut socket) {
                    Ok(Packet::Control(Control::Ping { sent })) => {
                        if tx
                            .try_send(Packet::Control(Control::Pong {
                                sent,
                                received: node.now(),
                                replied: 0,
                            }))
                            .is_err()
                        {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            station.subscribers.lock().unwrap().remove(&connection);
            let _ = socket.shutdown(Shutdown::Both);
            Ok(())
        }
        _ => Ok(()),
    }
}

fn connect(
    node: &Node,
    request: &JoinRequest,
) -> Result<(TcpStream, String, u64, String), (String, bool)> {
    let address = address(&request.address).map_err(|e| (e, true))?;
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|e| (format!("Could not reach this station: {e}"), false))?;
    configure(&socket).map_err(|e| (e.to_string(), false))?;
    send(
        &mut socket,
        Control::Hello {
            version: 1,
            id: node.id.clone(),
            name: node.name.lock().unwrap().clone(),
            station: request.station.clone(),
        },
    )
    .map_err(|e| (e.to_string(), false))?;
    match read_packet(&mut socket).map_err(|e| (e.to_string(), false))? {
        Packet::Control(Control::Welcome {
            station,
            name,
            epoch,
            ..
        }) if request.station.is_empty() || request.station == station => {
            Ok((socket, name, epoch, station))
        }
        Packet::Control(Control::Error { message }) => Err((message, true)),
        _ => Err((
            "The other device did not return an Elysium broadcast".into(),
            true,
        )),
    }
}
pub(super) fn join(node: Arc<Node>, request: JoinRequest) -> Result<(), String> {
    join_if_idle(node, request, false)
}
fn join_if_idle(node: Arc<Node>, mut request: JoinRequest, idle_only: bool) -> Result<(), String> {
    let _operation = node
        .operation
        .lock()
        .map_err(|_| "LAN session unavailable")?;
    if !node.alive.load(Ordering::Acquire) {
        return Err("LAN audio was disabled".into());
    }
    if idle_only
        && (node.media_busy.load(Ordering::Acquire)
            || node
                .client
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|c| c.alive.load(Ordering::Acquire)))
    {
        return Err("This room is busy".into());
    }
    if node
        .station
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|s| s.alive.load(Ordering::Acquire))
    {
        return Err("Stop broadcasting before joining another station".into());
    }
    let (socket, name, epoch, station) = connect(&node, &request).map_err(|e| e.0)?;
    request.station = station;
    let connection = socket.try_clone().map_err(|e| e.to_string())?;
    let sink = Sink::new(
        node.origin,
        false,
        node.volume(),
        node.delay_ms.load(Ordering::Relaxed),
    );
    let output = sink.start(request.output_device.as_deref(), node.app.clone())?;
    sink.reset(epoch);
    let client = Arc::new(Client {
        address: request.address.clone(),
        station: request.station.clone(),
        track_at: AtomicI64::new(0),
        alive: AtomicBool::new(true),
        sink,
        socket: Mutex::new(Some(connection)),
        view: Mutex::new(ListeningView {
            active: true,
            name,
            address: request.address.clone(),
            phase: "buffering".into(),
            output,
            ..Default::default()
        }),
    });
    {
        let mut slot = node.client.lock().unwrap();
        if !node.alive.load(Ordering::Acquire)
            || (idle_only && node.media_busy.load(Ordering::Acquire))
        {
            client.stop();
            return Err("This room is no longer available".into());
        }
        if let Some(previous) = slot.replace(client.clone()) {
            previous.stop();
        }
    }
    node.advertise();
    let worker_node = node.clone();
    std::thread::spawn(move || listen(worker_node, client, request, socket));
    Ok(())
}
pub(super) fn listen(node: Arc<Node>, client: Arc<Client>, request: JoinRequest, first: TcpStream) {
    let _awake = super::power::Awake::new();
    let mut connection = Some(first);
    let mut reconnect_since: Option<Instant> = None;
    while node.alive.load(Ordering::Acquire)
        && client.alive.load(Ordering::Acquire)
        && client.sink.alive.load(Ordering::Acquire)
    {
        let mut socket = if let Some(socket) = connection.take() {
            socket
        } else {
            match connect(&node, &request) {
                Ok((socket, name, epoch, _)) => {
                    client.sink.reset(epoch);
                    client.view.lock().unwrap().name = name;
                    *client.socket.lock().unwrap() = socket.try_clone().ok();
                    socket
                }
                Err((message, terminal)) => {
                    client.view.lock().unwrap().message = message;
                    if terminal
                        || reconnect_since.get_or_insert_with(Instant::now).elapsed()
                            > Duration::from_secs(30)
                    {
                        break;
                    }
                    for _ in 0..20 {
                        if !client.alive.load(Ordering::Acquire) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    continue;
                }
            }
        };
        let Ok(mut pinger) = socket.try_clone() else {
            break;
        };
        let ping_alive = Arc::new(AtomicBool::new(true));
        let ping_flag = ping_alive.clone();
        let ping_node = node.clone();
        let ping_client = client.clone();
        std::thread::spawn(move || {
            let mut count = 0;
            while ping_flag.load(Ordering::Acquire) && ping_client.alive.load(Ordering::Acquire) {
                if send(
                    &mut pinger,
                    Control::Ping {
                        sent: ping_node.now(),
                    },
                )
                .is_err()
                {
                    break;
                }
                count += 1;
                let ticks = if count < 8 { 2 } else { 40 };
                for _ in 0..ticks {
                    if !ping_flag.load(Ordering::Acquire) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        });
        let mut clock = ClockEstimate::default();
        let mut pending_tracks = std::collections::VecDeque::<(Track, i64)>::new();
        let mut first_audio = None;
        let mut ended = false;
        while client.alive.load(Ordering::Acquire) && client.sink.alive.load(Ordering::Acquire) {
            match read_packet(&mut socket) {
                Ok(Packet::Control(Control::Pong {
                    sent,
                    received,
                    replied,
                })) => {
                    if let Some(offset) = clock.update(sent, received, replied, node.now()) {
                        client.sink.offset.store(offset, Ordering::Relaxed);
                        client.sink.clock_ready.store(true, Ordering::Release);
                    }
                }
                Ok(Packet::Audio(chunk)) => {
                    first_audio.get_or_insert(chunk.at);
                    client.sink.push(chunk);
                }
                Ok(Packet::Control(Control::Reset { epoch })) => {
                    client.sink.reset(epoch);
                    first_audio = None;
                    pending_tracks.clear();
                    let mut view = client.view.lock().unwrap();
                    view.track = None;
                    view.phase = "buffering".into();
                }
                Ok(Packet::Control(Control::NowPlaying {
                    track,
                    at,
                    paused,
                    position,
                })) => {
                    {
                        let mut view = client.view.lock().unwrap();
                        if paused {
                            view.track = Some(track.clone());
                            view.position = position;
                            view.phase = "paused".into();
                            reconnect_since = None;
                        }
                        if view.track.is_none() {
                            view.track = Some(track.clone());
                            client.track_at.store(at, Ordering::Relaxed);
                        }
                    }
                    if paused {
                        continue;
                    }
                    if pending_tracks.len() >= 256 {
                        pending_tracks.pop_front();
                    }
                    pending_tracks.push_back((track, at));
                }
                Ok(Packet::Control(Control::End { reason })) => {
                    let mut v = client.view.lock().unwrap();
                    v.message = reason;
                    v.phase = "ended".into();
                    ended = true;
                    break;
                }
                Ok(Packet::Control(Control::Error { message })) => {
                    client.view.lock().unwrap().message = message;
                    ended = true;
                    break;
                }
                Err(error) => {
                    client.view.lock().unwrap().message = format!("Connection lost: {error}");
                    break;
                }
                _ => break,
            }
            if client.sink.clock_ready.load(Ordering::Acquire) {
                let now = client.sink.now();
                if first_audio.is_some_and(|at| at <= now) {
                    let mut v = client.view.lock().unwrap();
                    v.phase = "playing".into();
                    v.message.clear();
                    reconnect_since = None;
                }
                while pending_tracks.front().is_some_and(|(_, at)| *at <= now) {
                    if let Some((track, at)) = pending_tracks.pop_front() {
                        client.view.lock().unwrap().track = Some(track);
                        client.track_at.store(at, Ordering::Relaxed);
                    }
                }
            }
        }
        ping_alive.store(false, Ordering::Release);
        let _ = socket.shutdown(Shutdown::Both);
        if ended {
            break;
        }
        client.sink.clock_ready.store(false, Ordering::Release);
        client.sink.reset(0);
        client.view.lock().unwrap().phase = "reconnecting".into();
        reconnect_since.get_or_insert_with(Instant::now);
    }
    client.stop();
    let mut view = client.view.lock().unwrap();
    if view.phase != "ended" {
        view.phase = "disconnected".into();
    }
    drop(view);
    node.advertise();
}
pub(super) fn invite(node: Arc<Node>, peer_id: &str) -> Result<String, String> {
    let peer = node
        .peers
        .lock()
        .unwrap()
        .values()
        .find(|p| p.id == peer_id)
        .cloned()
        .ok_or("This room is no longer available")?;
    let station = node
        .station
        .lock()
        .unwrap()
        .clone()
        .filter(|s| s.alive.load(Ordering::Acquire))
        .ok_or("Start a broadcast first")?;
    station.blocked.lock().unwrap().remove(peer_id);
    let address = address(&peer.address)?;
    let mut socket =
        TcpStream::connect_timeout(&address, Duration::from_secs(3)).map_err(|e| e.to_string())?;
    configure(&socket).map_err(|e| e.to_string())?;
    send(
        &mut socket,
        Control::Invite {
            station: station.id.clone(),
            name: station.name.clone(),
            port: node.port,
        },
    )
    .map_err(|e| e.to_string())?;
    match read_packet(&mut socket).map_err(|e| e.to_string())? {
        Packet::Control(Control::InviteReply { status }) => Ok(status),
        _ => Err("The room did not acknowledge the invitation".into()),
    }
}
