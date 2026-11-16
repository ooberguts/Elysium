# Living worlds: audio visualizer design

Research and implementation notes, November 16, 2026.

The target is a full-screen, continuously changing performance with the organic character of classic desktop visualizers. A loudness-controlled animation is insufficient: percussion, sustained notes, changes of texture, and quiet passages need different visual consequences.

## What the research changed

| Primary reference                                                                                                                                                             | Useful principle                                                                                                                                      | Elysium implementation                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Ryan Geiss: how Geiss works](https://www.geisswerks.com/geiss/secrets.html), [MilkDrop preset authoring](https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html) | Feedback carries the previous image forward; immediate and attenuated frequency envelopes serve different purposes.                                   | Bounded ping-pong textures, music-driven advection, separate fast and slow bass/mid/treble signals, evolving forms instead of a repeating fixed animation.                                |
| [aubio onset methods](https://aubio.org/manual/latest/cli.html)                                                                                                               | A new musical event can appear in spectral change even when total energy hardly changes. Detection needs a silence gate and minimum event separation. | Positive spectral flux in three ranges, adaptive mean/deviation thresholds, independent refractory periods, and decaying attack envelopes. No aubio dependency or imported detector code. |
| [Web Audio smoothingTimeConstant](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/smoothingTimeConstant)                                                        | Analysis smoothing averages the spectrum over time. Too much averaging before another envelope follower masks attacks.                                | Player analyzer smoothing reduced from 0.45 to 0.2; the visualizer owns its faster attack and slower release/phrase envelopes. Native capture uses the same feature reader.               |
| [The Book of Shaders: fractal Brownian motion](https://thebookofshaders.com/13/)                                                                                              | Several scales of coherent noise and domain warping create organic structure.                                                                         | Multiscale warped color fields, animated Julia orbit traps, and continuously changing folds in the existing kaleidoscope scenes.                                                          |
| [Bridson, Hourihan, Nordenstam: Curl-Noise for Procedural Fluid Flow](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf)                                | Curl of a potential produces a divergence-free velocity field, avoiding arbitrary sinks in procedural motion.                                         | An analytic curl field transports feedback and bends Chromatic Current. This is procedural flow, not a Navier–Stokes fluid solver.                                                        |
| [Mark Harris: GPU fluid simulation](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)                      | Texture passes and backward advection carry visual state efficiently.                                                                                 | Fixed-size render targets and backward sampling; no CPU readback or target allocation in the production animation loop. The pressure-solve algorithm is not implemented.                  |

These are original shaders and analysis code. No Apple, Microsoft, MilkDrop, projectM, or third-party preset assets or engines are bundled.

## Listen at several timescales

`audio.ts` reads 64 logarithmic frequency bands between 35 Hz and 16 kHz, using actual sample rate and FFT size. It keeps the waveform contiguous, removes DC from RMS measurement, rejects nonfinite waveform values, and gates transients on real signal. Quiet playback receives bounded adaptive gain; silence does not become a beat.

- **Fast bass / mid / treble:** approximately 12 ms attack and 110 ms release after linear-energy reconstruction. These drive immediate deformation and light response.
- **Independent attacks:** positive changes in each spectral range detect new kicks, notes, and high percussion. Refractory intervals are 160 / 120 / 75 ms. A steady tone does not repeatedly trigger attacks.
- **Slow frequency envelopes:** 1.1-second followers shape larger forms without rattling the whole image on every FFT change.
- **Sustain:** a 2.4-second energy follower supplies context for quiet passages.
- **Spectral centroid:** a smoothed measure of where energy sits across the logarithmic bands influences color evolution.

`motion.ts` integrates these features into continuous time, morph, color, travel, and turn coordinates. It does not use absolute wall-clock time, invent a BPM, or force a metronome onto music. Sustained notes continue to evolve; silence, pause, and reduced motion stop spatial progression. Analysis and scene responses still depend on WebView scheduling and the source's capture cadence; this is not a sample-accurate beat tracker.

## Three new scenes

**Chromatic Current** fills the screen with folded iridescent color. Curl flow and nested domain warping shape its currents; bass expands the field, midrange bends it, and high attacks light the veins. Its feedback has the longest memory of the three new worlds.

**Fractal Sanctuary** uses a 36-iteration Julia orbit, a continuously varying complex seed, smooth escape counts, a distance estimate, and orbit traps. Branching forms change topology as the music develops. Much shorter feedback preserves fine filaments; the first visual review caught excessive temporal softness and led to this adjustment.

**Aurora Cathedral** layers seven curved, translucent light sheets with fine striations and luminous edges. Bass changes their spread, midrange changes their width, and high percussion accents their rims. It provides a more spacious alternative to the dense liquid and fractal scenes.

Prismatic Alchemy and Cosmic Bloom also use the new integrated morph coordinate. All eighteen scenes use the revised compositing pipeline. Existing saved preset IDs remain compatible.

## Rendering and show direction

The WebGL 1 pipeline has five passes: full-resolution scene/feedback, quarter-resolution bright extraction, horizontal blur, vertical blur, and full-resolution composite. Color accumulation is bounded before bloom and tone mapping. Static sub-LSB dithering reduces banding without adding animated noise. Dissolves last 1.8 seconds and snapshot the visible composite, including an interrupted dissolve.

Feedback decay uses elapsed seconds, with different durations for liquid, fractal, and aurora detail. Full-stage pixel budgets remain 0.9 megapixels in Balanced and 1.8 megapixels in Smooth; targets are 30 and 60 fps respectively. Hidden windows stop rendering. GPU resources are explicitly released; a Canvas compatibility renderer remains available after unavailable/lost WebGL contexts. The three new scenes use simpler related effects in that fallback.

**Auto show** waits at least 45 seconds, then changes on a fresh onset or a quiet passage. An 80-second cap allows ambient music to progress. It excludes the three instrument/ambient essentials, avoids the current and immediately previous scene, and pauses with silence or reduced motion. This is event-aware scene selection, not automatic detection of song sections or musical bars.

## Verification

The development-only renderer lab is `scripts/visualizer-check.html`. It contains deterministic GPU comparisons and a 1600×900 preview driven either by an explicitly labeled synthetic signal or real sample music analyzed through Web Audio. The sample monitor is muted; it does not add sound over the user's current music.

The checks compare structural changes after normalizing brightness, exercise bass/mid/high accents independently, verify morphing and pause, detect GL errors, and cover preset dissolves. DSP tests cover compressed high-frequency attacks, constant DC/silence, malformed samples, steady tones, multiple sample rates, and envelope timing. Musical-motion tests cover 30/60 fps equivalence and show timing. See [TESTING.md](TESTING.md) for observed results and platform limits.

Pixel checks and frame counters establish implementation behavior; they do not establish subjective musical quality. Visual review and actual device capture remain necessary, especially across different genres and drivers.
