use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, State};

const REPOSITORY: &str = "https://github.com/ooberguts/Elysium";
const COMMIT_API: &str = "https://api.github.com/repos/ooberguts/Elysium/commits/main";

#[derive(Default)]
pub struct UpdateState {
    checked_commit: Mutex<Option<String>>,
    launched: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    version: &'static str,
    commit: &'static str,
    short_commit: String,
    dirty: bool,
    branch: &'static str,
    repository: &'static str,
    can_install: bool,
}

#[tauri::command]
pub fn build_info() -> BuildInfo {
    let commit = env!("ELYSIUM_COMMIT");
    let dirty = env!("ELYSIUM_DIRTY") == "true";
    BuildInfo {
        version: env!("CARGO_PKG_VERSION"),
        commit,
        short_commit: commit.chars().take(12).collect(),
        dirty,
        branch: "main",
        repository: REPOSITORY,
        can_install: cfg!(any(target_os = "macos", target_os = "windows"))
            && !cfg!(debug_assertions)
            && !dirty
            && valid_commit(commit),
    }
}

fn valid_commit(commit: &str) -> bool {
    commit.len() == 40
        && commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[tauri::command]
pub fn open_commit_page(commit: String) -> Result<(), String> {
    if !valid_commit(&commit) {
        return Err("Choose a valid Git commit.".into());
    }
    let url = format!("{REPOSITORY}/commit/{commit}");
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(url).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("xdg-open").arg(url).status();
    status.map_err(|e| format!("Could not open GitHub: {e}"))?;
    Ok(())
}

#[derive(Deserialize)]
struct GithubCommit {
    sha: String,
    commit: GithubDetails,
}
#[derive(Deserialize)]
struct GithubDetails {
    message: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    commit: String,
    short_commit: String,
    message: String,
    url: String,
    available: bool,
}

fn update_check(commit: String, message: String) -> Result<UpdateCheck, String> {
    if !valid_commit(&commit) {
        return Err("GitHub returned an invalid commit version. Try checking again later.".into());
    }
    Ok(UpdateCheck {
        short_commit: commit[..12].to_owned(),
        url: format!("{REPOSITORY}/commit/{commit}"),
        available: commit != env!("ELYSIUM_COMMIT"),
        commit,
        message: message
            .lines()
            .next()
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect(),
    })
}

fn git_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let bundled = PathBuf::from(program_files).join("Git/cmd/git.exe");
        if bundled.is_file() {
            return bundled;
        }
    }
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from("/usr/bin/git");
    }
    #[allow(unreachable_code)]
    PathBuf::from("git")
}

// Git's credential helper also supports private repositories without storing a
// token in Elysium. Bound the child lifetime and disable authentication prompts.
fn authenticated_head() -> Result<String, String> {
    let mut command = Command::new(git_path());
    command
        .args([
            "-c",
            "credential.interactive=false",
            "ls-remote",
            "--exit-code",
        ])
        .arg(format!("{REPOSITORY}.git"))
        .arg("refs/heads/main")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Git is unavailable".to_owned())?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("GitHub connection timed out".into());
            }
        }
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("GitHub authentication or network connection failed".into());
    }
    parse_remote_head(&String::from_utf8_lossy(&output.stdout))
}

fn parse_remote_head(output: &str) -> Result<String, String> {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .find(|(sha, branch)| valid_commit(sha) && *branch == "refs/heads/main")
        .map(|(sha, _)| sha.to_owned())
        .ok_or_else(|| "GitHub did not return a valid main branch".into())
}

#[tauri::command]
pub async fn check_for_updates(state: State<'_, UpdateState>) -> Result<UpdateCheck, String> {
    // Invalidate a previous result when a refresh fails; it must not authorize
    // an installation based on a stale or frontend-supplied commit.
    *state.checked_commit.lock().map_err(|e| e.to_string())? = None;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("Elysium/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(COMMIT_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
    let latest = match response {
        Ok(response) if response.status().is_success() => {
            response.json::<GithubCommit>().await.ok()
        }
        _ => None,
    };
    let check = if let Some(latest) = latest {
        update_check(latest.sha, latest.commit.message)?
    } else {
        let commit = tauri::async_runtime::spawn_blocking(authenticated_head)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "Could not reach GitHub. Check your connection. For this private repository, sign in using gh auth login and gh auth setup-git, then retry. GitHub rate limits can also delay checks.".to_owned())?;
        update_check(commit, "Latest commit on main".into())?
    };
    *state.checked_commit.lock().map_err(|e| e.to_string())? = Some(check.commit.clone());
    Ok(check)
}

// Values are written as data into a local launcher, never interpolated into an
// AppleScript command. POSIX quoting protects spaces, quotes, and shell syntax.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn installed_directory() -> Result<Option<PathBuf>, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        if let Some(bundle) = executable.ancestors().nth(3) {
            if bundle.file_name().is_some_and(|name| name == "Elysium.app") {
                return Ok(bundle.parent().map(PathBuf::from));
            }
        }
        Ok(None)
    }
    #[cfg(not(target_os = "macos"))]
    Ok(executable.parent().map(PathBuf::from))
}

#[derive(Deserialize)]
struct InstallLocation {
    root: PathBuf,
    repository: String,
}

fn managed_root(directory: Option<&std::path::Path>) -> Result<Option<PathBuf>, String> {
    let Some(directory) = directory else {
        return Ok(None);
    };
    let record = directory.join(".elysium-install.json");
    if !record.exists() {
        return Ok(None);
    }
    let location: InstallLocation =
        serde_json::from_slice(&std::fs::read(record).map_err(|e| e.to_string())?).map_err(
            |_| "The installation location file is invalid. Rerun the GitHub installer.".to_owned(),
        )?;
    if !location.root.is_absolute() || location.repository != format!("{REPOSITORY}.git") {
        return Err("The installation location does not match the official repository. Rerun the GitHub installer.".into());
    }
    Ok(Some(location.root))
}

