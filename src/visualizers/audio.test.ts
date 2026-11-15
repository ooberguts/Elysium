import { describe, expect, it } from 'vitest';
import { AudioFeaturesReader } from './audio';
import {
  getVisualizer,
  PresetClock,
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
});

describe('visualizer library', () => {
  it('provides three unique effects for each requested era, and preserves existing saved modes', () => {
    expect(new Set(VISUALIZER_PRESETS.map((p) => p.id)).size).toBe(15);
    for (const family of VISUALIZER_FAMILIES)
      expect(VISUALIZER_PRESETS.filter((p) => p.family === family.id)).toHaveLength(3);
    for (const old of ['spectrum', 'waveform', 'ambient']) expect(getVisualizer(old).id).toBe(old);
    expect(getVisualizer('removed-mode').id).toBe('ribbons');
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
  it('only rotates after 30 seconds of visible playback, and never in reduced motion', () => {
    const clock = new PresetClock();
    for (let i = 0; i < 29; i++) expect(clock.tick(1, true, false)).toBe(false);
    for (let i = 0; i < 60; i++) {
      expect(clock.tick(1, false, false)).toBe(false);
      expect(clock.tick(1, true, true)).toBe(false);
    }
    expect(clock.tick(1, true, false)).toBe(true);
    expect(clock.elapsed).toBe(0);
  });
});
