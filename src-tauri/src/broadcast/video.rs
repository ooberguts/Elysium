//! Bounded, adaptive video alongside the timestamped native audio stream.
//! Only generated HLS assets from the active station are exposed. A random
//! loopback URL lets each WebView use MSE without opening arbitrary LAN URLs.
use super::*;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
pub const LOOKAHEAD: i64 = 6_000_000;
const MAX_ASSET: usize = 4 * 1024 * 1024;

pub fn prune(station: &Station, now: i64) {
    let retained: Vec<_> = station
        .scheduled_tracks(now - 1_000_000)
        .into_iter()
        .filter_map(|(track, _)| track.video_key)
        .collect();
    if let Ok(entries) = std::fs::read_dir(station.video_root.path()) {
        for entry in entries.flatten() {
            let key = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&key).is_ok() && !retained.contains(&key) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoView {
    pub url: String,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
}

pub fn asset_path(root: &Path, key: &str, file: &str) -> Option<PathBuf> {
    uuid::Uuid::parse_str(key).ok()?;
    let parts: Vec<_> = file.split('/').collect();
    let valid = file == "master.m3u8"
        || (parts.len() == 2
            && ["v0", "v1", "v2"].contains(&parts[0])
            && (parts[1] == "index.m3u8"
                || ["init_0.mp4", "init_1.mp4", "init_2.mp4"].contains(&parts[1])
                || (parts[1].starts_with("seg")
                    && parts[1].ends_with(".m4s")
                    && parts[1].len() == 15
                    && parts[1][3..11].bytes().all(|b| b.is_ascii_digit()))));
    valid.then(|| root.join(key).join(file))
}
pub fn read_asset(station: &Station, key: &str, file: &str) -> Result<Vec<u8>, String> {
    if !station.alive.load(Ordering::Acquire) {
        return Err("Broadcast ended".into());
    }
    let path = asset_path(station.video_root.path(), key, file).ok_or("Invalid video asset")?;
    let file = std::fs::File::open(path).map_err(|_| "Video is still buffering")?;
    let mut bytes = Vec::new();
    file.take(MAX_ASSET as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_ASSET {
        return Err("Video segment exceeds the size limit".into());
    }
    Ok(bytes)
}
pub fn serve_asset(
    node: &Node,
    socket: &mut TcpStream,
    station_id: &str,
    key: &str,
    file: &str,
) -> std::io::Result<()> {
    let station = node
        .station
        .lock()
        .unwrap()
        .clone()
        .filter(|s| s.id == station_id);
    let data = station
        .ok_or("Broadcast unavailable".into())
        .and_then(|s| read_asset(&s, key, file));
    match data {
        Ok(data) => {
            protocol::write_packet(
                socket,
                &Packet::Control(Control::VideoResponse {
                    length: data.len() as u32,
                }),
            )?;
            socket.write_all(&data)
        }
        Err(message) => {
            protocol::write_packet(socket, &Packet::Control(Control::Error { message }))
        }
    }
}
fn fetch_asset(node: &Node, key: &str, file: &str) -> Result<Vec<u8>, String> {
    if let Some(station) = node
        .station
        .lock()
        .unwrap()
        .clone()
        .filter(|s| s.alive.load(Ordering::Acquire))
    {
        return read_asset(&station, key, file);
    }
    let client = node
        .client
        .lock()
        .unwrap()
        .clone()
        .filter(|c| c.alive.load(Ordering::Acquire))
        .ok_or("No live broadcast")?;
    let mut socket = TcpStream::connect_timeout(&address(&client.address)?, Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    socket
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    protocol::write_packet(
        &mut socket,
        &Packet::Control(Control::VideoRequest {
            station: client.station.clone(),
            key: key.into(),
            file: file.into(),
        }),
    )
    .map_err(|e| e.to_string())?;
    match protocol::read_packet(&mut socket).map_err(|e| e.to_string())? {
        Packet::Control(Control::VideoResponse { length }) if length as usize <= MAX_ASSET => {
            let mut data = vec![0; length as usize];
            socket.read_exact(&mut data).map_err(|e| e.to_string())?;
            Ok(data)
        }
        Packet::Control(Control::Error { message }) => Err(message),
        _ => Err("Invalid video response".into()),
    }
}

pub fn serve_proxy(node: Arc<Node>, listener: TcpListener) {
    std::thread::spawn(move || {
        while node.alive.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((socket, remote)) if remote.ip().is_loopback() => {
                    if node.video_connections.fetch_add(1, Ordering::AcqRel) >= 8 {
                        node.video_connections.fetch_sub(1, Ordering::AcqRel);
                        continue;
                    }
                    let node = node.clone();
                    std::thread::spawn(move || {
                        let _ = proxy_request(&node, socket);
                        node.video_connections.fetch_sub(1, Ordering::AcqRel);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(_) => break,
                _ => {}
            }
        }
    });
}
fn proxy_request(node: &Node, mut socket: TcpStream) -> std::io::Result<()> {
    socket.set_nonblocking(false)?;
    socket.set_read_timeout(Some(Duration::from_secs(3)))?;
    socket.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request = Vec::new();
    let mut byte = [0u8; 1];
    while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
        socket.read_exact(&mut byte)?;
        request.push(byte[0]);
    }
    let request = String::from_utf8_lossy(&request);
    let mut lines = request.lines();
    let first = lines
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>();
    let origin = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("origin"))
        .map(|(_, v)| v.trim())
        .unwrap_or("tauri://localhost");
    let allowed = [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://127.0.0.1:1420",
    ]
    .contains(&origin);
    let prefix = format!("/{}/", node.proxy_token);
    let route = first
        .get(1)
        .and_then(|url| url.split('?').next())
        .and_then(|p| p.strip_prefix(&prefix))
        .and_then(|p| p.split_once('/'));
    let mut data = Vec::new();
    let mut status = "404 Not Found";
    let mut mime = "text/plain";
    if allowed && first.first().is_some_and(|m| *m == "GET" || *m == "HEAD") {
        if let Some((key, file)) =
            route.filter(|(key, file)| asset_path(Path::new("."), key, file).is_some())
        {
            if let Ok(bytes) = fetch_asset(node, key, file) {
                data = bytes;
                status = "200 OK";
                mime = if file.ends_with("m3u8") {
                    "application/vnd.apple.mpegurl"
                } else {
                    "video/mp4"
                };
            }
        }
    }
    if allowed && first.first() == Some(&"OPTIONS") {
        status = "204 No Content";
    }
    let cors = if allowed {
        format!("Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\n")
    } else {
        String::new()
    };
    write!(socket,"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n{cors}\r\n",data.len())?;
    if first.first() != Some(&"HEAD") {
        socket.write_all(&data)?;
    }
    Ok(())
}

pub fn configure_encoder(
    command: &mut Command,
    root: &Path,
    key: &str,
    duration: f64,
    has_audio: bool,
) -> std::io::Result<()> {
    let folder = root.join(key);
    for level in 0..3 {
        std::fs::create_dir_all(folder.join(format!("v{level}")))?;
    }
    if !has_audio {
        command.args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]);
    }
    command.args(["-filter_complex","[0:v:0]split=3[a][b][c];[a]scale=-2:'min(1080,ih)'[high];[b]scale=-2:'min(720,ih)'[mid];[c]scale=-2:'min(480,ih)'[low]",
        "-map","[high]","-map","[mid]","-map","[low]","-an","-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
        "-r","30","-g","30","-keyint_min","30","-sc_threshold","0","-force_key_frames","expr:gte(t,n_forced*1)",
        "-b:v:0","3500k","-maxrate:v:0","4500k","-bufsize:v:0","7000k",
        "-b:v:1","1800k","-maxrate:v:1","2400k","-bufsize:v:1","3600k",
        "-b:v:2","700k","-maxrate:v:2","1000k","-bufsize:v:2","1400k",
        "-t",&duration.to_string(),"-f","hls","-hls_time","1","-hls_list_size","18","-hls_delete_threshold","4",
        "-hls_flags","delete_segments+independent_segments+temp_file","-hls_segment_type","fmp4",
        "-hls_fmp4_init_filename","init_%v.mp4","-master_pl_name","master.m3u8","-var_stream_map","v:0 v:1 v:2","-hls_segment_filename"])
        .arg(folder.join("v%v/seg%08d.m4s")).arg(folder.join("v%v/index.m3u8"));
    command.args([
        "-map",
        if has_audio { "0:a:0" } else { "1:a:0" },
        "-t",
        &duration.to_string(),
    ]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::protocol::RATE;
    use super::*;
    #[test]
    fn asset_routes_cannot_read_library_or_parent_paths() {
        let key = uuid::Uuid::new_v4().to_string();
        let root = Path::new("/generated");
        for file in [
            "master.m3u8",
            "v0/index.m3u8",
            "v1/init_1.mp4",
            "v2/seg00000042.m4s",
        ] {
            assert!(asset_path(root, &key, file).is_some());
        }
        for file in [
            "../library.sqlite3",
            "v0/../../secret",
            "v3/index.m3u8",
            "v0/segxxxxxxxx.m4s",
            "v0/seg00000042.m4s/extra",
            "/etc/passwd",
        ] {
            assert!(asset_path(root, &key, file).is_none());
        }
        assert!(asset_path(root, "../outside", "master.m3u8").is_none());
    }
    #[test]
    fn encoder_produces_three_switchable_video_levels_and_stereo_audio() {
        let root = tempfile::tempdir().unwrap();
        let key = uuid::Uuid::new_v4().to_string();
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let ffmpeg = resources.join(format!("bin/ffmpeg{}", std::env::consts::EXE_SUFFIX));
        let mut cmd = crate::media::hidden_command(&ffmpeg);
        cmd.args(["-nostdin", "-v", "error", "-i"])
            .arg(resources.join("demo/The Aurora Study.mp4"));
        configure_encoder(&mut cmd, root.path(), &key, 2., true).unwrap();
        let result = cmd
            .args(["-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(
            result.stdout.len() > RATE as usize * 4,
            "Native stereo audio is produced alongside video"
        );
        let master = std::fs::read_to_string(root.path().join(&key).join("master.m3u8")).unwrap();
        assert_eq!(master.matches("#EXT-X-STREAM-INF").count(), 3);
        for level in 0..3 {
            let folder = root.path().join(&key).join(format!("v{level}"));
            let playlist = std::fs::read_to_string(folder.join("index.m3u8")).unwrap();
            assert!(playlist.contains("#EXT-X-INDEPENDENT-SEGMENTS"));
            assert!(
                folder
                    .join(format!("init_{level}.mp4"))
                    .metadata()
                    .unwrap()
                    .len()
                    > 100
            );
            let segment = std::fs::read(folder.join("seg00000000.m4s")).unwrap();
            assert!(segment.windows(4).any(|bytes| bytes == b"moof"));
        }
    }
}
