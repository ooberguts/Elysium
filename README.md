# Elysium

A personal music and video library built with TypeScript, React, Tauri 2, and Rust. Classic iTunes organization, modern collection views, and an expressive compact player.

**0.2.0 adds the retro visualizer collection.** The complete product direction is in [ELYSIUM_PLAN.md](ELYSIUM_PLAN.md). The test release implements the everyday local music/video workflow; the plan also describes features that have not shipped yet.

## Try the app

Open the packaged **Elysium.app** on macOS or the Windows installer from this private repository's Releases/Actions page. macOS test packages are locally signed and are not Apple-notarized; Windows test packages are unsigned.

1. Choose **Try the sample library**. Elysium includes three original synthesized songs, a short generated movie, and a sample TV episode.
2. Open **Songs** and double-click a song. Try the column browser, search, queue, equalizer, and Now Playing visualizers.
3. Open **Movies** or **TV shows** to test video playback, seeking, subtitles, and resume.
4. Use **Add a library folder** for your own media. A NAS share must first be mounted in Finder or File Explorer; Windows UNC paths can also be entered in Add Folder.
5. Select items and choose **Get Info**. Library-only edits are the default. Explicit MP3/FLAC file writes make backups and verify the encoded audio before replacing a file. Use the **Stop** button in the bottom player before writing the current item's file.

The app never moves or deletes your source media. Compatibility conversion creates a separate cached copy. Testing with a small copied collection is a useful way to check your own tag formats and network setup.

## Included in this build

- Persistent SQLite library with songs, albums, artists, movies, and TV episodes.
- Classic Silver and Graphite themes, compact song rows, virtualized song tables, column browsing, text search, sorting, favorites, and ratings. All playback controls live in the bottom strip; the top is reserved for navigation and search.
- Local files, external drives, mounted network folders, incremental rescans, scan cancellation, offline retention, and source rebinding.
- Music and video playback, seek, speed, shuffle, repeat, persistent queue, resume checkpoints, and basic OS Media Session integration.
- A compact always-on-top player that keeps the same playback session alive when the window changes size.
- Fifteen audio-reactive visualizers, including twelve original effects inspired by Windows Media Player, iTunes, Xbox, and Xbox 360. Includes a full-stage light show, grouped preset picker, previous/next/random, optional 30-second rotation, track-info overlay, 30/60 fps choices, and a three-band equalizer.
- Static playlists, drag-to-playlist, four smart playlist rules, M3U/M3U8 import, and M3U8 export.
- Single and batch metadata editing with a change preview; user overrides survive rescans.
- MusicBrainz match lookup with a request queue, rate limiting, session cache, and manual acceptance.
- Recoverable embedded MP3/FLAC writes, encoded-audio verification, and backup restoration with conflict detection.
- Local movie/episode NFO reading and export, local cover/poster artwork, and UTF-8 SRT/WebVTT subtitles.
- Jellyfin sign-in, up to 5,000 audio/movie/episode items per connection, authenticated direct-play streaming, and progress reporting. Tokens remain in native process memory and sign-out clears the session.
- JSON library backup and merge restore.

## Retro visualizers

Play a song and choose **Now Playing** (the monitor icon in the bottom player). All visualizer controls are in the expanded bottom strip. Use the grouped preset picker, its left/right arrows, or the sparkle button for a random effect. **Track info** hides or shows the artwork/title overlay. **Auto · 30s** rotates presets during visible music playback; choosing a preset restarts the countdown. The full-screen button expands the app while keeping transport accessible at the bottom.

| Collection                    | Effects                                           |
| ----------------------------- | ------------------------------------------------- |
| Windows Media Player inspired | Prismatic Alchemy, Spectral Ocean, Dot Plane      |
| iTunes inspired               | Classic Light Ribbons, Celestial Orbits, Stardust |
| Original Xbox inspired        | Emerald Reactor, Liquid Chamber, Verdant Matrix   |
| Xbox 360 inspired             | Neon Continuum, Infinity Tunnel, Cosmic Bloom     |
| Elysium essentials            | Spectrum, Oscilloscope, Ambient Glow              |

The renderers use the actual playing audio's waveform, logarithmic frequency bands, bass/mid/treble envelopes, and transient detection. Spatial animation freezes when paused and during silence. Hidden windows stop drawing; the full-stage renderer unmounts when leaving Now Playing or entering the mini-player. Balanced rendering targets 30 fps; Smooth targets 60 fps, subject to hardware and WebView performance. Both cap the canvas resolution on large displays.

