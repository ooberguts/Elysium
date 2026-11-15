use crate::{models::Match, store::err};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Session {
    pub url: String,
    pub token: String,
    pub item_ids: HashSet<String>,
    pub kinds: HashMap<String, String>,
}
pub struct RemoteState {
    pub sessions: Arc<Mutex<HashMap<String, Session>>>,
    pub lookup: tokio::sync::Mutex<Option<Instant>>,
    pub cache: Mutex<HashMap<String, Vec<Match>>>,
}
impl Default for RemoteState {
    fn default() -> Self {
        Self {
            sessions: Arc::default(),
            lookup: tokio::sync::Mutex::new(None),
            cache: Mutex::default(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLibrary {
    server_id: String,
    server_name: String,
    user_name: String,
    items: Vec<Value>,
}

pub fn checked_url(input: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(input.trim())
        .map_err(|_| "Enter a complete http:// or https:// server address".to_owned())?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "Use a server address without credentials, query parameters or fragments".into(),
        );
    }
    Ok(parsed.as_str().trim_end_matches('/').to_owned())
}

#[tauri::command]
pub async fn connect_jellyfin(
    url: String,
    username: String,
    password: String,
    state: tauri::State<'_, RemoteState>,
) -> Result<RemoteLibrary, String> {
    let url = checked_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(err)?;
    let result=client.post(format!("{url}/Users/AuthenticateByName")).header("X-Emby-Authorization","MediaBrowser Client=\"Elysium\", Device=\"Desktop\", DeviceId=\"elysium-desktop-v1\", Version=\"0.1.0\"")
        .json(&json!({"Username":username,"Pw":password})).send().await.map_err(|_|"Could not connect to this Jellyfin server".to_owned())?;
    if !result.status().is_success() {
        return Err(
            "Jellyfin sign-in failed. Check your server address and account details.".into(),
        );
    }
    let auth: Value = result
        .json()
        .await
        .map_err(|_| "Unexpected Jellyfin sign-in response".to_owned())?;
    let token = auth["AccessToken"]
        .as_str()
        .ok_or("Jellyfin returned no session token")?
        .to_owned();
    let user_id = auth["User"]["Id"]
        .as_str()
        .ok_or("Jellyfin returned no user")?
        .to_owned();
    let server_id = crate::media::digest(format!("{url}:{user_id}"))[..24].to_owned();
    let result = client
        .get(format!("{url}/Users/{user_id}/Items"))
        .header("X-Emby-Token", &token)
        .query(&[
            ("Recursive", "true"),
            ("IncludeItemTypes", "Audio,Movie,Episode"),
            (
                "Fields",
                "Overview,MediaSources,Genres,DateCreated,UserData",
            ),
            ("Limit", "5000"),
            ("SortBy", "SortName"),
        ])
        .send()
        .await
        .map_err(|_| "Could not load this Jellyfin library".to_owned())?;
    if !result.status().is_success() {
        return Err("This Jellyfin account could not read its library".into());
    }
    let body: Value = result
        .json()
        .await
        .map_err(|_| "Unexpected Jellyfin library response".to_owned())?;
    let mut items = Vec::new();
    let mut item_ids = HashSet::new();
    let mut kinds = HashMap::new();
    for remote in body["Items"]
        .as_array()
        .ok_or("Jellyfin returned no library items")?
    {
        let Some(id) = remote["Id"].as_str() else {
            continue;
        };
        if !safe_id(id) {
            continue;
        }
        item_ids.insert(id.to_owned());
        let kind = match remote["Type"].as_str().unwrap_or("") {
            "Audio" => "music",
            "Episode" => "tv",
            _ => "movie",
        };
        kinds.insert(id.to_owned(), kind.to_owned());
        let artists = remote["Artists"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let ticks = |v: &Value| v.as_f64().unwrap_or(0.0) / 10_000_000.0;
        items.push(json!({
            "id":format!("{server_id}:{id}"),"path":id,"sourceId":null,"relativePath":"","kind":kind,
            "title":remote["Name"].as_str().unwrap_or("Untitled"),"artist":artists,"album":remote["Album"].as_str().unwrap_or(""),"albumArtist":remote["AlbumArtist"].as_str().unwrap_or(""),
            "genre":remote["Genres"].as_array().and_then(|g|g.first()).and_then(Value::as_str).unwrap_or(""),"year":remote["ProductionYear"].as_u64().map(|n|n.to_string()).unwrap_or_default(),
            "track":remote["IndexNumber"].as_u64().unwrap_or(0),"disc":remote["ParentIndexNumber"].as_u64().unwrap_or(0),"duration":ticks(&remote["RunTimeTicks"]),"format":"JELLYFIN","sampleRate":0,"bitrate":0,
            "artwork":if remote["ImageTags"]["Primary"].is_string(){Some(format!("jellyfin:{server_id}/{id}/image"))}else{None},
            "favorite":remote["UserData"]["IsFavorite"].as_bool().unwrap_or(false),"rating":0,"playCount":remote["UserData"]["PlayCount"].as_u64().unwrap_or(0),"addedAt":0,"lastPlayed":0,
            "resume":ticks(&remote["UserData"]["PlaybackPositionTicks"]),"watched":remote["UserData"]["Played"].as_bool().unwrap_or(false),"available":true,
            "series":remote["SeriesName"].as_str().unwrap_or(""),"season":remote["ParentIndexNumber"].as_u64().unwrap_or(0),"episode":remote["IndexNumber"].as_u64().unwrap_or(0),
            "overview":remote["Overview"].as_str().unwrap_or(""),"overrides":{},"serverId":server_id
        }));
    }
    let user_name = auth["User"]["Name"]
        .as_str()
        .unwrap_or(&username)
        .to_owned();
    state.sessions.lock().map_err(err)?.insert(
        server_id.clone(),
        Session {
            url,
            token,
            item_ids,
            kinds,
        },
    );
    Ok(RemoteLibrary {
        server_id,
        server_name: "Jellyfin".into(),
        user_name,
        items,
    })
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[tauri::command]
pub async fn disconnect_jellyfin(
    server_id: String,
    state: tauri::State<'_, RemoteState>,
) -> Result<(), String> {
    let session = state.sessions.lock().map_err(err)?.remove(&server_id);
    if let Some(session) = session {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(err)?;
        let _ = client
            .post(format!("{}/Sessions/Logout", session.url))
            .header("X-Emby-Token", session.token)
            .send()
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_progress(
    server_id: String,
    item_id: String,
    position: f64,
    paused: bool,
    stopped: bool,
    state: tauri::State<'_, RemoteState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(err)?
        .get(&server_id)
        .cloned()
        .ok_or("Sign in to Jellyfin again")?;
    if !session.item_ids.contains(&item_id) {
        return Err("Unknown Jellyfin item".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(err)?;
    let endpoint = if stopped { "Stopped" } else { "Progress" };
    let response=client.post(format!("{}/Sessions/Playing/{endpoint}",session.url)).header("X-Emby-Token",session.token)
        .json(&json!({"ItemId":item_id,"PositionTicks":(position.max(0.0)*10_000_000.0)as u64,"IsPaused":paused,"PlayMethod":"DirectPlay","CanSeek":true})).send().await.map_err(|_|"Could not sync progress with Jellyfin".to_owned())?;
    if !response.status().is_success() {
        return Err("Jellyfin did not accept the progress update".into());
    }
    Ok(())
}

pub fn protocol_response(
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    path: String,
    range: Option<String>,
    head: bool,
) -> tauri::http::Response<Vec<u8>> {
    let fail = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap()
    };
    let decoded =
        percent_encoding::percent_decode_str(path.trim_start_matches('/')).decode_utf8_lossy();
    let parts: Vec<&str> = decoded.split('/').collect();
    if parts.len() != 3 || !safe_id(parts[1]) {
        return fail(404);
    }
    let session = match sessions.lock().ok().and_then(|m| m.get(parts[0]).cloned()) {
        Some(s) => s,
        None => return fail(401),
    };
    if !session.item_ids.contains(parts[1]) {
        return fail(404);
    }
    let image = parts[2] == "image";
    if !image && parts[2] != "stream" {
        return fail(404);
    }
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(_) => return fail(502),
    };
    let url = if image {
        format!(
            "{}/Items/{}/Images/Primary?maxWidth=640",
            session.url, parts[1]
        )
    } else if session.kinds.get(parts[1]).is_some_and(|k| k == "music") {
        format!("{}/Audio/{}/stream?static=true", session.url, parts[1])
    } else {
        format!("{}/Videos/{}/stream?static=true", session.url, parts[1])
    };
    let mut request = if head {
        client.head(url)
    } else {
        client.get(url)
    }
    .header("X-Emby-Token", &session.token);
    if !image {
        let requested = range
            .as_deref()
            .unwrap_or("bytes=0-")
            .trim_start_matches("bytes=");
        let mut split = requested.split('-');
        let start = split
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let end = split
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(start + 2_097_151)
            .min(start.saturating_add(2_097_151));
        request = request.header("Range", format!("bytes={start}-{end}"));
    }
    let response = match request.send() {
        Ok(r) => r,
        Err(_) => return fail(502),
    };
    let status = response.status().as_u16();
    if status >= 400 {
        return fail(status);
    }
    let mut builder = tauri::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header("Cache-Control", "no-store");
    for key in ["content-type", "content-range", "accept-ranges"] {
        if let Some(value) = response.headers().get(key) {
            if let Ok(v) = value.to_str() {
                builder = builder.header(key, v);
            }
        }
    }
    if head {
        return builder.body(Vec::new()).unwrap();
    }
    let mut bytes = Vec::new();
    if response.take(12_000_001).read_to_end(&mut bytes).is_err() || bytes.len() > 12_000_000 {
        return fail(502);
    }
    builder
        .header("Content-Length", bytes.len().to_string())
        .body(bytes)
        .unwrap()
}

#[derive(Deserialize)]
struct Recordings {
    recordings: Vec<Recording>,
}
#[derive(Deserialize)]
struct Recording {
    id: String,
    title: String,
    #[serde(default)]
    score: u32,
    #[serde(rename = "artist-credit", default)]
    artists: Vec<Credit>,
    #[serde(default)]
    releases: Vec<Release>,
}
#[derive(Deserialize)]
struct Credit {
    #[serde(default)]
    name: String,
    artist: Option<Value>,
}
#[derive(Deserialize)]
struct Release {
    title: String,
    date: Option<String>,
}

#[tauri::command]
pub async fn find_metadata(
    title: String,
    artist: String,
    state: tauri::State<'_, RemoteState>,
) -> Result<Vec<Match>, String> {
    let sanitize = |s: &str| {
        s.chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .take(160)
            .collect::<String>()
    };
    let query = if artist.trim().is_empty() {
        format!("recording:\"{}\"", sanitize(&title))
    } else {
        format!(
            "recording:\"{}\" AND artist:\"{}\"",
            sanitize(&title),
            sanitize(&artist)
        )
    };
    if let Some(cached) = state.cache.lock().map_err(err)?.get(&query).cloned() {
        return Ok(cached);
    }
    let mut lock = state.lookup.lock().await;
    if let Some(last) = *lock {
        let elapsed = last.elapsed();
        if elapsed < Duration::from_millis(1100) {
            tokio::time::sleep(Duration::from_millis(1100) - elapsed).await;
        }
    }
    *lock = Some(Instant::now());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Elysium/0.1.0 (https://github.com/ooberguts/Elysium)")
        .build()
        .map_err(err)?;
    let result = client
        .get("https://musicbrainz.org/ws/2/recording/")
        .query(&[("query", query.as_str()), ("fmt", "json"), ("limit", "5")])
        .send()
        .await
        .map_err(|_| {
            "MusicBrainz could not be reached. You can still edit information manually.".to_owned()
        })?;
    if !result.status().is_success() {
        return Err("MusicBrainz is busy. Please try again later.".into());
    }
    let records: Recordings = result
        .json()
        .await
        .map_err(|_| "Unexpected MusicBrainz response".to_owned())?;
    let matches: Vec<Match> = records
        .recordings
        .into_iter()
        .map(|r| Match {
            id: r.id,
            title: r.title,
            artist: r
                .artists
                .iter()
                .map(|a| {
                    if !a.name.is_empty() {
                        a.name.clone()
                    } else {
                        a.artist
                            .as_ref()
                            .and_then(|a| a["name"].as_str())
                            .unwrap_or("")
                            .to_owned()
                    }
                })
                .collect::<Vec<_>>()
                .join(", "),
            album: r
                .releases
                .first()
                .map(|r| r.title.clone())
                .unwrap_or_default(),
            year: r
                .releases
                .first()
                .and_then(|r| r.date.as_ref())
                .map(|s| s.chars().take(4).collect())
                .unwrap_or_default(),
            score: r.score,
        })
        .collect();
    state
        .cache
        .lock()
        .map_err(err)?
        .insert(query, matches.clone());
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_address_rejects_embedded_secrets_and_other_protocols() {
        assert!(checked_url("file:///etc/passwd").is_err());
        assert!(checked_url("https://user:secret@server/").is_err());
        assert_eq!(checked_url("http://nas:8096/").unwrap(), "http://nas:8096");
    }
}
