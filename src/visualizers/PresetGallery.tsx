import { useEffect, useState } from 'react';
import { Check, Search, Sparkles } from 'lucide-react';
import { Modal } from '../components';
import { AudioFeaturesReader } from './audio';
import { VISUALIZER_FAMILIES, VISUALIZER_PRESETS } from './catalog';
import { GpuVisualizer } from './gpu';
import { VisualizerRenderer } from './renderer';

const previews = new Map<string, string>();

/** One disposable renderer generates accurate thumbnails, never a grid of live contexts. */
function renderPreviews() {
  if (previews.size) return;
  let canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 210;
  const gpu = GpuVisualizer.create(canvas);
  if (!gpu) {
    canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 210;
  }
  const ctx = gpu ? null : canvas.getContext('2d');
  const f = new AudioFeaturesReader().features;
  f.rawRms = 0.16;
  f.sustain = 0.5;
  f.bassSlow = 0.4;
  f.midSlow = 0.35;
  f.trebleSlow = 0.2;
  f.centroid = 0.4;
  f.bass = 0.48;
  f.mid = 0.36;
  f.treble = 0.24;
  f.energy = 0.5;
  for (let i = 0; i < 64; i++) f.bands[i] = (0.3 + 0.25 * Math.sin(i * 0.38) ** 2) * (1 - i / 100);
  for (let i = 0; i < 1024; i++) f.wave[i] = Math.sin(i * 0.05) * 0.3 + Math.sin(i * 0.13) * 0.12;
  try {
    gpu?.resize(360, 210);
    for (const preset of VISUALIZER_PRESETS) {
      if (gpu) {
        gpu.setPreset(preset, true);
        gpu.draw(0, f, true);
      } else if (ctx)
        new VisualizerRenderer(ctx, preset, 'balanced').draw(360, 210, 0, f, true, true, '#75cabb');
      previews.set(preset.id, canvas.toDataURL('image/webp', 0.85));
    }
  } finally {
    gpu?.dispose(true);
  }
}

export function PresetGallery({
  current,
  select,
  close,
}: {
  current: string;
  select: (id: string) => void;
  close: () => void;
}) {
  const [family, setFamily] = useState('all');
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(previews.size > 0);
  useEffect(() => {
    renderPreviews();
    setReady(true);
  }, []);
  const matches = [...VISUALIZER_PRESETS]
    .sort((a, b) => Number(b.family === 'signature') - Number(a.family === 'signature'))
    .filter(
      (p) =>
        (family === 'all' || p.family === family) &&
        `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <Modal title="Find your atmosphere" close={close} wide>
      <div className="preset-gallery">
        <p className="gallery-intro">
          {VISUALIZER_PRESETS.length} worlds, shaped by your music. Try the living worlds for fluid
          color, evolving fractals, and luminous silk.
        </p>
        <div className="gallery-tools">
          <label className="gallery-search">
            <Search size={16} />
            <input
              aria-label="Search visualizers"
              placeholder="Search atmospheres…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Visualizer collection"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            <option value="all">All collections</option>
            {VISUALIZER_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="preset-grid">
          {matches.map((p) => (
            <button
              key={p.id}
              className={`preset-card ${current === p.id ? 'selected' : ''}`}
              aria-pressed={current === p.id}
              onClick={() => {
                select(p.id);
                close();
              }}
            >
              <div className="preset-preview">
                {ready && <img src={previews.get(p.id)} alt="" />}
                {current === p.id && (
                  <span className="preset-selected">
                    <Check size={12} />
                    Selected
                  </span>
                )}
              </div>
              <div className="preset-copy">
                <strong>{p.name}</strong>
                <span>{p.description}</span>
              </div>
            </button>
          ))}
        </div>
        {!matches.length && (
          <div className="empty-filter">
            <Sparkles />
            <h3>No atmospheres found</h3>
            <p>Try another name or collection.</p>
            <button
              onClick={() => {
                setFamily('all');
                setQuery('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        <p className="gallery-footnote">
          Original Elysium scenes · Previews show an illustrative audio signal
        </p>
      </div>
    </Modal>
  );
}
