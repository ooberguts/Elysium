# Third party notices

Elysium uses Tauri, React, Vite, Rust crates, and JavaScript packages listed in the committed lockfiles. Their respective licenses apply to those components.

## FFmpeg

The build downloads a platform-specific FFmpeg binary through `ffmpeg-static` 5.3.0. This is a third-party binary build, distinct from the license of the JavaScript wrapper. The binary's `ffmpeg.LICENSE` and `ffmpeg.README` files are copied into `resources/bin/` beside the executable in the application bundle. They contain the applicable GPL license and the source/build information supplied with that exact binary distribution.

The upstream binary distribution and its corresponding build/source materials are maintained at [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static). FFmpeg itself is developed at [ffmpeg.org](https://ffmpeg.org/). Review the exact binary, enabled components, and corresponding-source obligations before distributing Elysium beyond private testing. Keeping Elysium in a private repository does not change the licenses of included third-party software.

## MusicBrainz

Optional music matching uses the [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API). Elysium identifies its client, queues requests no faster than one per second, and presents matches for the user to accept. Applicable MusicBrainz data and service terms continue to apply. Commercial use should be reviewed against the current service terms before public distribution.

## Jellyfin

The optional source adapter interoperates with the user's Jellyfin server through its HTTP API. Elysium is an independent client and is not endorsed by the Jellyfin project.

## Artwork and sample media

The Elysium icon, generated collection artwork, synthesized sample tracks, and moving color-study sample video were created for this project. No Apple, Microsoft, Spotify, movie-poster, or album-cover assets are bundled. Original Windows Media Player skins and third-party visualization presets are not included.

## Retro visualizers

The fifteen renderers in `src/visualizers/` are original Elysium code using procedural geometry and color fields. Collection labels describe stylistic inspiration. They do not bundle or execute Windows Media Player, iTunes, Xbox, or Xbox 360 visualizer engines, plug-ins, shaders, preset data, or other proprietary assets. No projectM/MilkDrop preset packs are included. Product names belong to their respective owners; Elysium is an independent project.
