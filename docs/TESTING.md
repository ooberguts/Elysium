# Elysium validation

## 0.2.0 retro visualizers

The frontend suite now has eighteen tests. Nine added checks cover silence, bass/treble assignment at 44.1/48/96 kHz, contiguous waveform sampling (including high notes), transient detection without steady-tone retriggering, envelope timing at 30/60 fps, existing saved mode compatibility, preset navigation, and rotation timing. TypeScript checking, the production build, all ten native tests, and native formatting pass locally on Apple Silicon.

All fifteen presets were selected through the packaged macOS app's bottom control strip during music playback. Native screenshots confirmed the WMP-inspired kaleidoscope, iTunes-inspired ribbon/orbit effects, Xbox-inspired plasma, and Xbox 360-inspired neon ribbons. The playing track advanced across the sample queue without interrupting preset navigation. The stage occupies the available content area and controls remain in the bottom strip. Two paused screenshots had identical visualization-stage pixels; their only differences were in the cursor over the play button.

The final 0.2.0 package restored saved visualizer options after restart. Automatic rotation changed presets across short sample tracks. The track-info toggle hid the overlay, the performance picker selected 60 fps, reduced motion kept spatial animation stationary while responding to audio, and full screen retained the bottom controls. Entering and leaving the mini-player preserved playback and the selected preset. Frame-rate targets are not a hardware performance certification.

Browser rendering checks also exercised the actual React visualizer component and real Web Audio analysis using the original sample music, rather than a simulated audio signal. The temporary browser harness and screenshots live under ignored `artifacts/` and are not bundled into the app.

## 0.1.0 baseline

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

The revised interface was checked in the packaged app with all global playback controls in the bottom strip. Music transport, seek, volume, queue, equalizer, mini-player, and full-screen actions fit at the standard desktop size. The mini-player keeps transport, pinning, seek, and volume at the bottom. Video speed, subtitles, and skip controls expand from the same bottom player rather than appearing over the video. The macOS bundle also passed strict recursive code-signature verification with its local test signature.

## Qualification still needed

Windows installation and native tests run in GitHub Actions; hardware playback and UI behavior also need a real Windows test. Live NAS disconnect/reconnect behavior, a real Jellyfin server, large collections, unusual metadata, external subtitle files, and broader codec coverage need user/platform testing. The generated local fixture collection does not establish those cases.

The broader performance and feature targets in ELYSIUM_PLAN.md remain product targets, not measured results for this test build.
