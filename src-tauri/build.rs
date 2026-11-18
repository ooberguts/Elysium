fn main() {
    // Embed the source identity in the executable, not in a mutable runtime file.
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|value| value.trim().to_owned())
    };
    let commit = git(&["rev-parse", "HEAD"])
        .filter(|value| value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"]).is_none_or(|status| !status.is_empty());
    println!("cargo:rustc-env=ELYSIUM_COMMIT={commit}");
    println!("cargo:rustc-env=ELYSIUM_DIRTY={dirty}");
    // Watch source changes and Git refs, including detached installer checkouts.
    for entry in [
        "src",
        "Cargo.toml",
        "Cargo.lock",
        "tauri.conf.json",
        "build.rs",
        "../src",
        "../scripts",
        "../package.json",
        "../package-lock.json",
        "../.git/HEAD",
        "../.git/index",
        "../.git/refs",
        "../.git/packed-refs",
    ] {
        println!("cargo:rerun-if-changed={entry}");
    }
    // CoreAudio process-tap symbols are absent before macOS 14.2. Keep the
    // existing macOS 12 library-player support; capture.rs gates the tap path.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,CoreAudio");
    }
    // The Windows test harness also needs Common Controls v6. Tauri embeds its
    // manifest in the app resource only, so let the MSVC linker add the same
    // dependency to both the application and the test executable.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("failed to run Tauri build script");
    } else {
        tauri_build::build();
    }
}
