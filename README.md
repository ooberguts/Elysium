# Elysium

A personal music, audiobook, and video library built with TypeScript, React, Tauri 2, and Rust. Classic iTunes organization, modern collection views, and an expressive compact player.

**This update adds morphing full-stage visualizers, live audio-device capture, audiobook listening progress, and LAN music/audiobook/video broadcasts for Mac and Windows.** The complete product direction is in [ELYSIUM_PLAN.md](ELYSIUM_PLAN.md). The test release implements the everyday local music/video workflow; the plan also describes features that have not shipped yet.

## Try the app

Use the [GitHub installation scripts](#install-from-github) below to install dependencies, build Elysium, and put it in your applications folder. You can also open a packaged **Elysium.app** on macOS or the Windows installer from this private repository's Releases/Actions page. macOS test packages are locally signed and are not Apple-notarized; Windows test packages are unsigned.

1. Choose **Try the sample library**. Elysium includes three original synthesized songs, a short generated movie, and a sample TV episode.
2. Open **Songs** and double-click a song. Try search, the queue, equalizer, and Now Playing visualizers.
3. Open **Movies** or **TV shows** to test video playback, seeking, subtitles, and resume.
4. Use **Add a library folder** for your own media. A NAS share must first be mounted in Finder or File Explorer; Windows UNC paths can also be entered in Add Folder.
5. Select items, right-click, and choose **Edit metadata**. Library-only edits are the default. Explicit MP3/FLAC file writes make backups and verify the encoded audio before replacing a file. Use the **Stop** button in the bottom player before writing the current item's file.

Use **Touch mode** in the top navigation bar to switch between the standard layout and larger touch controls. The choice is remembered. In touch mode, tap song rows to select multiple items, use the visible play and actions buttons, and use a playlist track’s actions to move it up or down. Switch back with the same button.

The app never moves or deletes your source media. Compatibility conversion creates a separate cached copy. Testing with a small copied collection is a useful way to check your own tag formats and network setup.

## Included in this build

- Windows and macOS installation scripts with dependency setup, dedicated source/tool folders, logs, and exact commit selection. Preferences shows the installed commit, checks GitHub on startup or on demand, and launches the update installer.
- Persistent SQLite library with songs, albums, artists, audiobooks, movies, and TV episodes.
- Artist pages with album artwork, a discography grouped by album, and songs from both their releases and compilation appearances. Album covers and titles open a full album page with its ordered track list. Back/forward buttons connect library, artist, and album pages.
- Classic Silver and Graphite themes, compact song rows, virtualized song tables, text search, sorting, favorites, and ratings. All playback controls live in the bottom strip; the top is reserved for navigation and search.
- Local files, external drives, mounted network folders, incremental rescans, scan cancellation, offline retention, and source rebinding.
- Music and video playback, seek, speed, shuffle, repeat, persistent queue, resume checkpoints, and basic OS Media Session integration.
- A compact always-on-top player that keeps the same playback session alive when the window changes size.
- Eighteen audio-reactive GPU scenes, including ray-marched 3D forms, a perspective tunnel, luminous ribbons, star fields, and audio instruments. Includes bloom, feedback trails, preset dissolves, a searchable visual gallery, theater view, intensity, previous/next/random, music-aware Auto show, and 30/60 fps targets.
- Standalone visualizer with native system-output and input-device capture. Music playing in Chrome, YouTube Music, or another app can drive the show without a library track.
- LAN broadcast from the media controls, with automatic discovery, direct-address joining, room invitations, synchronized seek, and independent room volume/output.
- Static and smart playlists with custom images, drag-to-playlist, drag to reorder, right-click editing and deletion, M3U/M3U8 import, and M3U8 export.
- Single and batch metadata editing with shared cover artwork, album grouping, ratings, per-field Undo, and a change preview; user overrides survive rescans.
- Context menus follow the song, selected group, album, artist, playlist, video, audiobook, or queue entry under the pointer.
- MusicBrainz match lookup with a request queue, rate limiting, session cache, and manual acceptance.
- Recoverable embedded MP3/FLAC writes, encoded-audio verification, and backup restoration with conflict detection.
- Local movie/episode NFO reading and export, custom cover artwork with generated still-frame fallback, and UTF-8 SRT/WebVTT subtitles.
- Jellyfin sign-in, up to 5,000 audio/movie/episode items per connection, authenticated direct-play streaming, and progress reporting. Tokens remain in native process memory and sign-out clears the session.
- JSON library backup and merge restore.

## Ratings and organizing your music

Every song row has **1–5 stars**. Click a star to rate a song; click its current star again to clear it. Rating does not select the song or start playback. **Sort → Rating** orders the library by your scores. Right-click a selected group and choose **Set rating** to rate several songs together.

Right-click follows the item under the pointer. If that item belongs to your selection, the menu applies to the selected group; clicking outside the group targets that item alone. Menus include play, play next, queue, playlist, favorites, metadata, and ratings as applicable. Queue entries also offer removal. **Shift+F10** opens a focused song's menu; arrows navigate and Escape dismisses it. Blank app surfaces show library actions instead of browser Reload; text fields retain normal editing menus.

To collect songs into one album:

1. Select songs with Cmd/Ctrl-click, Shift-click, or **Select all**, then choose **Edit metadata** in the toolbar or right-click menu.
2. Enter a shared **Album**. For different performers, **Use Various Artists** sets the Album artist while preserving each song's individual Artist and Title. Mixed fields remain unchanged until you edit them. Use each field's **Undo** to keep its original values.
3. Open **Cover art → Choose cover image** to apply one front cover to the group. JPEG and PNG are accepted up to 8 MB, 8192 pixels per side, and 32 megapixels. Removing/replacing a front cover preserves other embedded pictures.
4. Review the affected items and changed fields. Choose **Elysium library** for personal organization or **Library + compatible files** to embed changes into MP3/FLAC files too. Only explicitly changed fields are written. Stop playback before choosing file writes for the open item.

To edit or delete a playlist, right-click it in the sidebar. **Edit playlist** can change its name or attach an image; without one, the playlist uses available album artwork. Deletion asks for confirmation and keeps your songs and original files. Right-click a song and choose **Remove from library** to remove the entry while retaining the file; explicit file import adds it again.

Song-row ratings automatically save in the library and attempt compatible file embedding. MP3 uses Elysium's own ID3 **POPM** owner (`ratings@elysium.local`, an identifier, not a network address), preserving other owners and counters. Its 1–5 values are 1/64/128/196/255; unrated is 0. FLAC uses a **RATING** comment at 20/40/60/80/100, or 0. Existing MP3 ratings prefer Elysium, then Windows Media Player, then another owner. The [ID3 specification](https://id3.org/id3v2.3.0#Popularimeter), [Mp3tag field mapping](https://docs.mp3tag.de/mapping/), and [Picard mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html) informed this implementation; rating conventions vary among players. MP4's advisory rating is not used for personal stars.

Other formats keep these edits in Elysium. Read-only files, unsupported specialized tags, and file verification failures also retain personal edits in the library and produce a report. Changes survive rescans and app restarts. File writes retain a backup, verify unrelated metadata and the encoded audio, and replace the original only after verification. **Source & recovery** can restore the most recent successful file backup. Library overrides remain your personal organization.

## Audiobooks

Open **Audiobooks** and choose **Add audiobooks** or **Add folder**. M4B files are automatically recognized as books. Import MP3, M4A, FLAC, and other audio from this section, or choose **Audiobooks** as a folder's content type, to separate spoken audio from Songs. Each file keeps its own progress; multi-file books retain a position per file.

**Continue listening** resumes the last saved position, including after switching books or quitting the app. Checkpoints are written while playing and on pause/seek, with synchronous local recovery between database saves. The player offers **−15s**, **+30s**, and **0.5×–2×** speed. Completed books can be played again from the beginning. Progress is local to each installation.

To share a book around the house, start the book and choose **Broadcast** in the media controls. The broadcast starts from the current position. The broadcaster saves the position actually presented on the broadcast clock, not the decoder's buffered position. Other rooms join live and can pause/resume locally. Their local book checkpoints are unaffected.

## Live video broadcasts

Start a local movie or episode and choose **Broadcast** in the media controls. On another Elysium computer, open **Listen to broadcasts**, join, and choose **Watch video**. The sender encodes up to 1080p, 720p, and 480p (never exceeding source height), with a six-second startup buffer. Open a video’s **Get Info → Cover art** to choose a custom cover or return to its automatic video still.

**Auto · keep live** adapts picture quality to the connection. High, Medium, and Low cap the chosen stream to a fixed rendition. Audio follows the shared room clock; picture playback corrects drift toward that clock. On a listener, **Pause here** pauses only this room and **Resume live** returns to the current broadcast moment, including if the program changed while paused. On the host, **Pause broadcast** freezes the broadcast for every room; resuming starts again at that position after buffering. Each room has its own volume, output, timing adjustment, and video quality. Local subtitles are not transmitted. Video broadcasting uses local library files, not browser/screen capture or protected streaming services.

Video needs a current WebView with Media Source Extensions and H.264 support; encoding three renditions requires more CPU than music. Multi-computer acoustic sync, Windows hardware, and stressed-network adaptive quality still require physical-device qualification; see [TESTING.md](docs/TESTING.md).

## Retro visualizers

Open **Visualizer** in the sidebar, even with an empty library. Album artwork is the default; a chosen visualizer remains selected as songs change. Choose **Atmospheres** to browse actual render previews, or use the preset picker, arrows, and random button below the stage. **Theater** fills the window; controls fade after three idle seconds and return on pointer movement or keyboard input. Start with **Chromatic Current** for flowing iridescent color, **Fractal Sanctuary** for continuously changing Julia branches, or **Aurora Cathedral** for layered silk curtains. **Prismatic Alchemy** and **Cosmic Bloom** also have evolving organic forms. **Auto show** waits 45–80 seconds and changes scenes on a musical accent or quiet passage, excluding meters and avoiding immediate repeats. **Intensity** adjusts the light output. Left/right arrow keys change presets, **T** toggles theater, and **Escape** returns to the library. Space controls Elysium playback or stops device listening when external audio is selected.

To visualize YouTube Music or another app:

1. Open **Visualizer**, then click the audio source button at the top of the stage.
2. Under **System audio**, choose the output device that Chrome is playing through (for example, your headphones).
3. Click **Start listening** and grant the operating system's audio permission if asked.
4. Play music in the other app. The live input meter shows the received signal; **Stop listening** releases the device.

The same picker lists microphones, audio interfaces, and installed loopback inputs. Microphones hear the room; loopback inputs hear whatever is routed to them. System-output capture uses CoreAudio process taps on macOS 14.6+ and WASAPI loopback on Windows. On macOS, output-only endpoints are offered for system capture; duplex devices that expose a combined input/output endpoint require a dedicated loopback input. Older macOS versions retain the library player and audio-input capture. Hardware and driver support varies.

Elysium pauses its own player when starting device capture. Captured samples are analyzed in a bounded memory buffer and are never saved, sent over the network, or monitored back through the speakers. Capture stops when leaving the visualizer, entering the mini-player, switching back to the player source, or closing the window. Capture does not resume automatically on app launch. Unplugged devices report an error and require an explicit reconnect.

| Collection                    | Effects                                                |
| ----------------------------- | ------------------------------------------------------ |
| Elysium living worlds         | Chromatic Current, Fractal Sanctuary, Aurora Cathedral |
| Windows Media Player inspired | Prismatic Alchemy, Spectral Ocean, Dot Plane           |
| iTunes inspired               | Classic Light Ribbons, Celestial Orbits, Stardust      |
| Original Xbox inspired        | Emerald Reactor, Liquid Chamber, Verdant Matrix        |
| Xbox 360 inspired             | Neon Continuum, Infinity Tunnel, Cosmic Bloom          |
| Elysium essentials            | Spectrum, Oscilloscope, Ambient Glow                   |

The renderers use the selected audio source’s waveform, logarithmic frequency bands, fast and slow bass/mid/treble envelopes, spectral flux, and independent percussion attacks. The large stage uses bounded feedback textures, quarter-resolution bloom, tone mapping, and 1.8-second preset dissolves. [Research and rendering design](docs/VISUALIZER_DESIGN.md) explains the musical mappings and original shader techniques. A Canvas compatibility renderer handles unavailable or lost GPU contexts. Spatial animation freezes when paused and during silence. Hidden windows stop drawing; the full-stage renderer unmounts when leaving Now Playing or entering the mini-player. Balanced rendering targets 30 fps; Smooth targets 60 fps, subject to hardware and WebView performance. Both cap the backing resolution (0.9 megapixels at 30 fps, 1.8 megapixels at 60 fps). These are frame-rate targets, not a hardware performance guarantee.

**Preferences → Sound & visuals → Reduce visualizer motion** stops spatial animation while retaining a slower response to audio. System reduced-motion preferences are always respected, and automatic preset changes are suspended in reduced motion.

These are original Elysium interpretations of the era, not the original Apple/Microsoft/Llamasoft engines or a pixel-identical emulation. Proprietary visualizer binaries, WMP plug-in DLLs, iTunes plug-ins, Xbox assets, and third-party preset packs are not included. There is no plug-in import in this release.

## LAN broadcast

On each computer, turn on **Preferences → LAN broadcasting → Enable LAN broadcasting**. This setting is remembered across app launches. Room name, audio output, volume, timing, and automatic invitation acceptance are also configured there.

1. Play a local song, audiobook, movie, or episode and choose **Broadcast** in the bottom media controls. If LAN broadcasting is off, the app offers a link to the preference. The broadcast starts at the current position and plays the remaining local queue once.
2. On another computer, open **Listen to broadcasts**, choose a discovered broadcast, and select **Join**. If discovery is blocked, enter the broadcaster’s LAN address under **Join by address**. New listeners tune in to the current position.
3. The host can open **Listen to broadcasts → Share your current broadcast** to copy an address, invite idle rooms, or disconnect listeners. An idle room with **Accept playback requests while idle** enabled joins automatically; otherwise it receives an invitation.
4. The host controls playback, seeking, and stopping from the media bar. Choosing another library item switches the active broadcast while keeping rooms connected. A listener can pause its own room and resume live; volume affects only that room. Video quality is set in Preferences or the video player.

The implementation sends 48 kHz, stereo, 16-bit PCM in timestamped chunks with approximately 1.2 seconds of lookahead. Clients estimate clock offset and render against predicted device playback time to compensate drift. This uses about **1.54 Mbit/s per listener**, plus transport overhead. A lost listener connection retries for up to 30 seconds. Actual room-to-room acoustic alignment still requires testing on your Mac/Windows devices, particularly Bluetooth outputs with hidden latency.

This version broadcasts **local library files**, including mounted folders. It does not rebroadcast Chrome/system capture, Jellyfin, or other streaming services. It supports private/link-local IPv4 networks and direct IPv4 addresses, with Bonjour/mDNS discovery; guest Wi-Fi isolation or firewall rules can prevent discovery or connections. It has no Internet relay, accounts, encryption, or pairing authentication: enable it on a trusted home LAN. Peers receive audio, generated video segments when applicable, and track metadata; they do not receive original file paths or library-editing access.

Keep Elysium open on the host and listening computers. Active sessions request prevention of idle system sleep while allowing screen sleep and locking; explicit sleep, closing a laptop lid, quitting, or closing the window can still end playback. There is no background service or automatic startup station in this build. Local-player equalizer and volume do not alter LAN audio; use the room controls.

## Current limits

This build uses the operating system's WebView media decoder. Unsupported local files fall back to a bundled FFmpeg helper that prepares AAC audio or H.264/AAC video in a local cache. **Preparation finishes before playback starts**, so a large or unusual movie may take several minutes and substantial disk space. FFmpeg work is cancelled when you change to another item or close the app. Cached compatible files are currently retained; their location is listed below.

This is a deliberate test-release backend, with a separate native-player evaluation still on the roadmap. It does not yet provide certified gapless transitions, native libmpv playback, ReplayGain, crossfade, HDR/surround qualification, embedded audio-track selection, chapters, or subtitle/audio timing adjustments. The current video conversion selects the first video/audio streams; externally loaded SRT/VTT subtitles are supported.

Jellyfin is direct-play only. The app does not request server transcoding yet, does not persist server sessions across restarts, and does not edit remote metadata or favorites. Local progress is durable; failed remote progress requests currently require another successful playback checkpoint rather than a durable retry queue. A real server is required to qualify the integration against your server's version and codecs.

Online movie/poster enrichment, AcoustID fingerprinting, lyric providers, arbitrary smart-playlist rules, iTunes XML import, WMP `.wmz` import, projectM, a separate floating video window, and Linux qualification remain planned work. Metadata writes are enabled only for MP3/FLAC files whose tag data can be preserved; specialized frames may require library-only edits. Batch writes report per-file failures rather than claiming the whole batch succeeded.

## Install from GitHub

The installers build the official `main` branch locally. They install missing build dependencies, fetch the repository into a managed folder, verify the selected commit belongs to `main`, build with the locked Rust and npm dependencies, and install the finished application. The first build can take several minutes and needs a few GB of free space and an Internet connection. Run as your normal user; platform installers may request administrator approval for system build tools.

**Private repository:** raw GitHub download links require repository access. If you cannot download the script while signed out, download it from GitHub while signed in, or use an authenticated checkout (`gh auth login`, `gh auth setup-git`, then `gh repo clone ooberguts/Elysium`). Run the relevant script from its `scripts` folder. Git needs credentials with read access for both installation and future updates; Elysium does not ask you to save a GitHub token in the app. On Windows, Git Credential Manager can also open a sign-in window during the first clone.

### macOS

Requires **macOS 13.5+** on Apple Silicon or Intel to run the Node.js build tools. In Terminal, from a downloaded/authenticated checkout:

```sh
bash scripts/install-macos.sh
```

For a repository accessible without authentication, download and run the installer directly:

```sh
installer="$(mktemp -t elysium-install)"
curl --fail --location --retry 3 https://raw.githubusercontent.com/ooberguts/Elysium/main/scripts/install-macos.sh -o "$installer" && bash "$installer"
rm -f "$installer"
```

The script opens Apple's Command Line Tools installer if needed and waits for you to finish it. It installs a private, checksum-verified Node.js 24 toolchain if your Node is missing or too old, and installs/updates Rust stable through rustup. It builds and verifies the locally signed application before replacing an existing copy, then opens Elysium.

- Installed app: `~/Applications/Elysium.app`.
- Managed checkout: `~/Library/Application Support/Elysium/source/`.
- Private Node toolchain and install logs: `~/Library/Application Support/Elysium/tools/` and `logs/`.
- Override the app location with `--app-dir /Applications` if you can write there, or the managed folder with `--root /absolute/path`. Use `--no-launch` to skip opening the installed app.

### Windows

Requires **Windows 10/11 x64** and 64-bit PowerShell 5.1 or newer. From a downloaded/authenticated checkout, run in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

For a repository accessible without authentication:

```powershell
$installer = Join-Path ([IO.Path]::GetTempPath()) ('elysium-install-' + [guid]::NewGuid().ToString('N') + '.ps1')
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/ooberguts/Elysium/main/scripts/install-windows.ps1 -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
Remove-Item $installer
```

The script installs missing Git and Visual Studio C++ Build Tools/Windows SDK using WinGet, bootstraps WinGet if missing, installs a private checksum-verified Node.js 24 toolchain if needed, and installs/updates Rust stable with the MSVC toolchain. The Windows installer installs WebView2 when needed, creates the normal app/uninstall entries, and opens Elysium. If a system tool requests a restart, restart Windows and rerun the script.

- Installed app: `%LOCALAPPDATA%\Programs\Elysium\`.
- Managed checkout: `%LOCALAPPDATA%\Elysium\source\`.
- Private Node toolchain and logs: `%LOCALAPPDATA%\Elysium\tools\` and `logs\`.
- Override locations with `-AppDir C:\path\Elysium` or `-Root C:\path\Elysium-build`. Use `-NoLaunch` to skip opening the installed app.

### Versions and updates

The **Git commit is the build version**. Elysium shows its 12-character commit in the header and in **Preferences → Updates**; hovering the commit shows the full 40-character SHA, and Preferences links to that commit on GitHub. The package's base version (currently `0.2.0`) remains available alongside it. Builds with uncommitted files show **Local changes** so they cannot be mistaken for the published commit.

Startup checks are enabled by default and can be switched off in Preferences. **Check for updates** compares the full installed SHA with GitHub `main`; a different SHA displays an Update badge beside Preferences. **Install <commit>** opens Terminal/PowerShell and runs the installer embedded in the installed executable, pinned to the commit you checked. It builds while Elysium stays open; when the terminal says the build is ready, quit Elysium to finish. The installer installs to the current app folder and reopens it. This is a source-build update, so it can install missing build tools and needs the same repository access as the initial installation.

Checks use GitHub's API, falling back to Git's configured credentials for a private repository or API rate limits. Network/authentication failures appear in Preferences and leave the installed app in place. Development builds, unknown-source builds, and builds with local changes can check versions but cannot launch an app update. A failed installer leaves a log in the folder above; correct the issue and reopen Elysium to retry. The managed checkout must be clean, and another installer cannot run concurrently. Library data stays in the separate [application-data folder](#data-and-recovery).

To install a particular historical commit from `main`, supply its full SHA:

```sh
bash scripts/install-macos.sh --commit FULL_40_CHARACTER_SHA
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Commit FULL_40_CHARACTER_SHA
```

The macOS installer stages and verifies the replacement beside the destination and restores the previous app if the final move fails. Windows builds the new NSIS installer before starting installation. A small `.elysium-install.json` beside the installed app records a custom managed folder so app updates reuse it. Neither installer resets or discards edits in its managed checkout. Do development work in a separate checkout.

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

Run `npm run prepare:media` before native tests. The native suite exercises real generated media, including MP3/FLAC writing, encoded-audio preservation, recovery, conflict detection, and rescan behavior. Frontend tests cover queue transitions, shuffle, search, release grouping, smart rules, playlist order, frequency analysis at three sample rates, silence/transients, frame-rate-independent envelopes, preset compatibility, and rotation timing. Native capture tests cover FFT peaks at three sample rates, silence, bounded chronological buffering, stale session stops, and cancellation during a pending permission request. For browser GPU integration checks, run `npm run dev` and open `http://127.0.0.1:1420/scripts/visualizer-check.html`; this development-only harness verifies every scene, GL errors, reduced motion, pause, intensity, and preset dissolves.

macOS packages are generated under `src-tauri/target/release/bundle/macos` and `bundle/dmg`. Windows NSIS installers are generated under `bundle/nsis`. GitHub Actions builds and tests macOS and Windows, with installer artifacts attached to each run. Tagged versions also attach installers to a release in the same repository.

## Data and recovery

Elysium uses the platform application-data folder for `com.ooberguts.elysium`:

- macOS: `~/Library/Application Support/com.ooberguts.elysium/`
- Windows: `%APPDATA%\com.ooberguts.elysium\`
- Linux development: the standard XDG data directory for this identifier.

`library.sqlite3` contains the library. `artwork/` holds cached artwork, `compatible/` holds prepared playback files, `demo/` holds the copied sample library, and `backups/` holds originals and write journals for explicit embedded-tag edits. Backups are currently retained until you remove them yourself. JSON exports contain metadata and source locations, not your media or binary tag backups.

The **Source & recovery** tab in Edit metadata can restore the most recent embedded-tag backup. Restoration refuses to overwrite a file that has been changed externally after the edit. Keep normal backups of your collection independently of Elysium.

## Source layout

`src/` contains the React interface, native bridge, queue/playback controller, and domain rules. `src-tauri/src/` contains the SQLite store, scanner, metadata writer, providers, native commands, and authenticated Jellyfin streaming proxy. `scripts/` prepares the platform helper and generates original sample media. All imported media and credentials are excluded from the repository.

## Third-party software

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The FFmpeg helper's actual license and build/source information are copied alongside it into every bundle. Elysium's own source is private; this repository does not grant a public redistribution license for it.
