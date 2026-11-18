//! Local-network radio and synchronized room playback. Network clients receive
//! audio and metadata only; library/transport commands stay in the local app.
mod audio;
mod network;
mod power;
mod protocol;
mod station;
#[cfg(test)]
mod tests;
mod timing;
mod video;

use crate::store::{err, Store};
use audio::Sink;
use cpal::traits::{DeviceTrait, HostTrait};
use protocol::{Control, Packet, Track};
use serde::{Deserialize, Serialize};
use station::{BroadcastRequest, ListenerView, Station, StationView};
use std::{
    collections::HashMap,
    net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

const SERVICE: &str = "_elysium._tcp.local.";
#[derive(Default)]
pub struct BroadcastState {
    node: Mutex<Option<Arc<Node>>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    id: String,
    name: String,
    address: String,
    station_id: String,
    station_name: String,
    accepting: bool,
    mode: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    id: String,
    name: String,
    address: String,
    station: String,
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListeningView {
    active: bool,
    name: String,
    address: String,
    phase: String,
    track: Option<Track>,
    message: String,
    output: String,
    position: f64,
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    enabled: bool,
    id: String,
    name: String,
    addresses: Vec<String>,
    allow_requests: bool,
    volume: f32,
    delay_ms: i64,
    output_device: Option<String>,
    peers: Vec<Peer>,
    invitations: Vec<Invitation>,
    station: Option<StationView>,
    listening: Option<ListeningView>,
    listeners: Vec<ListenerView>,
    message: String,
    paused: bool,
    video: Option<video::VideoView>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    address: String,
    station: String,
    output_device: Option<String>,
}
pub(super) struct Client {
    address: String,
    station: String,
    track_at: AtomicI64,
    alive: AtomicBool,
    sink: Arc<Sink>,
    socket: Mutex<Option<TcpStream>>,
    view: Mutex<ListeningView>,
}
impl Client {
    fn stop(&self) {
        self.alive.store(false, Ordering::Release);
        self.sink.stop();
        if let Ok(slot) = self.socket.lock() {
            if let Some(s) = slot.as_ref() {
                let _ = s.shutdown(Shutdown::Both);
            }
        }
        if let Ok(mut v) = self.view.lock() {
            v.active = false;
        }
    }
}
pub(super) struct Node {
    id: String,
    name: Mutex<String>,
    origin: Instant,
    alive: AtomicBool,
    port: u16,
    proxy_port: u16,
    proxy_token: String,
    video_connections: AtomicUsize,
    app: Option<tauri::AppHandle>,
    mdns: Option<mdns_sd::ServiceDaemon>,
    peers: Mutex<HashMap<String, Peer>>,
    station: Mutex<Option<Arc<Station>>>,
    client: Mutex<Option<Arc<Client>>>,
    invitations: Mutex<Vec<(Invitation, Instant)>>,
    allow_requests: AtomicBool,
    media_busy: AtomicBool,
    output_device: Mutex<Option<String>>,
    volume: AtomicU32,
    delay_ms: AtomicI64,
    connections: AtomicUsize,
    message: Mutex<String>,
    // Serializes session replacement so two joins cannot leave an orphan output.
    operation: Mutex<()>,
}
impl Node {
    fn now(&self) -> i64 {
        self.origin.elapsed().as_micros() as i64
    }
    fn volume(&self) -> f32 {
        f32::from_bits(self.volume.load(Ordering::Relaxed))
    }
    fn advertise(&self) {
        let Some(mdns) = self.mdns.as_ref() else {
            return;
        };
        if !self.alive.load(Ordering::Acquire) {
            return;
        }
        let station = self
            .station
            .lock()
            .ok()
            .and_then(|s| s.clone())
            .filter(|s| s.alive.load(Ordering::Acquire));
        let listening = self
            .client
            .lock()
            .ok()
            .and_then(|c| c.clone())
            .is_some_and(|c| c.alive.load(Ordering::Acquire));
        let name = self.name.lock().unwrap().clone();
        let props = HashMap::from([
            ("v".into(), "1".into()),
            ("id".into(), self.id.clone()),
            ("name".into(), name),
            (
                "station".into(),
                station.as_ref().map(|s| s.id.clone()).unwrap_or_default(),
            ),
            (
                "title".into(),
                station.as_ref().map(|s| s.name.clone()).unwrap_or_default(),
            ),
            (
                "mode".into(),
                if station.is_some() {
                    "broadcasting"
                } else if listening {
                    "listening"
                } else if self.media_busy.load(Ordering::Acquire) {
                    "busy"
                } else {
                    "idle"
                }
                .into(),
            ),
            (
                "accept".into(),
                if self.allow_requests.load(Ordering::Relaxed) {
                    "1"
                } else {
                    "0"
                }
                .into(),
            ),
        ]);
        let service = mdns_sd::ServiceInfo::new(
            SERVICE,
            &self.id,
            &format!("elysium-{}.local.", self.id),
            "",
            self.port,
            props,
        );
        if let Ok(info) = service {
            if let Err(e) = mdns.register(info.enable_addr_auto()) {
                *self.message.lock().unwrap() =
                    format!("Discovery unavailable: {e}. Use a direct LAN address.");
            }
        }
    }
    fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if let Some(s) = self.station.lock().unwrap().as_ref() {
            s.stop("Broadcaster disconnected");
        }
        if let Some(c) = self.client.lock().unwrap().as_ref() {
            c.stop();
        }
        if let Some(mdns) = &self.mdns {
            let _ = mdns.unregister(&format!("{}.{}", self.id, SERVICE));
            let _ = mdns.shutdown();
        }
    }
    fn snapshot(&self) -> Snapshot {
        let station = self.station.lock().unwrap().clone();
        let listening = self.client.lock().unwrap().as_ref().map(|client| {
            let mut v = client.view.lock().unwrap().clone();
            v.active = client.alive.load(Ordering::Acquire);
            if v.phase != "paused" {
                v.position = ((client.sink.now()
                    - client.sink.delay_us.load(Ordering::Relaxed)
                    - client.track_at.load(Ordering::Relaxed))
                .max(0) as f64)
                    / 1e6;
            }
            let error = client.sink.error.lock().unwrap().clone();
            if !error.is_empty() {
                v.message = error;
                v.phase = "error".into();
                v.active = false;
            }
            v
        });
        let mut invitations = self.invitations.lock().unwrap();
        invitations.retain(|(_, created)| created.elapsed() < Duration::from_secs(60));
        let mut peers: Vec<_> = self.peers.lock().unwrap().values().cloned().collect();
        peers.sort_by(|a, b| a.name.cmp(&b.name));
        let addresses = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .iter()
            .map(|i| i.ip())
            .filter(|ip| local_ip(*ip) && !ip.is_loopback())
            .map(|ip| format!("{ip}:{}", self.port))
            .collect();
        let station_view = station.as_ref().map(|s| s.snapshot(self.now()));
        let client = self.client.lock().unwrap().clone();
        let sink = station
            .as_ref()
            .filter(|s| s.alive.load(Ordering::Acquire))
            .and_then(|s| s.sink.clone())
            .or_else(|| {
                client
                    .as_ref()
                    .filter(|c| c.alive.load(Ordering::Acquire))
                    .map(|c| c.sink.clone())
            });
        let paused = sink
            .as_ref()
            .is_some_and(|s| s.paused.load(Ordering::Acquire));
        let video = if let Some(s) = station_view.as_ref().filter(|s| s.active && s.play_here) {
            s.track.as_ref().and_then(|t| {
                t.video_key.as_ref().map(|key| {
                    (
                        key.clone(),
                        (s.position - self.delay_ms.load(Ordering::Relaxed) as f64 / 1000.).max(0.),
                        t.duration,
                        self.now()
                            >= station
                                .as_ref()
                                .unwrap()
                                .scheduled_tracks(self.now())
                                .first()
                                .map(|(_, at)| *at + self.delay_ms.load(Ordering::Relaxed) * 1000)
                                .unwrap_or(i64::MAX)
                            && !s.paused,
                    )
                })
            })
        } else {
            listening.as_ref().filter(|l| l.active).and_then(|l| {
                l.track.as_ref().and_then(|t| {
                    t.video_key.as_ref().map(|key| {
                        (
                            key.clone(),
                            l.position,
                            t.duration,
                            l.phase == "playing"
                                && client.as_ref().is_some_and(|c| {
                                    c.sink.now() - c.sink.delay_us.load(Ordering::Relaxed)
                                        >= c.track_at.load(Ordering::Relaxed)
                                }),
                        )
                    })
                })
            })
        };
        let video = video.map(|(key, position, duration, playing)| video::VideoView {
            url: format!(
                "http://127.0.0.1:{}/{}/{key}/master.m3u8",
                self.proxy_port, self.proxy_token
            ),
            position,
            duration,
            playing: playing && !paused,
        });
        Snapshot {
            enabled: true,
            paused,
            video,
            id: self.id.clone(),
            name: self.name.lock().unwrap().clone(),
            addresses,
            allow_requests: self.allow_requests.load(Ordering::Relaxed),
            volume: self.volume(),
            delay_ms: self.delay_ms.load(Ordering::Relaxed),
            output_device: self.output_device.lock().unwrap().clone(),
            peers,
            invitations: invitations.iter().map(|(i, _)| i.clone()).collect(),
            listeners: station
                .as_ref()
                .map(|s| {
                    s.subscribers
                        .lock()
                        .unwrap()
                        .values()
                        .map(|s| s.view.clone())
                        .collect()
                })
                .unwrap_or_default(),
            station: station_view,
            listening,
            message: self.message.lock().unwrap().clone(),
        }
    }
}
fn local_ip(ip: IpAddr) -> bool {
    matches!(ip,IpAddr::V4(ip) if ip.is_private()||ip.is_loopback()||ip.is_link_local())
}
fn address(value: &str) -> Result<SocketAddr, String> {
    let address: SocketAddr = value
        .trim()
        .parse()
        .map_err(|_| "Use a LAN address and port, such as 192.168.1.20:50000")?;
    if !local_ip(address.ip()) || address.port() == 0 {
        return Err("Only local IPv4 network addresses are supported".into());
    }
    Ok(address)
}
fn get_node(state: &BroadcastState) -> Result<Arc<Node>, String> {
    state
        .node
        .lock()
        .map_err(|_| "LAN state unavailable")?
        .clone()
        .ok_or("Enable LAN audio first".into())
}
impl BroadcastState {
    pub fn shutdown(&self) {
        if let Ok(mut n) = self.node.lock() {
            if let Some(node) = n.take() {
                node.shutdown();
            }
        }
    }
}
fn enable(app: tauri::AppHandle, store: Arc<Store>, name: String) -> Result<Arc<Node>, String> {
    let state = app.state::<BroadcastState>();
    let mut slot = state.node.lock().map_err(|_| "LAN state unavailable")?;
    if let Some(node) = slot.as_ref() {
        return Ok(node.clone());
    }
    let name = name.trim().chars().take(60).collect::<String>();
    if name.is_empty() {
        return Err("Name this computer or room first".into());
    }
    let settings = store.library()?.settings;
    let id = settings
        .get("lanDeviceId")
        .filter(|s| uuid::Uuid::parse_str(s).is_ok())
        .cloned()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    {
        let db = store.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('lanDeviceId',?1)",
            [&id],
        )
        .map_err(|e| e.to_string())?;
        db.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('lanRoomName',?1)",
            [&name],
        )
        .map_err(|e| e.to_string())?;
    }
    let listener =
        TcpListener::bind("0.0.0.0:0").map_err(|e| format!("Could not open LAN audio: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let proxy = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    proxy.set_nonblocking(true).map_err(|e| e.to_string())?;
    let proxy_port = proxy.local_addr().map_err(|e| e.to_string())?.port();
    let mdns = mdns_sd::ServiceDaemon::new().ok();
    let events = mdns.as_ref().and_then(|mdns| mdns.browse(SERVICE).ok());
    let discovery_error = if events.is_none() {
        "Discovery is unavailable. Join using a direct LAN address."
    } else {
        ""
    };
    let node = Arc::new(Node {
        id,
        name: Mutex::new(name),
        origin: Instant::now(),
        alive: AtomicBool::new(true),
        port,
        proxy_port,
        proxy_token: uuid::Uuid::new_v4().to_string(),
        video_connections: AtomicUsize::new(0),
        app: Some(app.clone()),
        mdns,
        peers: Mutex::new(HashMap::new()),
        station: Mutex::new(None),
        client: Mutex::new(None),
        invitations: Mutex::new(Vec::new()),
        allow_requests: AtomicBool::new(
            settings
                .get("lanAllowRequests")
                .is_some_and(|value| value == "true"),
        ),
        media_busy: AtomicBool::new(true),
        output_device: Mutex::new(
            settings
                .get("lanOutputDevice")
                .filter(|s| !s.is_empty())
                .cloned(),
        ),
        volume: AtomicU32::new(
            settings
                .get("lanVolume")
                .and_then(|s| s.parse::<f32>().ok())
                .filter(|v| v.is_finite())
                .unwrap_or(0.75)
                .clamp(0., 1.)
                .to_bits(),
        ),
        delay_ms: AtomicI64::new(
            settings
                .get("lanDelayMs")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0)
                .clamp(-500, 500),
        ),
        connections: AtomicUsize::new(0),
        message: Mutex::new(discovery_error.into()),
        operation: Mutex::new(()),
    });
    node.advertise();
    let observer = node.clone();
    std::thread::spawn(move || {
        let Some(events) = events else {
            return;
        };
        while observer.alive.load(Ordering::Acquire) {
            match events.recv_timeout(Duration::from_millis(500)) {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                    let prop = |key: &str| info.get_property_val_str(key).unwrap_or("").to_owned();
                    let id = prop("id");
                    if prop("v") != "1" || id == observer.id || uuid::Uuid::parse_str(&id).is_err()
                    {
                        continue;
                    }
                    let interfaces = if_addrs::get_if_addrs().unwrap_or_default();
                    let ip = info
                        .get_addresses_v4()
                        .into_iter()
                        .filter(|ip| local_ip(IpAddr::V4(*ip)) && !ip.is_loopback())
                        // Prefer the attached LAN over a peer's VPN/VM address.
                        .min_by_key(|ip| {
                            let same_subnet =
                                interfaces.iter().any(|interface| match &interface.addr {
                                    if_addrs::IfAddr::V4(local) => {
                                        (u32::from(*ip) & u32::from(local.netmask))
                                            == (u32::from(local.ip) & u32::from(local.netmask))
                                    }
                                    _ => false,
                                });
                            (!same_subnet, *ip)
                        });
                    if let Some(ip) = ip {
                        let peer = Peer {
                            id,
                            name: prop("name").chars().take(60).collect(),
                            address: format!("{ip}:{}", info.port),
                            station_id: prop("station"),
                            station_name: prop("title").chars().take(80).collect(),
                            accepting: prop("accept") == "1",
                            mode: prop("mode"),
                        };
                        let mut peers = observer.peers.lock().unwrap();
                        if peers.len() < 64 || peers.contains_key(&info.fullname) {
                            peers.insert(info.fullname.clone(), peer);
                        }
                    }
                }
                Ok(mdns_sd::ServiceEvent::ServiceRemoved(_, name)) => {
                    observer.peers.lock().unwrap().remove(&name);
                }
                _ => {}
            }
        }
    });
    network::serve(node.clone(), listener);
    video::serve_proxy(node.clone(), proxy);
    *slot = Some(node.clone());
    Ok(node)
}

