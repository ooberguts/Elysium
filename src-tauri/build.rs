fn main() {
    // CoreAudio process-tap symbols are absent before macOS 14.2. Keep the
    // existing macOS 12 library-player support; capture.rs gates the tap path.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,CoreAudio");
    }
    tauri_build::build()
}
