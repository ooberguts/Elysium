import { describe, expect, it } from 'vitest';
import { AudioFeaturesReader } from './audio';
import {
  getVisualizer,
  randomVisualizer,
  stepVisualizer,
  VISUALIZER_FAMILIES,
  VISUALIZER_PRESETS,
} from './catalog';

function signal(sampleRate = 48000, hz = 100, amplitude = 220) {
  const fftSize = 2048;
  const frequency = new Uint8Array(fftSize / 2);
  const bin = Math.round((hz * fftSize) / sampleRate);
  frequency.fill(amplitude, Math.max(0, bin - 1), bin + 2);
  const waveform = Uint8Array.from(
    { length: fftSize },
    (_, i) => 128 + Math.sin((TAU * hz * i) / sampleRate) * amplitude * 0.35,
  );
  return { frequency, waveform, fftSize, sampleRate };
}
const TAU = Math.PI * 2;

describe('music analysis', () => {
  it('keeps silence neutral without inventing a beat or a DC-offset waveform', () => {
    const reader = new AudioFeaturesReader();
    for (let i = 0; i < 100; i++)
      reader.update(new Uint8Array(1024), new Uint8Array(2048).fill(128), 48000, 2048, 1 / 30);
    expect(reader.features.energy).toBe(0);
    expect(reader.features.beat).toBe(0);
    expect([...reader.features.wave].every((n) => n === 0)).toBe(true);
  });

  it.each([44100, 48000, 96000])('assigns bass and treble by frequency at %i Hz', (sampleRate) => {
    const reader = new AudioFeaturesReader();
    const bass = signal(sampleRate, 100);
    for (let i = 0; i < 45; i++)
      reader.update(bass.frequency, bass.waveform, sampleRate, bass.fftSize, 1 / 30);
    expect(reader.features.bass).toBeGreaterThan(reader.features.treble + 0.1);
    const high = signal(sampleRate, 6000);
    for (let i = 0; i < 90; i++)
      reader.update(high.frequency, high.waveform, sampleRate, high.fftSize, 1 / 30);
    expect(reader.features.treble).toBeGreaterThan(reader.features.bass);
    expect(reader.features.wave.some((n) => n < 0)).toBe(true);
    expect(reader.features.wave.some((n) => n > 0)).toBe(true);
  });

  it('detects an actual transient, decays it, and does not retrigger on a steady tone', () => {
    const reader = new AudioFeaturesReader();
    const silent = new Uint8Array(2048).fill(128);
    for (let i = 0; i < 60; i++) reader.update(new Uint8Array(1024), silent, 48000, 2048, 1 / 30);
    const s = signal();
    reader.update(s.frequency, s.waveform, s.sampleRate, s.fftSize, 1 / 30);
    expect(reader.features.beat).toBe(1);
    let hits = 0;
    for (let i = 0; i < 90; i++) {
      reader.update(s.frequency, s.waveform, s.sampleRate, s.fftSize, 1 / 30);
      if (reader.features.beat === 1) hits++;
    }
    expect(hits).toBe(0);
    expect(reader.features.beat).toBeLessThan(0.01);
    for (let i = 0; i < 90; i++) reader.update(new Uint8Array(1024), silent, 48000, 2048, 1 / 30);
    expect(reader.features.energy).toBeLessThan(0.001);
  });

  it('has matching envelope timing at 30 and 60 fps and reuses its feature buffers', () => {
    const s = signal();
    const run = (fps: number) => {
      const reader = new AudioFeaturesReader();
      const bands = reader.features.bands;
      for (let i = 0; i < fps; i++)
        reader.update(s.frequency, s.waveform, s.sampleRate, s.fftSize, 1 / fps);
      expect(reader.features.bands).toBe(bands);
      return reader.features.energy;
    };
    expect(run(30)).toBeCloseTo(run(60), 2);
  });

  it('makes quiet device audio visible and follows its loudness changes without clipping', () => {
    const reader = new AudioFeaturesReader();
    const frequency = new Uint8Array(1024).fill(65);
    const wave = (amplitude: number) =>
      Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.13) * amplitude);
    for (let i = 0; i < 30; i++) reader.update(frequency, wave(0.004), 48000, 2048, 1 / 30);
    const quiet = reader.features.rms;
    expect(quiet).toBeGreaterThan(0.1);
    for (let i = 0; i < 3; i++) reader.update(frequency, wave(0.02), 48000, 2048, 1 / 30);
    expect(reader.features.rms).toBeGreaterThan(quiet + 0.3);
    expect(reader.features.rms).toBeLessThan(0.8);
    for (let i = 0; i < 30; i++) reader.update(frequency, wave(0.004), 48000, 2048, 1 / 30);
    expect(reader.features.rms).toBeLessThan(0.3);
  });

  it('detects quiet percussion even when the average frequency magnitude barely changes', () => {
    const reader = new AudioFeaturesReader();
    const frequency = new Uint8Array(1024).fill(80);
    const wave = (amplitude: number) =>
      Uint8Array.from({ length: 2048 }, (_, i) => Math.round(128 + Math.sin(i * 0.3) * amplitude));
    for (let i = 0; i < 45; i++) reader.update(frequency, wave(2), 48000, 2048, 1 / 30);
    expect(reader.features.beat).toBeLessThan(0.001);
    reader.update(frequency, wave(6), 48000, 2048, 1 / 30);
    expect(reader.features.beat).toBe(1);
    for (let i = 0; i < 45; i++) reader.update(frequency, wave(6), 48000, 2048, 1 / 30);
    expect(reader.features.beat).toBeLessThan(0.001);
  });

  it('preserves bass dynamics hidden by logarithmic spectrum magnitudes', () => {
    const reader = new AudioFeaturesReader();
    const strong = signal(48000, 100, 180);
    const soft = signal(48000, 100, 141);
    for (let i = 0; i < 30; i++)
      reader.update(strong.frequency, strong.waveform, 48000, 2048, 1 / 30);
    for (let i = 0; i < 45; i++)
      reader.update(soft.frequency, strong.waveform, 48000, 2048, 1 / 30);
    const low = reader.features.bass;
    reader.update(strong.frequency, strong.waveform, 48000, 2048, 1 / 30);
    expect(reader.features.bass - low).toBeGreaterThan(0.35);
    expect(reader.features.beat).toBe(1);
  });
});

