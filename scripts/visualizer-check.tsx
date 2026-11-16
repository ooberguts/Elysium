// Development-only GPU integration checks. Not included in the app entry point.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { GpuVisualizer } from '../src/visualizers/gpu';
import { AudioFeaturesReader } from '../src/visualizers/audio';
import { getVisualizer, VISUALIZER_PRESETS } from '../src/visualizers/catalog';
import { PresetGallery } from '../src/visualizers/PresetGallery';
import '../src/styles.css';
import '../src/polish.css';

function validate() {
  const results: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 270;
  const gpu = GpuVisualizer.create(canvas);
  if (!gpu) return ['FAIL: WebGL initialization'];
  gpu.resize(480, 270);
  const gl = canvas.getContext('webgl')!;
  const read = () => {
    const pixels = new Uint8Array(480 * 270 * 4);
    gl.readPixels(0, 0, 480, 270, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const difference = (a: Uint8Array, b: Uint8Array) =>
    a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0);
  // Ignore overall brightness: a louder packet must move rendered structures,
  // even with elapsed time and global energy held completely constant.
  const shapeDifference = (a: Uint8Array, b: Uint8Array) => {
    const sum = (pixels: Uint8Array) => pixels.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v), 0);
    const scale = sum(a) / sum(b);
    return a.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : Math.abs(v - b[i] * scale)), 0) / sum(a);
  };
  const f = new AudioFeaturesReader().features;
  f.energy = 0.5;
  f.bass = 0.4;
  f.mid = 0.3;
  f.treble = 0.2;
  for (let i = 0; i < 64; i++) f.bands[i] = 0.4 + 0.2 * Math.sin(i * 0.3);
  for (let i = 0; i < 1024; i++) f.wave[i] = Math.sin(i * 0.06) * 0.35;
  const signatures = new Set<number>();
  const check = (ok: boolean, label: string) => results.push(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  for (const preset of VISUALIZER_PRESETS) {
    gpu.setPreset(preset, true);
    gpu.draw(0, f, true);
    const pixels = read();
    const light = pixels.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v), 0);
    check(
      light > 100000 && gl.getError() === gl.NO_ERROR,
      `${preset.name}: nonempty scene, no GL errors`,
    );
    signatures.add(light);
    gpu.draw(0.1, f, true);
    check(difference(pixels, read()) === 0, `${preset.name}: reduced motion is stationary`);
  }
  check(signatures.size === VISUALIZER_PRESETS.length, 'All presets produce distinct scenes');
  for (const preset of VISUALIZER_PRESETS) {
    gpu.setPreset(preset, true);
    const soft = {
      ...f,
      rms: 0.12,
      bass: 0.15,
      mid: 0.15,
      treble: 0.1,
      beat: 0,
      bands: f.bands.map((v) => v * 0.25),
      wave: f.wave.map((v) => v * 0.15),
    };
    const loud = { ...f, rms: 0.65, bass: 0.55, mid: 0.4, treble: 0.35, beat: 0.8 };
    gpu.draw(0, soft, false, 1, false);
    const quietPixels = read();
    gpu.draw(0, loud, false, 1, false);
    const change = shapeDifference(quietPixels, read());
    check(
      change > 0.08,
      `${preset.name}: music changes geometry at fixed time (${Math.round(change * 100)}%)`,
    );
  }
  for (const id of ['current', 'garden', 'aurora']) {
    gpu.setPreset(getVisualizer(id), true);
    const base = {
      ...f,
      rawRms: 0.12,
      bass: 0.2,
      mid: 0.2,
      treble: 0.15,
      bassSlow: 0.3,
      midSlow: 0.3,
      trebleSlow: 0.2,
    };
    gpu.draw(0, base, false, 1, false);
    const resting = read();
    for (const [part, accent] of Object.entries({
      bass: { bass: 0.8, bassHit: 0.9 },
      melody: { mid: 0.8, midHit: 0.8 },
      percussion: { treble: 0.8, trebleHit: 0.9 },
    })) {
      gpu.draw(0, { ...base, ...accent }, false, 1, false);
      const change = shapeDifference(resting, read());
      check(change > 0.004, `${id}: independent ${part} response (${(change * 100).toFixed(1)}%)`);
    }
  }
  gpu.setPreset(getVisualizer('liquid'), true);
  gpu.draw(0, f, false, 1, false);
  const paused = read();
  gpu.draw(0.1, f, false, 1, false);
  check(difference(paused, read()) === 0, 'Paused geometry remains stationary');
  gpu.draw(0.1, f, false, 1, true);
  check(difference(paused, read()) > 10000, 'Live audio advances geometry');
  gpu.setPreset(getVisualizer('tunnel'));
  check(gpu.transitioning, 'Preset change starts a dissolve');
  const transitionError = gl.getError();
  check(transitionError === 0, `Transition setup GL status ${transitionError}`);
  for (let i = 0; i < 60; i++) gpu.draw(1 / 30, f, false);
  const dissolveError = gl.getError();
  check(dissolveError === 0, `Dissolve rendering GL status ${dissolveError}`);
  check(!gpu.transitioning, 'Preset dissolve completes');
  gpu.draw(0, f, true, 0.5);
  const low = read();
  gpu.draw(0, f, true, 1.5);
  check(difference(low, read()) > 10000, 'Intensity changes the rendered light');
  for (const id of ['prism', 'bloom', 'current', 'garden', 'aurora']) {
    gpu.setPreset(getVisualizer(id), true);
    gpu.draw(0, f, false, 1, false);
    const before = read();
    // Constant music still evolves the forms across a musical phrase.
    for (let frame = 0; frame < 120; frame++) gpu.draw(0.1, f, false);
    gpu.draw(0, f, false, 1, false);
    check(shapeDifference(before, read()) > 0.15, `${id}: forms evolve through a sustained phrase`);
    const frozen = read();
    gpu.draw(0.1, f, false, 1, false);
    check(difference(frozen, read()) === 0, `${id}: morphing freezes when paused`);
  }
  check(gl.getError() === gl.NO_ERROR, 'Final render is free of WebGL errors');
  gpu.dispose();
  return results;
}

