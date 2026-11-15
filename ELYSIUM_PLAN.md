# Elysium product and engineering plan

Draft direction · November 13, 2026

Elysium is a desktop media center for people who want to own, organize, enjoy, and maintain their music and video collections. Its default interface brings back the organized library and tactile controls of early 2000s iTunes, adds the playful mini-player and visual character of Windows Media Player, and uses modern artwork, queues, search, and browsing where they improve everyday use.

The first public release includes music, movies, TV shows, network libraries, metadata editing, visualizers, and a mini-player. Development proceeds through small working milestones across those capabilities. Windows and macOS are the initial release platforms; Linux is a proposed additional desktop target. Here, “PC” means Windows unless a separate Linux release is requested.

## Product identity

The main experience is a collection you can understand at a glance: familiar source sidebar, persistent playback controls, a useful browser, and a library that rewards careful organization. Modern discovery comes from the user's own collection: forgotten albums, recently added movies, unfinished episodes, favorites, and smart playlists.

| Influence | Elysium interpretation |
| --- | --- |
| Early iTunes | Dense song tables, genre/artist/album column browser, playlist folders, ratings, album grouping, Get Info editor, restrained silver chrome, clear playback display. |
| Windows Media Player | Expressive mini-player themes, LCD-style readouts, visualizers, full-screen Now Playing, optional compact layouts. |
| Spotify | Strong album and artist pages, clear queue, artwork-focused browse views, quick search, contextual actions, comfortable dark mode. |
| VLC | Broad playback targets, subtitles and audio tracks, reliable seeking, playback speed, sync adjustments, useful playback diagnostics. |
| Kodi | Movies and series collections, poster browsing, local artwork and NFO metadata, a couch-friendly full-screen mode. |
| Jellyfin | Optional existing-server connection, server libraries, playback negotiation, watched state, and resume synchronization. |

Elysium has its own name, icon, artwork, and design assets. The default home screen is the library; “For You” recommendations remain an optional view. Local playback and library management work without an Elysium account.

## Interface and navigation

### Main desktop window

Use a silver or graphite toolbar with back/forward navigation, transport controls, track display, volume, and search. Below it, a persistent source sidebar leads to Home, Music, Movies, TV Shows, Music Videos, Playlists, Sources, and Downloads when available. Keep imports, network state, and background activity in a quiet status area.

Music defaults to a sortable song table. An optional column browser above it filters Genre → Artist → Album; selecting a column value narrows the next column and the table. Support multiple selection, drag to playlist, keyboard navigation, reorderable columns, and saved per-view sort order. Album and artist views are one click away. Dense, comfortable, and large-text settings change spacing without hiding core actions.

An optional right drawer holds Up Next, lyrics, or information. The bottom playback strip can remain visible while the user browses music or video; the toolbar and strip must never present conflicting playback state. Artwork, duration, source availability, and the selected item remain legible at common desktop sizes.

### Video and theater views

Movies use posters, collections, genres, and a detail page with synopsis, cast, runtime, editions, and Play or Resume. TV uses series → season → episode navigation, with explicit episode ordering and next-episode behavior. Home combines Continue Watching, Recently Added, Favorite Albums, and Recently Played.

Theater mode uses large focus targets, directional navigation, visible focus, a Back action, a simplified on-screen player, and an easy way back to the desktop library. First-release couch control uses the keyboard and remotes that expose standard keyboard/media keys. Specialized gamepads and a phone remote are later integrations.

### Mini-player and floating video

Provide three Elysium layouts: a slim transport bar, an artwork player, and an LCD/spectrum player. Each offers play/pause, previous/next, seek, volume, title, pin/unpin, and return to library. Queue and metadata are optional expansions. Remember size and position per display and recover windows placed on disconnected monitors.

The mini-player is a second window controlling the same playback session. A floating video window provides app-level picture-in-picture; native OS picture-in-picture can follow platform feasibility. Tauri exposes always-on-top controls, with a dedicated capability permission. Test behavior across macOS Spaces and Windows full-screen applications rather than promising identical placement everywhere. [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setalwaysontop)

