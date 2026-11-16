mod broadcast;
mod capture;
mod commands;
mod media;
mod metadata;
mod models;
mod ratings;
mod remote;
mod store;

use std::{path::PathBuf, sync::Arc};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let remote = remote::RemoteState::default();
    let sessions = remote.sessions.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(remote)
        .manage(capture::CaptureState::default())
        .manage(broadcast::BroadcastState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(broadcast) = window.try_state::<broadcast::BroadcastState>() {
                    broadcast.shutdown();
                }
                if let Some(capture) = window.try_state::<capture::CaptureState>() {
                    capture.stop(None);
                }
                if let Some(store) = window.try_state::<Arc<store::Store>>() {
                    store.stop_conversion();
                    store
                        .cancel_scan
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("jellyfin", move |_ctx, request, responder| {
            let sessions = sessions.clone();
            let path = request.uri().path().to_owned();
            let range = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let head = request.method() == tauri::http::Method::HEAD;
            std::thread::spawn(move || {
                responder.respond(remote::protocol_response(sessions, path, range, head))
            });
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let resource = app.path().resource_dir()?;
            let name = if cfg!(target_os = "windows") {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            };
            let bundled = resource.join("resources/bin").join(name);
            let ffmpeg = if bundled.is_file() {
                bundled
            } else {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/bin")
                    .join(name)
            };
            let store = Arc::new(
                store::Store::new(data_dir.clone(), ffmpeg).map_err(std::io::Error::other)?,
            );
            let scope = app.asset_protocol_scope();
            for folder in ["artwork", "compatible", "demo"] {
                let _ = scope.allow_directory(data_dir.join(folder), true);
            }
            if let Ok(library) = store.library() {
                for source in library.sources {
                    let _ = scope.allow_directory(source.path, true);
                }
                for item in library.items {
                    if item.source_id.is_none() {
                        let _ = scope.allow_file(item.path);
                    }
                    if let Some(art) = item.artwork {
                        let _ = scope.allow_file(art);
                    }
                }
            }
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            broadcast::broadcast_status,
            broadcast::broadcast_activity,
            broadcast::broadcast_pause_room,
            broadcast::broadcast_outputs,
            broadcast::broadcast_enable,
            broadcast::broadcast_disable,
            broadcast::broadcast_settings,
            broadcast::broadcast_start,
            broadcast::broadcast_stop,
            broadcast::broadcast_next,
            broadcast::broadcast_join,
            broadcast::broadcast_leave,
            broadcast::broadcast_remove_listener,
            broadcast::broadcast_invite,
            broadcast::broadcast_answer_invite,
            capture::list_audio_devices,
            capture::start_audio_capture,
            capture::stop_audio_capture,
            commands::get_library,
            commands::add_source,
            commands::scan_source,
            commands::cancel_scan,
            commands::import_files,
            commands::import_samples,
            commands::rebind_source,
            commands::set_favorite,
            commands::set_rating,
            commands::update_progress,
            commands::set_watched,
            commands::update_metadata,
            commands::prepare_cover,
            commands::restore_tags,
            commands::prepare_playback,
            commands::cancel_conversion,
            commands::create_playlist,
            commands::update_playlist,
            commands::delete_playlist,
            commands::save_settings,
            commands::export_library,
            commands::export_playlist,
            commands::export_nfo,
            commands::restore_library,
            commands::load_subtitle,
            commands::import_playlist,
            remote::connect_jellyfin,
            remote::disconnect_jellyfin,
            remote::remote_progress,
            remote::find_metadata
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Elysium");
}
