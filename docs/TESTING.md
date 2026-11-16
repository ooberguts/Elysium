# Elysium validation

## Ratings, bulk metadata, and context menus · November 16, 2026

**39 frontend tests**, **35 release-mode native tests**, and the production frontend build pass. New selection tests cover right-clicking outside a selected group, preserving selected filtered-out items, deduplicating repeated playlist entries, and handling refreshes. Existing broadcast/capture/audiobook tests remain passing.

Generated MP3 and FLAC fixtures cover 1–5/cleared rating persistence, reopening the database, preserving another POPM owner's rating/counter and lyrics, shared album/album-artist/front-cover edits, preservation of individual titles/artists and back covers, original encoded-audio hashes, and byte-for-byte restoration. Additional cases cover invalid images/ratings, read-only files, partial batch failures, duplicate IDs, rescan protection for artwork and explicit unrated values, and rating-only writes that leave unrelated private library overrides out of the media file. Generated M4A stays byte-identical while its rating persists in the library. Tests use temporary files, not the user's collection.

The WebKit development fixture (`scripts/metadata-check.html`, excluded from the app entry point) exercises the production song table, metadata editor, context-menu component, and selection helper. Observed: clicking a star updates its rating without selecting/playing; right-click within a three-song selection retains all three; clicking outside it targets the hovered song, Shift+F10 opens its menu, and Escape restores focus; mixed fields remain untouched while album, album artist, and rating enter the review; cover controls and both save destinations are present. The editor was inspected at 1280×720 and 850×600. The review caught and corrected clipped sticky save controls and vertically stacked destination radio labels. Browser checks do not exercise the native file picker or native save bridge.

After the Mac was unlocked, the rebuilt packaged app was fully quit and relaunched. Native checks confirmed the three-item selection context menu, targeting a different song outside the selection, and the 0–5 rating submenu. Rating the bundled Glass Horizon sample saved to both the library and file metadata without starting playback. The native cover picker loaded a bundled PNG, rendered its preview, and saved one shared album name and cover across the three Elysium Lab samples while retaining their separate titles. A second full Quit/relaunch preserved the five-star rating, album name, and cover. The sample album name, cover, and unrated values were then restored through the UI. Newly imported personal songs were not edited. The app was left open in Songs with search and selection cleared, retaining the previously paused playback position. Native screenshots are in ignored `artifacts/native-context-menu.png` and `artifacts/native-cover-editor.png`. Windows UI and file replacement behavior still require physical-platform qualification.


## Living worlds visualizers · November 16, 2026

The update adds Chromatic Current, Fractal Sanctuary, and Aurora Cathedral, bringing the gallery to **18 scenes**. Spectral-flux attacks, slow frequency envelopes, integrated morph coordinates, quarter-resolution bloom, and event-aware Auto show were implemented from the primary-source research recorded in [VISUALIZER_DESIGN.md](VISUALIZER_DESIGN.md).

**36 frontend tests** and the production build pass. The development WebKit renderer lab passed **82 GPU checks**, including distinct nonempty output without GL errors for all 18 scenes, stationary reduced motion, fixed-time audio-driven structural changes normalized for brightness, and separate bass/mid/high responses for all three new worlds. Further checks cover pause, continuous morphing through a sustained phrase, intensity, and 1.8-second preset dissolves. Native audio/broadcast code is unchanged in this update; the previous 28-test native result remains the baseline.

The new gallery and all three new scene styles were visually inspected. Review caught excessive feedback blur in the fractal; its feedback duration and advection were reduced, the iteration detail increased, and its filled interior light reduced to retain fine branches. Real sample music drove the fractal preview at an observed **60 fps at 1600×900** on this Mac; silence reached zero RMS and stopped the morph clock. This is a short observed WebKit result, not a performance guarantee for other GPUs, resolutions, or operating systems.

The rebuilt native Mac app successfully captured the **SteelSeries Arctis Nova 5 output** and displayed changing input levels and a full-stage Chromatic Current rendering. An audiobook left selected in the player exposed a UI issue that hid the visualizer toolbar; the toolbar now follows the visible stage, while audiobook skip/speed controls remain in the audiobook listening view. The final native build was reopened with the audiobook still selected: preset navigation, Auto show, intensity, and the 60 fps setting were present, and Auto show could be enabled.

Windows rendering/hardware and extended cross-genre listening remain unqualified for this update. Automated image comparisons establish response and rendering behavior, not subjective musical quality.

## Audiobooks and video broadcast · November 16, 2026

Final automated validation: **31 frontend tests**, **28 release-mode native tests**, and the production frontend build pass. The live video engine is split into an on-demand bundle; Vite reports its size (583 kB uncompressed) as a chunk warning.