function LivePreview({ preset }: { preset: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    music = useRef<HTMLAudioElement>(null);
  const latest = useRef({ preset, paused: false, silent: false });
  latest.current.preset = preset;
  const context = useRef<AudioContext | null>(null),
    analyser = useRef<AnalyserNode | null>(null);
  const [paused, setPaused] = useState(false),
    [silent, setSilent] = useState(false);
  const [stats, setStats] = useState('Starting…');
  latest.current.paused = paused;
  latest.current.silent = silent;
  const playMusic = async () => {
    if (!context.current) {
      const ctx = new AudioContext();
      context.current = ctx;
      const node = ctx.createAnalyser();
      node.fftSize = 2048;
      node.minDecibels = -90;
      node.maxDecibels = -15;
      node.smoothingTimeConstant = 0.2;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      ctx
        .createMediaElementSource(music.current!)
        .connect(node)
        .connect(mute)
        .connect(ctx.destination);
      analyser.current = node;
    }
    await context.current.resume();
    await music.current!.play();
    setSilent(false);
  };
  useEffect(() => {
    const gpu = GpuVisualizer.create(canvas.current!);
    if (!gpu) {
      setStats('FAIL: GPU unavailable');
      return;
    }
    gpu.resize(1600, 900);
    const reader = new AudioFeaturesReader();
    const spectrum = new Uint8Array(1024),
      waveform = new Float32Array(2048);
    let raf = 0,
      previous = 0,
      elapsed = 0,
      report = 0,
      frames = 0,
      mode = '';
    const draw = (now: number) => {
      const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 1 / 60;
      previous = now;
      if (!latest.current.paused) elapsed += dt;
      const actual = !!music.current && !music.current.paused;
      if (latest.current.silent) {
        spectrum.fill(0);
        waveform.fill(0);
      } else if (actual && analyser.current) {
        analyser.current.getByteFrequencyData(spectrum);
        analyser.current.getFloatTimeDomainData(waveform);
      } else {
        spectrum.fill(0);
        const kick = Math.exp(-(elapsed % 0.5) * 19),
          hat = Math.exp(-(elapsed % 0.25) * 45);
        spectrum.fill(Math.round(120 + kick * 85), 2, 11);
        spectrum.fill(Math.round(115 + Math.sin(elapsed * 0.6) * 28), 18, 75);
        spectrum.fill(Math.round(70 + hat * 100), 160, 500);
        for (let i = 0; i < 2048; i++)
          waveform[i] =
            Math.sin(i * 0.014 + elapsed * 3) * (0.08 + kick * 0.24) +
            Math.sin(i * 0.081 + elapsed) * 0.065 +
            Math.sin(i * 1.2 + elapsed) * hat * 0.018;
      }
      const f = reader.update(
        spectrum,
        waveform,
        analyser.current?.context.sampleRate || 48000,
        2048,
        dt,
      );
      if (mode !== latest.current.preset) {
        mode = latest.current.preset;
        gpu.setPreset(getVisualizer(mode));
      }
      gpu.draw(dt, f, false, 1, !latest.current.paused);
      frames++;
      if (now - report > 1000) {
        setStats(
          `${actual ? 'Actual sample music (silent monitor)' : latest.current.silent ? 'Silence' : 'Synthetic percussion test'} · 1600×900 · ${Math.round((frames * 1000) / (now - report))} fps · RMS ${f.rawRms.toFixed(3)} · bass ${f.bass.toFixed(2)} · high attacks ${f.trebleHit.toFixed(2)} · morphing ${!latest.current.paused && f.energy >= 0.006}`,
        );
        report = now;
        frames = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gpu.dispose(true);
      void context.current?.close();
    };
  }, []);
  return (
    <section>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button onClick={() => setPaused(!paused)}>
          {paused ? 'Resume motion' : 'Freeze motion'}
        </button>
        <button onClick={() => setSilent(!silent)}>
          {silent ? 'Restore signal' : 'Silence test'}
        </button>
        <button onClick={() => void playMusic()}>Play sample music</button>
        <button onClick={() => music.current?.pause()}>Use synthetic test</button>
      </div>
      <p role="status">{stats}</p>
      <canvas
        aria-label="Live visualizer preview"
        ref={canvas}
        width={1600}
        height={900}
        style={{
          width: '100%',
          maxWidth: 1200,
          aspectRatio: '16/9',
          display: 'block',
          margin: '18px 0',
          background: '#030710',
        }}
      />
      <audio ref={music} loop src="/src-tauri/resources/demo/01%20-%20Glass%20Horizon.mp3" />
    </section>
  );
}
function App() {
  const [results, setResults] = useState<string[]>([]),
    [gallery, setGallery] = useState(false),
    [preset, setPreset] = useState('current');
  return (
    <div
      className="app"
      data-theme="graphite"
      style={{ display: 'block', overflow: 'auto', padding: 30 }}
    >
      <h1>Living worlds · renderer lab</h1>
      <label>
        Preview atmosphere{' '}
        <select
          aria-label="Preview atmosphere"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          {VISUALIZER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <LivePreview preset={preset} />
      <p>
        GPU checks use a deterministic signal. Live audio is tested separately in the desktop app.
      </p>
      <div style={{ display: 'flex', gap: 10, margin: '20px 0' }}>
        <button onClick={() => setResults(validate())}>Run GPU checks</button>
        <button onClick={() => setGallery(true)}>Open preset gallery</button>
      </div>
      <p role="status">
        {results.length
          ? `${results.filter((r) => r.startsWith('PASS')).length} / ${results.length} checks passed`
          : 'Ready'}
      </p>
      <pre style={{ fontSize: 12, lineHeight: 1.7 }}>{results.join('\n')}</pre>
      {gallery && (
        <PresetGallery current={preset} select={setPreset} close={() => setGallery(false)} />
      )}
    </div>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
// Shader edits can reload this development entry rather than a refresh boundary.
import.meta.hot?.dispose(() => root.unmount());