describe('visualizer library', () => {
  it('provides three unique effects for each requested era, and preserves existing saved modes', () => {
    expect(new Set(VISUALIZER_PRESETS.map((p) => p.id)).size).toBe(18);
    for (const family of VISUALIZER_FAMILIES)
      expect(VISUALIZER_PRESETS.filter((p) => p.family === family.id)).toHaveLength(3);
    for (const old of ['spectrum', 'waveform', 'ambient']) expect(getVisualizer(old).id).toBe(old);
    expect(getVisualizer('removed-mode').id).toBe('current');
  });
  it('wraps preset navigation and never randomly selects the currently displayed preset', () => {
    const first = VISUALIZER_PRESETS[0],
      last = VISUALIZER_PRESETS.at(-1)!;
    expect(stepVisualizer(first.id, -1)).toBe(last);
    expect(stepVisualizer(last.id, 1)).toBe(first);
    for (const p of VISUALIZER_PRESETS) {
      expect(randomVisualizer(p.id, () => 0).id).not.toBe(p.id);
      expect(randomVisualizer(p.id, () => 0.9999).id).not.toBe(p.id);
    }
  });
});

describe('musical detail', () => {
  it('detects new high percussion over a constant bass without needing an RMS change', () => {
    const reader = new AudioFeaturesReader();
    const s = signal(48000, 100, 180);
    for (let i = 0; i < 90; i++) reader.update(s.frequency, s.waveform, 48000, 2048, 1 / 60);
    const before = reader.features.onsetId;
    const withHat = s.frequency.slice();
    withHat.fill(180, 170, 480);
    reader.update(withHat, s.waveform, 48000, 2048, 1 / 60);
    expect(reader.features.trebleHit).toBeGreaterThan(0.4);
    expect(reader.features.bassHit).toBeLessThan(0.01);
    expect(reader.features.onsetId).toBeGreaterThan(before);
    const highCentroid = reader.features.centroid;
    for (let i = 0; i < 120; i++) reader.update(withHat, s.waveform, 48000, 2048, 1 / 60);
    expect(reader.features.onsetId).toBe(before + 1);
    expect(reader.features.trebleHit).toBeLessThan(0.01);
    expect(reader.features.centroid).toBeGreaterThan(highCentroid);
  });
  it('removes DC offset and rejects invalid waveform samples without phantom motion', () => {
    const reader = new AudioFeaturesReader();
    for (let i = 0; i < 80; i++)
      reader.update(
        new Uint8Array(1024).fill(120),
        new Float32Array(2048).fill(0.25),
        48000,
        2048,
        1 / 30,
      );
    expect(reader.features.rawRms).toBe(0);
    expect(reader.features.energy).toBe(0);
    expect(reader.features.onsetId).toBe(0);
    reader.update(new Uint8Array(0), new Float32Array([NaN, Infinity]), 0, 0, NaN);
    for (const value of Object.values(reader.features))
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  });
  it('separates immediate attacks from slower sustained movement', () => {
    const reader = new AudioFeaturesReader();
    const s = signal();
    reader.update(new Uint8Array(1024), new Float32Array(2048), 48000, 2048, 1 / 60);
    reader.update(s.frequency, s.waveform, 48000, 2048, 1 / 60);
    expect(reader.features.bass).toBeGreaterThan(reader.features.bassSlow + 0.3);
    expect(reader.features.bassHit).toBeGreaterThan(0.3);
    for (let i = 0; i < 180; i++) reader.update(s.frequency, s.waveform, 48000, 2048, 1 / 60);
    expect(reader.features.bassSlow).toBeGreaterThan(0.7);
    expect(reader.features.bassHit).toBeLessThan(0.01);
  });
});