#[tauri::command]
pub fn install_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
    commit: String,
) -> Result<(), String> {
    if !build_info().can_install {
        return Err("Install updates from a packaged, clean Git commit. This build contains local changes or is a development build.".into());
    }
    if !valid_commit(&commit)
        || state
            .checked_commit
            .lock()
            .map_err(|e| e.to_string())?
            .as_deref()
            != Some(commit.as_str())
        || commit == env!("ELYSIUM_COMMIT")
    {
        return Err("Check GitHub for an available commit before installing.".into());
    }
    let mut launched = state.launched.lock().map_err(|e| e.to_string())?;
    if *launched {
        return Err(
            "The update installer is already open. Follow its progress in the terminal.".into(),
        );
    }
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let app_dir = installed_directory()?;
    let root = managed_root(app_dir.as_deref())?;
    launch_installer(&folder, &commit, app_dir, root)?;
    *launched = true;
    Ok(())
}

fn launch_installer(
    folder: &std::path::Path,
    commit: &str,
    app_dir: Option<PathBuf>,
    root: Option<PathBuf>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        let script = folder.join("install-macos.sh");
        std::fs::write(&script, include_str!("../../scripts/install-macos.sh"))
            .map_err(|e| e.to_string())?;
        let launcher = folder.join("Update Elysium.command");
        let mut args = format!(
            "/bin/bash {} --commit {} --wait-pid {}",
            shell_quote(&script.to_string_lossy()),
            shell_quote(commit),
            std::process::id()
        );
        if let Some(directory) = app_dir {
            args.push_str(&format!(
                " --app-dir {}",
                shell_quote(&directory.to_string_lossy())
            ));
        }
        if let Some(root) = root {
            args.push_str(&format!(" --root {}", shell_quote(&root.to_string_lossy())));
        }
        std::fs::write(
            &launcher,
            format!(
                r#"#!/bin/bash
{args}
result=$?
if [ "$result" -ne 0 ]; then
  echo 'Update failed. See the installation log above. Close this window when ready.'
  read -r
fi
exit "$result"
"#
            ),
        )
        .map_err(|e| e.to_string())?;
        std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        let status = Command::new("/usr/bin/open")
            .args(["-a", "Terminal"])
            .arg(&launcher)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not open Terminal for the installer.".into());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let script = folder.join("install-windows.ps1");
        std::fs::write(&script, include_str!("../../scripts/install-windows.ps1"))
            .map_err(|e| e.to_string())?;
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NoExit",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script)
            .arg("-Commit")
            .arg(commit)
            .arg("-WaitPid")
            .arg(std::process::id().to_string());
        if let Some(directory) = app_dir {
            command.arg("-AppDir").arg(directory);
        }
        if let Some(root) = root {
            command.arg("-Root").arg(root);
        }
        command
            .creation_flags(0x00000010)
            .spawn()
            .map_err(|e| format!("Could not open the update installer: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (folder, commit, app_dir, root);
        Err("Automatic installation is available on Windows and macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn commit_versions_reject_refs_options_and_shell_input() {
        assert!(valid_commit(SHA));
        for value in [
            "main",
            "--help",
            "0123456",
            "$(touch /tmp/test)",
            "0123456789ABCDEF0123456789abcdef01234567",
        ] {
            assert!(!valid_commit(value));
        }
    }

    #[test]
    fn remote_check_requires_the_exact_main_ref() {
        assert_eq!(
            parse_remote_head(&format!("{SHA}\trefs/heads/main\n")).unwrap(),
            SHA
        );
        assert!(parse_remote_head(&format!("{SHA}\trefs/heads/main-other\n")).is_err());
        assert!(parse_remote_head("main\trefs/heads/main").is_err());
    }

    #[test]
    fn update_metadata_is_validated_and_compares_full_commits() {
        let current = env!("ELYSIUM_COMMIT");
        if valid_commit(current) {
            assert!(
                !update_check(current.into(), "Title\nBody".into())
                    .unwrap()
                    .available
            );
        }
        let check = update_check(SHA.into(), "Title\nBody".into()).unwrap();
        assert_eq!(check.message, "Title");
        assert_eq!(check.short_commit, &SHA[..12]);
        assert_eq!(check.url, format!("{REPOSITORY}/commit/{SHA}"));
        assert!(update_check("invalid".into(), String::new()).is_err());
    }

    #[test]
    fn terminal_paths_are_quoted_as_single_arguments() {
        assert_eq!(shell_quote("a b's $(command)"), "'a b'\\''s $(command)'");
    }

    #[test]
    fn updates_reuse_custom_install_roots_and_reject_other_repositories() {
        let folder = tempfile::tempdir().unwrap();
        assert!(managed_root(Some(folder.path())).unwrap().is_none());
        let record = folder.path().join(".elysium-install.json");
        std::fs::write(
            &record,
            serde_json::to_vec(&serde_json::json!({
                "root": folder.path(), "repository": format!("{REPOSITORY}.git")
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            managed_root(Some(folder.path())).unwrap(),
            Some(folder.path().to_path_buf())
        );
        std::fs::write(
            &record,
            r#"{"root":"relative","repository":"https://example.com/other.git"}"#,
        )
        .unwrap();
        assert!(managed_root(Some(folder.path())).is_err());
    }
}