### Visual design rules

Start with Classic Silver and Graphite themes. Use thin dividers, modest bevels, a blue selection color, readable tables, and a restrained LCD display. Add WMP-inspired shapes and color to the mini-player and Now Playing views. Keep native menus, keyboard conventions, readable focus states, high contrast, reduced motion, and scalable text. Build a later Cover Flow-style album browser as an optional view; it belongs to a later part of the iTunes era and should not define the early-iTunes default.

## First release scope

“Complete media center” means the desktop app can organize and play both music and video from the first release. It includes an optional Jellyfin client connection. A new home media server, live TV service, or streaming subscription catalog would each be a separate product expansion.

| Area | Required for the first public release | Expansion |
| --- | --- | --- |
| Music | Local/NAS libraries, song/album/artist views, gapless target for compatible albums, queue, playlists, smart playlists, ratings, favorites, basic EQ and ReplayGain. | Crossfade, advanced DSP, exclusive output modes, CD ripping, device sync. |
| Movies and TV | Posters, details, seasons/episodes, watched state, resume, editions, subtitle/audio selection, chapters, speed, sync offsets, full-screen and floating video. | Live TV, DVR, optical-disc navigation, advanced HDR and surround certification. |
| Metadata | Manual and batch music edits, artwork, online match preview, field locks, format-specific file writing, movie/TV overrides and NFO sidecars. | Broader tag-format coverage, advanced credits, extensive automatic organization rules. |
| Sources | Local folders, external drives, OS-mounted shares, Windows UNC paths, refresh/reconnect, existing Jellyfin server. | Built-in SMB/NFS login and discovery, WebDAV/SFTP, portable offline pinning. |
| Personalization | Silver/graphite library, original mini-player themes, spectrum/waveform visualizers, reduced-motion mode. | Selected original WMP skin import, projectM presets, a broader theme ecosystem. |
| Portability | Windows and macOS packages, export/backup, playlist import/export, keyboard/media controls. | Linux release, cross-device Elysium profile sync, mobile companion. |

Core scope stays visible throughout development: every internal alpha must exercise both an audio and a video path.

## Music experience

Support a tested audio matrix beginning with MP3, FLAC, AAC/M4A, ALAC, WAV, AIFF, Ogg Vorbis, Opus, and WMA where the selected build supports it. Distinguish file decoding from tag editing: a file may play before safe write support is available. Files protected by a provider's DRM need that provider's authorized playback integration.

Model albums as specific releases with discs and track order. Store track artist separately from album artist, preserve featured and multiple artists, and support compilations, composer, genre, release date, original release date, artwork, lyrics, MusicBrainz IDs, and sort fields. Technical fields such as duration and sample rate are measured values. Ratings, play counts, history, and preferences belong to the library unless the user explicitly exports them.

The queue supports Play Next, Add to End, reorder, remove, repeat, shuffle, and persistent recovery. Define shuffle as a stable sequence so Back returns to the actual previous item. Define when an album selection replaces the queue and when it appends. Switching to a movie uses the same active playback session; retaining the suspended music queue makes returning straightforward.

Smart playlists use a visual rule builder: examples include “rating at least four stars and not played in 90 days” or “added this month and lossless.” Store rules as a versioned expression tree and compile them into parameterized queries. Permit playlist folders, static ordering, M3U8 import/export, and best-effort iTunes XML import of files, playlists, ratings, and counts with an unresolved-path report.

Use explicit music and video audio profiles. ReplayGain and EQ should not silently change movie loudness settings. Start with ReplayGain playback from existing tags; a background analysis job can calculate missing values after the analysis pipeline is proven. Crossfade requires overlap, mixing, and queue semantics beyond ordinary gapless playback and remains a separate feature.

## Video experience