#[tauri::command]
pub fn broadcast_status(state: tauri::State<BroadcastState>) -> Snapshot {
    state
        .node
        .lock()
        .unwrap()
        .as_ref()
        .map(|n| n.snapshot())
        .unwrap_or_default()
}
#[tauri::command]
pub async fn broadcast_enable(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<Store>>,
    name: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        enable(app, store.clone(), name)?;
        store
            .db
            .lock()
            .map_err(err)?
            .execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES('lanEnabled','true')",
                [],
            )
            .map_err(err)?;
        Ok(())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub fn broadcast_disable(
    state: tauri::State<BroadcastState>,
    store: tauri::State<Arc<Store>>,
) -> Result<(), String> {
    store
        .db
        .lock()
        .map_err(err)?
        .execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('lanEnabled','false')",
            [],
        )
        .map_err(err)?;
    state.shutdown();
    Ok(())
}
#[tauri::command]
pub fn broadcast_settings(
    state: tauri::State<BroadcastState>,
    store: tauri::State<Arc<Store>>,
    name: String,
    allow_requests: bool,
    volume: f32,
    delay_ms: i64,
    output_device: Option<String>,
) -> Result<(), String> {
    let node = get_node(&state)?;
    if name.trim().is_empty() || name.chars().count() > 60 || !volume.is_finite() {
        return Err("Invalid room settings".into());
    }
    let advertise = *node.name.lock().unwrap() != name.trim()
        || node.allow_requests.load(Ordering::Relaxed) != allow_requests;
    let output_device = output_device.filter(|s| !s.is_empty());
    if output_device.as_ref().is_some_and(|s| s.len() > 1024) {
        return Err("Invalid output device".into());
    }
    {
        let db = store.db.lock().map_err(|e| e.to_string())?;
        for (key, value) in [
            ("lanRoomName", name.trim().to_owned()),
            ("lanOutputDevice", output_device.clone().unwrap_or_default()),
            ("lanVolume", volume.clamp(0., 1.).to_string()),
            ("lanDelayMs", delay_ms.clamp(-500, 500).to_string()),
            ("lanAllowRequests", allow_requests.to_string()),
        ] {
            db.execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
                [key, &value],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    *node.output_device.lock().unwrap() = output_device;
    *node.name.lock().unwrap() = name.trim().into();
    node.allow_requests.store(allow_requests, Ordering::Relaxed);
    node.volume
        .store(volume.clamp(0., 1.).to_bits(), Ordering::Relaxed);
    node.delay_ms
        .store(delay_ms.clamp(-500, 500), Ordering::Relaxed);
    if let Some(station) = node.station.lock().unwrap().as_ref() {
        if let Some(sink) = &station.sink {
            sink.settings(volume, delay_ms);
        }
    }
    if let Some(client) = node.client.lock().unwrap().as_ref() {
        client.sink.settings(volume, delay_ms);
    }
    if advertise {
        node.advertise();
    }
    Ok(())
}
#[tauri::command]
pub async fn broadcast_start(
    state: tauri::State<'_, BroadcastState>,
    store: tauri::State<'_, Arc<Store>>,
    request: BroadcastRequest,
) -> Result<(), String> {
    let node = get_node(&state)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        request.validate()?;
        let _operation = node
            .operation
            .lock()
            .map_err(|_| "LAN session unavailable")?;
        if !node.alive.load(Ordering::Acquire) {
            return Err("LAN audio was disabled".into());
        }
        if node
            .station
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|s| s.alive.load(Ordering::Acquire))
        {
            return Err("Stop the current broadcast before starting another".into());
        }
        let items = request
            .item_ids
            .iter()
            .map(|id| {
                let item = store.item(id)?;
                if !["music", "movie", "tv", "audiobook"].contains(&item.kind.as_str()) {
                    return Err("Unsupported broadcast media".into());
                }
                Ok(item)
            })
            .collect::<Result<Vec<_>, String>>()?;
        if let Some(client) = node.client.lock().unwrap().take() {
            client.stop();
        }
        let station = station::launch(node.clone(), request, items, store.clone())?;
        {
            let mut slot = node.station.lock().unwrap();
            if !node.alive.load(Ordering::Acquire) {
                station.stop("LAN audio disabled");
                return Err("LAN audio was disabled".into());
            }
            *slot = Some(station);
        }
        node.advertise();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_replace_queue(
    state: tauri::State<'_, BroadcastState>,
    store: tauri::State<'_, Arc<Store>>,
    item_ids: Vec<String>,
) -> Result<(), String> {
    if item_ids.is_empty() || item_ids.len() > 10_000 {
        return Err("Choose between 1 and 10,000 media items".into());
    }
    let node = get_node(&state)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = node
            .operation
            .lock()
            .map_err(|_| "LAN session unavailable")?;
        let items = item_ids
            .iter()
            .map(|id| {
                let item = store.item(id)?;
                if !item.available || !std::path::Path::new(&item.path).is_file() {
                    return Err(format!(
                        "{} is unavailable. Reconnect its folder and try again.",
                        item.title
                    ));
                }
                if !["music", "movie", "tv", "audiobook"].contains(&item.kind.as_str()) {
                    return Err("Unsupported broadcast media".into());
                }
                Ok(item)
            })
            .collect::<Result<Vec<_>, String>>()?;
        let station = node
            .station
            .lock()
            .map_err(|_| "LAN session unavailable")?
            .clone()
            .ok_or("This broadcast has ended")?;
        station.replace_queue(items)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn broadcast_stop(state: tauri::State<'_, BroadcastState>) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(s) = node.station.lock().unwrap().as_ref() {
            s.stop("Broadcast stopped");
        }
        node.advertise();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_next(state: tauri::State<'_, BroadcastState>) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(s) = node.station.lock().unwrap().as_ref() {
            s.navigate(1)?;
        }
        node.advertise();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_previous(state: tauri::State<'_, BroadcastState>) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(station) = node.station.lock().unwrap().as_ref() {
            station.navigate(-1)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_seek(
    state: tauri::State<'_, BroadcastState>,
    position: f64,
) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let station = node
            .station
            .lock()
            .unwrap()
            .clone()
            .ok_or("Start a broadcast first")?;
        station.seek(position)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn broadcast_pause(
    state: tauri::State<'_, BroadcastState>,
    paused: bool,
) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let station = node
            .station
            .lock()
            .unwrap()
            .clone()
            .ok_or("Start a broadcast first")?;
        station.pause(paused)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_join(
    state: tauri::State<'_, BroadcastState>,
    request: JoinRequest,
) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || network::join(node, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn broadcast_leave(state: tauri::State<BroadcastState>) -> Result<(), String> {
    let node = get_node(&state)?;
    if let Some(client) = node.client.lock().unwrap().take() {
        client.stop();
    }
    node.advertise();
    Ok(())
}
#[tauri::command]
pub fn broadcast_remove_listener(
    state: tauri::State<BroadcastState>,
    id: String,
) -> Result<(), String> {
    let node = get_node(&state)?;
    if let Some(s) = node.station.lock().unwrap().as_ref() {
        s.remove(&id);
    }
    Ok(())
}
#[tauri::command]
pub async fn broadcast_invite(
    state: tauri::State<'_, BroadcastState>,
    peer_id: String,
) -> Result<String, String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || network::invite(node, &peer_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn broadcast_answer_invite(
    state: tauri::State<'_, BroadcastState>,
    id: String,
    accept: bool,
    output_device: Option<String>,
) -> Result<(), String> {
    let node = get_node(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let invite = {
            let mut invites = node.invitations.lock().unwrap();
            let index = invites
                .iter()
                .position(|(i, _)| i.id == id)
                .ok_or("This invitation has expired")?;
            let (invite, created) = invites.remove(index);
            if created.elapsed() > Duration::from_secs(60) {
                return Err("This invitation has expired".into());
            }
            invite
        };
        if accept {
            network::join(
                node,
                JoinRequest {
                    address: invite.address,
                    station: invite.station,
                    output_device,
                },
            )
        } else {
            Ok(())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    id: String,
    name: String,
    is_default: bool,
}
#[tauri::command]
pub async fn broadcast_outputs() -> Result<Vec<OutputDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let host = cpal::default_host();
        let default = host.default_output_device().and_then(|d| d.id().ok());
        let mut devices = Vec::new();
        for device in host.output_devices().map_err(|e| e.to_string())? {
            if let Ok(id) = device.id() {
                devices.push(OutputDevice {
                    name: device
                        .description()
                        .map(|d| d.name().into())
                        .unwrap_or_else(|_| "Audio output".into()),
                    is_default: Some(&id) == default.as_ref(),
                    id: id.to_string(),
                });
            }
        }
        Ok(devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn broadcast_activity(state: tauri::State<BroadcastState>, busy: bool) {
    if let Ok(node) = get_node(&state) {
        if node.media_busy.swap(busy, Ordering::AcqRel) != busy {
            node.advertise();
        }
    }
}

#[tauri::command]
pub fn broadcast_pause_room(
    state: tauri::State<BroadcastState>,
    paused: bool,
) -> Result<(), String> {
    let node = get_node(&state)?;
    if let Some(station) = node.station.lock().unwrap().as_ref() {
        if let Some(sink) = &station.sink {
            sink.paused.store(paused, Ordering::Release);
        }
    }
    if let Some(client) = node.client.lock().unwrap().as_ref() {
        client.sink.paused.store(paused, Ordering::Release);
    }
    Ok(())
}
