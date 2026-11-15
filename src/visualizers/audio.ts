export type AudioFeatures = {
  bands: Float32Array;
  wave: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  energy: number;
  beat: number;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Reuses its buffers; bands use Hz, not fixed bins, at every sample rate. */
export class AudioFeaturesReader {
  readonly features: AudioFeatures = {
    bands: new Float32Array(64),
    wave: new Float32Array(1024),
    bass: 0,
    mid: 0,
    treble: 0,
    rms: 0,
    energy: 0,
    beat: 0,
  };
  private averageBass = 0;
  private previousBass = 0;
  private cooldown = 0;
  private initialized = false;

  update(
    frequency: Uint8Array,
    waveform: Uint8Array,
    sampleRate: number,
    fftSize: number,
    dt: number,
  ): AudioFeatures {
    const f = this.features;
    const delta = Math.min(0.1, Math.max(0.001, dt));
    const smooth = (old: number, next: number) =>
      old + (next - old) * (1 - Math.exp(-delta / (next > old ? 0.045 : 0.22)));
    const binHz = sampleRate / fftSize;
    const band = (low: number, high: number) => {
      const start = Math.min(frequency.length - 1, Math.max(1, Math.floor(low / binHz)));
      const end = Math.min(frequency.length, Math.max(start + 1, Math.ceil(high / binHz)));
      let sum = 0;
      for (let i = start; i < end; i++) sum += frequency[i] / 255;
      return sum / Math.max(1, end - start);
    };
    for (let i = 0; i < f.bands.length; i++) {
      const low = 35 * Math.pow(16000 / 35, i / f.bands.length);
      const high = 35 * Math.pow(16000 / 35, (i + 1) / f.bands.length);
      f.bands[i] = smooth(f.bands[i], band(low, high));
    }
    let power = 0;
    for (let i = 0; i < waveform.length; i++) power += ((waveform[i] - 128) / 128) ** 2;
    const rms = Math.sqrt(power / Math.max(1, waveform.length));
    for (let i = 0; i < f.wave.length; i++)
      // A contiguous window avoids aliasing a high note into an apparent flat line.
      f.wave[i] = ((waveform[i] ?? 128) - 128) / 128;
    const bass = band(35, 240);
    f.bass = smooth(f.bass, bass);
    f.mid = smooth(f.mid, band(240, 2500));
    f.treble = smooth(f.treble, band(2500, 14000));
    f.rms = smooth(f.rms, clamp(rms * 2.5));
    f.energy = smooth(f.energy, clamp(rms * 1.5 + (f.bass + f.mid + f.treble) / 4));
    this.cooldown = Math.max(0, this.cooldown - delta);
    // Prime the adaptive envelope before detecting a transient. Silence never beats.
    const hit =
      this.initialized &&
      bass > this.previousBass + 0.035 &&
      bass > Math.max(0.17, this.averageBass * 1.35 + 0.035) &&
      rms > 0.012 &&
      this.cooldown === 0;
    if (hit) this.cooldown = 0.28;
    f.beat = hit ? 1 : f.beat * Math.exp(-delta / 0.2);
    this.averageBass += (bass - this.averageBass) * (1 - Math.exp(-delta / 0.8));
    this.previousBass = bass;
    this.initialized = true;
    return f;
  }
}