Target common MP4/M4V, MKV, MOV, WebM, AVI, and MPEG-TS containers with H.264, HEVC, VP9, and AV1 samples. Publish results by codec profile, bit depth, resolution, audio format, subtitle type, hardware, and OS. A filename extension alone is not a compatibility claim. mpv provides a broad native decoding and subtitle foundation, but Elysium must validate its own shipped build. [mpv manual](https://mpv.io/manual/stable/)

Include embedded and external SRT/ASS/SSA subtitles, image subtitles where tested, language/default/forced track selection, subtitle appearance, subtitle delay, audio delay, chapters, playback speed, and persistent per-item preferences. Keep HDR tone mapping, HDR passthrough, and multichannel passthrough separately identified in the capability matrix; they depend on the renderer and output chain.

Use conservative filename parsing for title/year, season/episode, and editions. Let users correct matches, choose an alternate episode order, and group multi-episode files or multiple versions. Home videos and unmatched material remain playable with editable local details. Do not force every item through an online catalog.

Store resume and watched state per profile. Save progress periodically and on pause/stop. Restore near the recorded time with a small optional rewind. Give next-episode countdowns a clear cancel control. Avoid treating credits or a short preview as a completed watch without a documented rule the user can change.

## Metadata editing and enrichment

The Get Info editor has Details, Artwork, Sorting, Technical, and Source tabs. Batch edits show mixed values, apply only intentionally edited fields, and provide a before/after preview. Local field locks protect deliberate corrections from later scans or online updates.

Maintain original observed values, proposed provider values, and user overrides separately. Each proposal records its provider, ID, confidence, fetch time, and attribution. Default precedence is locked user override → user-selected local metadata → embedded tags/NFO → accepted provider data → filename inference. Provide an explicit reset-to-source action; a background scan must not silently remove a user's correction.

For music, use MusicBrainz for identities and releases, with optional Chromaprint/AcoustID matching for poorly labeled recordings. A fingerprint identifies a recording candidate; album edition selection still needs release matching. Queue provider work, cache results, send an identifying User-Agent, and observe MusicBrainz's one-request-per-second limit. AcoustID documents a three-request-per-second limit and separate commercial arrangements. [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [AcoustID web service](https://acoustid.org/webservice)

For movie/TV enrichment, use a TMDB adapter after API setup, with required attribution and the appropriate commercial arrangement if the product becomes commercial. Local tags, NFO, artwork, and manual editing remain available when providers are offline. Treat cover-art retrieval and its usage terms as their own provider integration. [TMDB API FAQ](https://developer.themoviedb.org/docs/faq)

Use Lofty as the initial Rust tag-reading/writing candidate, with a tested write allowlist for each actual container/tag combination. Generic tag conversions can lose format-specific detail, so preserve unknown fields and reject a write that cannot meet the preservation contract. Video edits default to the database and compatible NFO sidecars; rewriting video containers is a later explicit operation. Kodi's NFO format is a useful interchange target for local video metadata. [Lofty documentation](https://docs.rs/lofty/latest/lofty/), [Kodi NFO documentation](https://kodi.wiki/view/NFO_files)

File writes use this transaction:

1. Resolve a file by stable asset ID and inspect writability, current size/mtime, identity, and active playback use.
2. Show selected changes and destination: library only, embedded tags, or sidecar. Defer writes to files currently held open when required by the OS or engine.
3. Create a recoverable backup and a staged file on the destination filesystem where supported. Retain attributes that the writer can safely preserve.
4. Write the chosen fields, reopen and parse the result, check unaffected tags and artwork, and verify that the audio payload remains unchanged using format-aware validation.
5. Recheck the original file identity and modification state, then replace it using a validated filesystem operation. Record a durable job state and update the database after confirmation.
6. On an interrupted network write or failed validation, keep the backup and show a recoverable error. NAS replacement and locking behavior need dedicated tests; an application database transaction cannot make a remote file write atomic.

A batch operation is a collection of recoverable per-file writes, with success/failed/skipped results. Undo restores backed-up bytes when available and clearly states its retention period. File renaming, moving, deletion, and automatic folder organization require their own previews and never happen as a side effect of a metadata refresh.

## Network and external libraries

The first release reads folders mounted through the operating system: mapped drives or UNC paths on Windows, mounted volumes on macOS, and mounted paths if Linux is added. The operating system handles share authentication initially. “Add Source” offers Local Folder, External Drive, Network Folder, and Jellyfin Server with connection guidance.

Store source identity separately from its current mount path and each item's relative path. Rebinding a source after a drive-letter or mount change should preserve playlists, ratings, and watched state. Cache metadata and appropriately sized artwork locally; keep the database on local storage. A source may be online, disconnected, unauthorized, scanning, or partially available.

Use incremental scans with bounded concurrency, cancellation, resumable checkpoints, symlink rules, file-stability checks for incomplete copies, and separate enumeration/metadata/artwork jobs. Prioritize a file the user chooses to play. Filesystem watchers are a fast refresh signal; scheduled reconciliation and manual refresh remain necessary because network filesystems may emit no useful watcher events. [notify network filesystem notes](https://docs.rs/notify/latest/notify/#network-filesystems)

An unreachable source retains its library records and displays Offline. Only a successful source enumeration can mark an individual file missing; permanent cleanup is an explicit action. Retry with backoff, avoid blocking the UI on a dead share, buffer playback within limits, and offer reconnect or locate-source actions. Track content identity carefully when duplicate files exist: two copies of one recording are separate assets and may carry different metadata.

## Jellyfin and Kodi integration

Build Jellyfin as an optional source adapter with sign-in, library browsing, artwork, playback information, track selection, progress reporting, watched/favorite actions, session stop, and sign-out. Target a declared server-version range and test it; Jellyfin's official TypeScript SDK publishes a version compatibility table. Keep long-lived credentials in an OS credential store, and route authenticated playback through the native adapter without exposing tokens in logs or arbitrary URLs. [Jellyfin TypeScript SDK](https://typescript-sdk.jellyfin.org/)

Prefer Direct Play when the measured capabilities support the entire stream. Request server remuxing or transcoding when necessary, and show the actual playback method. The server performs conversion; Elysium is a client in this release. Jellyfin documents that container, video, audio, and subtitle compatibility all affect playback decisions. [Jellyfin codec support](https://jellyfin.org/docs/general/clients/codec-support/)

Namespace server IDs by server and user. Store remote progress changes in a bounded retry queue; acknowledge successful server writes and prevent old queued events from overwriting newer known state. Separate local overrides from edits to server metadata, which require the server user's permissions. Offline downloads require a later cache/entitlement/cleanup design and should not be implied by cached artwork.

Kodi interoperability begins with tested movie, show, episode, artist, and album NFO/artwork conventions. Support an identified subset and preserve unsupported fields when round-tripping. Music discovery still starts from audio tags; Kodi album NFOs supplement scanned music rather than creating track entries by themselves. Direct control of a running Kodi instance is a later adapter. [Kodi album NFO documentation](https://kodi.wiki/view/NFO_files/Albums)

## Visualizers and skin compatibility

### First release visualizers

Ship an original spectrum display, oscilloscope, and restrained ambient visual. Offer full-screen, in-window, and mini-player presentation, preset selection, brightness, frame-rate cap, and reduced motion. Stop rendering when hidden and scale down on battery. A display should respond to the active media's actual audio, including seek/pause and playback rate.

Prove the audio-analysis route during engine selection. libmpv control APIs do not by themselves provide a general decoded-PCM callback. Evaluate a supported native analysis filter or controlled analysis branch synchronized with the playback clock, including network/authenticated sources. Send small amplitude/frequency frames to the UI at a bounded rate; keep full audio buffers out of general frontend events. Do not rely on system loopback capture as the normal cross-platform solution. An analysis failure should disable the visualizer while playback continues.

Evaluate projectM after the PCM/rendering path works. It is a reusable cross-platform MilkDrop-style visualization library; its native rendering and preset licensing add work beyond a browser spectrum display. Treat the core library and bundled preset packs separately. [projectM repository](https://github.com/projectM-visualizer/projectm)

### Original Windows Media Player skins

Original-skin support is a compatibility project with a test corpus and a supported-feature list. WMP skin files combine a `.wms` definition, bitmap art, and optional JScript; compressed `.wmz` packages contain those resources. Layouts and behavior depend on WMP's original object model. Microsoft also documents the removal of skin support from WMP Legacy starting November 10, 2026 on Windows 11 24H2 and later. [Microsoft skin files](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/wmp/skin-files), [Microsoft supported file types](https://support.microsoft.com/en-gb/windows/apps/windowsmediaplayer/file-types-supported-by-windows-media-player)

Use three compatibility levels:

| Level | Behavior | Release placement |
| --- | --- | --- |
| Elysium themes | Original assets and a declarative manifest for artwork, controls, layouts, and visualizer slots. | First release. |
| Imported WMP subset | Import user-supplied packages; translate supported static layouts, images, buttons, sliders, text, and a small allowlist of actions. Report unsupported elements. | Follow-up experimental release after a compatibility spike. |
| Complex legacy behavior | Animated regions, unusual window shapes, scripted state, and specialized effects require individual mappings or dedicated compatibility work. | Investigate per skin; no universal promise. |

Extract archives with path and size limits, parse XML without external entities, and translate supported actions into declarative Elysium commands. Imported JScript and native DLLs do not gain application execution privileges. A skin may be importable without being redistributable; bundle original third-party artwork only after its actual license or permission has been established. User-supplied import is not a substitute for checking distribution rights.

Keep skins separate from visualization plugins: a WMP visualizer DLL is a different native extension format and is not covered by `.wmz` support. Windows-only legacy hosting would create a separate maintenance track and would not provide macOS compatibility.

## Proposed technical architecture

Use TypeScript for the interface and application-facing contracts, with Tauri 2 and Rust for native services. React plus Vite is the proposed frontend. The native layer owns authoritative library, source, job, and playback state; windows subscribe to snapshots and sequenced updates. Tauri's process model supports a Rust core with multiple system WebViews, which differ across operating systems. [React](https://react.dev/), [Vite](https://vite.dev/guide/), [Tauri process model](https://v2.tauri.app/concept/process-model/)

| Layer | Proposed choice and responsibility |
| --- | --- |
| Interface | React, TypeScript, Vite, semantic controls, CSS design tokens, virtualized library rows, source and playback drawers. |
| Native application | Tauri 2, Rust services, scoped commands, background workers, lifecycle and window management. |
| Playback | A Rust `PlaybackBackend` abstraction, initially evaluated with mpv/libmpv; native video composition is an early feasibility gate. |
| Library | Local SQLite with migrations and FTS5 search; native service owns queries and writes. |
| Metadata | Lofty behind format-specific adapters; independent provider clients, job queue, file-write journal and backups. |
| Sources | Local/mounted filesystem and Jellyfin adapters; scan and availability state independent of library records. |
| Analysis | Native audio analysis plus bounded spectrum events; UI canvas/WebGL after platform testing. |
| Integrations | OS media controls, menus, tray/menu bar, shortcuts, notifications, credentials, signed updates. |

SQLite FTS5 supplies the initial text index; exact identifiers, structured filters, and smart playlist rules use ordinary indexed columns. Typo-tolerant search can follow measured need. Keep expensive decoding, probes, hashing, and tag work outside UI threads and the asynchronous executor's blocking path. [SQLite FTS5](https://www.sqlite.org/fts5.html)

### Playback engine decision

Prefer evaluating libmpv for a single native audio/video backend. mpv recommends libmpv for embedding, through its C API. A temporary mpv sidecar controlled by JSON IPC is useful for proving commands and decoding, but a separate external player window does not satisfy the final integrated interface. Tauri supports bundling sidecar binaries per target. [libmpv embedding](https://github.com/mpv-player/mpv/blob/master/DOCS/man/libmpv.rst), [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)

The first native spike must prove embedded video on both Windows and macOS, resize/full-screen behavior, UI overlays, multiple displays and DPI changes, keyboard focus, hardware decoding, floating video, engine shutdown, and packaging. Choose between a native child surface and a render-API compositor based on results; macOS and Windows may need different adapters. Capture the decision before building the final video controls. Retain libVLC as an alternative to evaluate if the chosen surface integration fails the requirements.

The backend contract includes load, play/pause/stop, seek, queue transitions, volume, track selection, sync offsets, chapter selection, diagnostics, and capability reporting. A monotonically increasing session generation prevents stale events from the prior file changing the new session. Persist queue and resume checkpoints without creating an extra player per window.

Gapless playback is a measured acceptance target for compatible album encodings and output settings. mpv's documentation explains that device format changes and delayed network startup can interrupt transitions. Preloading and buffering need tests rather than an unconditional “all formats gapless” claim. [mpv gapless audio](https://mpv.io/manual/stable/#options-gapless-audio)

Resolve the exact playback build and distribution model early. mpv is GPL by default, and builds that exclude GPL-only files have additional LGPL-related conditions; dependency selection matters too. Record the engine and FFmpeg configuration, shipped libraries, notices, source/relinking obligations where applicable, and update process before distributing binaries. A sidecar boundary alone does not settle license obligations. [mpv copyright and build conditions](https://github.com/mpv-player/mpv/blob/master/Copyright)

### Suggested project structure

```text
src/
  app/                 shell, routing, window-specific entry points
  features/            music, video, theater, queue, metadata, sources
  components/          tables, column browser, artwork, player controls
  themes/              tokens and original theme definitions
  native/              typed command and event contracts
src-tauri/src/
  library/             database, migrations, queries, search
  playback/            backend interface, engine adapter, session state
  sources/             local mounts, availability, Jellyfin
  metadata/            tags, providers, merge rules, write transactions
  analysis/            audio analysis and visualization transport
  jobs/                scheduling, cancellation, journaling
  platform/            windows, media controls, credentials, native surfaces
tests/fixtures/        generated or redistributable media and metadata cases
docs/                  decisions, supported formats, interoperability
```

Use one application repository with feature modules and explicit native interfaces. Pin dependency versions when implementation begins and commit lockfiles. A theme's manifest schema and metadata provider interface are useful extension points; an arbitrary-code plugin marketplace can wait.

## Library data model

Separate the logical work from the physical file. One movie can have several editions; one recording can appear on multiple releases; one file can contain multiple episodes. Do not merge these relationships based only on title similarity or file hash.

| Entity | Purpose |
| --- | --- |
| Source and source binding | Stable source identity, availability, mount mapping, server/user namespace, scan checkpoints. |
| Media asset | Physical or remote object, locator, identity hints, size/mtime, streams, technical properties, availability. |
| Artist, recording, release, release track | Multiple contributors, specific album editions, disc/track order, repeated recordings. |
| Movie, edition, series, season, episode | Logical video catalog and mappings from assets, including multi-episode files. |
| Metadata observation and override | Source values, accepted values, field locks, provenance, revision. |
| Artwork and subtitle | Source, cache key, dimensions/language, local or remote location. |
| Profile and progress | Local preferences, watched state, resume, ratings, favorites, play history. |
| Playlist and entry | Ordered item references or versioned smart-playlist rules. |
| Playback session and queue | Active item, sequence generation, order, checkpoints and suspended queue. |
| Job, write journal, provider cache | Durable work, retry state, recovery and attribution. |

Keep SQLite and artwork cache in the platform application-data location, outside media folders. Version exports and schema migrations. Provide a consistent backup snapshot and a restore rehearsal; a backup must include the active database state, not just a live database file copied without coordination.

## Platform and operational requirements

Proposed shipping targets are Windows 11 x64 and macOS on Apple Silicon, with Intel macOS included if native engine packaging and testing pass. Windows ARM and Linux are additional qualification targets. Decide minimum macOS version after validating Tauri, engine, renderer, and signing requirements together.

Provide OS media keys and Now Playing integration, file-open associations, drag-and-drop import, native menus, expected Cmd/Ctrl shortcuts, sleep/wake recovery, headphone/output-device changes, and a clear close/minimize/quit policy. A stopped or crashed engine must not leave an orphan process playing audio.

Scope native commands to specific operations, sources, and windows. Skins and downloaded metadata remain data. Restrict media protocols, disable arbitrary engine scripts/config loading, validate helper arguments, and prevent a metadata URL from becoming an unrestricted filesystem or shell operation. Tauri capabilities are the application permission boundary for frontend access. [Tauri capabilities](https://v2.tauri.app/security/capabilities/)

Online lookup is optional. Explain which metadata or fingerprint is sent before enabling a provider. Redact filesystem paths, credentials, and stream tokens from shared diagnostics. Support an exportable diagnostic report and local logs with retention. Signing, macOS notarization, per-architecture playback binaries, update signatures, and clean-machine installation belong in the release pipeline. Engine binaries will materially affect the application's footprint. [Tauri distribution](https://v2.tauri.app/distribute/)

## Quality gates

The figures below are proposed product targets to validate on a declared Windows laptop and Apple Silicon Mac with SSD storage and a documented NAS/network setup. They are not existing benchmark results.

| Area | Initial acceptance target |
| --- | --- |
| Startup | Usable cached library within 2 seconds at the 95th percentile on reference machines, without waiting for source scans. |
| Library scale | Smooth virtualized browsing at 100,000 tracks and 10,000 video items; loaded rows and artwork stay bounded. |
| Search | Cached-library text searches return within 150 ms at the 95th percentile after input debounce. |
| Playback | Local audio begins within 500 ms and ordinary local video within 2 seconds at the 95th percentile for the declared fixture set; report network startup separately. |
| Audio continuity | Compatible album fixtures have no inserted silence or audible click across the transition; compare captured output to a continuous reference. |
| Video | No persistent A/V drift beyond the declared 80 ms target on reference fixtures; show dropped-frame and decoding diagnostics. |
| Multi-window | Mini-player/library actions change one authoritative session with no duplicate playback, including rapid switching and window closure. |
| Metadata | Every enabled write format passes unknown-tag, artwork, Unicode, audio-payload, crash recovery, and backup-restore tests. |
| Network resilience | Disconnect/reconnect, permission failure, mount rebinding, and a partial scan preserve records and recover without UI hangs. |
| Accessibility | Core flows work with keyboard and screen reader, visible focus, 200% text scaling, and reduced motion. |
| Release | Signed/notarized packages install and update on clean machines; migration rollback and data restore are rehearsed. |

Create generated or redistributable media fixtures for damaged tags, malformed images, variable frame rate, multi-disc albums, compilations, mixed sample rates, Unicode paths, missing files, subtitles, odd chapters, multiple audio tracks, and HDR-to-SDR cases. Maintain separate metadata round-trip and playback matrices. Test actual packaged apps on Windows and macOS; browser-only UI tests cannot establish native playback correctness.

Use unit tests for merge rules, queue transitions, parsing, and source identity; integration tests for the database, providers, engine, and write journal; and a small end-to-end suite for import → browse → play → edit → restart. Add fault injection around interrupted writes and source loss. Keep native manual checks for graphics, audio devices, accessibility, and signed installation.

## Delivery milestones

The sequence below assumes two experienced engineers, part-time product/design support, and regular testing on both operating systems. Plan roughly 28–40 weeks to a polished first release, revising the estimate after the native playback spike. A solo build with the same scope is more plausibly 12–18 months or longer. These are planning ranges, with the largest uncertainty in native video composition, audio analysis, and metadata writes.

| Milestone | Planning range | Reviewable outcome |
| --- | --- | --- |
| Feasibility and design | 2–3 weeks | Classic library concept; embedded audio/video on both OSes; PCM analysis proof; packaging and engine-license decision; representative legacy-skin analysis. |
| Working media center foundation | 4–5 weeks | Main window, local database, sources, initial scan, real music/movie/episode playback, shared mini-player session, basic theater navigation. |
| Library and video workflows | 5–7 weeks | Column browser, album/artist pages, movie/TV catalog, posters, editions, queue, resume, subtitles, chapters, smart playlists. |
| Network and Jellyfin | 4–6 weeks | Mounted-share resilience, source rebinding, server authentication, browse/play/progress, capability negotiation and reconnect tests. |
| Metadata and visual personality | 5–7 weeks | Get Info, batch preview, providers, protected write pipeline, NFO subset, original themes, spectrum/waveform/ambient visualizers. |
| Integration and release hardening | 5–7 weeks | Performance targets, media/device/OS checks, imports/exports, backups, accessibility, clean installs, signed updates, release candidates. |

These bands total 25–35 weeks before a 3–5 week contingency. Some work can overlap after stable interfaces exist; the contingency should remain available for native integration and field testing. An internal alpha at the foundation milestone already contains music and video.

## Initial implementation backlog

| ID | Work item | Completion evidence | Depends on |
| --- | --- | --- | --- |
| ELY 001 | Record product scope and platform matrix | First-release checklist and reference hardware chosen. | This plan |
| ELY 002 | Prototype native media surface | Same fixture plays embedded, full-screen, and floating on both OSes. | 001 |
| ELY 003 | Prove audio analysis | Spectrum follows real playback, pause, seek, and rate without interrupting audio. | 002 |
| ELY 004 | Resolve engine packaging | Reproducible build recipe, dependency/license inventory, clean-machine smoke package. | 002 |
| ELY 005 | Implement shell and shared contracts | Library and mini-player render the same sequenced native session. | 002 |
| ELY 006 | Create database and source identity | Migration and backup/restore pass; a source can be rebound without losing references. | 001 |
| ELY 007 | Build resumable scanner | Local and mounted libraries import; cancellation/restart and unavailable sources work. | 006 |
| ELY 008 | Deliver music and video browsing | Song table, column browser, album page, movies and episode navigation use real records. | 005, 007 |
| ELY 009 | Implement queue and progress | Reordering, repeat/shuffle, music/video switching, and restart recovery pass. | 005, 006 |
| ELY 010 | Deliver video control suite | Subtitle/audio tracks, chapter, speed, offsets and watched state pass fixture tests. | 002, 009 |
| ELY 011 | Integrate metadata providers | Caching, matching preview, field locks, rate limits, attribution and offline behavior work. | 006, 008 |
| ELY 012 | Implement recoverable metadata writes | Each enabled format passes corruption, conflict and recovery cases. | 007, 011 |
| ELY 013 | Add Jellyfin adapter | Declared server versions pass browse/play/progress/sign-out and capability cases. | 004, 006, 009, 010 |
| ELY 014 | Ship Elysium themes and visualizers | Theme changes preserve session; analysis and reduced-motion behavior pass. | 003, 005 |
| ELY 015 | Deliver import/export and release pipeline | Playlist and library round trips, signing, updater and clean install pass. | 004, 006, 009, 012 |
| ELY 016 | Investigate WMP import subset | Supported-element inventory, licensed/user-provided sample corpus, conversion report and effort estimate. | 005, 014 |

## Decisions and risks to carry forward

The first implementation decision is the native video/rendering and audio-analysis route. Resolve it before investing heavily in final controls. A mature decoder still needs substantial application integration.

The user has chosen a complete media center for the first release. The recommended default remains early-iTunes library organization, with WMP expression concentrated in mini-player and Now Playing modes, and modern artwork views alongside them. Existing Jellyfin servers supply optional remote libraries and transcoding. Built-in share clients, a new Elysium server, live TV/DVR, casting, mobile sync, CD ripping, projectM, and broad legacy-skin emulation form the expansion roadmap.

Keep the business model and distribution license open until the exact playback build and provider terms have been selected. Treat Linux, Intel macOS, and Windows ARM as explicit qualification decisions. Obtain a small set of representative WMP skins before estimating compatibility coverage; static art-based players and heavily scripted skins have very different costs.

The next concrete build milestone is a real Tauri shell with the Classic library layout, one local music album, one movie and one TV episode, a shared mini-player, and embedded playback on Windows and macOS. It should also prove the audio signal path for visualizers. That milestone establishes the technical foundation for the entire media center.
