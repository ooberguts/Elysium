# Elysium 0.1.0 validation

Native macOS testing was completed on Apple Silicon on November 14, 2026.

## Automated checks

- TypeScript checking and production Vite build.
- Nine frontend domain tests: queue completion/repeat, stable shuffle membership, multi-field search, album identity and disc order, repeated playlist entries, smart rules, and time formatting.
- Ten Rust tests: provider-address validation, episode parsing, deterministic identity, SQLite persistence, loose-file/source deduplication, rescan protection, MP3/FLAC audio-payload preservation, original-byte restoration, and rejection of restoration after an external file change.
- The installed JavaScript dependency tree reported zero known vulnerabilities after updating the development tools.

## Observed in the packaged native app

The first-run sample import created three music tracks, one movie, and one episode. The song table and column browser showed the imported tags. Music playback advanced its clock and spectrum. The queue advanced to the next song. Switching into and out of the always-on-top mini-player preserved playback.

Get Info displayed a field-level before/after preview and saved a library-only genre edit. A source rescan preserved that edit, and the sample's original displayed genre was restored through the editor. A static playlist was created and populated through the selection toolbar; its entry appeared in playlist order.

The generated movie played in the integrated video surface. Pause and seeking worked. Quitting and reopening restored the library, playlist, current item, and a paused movie checkpoint with the intended small resume rewind.

## Qualification still needed

Windows installation and native tests run in GitHub Actions; hardware playback and UI behavior also need a real Windows test. Live NAS disconnect/reconnect behavior, a real Jellyfin server, large collections, unusual metadata, external subtitle files, and broader codec coverage need user/platform testing. The generated local fixture collection does not establish those cases.

The broader performance and feature targets in ELYSIUM_PLAN.md remain product targets, not measured results for this test build.