Audiobooks have a separate shelf, explicit audiobook file/folder import, automatic M4B classification, per-file checkpoints, skip controls, and playback speed. A native M4B test file was imported, played, skipped, and paused at **37.6 seconds**. A full menu Quit and relaunch restored **37.6 seconds**, with the book still paused. Native tests cover rescan preservation, database reopen, backward seeks, completion, and invalid times. Frontend tests cover separate checkpoints, stale queue positions, unavailable local storage, and newer broadcast progress taking precedence.

Live video uses three aligned H.264/fMP4 HLS renditions and the existing native audio presentation clock. The encoder test verifies actual video segments at three levels and nonempty stereo PCM. The TCP/proxy test fetches generated assets through a simulated receiver, rejects wrong tokens/origins/traversal, rejects ended stations, and verifies that pause does not stop the broadcast clock. The packaged Mac app displayed the generated sample movie with Auto quality, paused independently across program iterations, then resumed the current iteration; Low selected **480p**, and Auto was restored afterward.

Audiobook broadcasts support book, author, collection, playlist, genre, queue, and all-books selection. The native test resumes a book from 5.25 seconds, delivers that offset to a TCP listener, stops after one second of actual presentation, and checks that the persisted position reflects presentation rather than lookahead decoding. Progress checkpoints carry timestamps so a newer native broadcast checkpoint supersedes a stale WebView player checkpoint. Native GUI verification also started the M4B broadcast at **37.6 seconds**, stopped it around **62.3 seconds**, and then resumed the local player at **62.3 seconds** rather than returning to the older checkpoint. The test broadcast was stopped and the local test book left paused.