**Preferences → Sound & visuals → Reduce visualizer motion** stops spatial animation while retaining a slower response to audio. System reduced-motion preferences are always respected, and automatic preset changes are suspended in reduced motion.

These are original Elysium interpretations of the era, not the original Apple/Microsoft/Llamasoft engines or a pixel-identical emulation. Proprietary visualizer binaries, WMP plug-in DLLs, iTunes plug-ins, Xbox assets, and third-party preset packs are not included. There is no plug-in import in this release.

## Current limits

This build uses the operating system's WebView media decoder. Unsupported local files fall back to a bundled FFmpeg helper that prepares AAC audio or H.264/AAC video in a local cache. **Preparation finishes before playback starts**, so a large or unusual movie may take several minutes and substantial disk space. FFmpeg work is cancelled when you change to another item or close the app. Cached compatible files are currently retained; their location is listed below.

This is a deliberate test-release backend, with a separate native-player evaluation still on the roadmap. It does not yet provide certified gapless transitions, native libmpv playback, ReplayGain, crossfade, HDR/surround qualification, embedded audio-track selection, chapters, or subtitle/audio timing adjustments. The current video conversion selects the first video/audio streams; externally loaded SRT/VTT subtitles are supported.

Jellyfin is direct-play only. The app does not request server transcoding yet, does not persist server sessions across restarts, and does not edit remote metadata or favorites. Local progress is durable; failed remote progress requests currently require another successful playback checkpoint rather than a durable retry queue. A real server is required to qualify the integration against your server's version and codecs.

Online movie/poster enrichment, AcoustID fingerprinting, lyric providers, artwork editing, arbitrary smart-playlist rules, iTunes XML import, WMP `.wmz` import, projectM, a separate floating video window, and Linux qualification remain planned work. Metadata writes are enabled only for MP3/FLAC files whose tag data can be preserved; specialized frames may require library-only edits. Batch writes report per-file failures rather than claiming the whole batch succeeded.

## Run from source

Install a current Node.js LTS release (24 or newer), Rust stable, and the platform prerequisites from [Tauri's setup guide](https://v2.tauri.app/start/prerequisites/). macOS needs Xcode Command Line Tools. Windows needs the Visual Studio C++ build tools and WebView2 runtime.

```sh
npm ci
npm run prepare:media
npm run desktop
```

The desktop launcher also checks the standard `~/.cargo/bin` toolchain location, so a Rust installation there works even if the launching shell does not include it on PATH.

For the frontend alone, `npm run dev` displays the interface with a desktop-required notice. Filesystem and playback integration are enabled in the Tauri app.

## Build and verify

```sh
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run package
```

Run `npm run prepare:media` before native tests. The native suite exercises real generated media, including MP3/FLAC writing, encoded-audio preservation, recovery, conflict detection, and rescan behavior. Frontend tests cover queue transitions, shuffle, search, release grouping, smart rules, playlist order, frequency analysis at three sample rates, silence/transients, frame-rate-independent envelopes, preset compatibility, and rotation timing.

macOS packages are generated under `src-tauri/target/release/bundle/macos` and `bundle/dmg`. Windows NSIS installers are generated under `bundle/nsis`. GitHub Actions builds and tests macOS and Windows, with installer artifacts attached to each run. Tagged versions also attach installers to a release in the same repository.

## Data and recovery

Elysium uses the platform application-data folder for `com.ooberguts.elysium`:

- macOS: `~/Library/Application Support/com.ooberguts.elysium/`
- Windows: `%APPDATA%\com.ooberguts.elysium\`
- Linux development: the standard XDG data directory for this identifier.

`library.sqlite3` contains the library. `artwork/` holds cached artwork, `compatible/` holds prepared playback files, `demo/` holds the copied sample library, and `backups/` holds originals and write journals for explicit embedded-tag edits. Backups are currently retained until you remove them yourself. JSON exports contain metadata and source locations, not your media or binary tag backups.

The **Source & recovery** tab in Get Info can restore the most recent embedded-tag backup. Restoration refuses to overwrite a file that has been changed externally after the edit. Keep normal backups of your collection independently of Elysium.

## Source layout

`src/` contains the React interface, native bridge, queue/playback controller, and domain rules. `src-tauri/src/` contains the SQLite store, scanner, metadata writer, providers, native commands, and authenticated Jellyfin streaming proxy. `scripts/` prepares the platform helper and generates original sample media. All imported media and credentials are excluded from the repository.

## Third-party software

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The FFmpeg helper's actual license and build/source information are copied alongside it into every bundle. Elysium's own source is private; this repository does not grant a public redistribution license for it.
