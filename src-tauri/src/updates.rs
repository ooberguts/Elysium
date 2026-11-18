use serde::Serialize;
use std::process::Command;

const REPOSITORY: &str = "https://github.com/ooberguts/Elysium";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    version: String,
    commit: &'static str,
    short_commit: String,
    dirty: bool,
    repository: &'static str,
}

#[tauri::command]
pub fn build_info(app: tauri::AppHandle) -> BuildInfo {
    let commit = env!("ELYSIUM_COMMIT");
    BuildInfo {
        version: app.package_info().version.to_string(),
        commit,
        short_commit: commit.chars().take(12).collect(),
        dirty: env!("ELYSIUM_DIRTY") == "true",
        repository: REPOSITORY,
    }
}

#[tauri::command]
pub fn open_commit_page(commit: String) -> Result<(), String> {
    if commit.len() != 40
        || !commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Choose a valid Git commit.".into());
    }
    let url = format!("{REPOSITORY}/commit/{commit}");
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(url).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("xdg-open").arg(url).status();
    let status = status.map_err(|e| format!("Could not open GitHub: {e}"))?;
    if !status.success() {
        return Err("Could not open GitHub.".into());
    }
    Ok(())
}