Research: [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls), [hls.js API](https://hlsjs.video-dev.org/api-docs/hls.js.hls), [media currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime), [media playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate), [persistent local storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), and [pagehide limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event). Checkpoints are written continuously rather than depending on an exit event.

Physical Windows playback, actual two-computer speaker/screen sync, bandwidth-induced Auto transitions, and overnight operation remain unqualified. Tests of multiple TCP clients on one Mac establish data transport, not acoustic synchronization across a house.

## LAN radio update · November 16, 2026

The production frontend build and 24 frontend tests pass. The release-mode native suite passes 23 tests, including bounded protocol parsing, PCM round trips, timestamp/clock estimation with delay outliers and extreme values, interpolation, queue run policies, and three real TCP integration tests. A generated stereo WAV is decoded through the bundled FFmpeg process and delivered to two concurrent loopback receivers; overlapping timestamps contain identical, non-silent PCM, and once mode closes both streams after playback. Additional connections exercise clock replies, explicit listener removal and blocked reconnects, invitations requiring consent, busy-room rejection, protocol version errors, and local-address validation. These tests found and fixed macOS accepted sockets inheriting nonblocking mode.

The implementation uses mDNS discovery, opt-in idle-room requests, local playlist/artist/album/genre/queue selection, once/repeat/timed runs, bounded per-listener queues, reconnect attempts, selectable CPAL outputs, independent room gain/delay, and an audio-fed visualizer. Timing uses a shared monotonic presentation timeline, a low-RTT four-timestamp clock estimate, and CPAL predicted playback timestamps. Active session workers hold a system-idle-sleep assertion and release it when the session ends; display locking remains allowed.

Research references: [Snapcast's timestamped chunk architecture](https://github.com/snapcast/snapcast), [mdns-sd discovery](https://docs.rs/mdns-sd/0.21.6/mdns_sd/), [CPAL OutputStreamTimestamp](https://docs.rs/cpal/0.18.2/cpal/struct.OutputStreamTimestamp.html), [Windows execution state](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate), and the installed macOS `caffeinate(8)` manual. The network protocol and playback timeline are original implementations.

The new radio setup screen was reviewed in the development WebView at 1280×720 and the app minimum 850×600. Timed-mode controls exposed both stopping policies; room setup wrapping and checkbox alignment were corrected. The packaged LAN screen was subsequently verified on the unlocked Mac. The user confirmed clean, continuous sample-station playback through the Arctis Nova 5. Output refresh after reconnection and the full-stage visualizer layout were corrected and verified. The final locally signed macOS app passed strict recursive code-signature verification; its generated DMG passed image checksum verification. The installer is `artifacts/Elysium-LAN-radio-macOS-arm64.dmg`, with an adjacent SHA-256 file.

Still requiring physical-device qualification: discovery and firewall behavior between Mac and Windows; measured speaker-to-speaker synchronization and long-term clock drift; Bluetooth latency calibration; real network loss/reconnect; permission denial; large listener counts; and overnight operation. Loopback receivers establish data-path behavior, not multi-computer acoustic synchronization. The Windows CI workflow includes the new native tests and installer build, but it has not been run from this uncommitted local checkout.

## GPU and live audio update · November 16, 2026

The interface now uses quieter silver/graphite surfaces, clearer hierarchy, a visualizer entry in the sidebar, a searchable preset gallery, and a theater layout. Dialogs inherit the current theme. The large renderer has original full-frame shaders, signed-distance 3D surfaces, feedback, bloom, and preset dissolves. The native audio path uses CPAL and RustFFT; raw samples are kept only in a fixed-size in-memory ring.

Research informed the implementation:

- [Apple: sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) and [toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): keep navigation grouped, action placement consistent, and the visual stage clear.
- [MDN: AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode) and [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices): reuse analysis buffers, bound texture sizes, manage GPU resources, and handle context loss.
- [MilkDrop authoring](https://www.geisswerks.com/hosted/milkdrop2/milkdrop_preset_authoring.html) and [Geiss feedback architecture](https://www.geisswerks.com/geiss/secrets.html): frequency-specific response and per-pixel feedback warps for an evolving, organic show.
- [projectM](https://github.com/projectM-visualizer/projectm): reference architecture for audio-driven shader scenes and transitions. No projectM code or preset data was imported.
- [CPAL’s CoreAudio loopback implementation](https://github.com/RustAudio/cpal/blob/v0.18.2/src/host/coreaudio/macos/loopback.rs), [WASAPI capture](https://github.com/RustAudio/cpal/blob/v0.18.2/src/host/wasapi/device.rs), and [Apple audio-capture privacy keys](https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription): native capture of selected output endpoints and explicit user-controlled capture lifetime.

Observed on macOS: the locally signed app enumerated the SteelSeries Arctis Nova 5 output/input, the display output, built-in speakers/microphone, and an installed virtual input. The selected SteelSeries output delivered a changing signal to the native input meter and full-stage renderer, independently of the library player. Real sample music also drove the React visualizer through Web Audio in the browser. This confirms actual output-device capture on the tested Mac; it does not certify every audio driver or Windows hardware.

The development browser harness at `scripts/visualizer-check.html` passed 58 GPU checks: all fifteen scenes rendered nonempty, distinct output without GL errors; reduced motion was stationary for each scene; pause held spatial geometry; live input advanced geometry; intensity changed the image; preset dissolves started and completed. Fifteen additional checks hold elapsed time and global energy constant and compare quiet/loud audio after removing overall brightness differences: every preset changes its rendered structures. Four additional checks verify that both organic fractal scenes evolve during a sustained phrase and freeze when paused. These checks found a WebKit RGB/RGBA copy incompatibility, now fixed by matching the opaque framebuffer's texture format. The gallery was visually reviewed in Graphite, including search filtering.

All twenty-one frontend tests and the production build pass. The audio regression tests include quiet device signals, loudness changes, and percussion transients whose frequency magnitude is nearly constant. Adaptive loudness gain now drives geometry directly; the tunnel perspective, twist, wall relief, and travel speed respond to the music instead of primarily advancing with elapsed time. The native bridge and Web Audio path preserve floating-point waveform samples; low-volume signals no longer lose detail to 8-bit quantization. Bass/mid/treble motion uses recovered linear energy rather than compressed decibel magnitudes, with fast onset and slower release. Prismatic Alchemy and Cosmic Bloom now use shaded recursive inversion folds with continuously morphing symmetry, fold spacing, cavities, and curvature; Neon Continuum adds a mirrored liquid field, and Infinity Tunnel fills the stage with an illuminated cylindrical flight. Theater controls overlay the full-window stage and fade after three idle seconds; pointer movement or keyboard input reveals them. Native tests include the previous media/library suite plus capture DSP and lifecycle checks. The browser harness is outside the Vite app entry point and is not included in the packaged app.

Remaining platform qualification: Windows capture and device unplug/reconnect on physical hardware; permission denial/revocation; macOS 12–14.5 launch with weak-linked CoreAudio symbols; very large displays and sustained frame pacing on lower-power GPUs. Output-only CoreAudio endpoints are supported directly; a duplex endpoint needs a dedicated loopback input rather than silently capturing its microphone.

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

Latest Mac installer: `artifacts/Elysium-metadata-ratings-macOS-arm64.dmg`. SHA-256: `a94fbd9af4509146da9eb7e340a9b017c1e5d68742bbd6f56141a18abfbdca92`. This package includes the context-menu, rating, and bulk metadata update alongside the eighteen-scene visualizers, audiobook shelf/resume, audiobook/video/music broadcasts, adaptive video controls, and device capture. Strict recursive local signature verification and DMG checksum verification pass. Earlier installers remain alongside it. The new packaged Mac interface and restart persistence have been verified.
