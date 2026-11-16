export type AudioFeatures = {
  bands: Float32Array;
  wave: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  energy: number;
  beat: number;
  rawRms: number;
  bassSlow: number;
  midSlow: number;
  trebleSlow: number;
  bassHit: number;
  midHit: number;
  trebleHit: number;
  flux: number;
  centroid: number;
  sustain: number;
  onsetId: number;
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
    rawRms: 0,
    bassSlow: 0,
    midSlow: 0,
    trebleSlow: 0,
    bassHit: 0,
    midHit: 0,
    trebleHit: 0,
    flux: 0,
    centroid: 0,
    sustain: 0,
    onsetId: 0,
  };
  private previousSpectrum = new Float32Array(64);
  private fluxMean = new Float32Array(3);
  private fluxDeviation = new Float32Array(3);
  private onsetCooldown = new Float32Array(3);
  private averageBass = 0;
  private averageRms = 0;
  private previousRms = 0;
  private peakRms = 0;
  private peaks = new Float32Array(3);
  private previousBass = 0;
  private cooldown = 0;
  private initialized = false;

  update(
    frequency: Uint8Array,
    waveform: Uint8Array | Float32Array,
    sampleRate: number,
    fftSize: number,
    dt: number,
  ): AudioFeatures {
    const f = this.features;
    const delta = Math.min(0.1, Math.max(0.001, Number.isFinite(dt) ? dt : 1 / 30));
    const smooth = (old: number, next: number) =>
      old + (next - old) * (1 - Math.exp(-delta / (next > old ? 0.045 : 0.22)));
    const binHz = sampleRate > 0 && fftSize > 0 ? sampleRate / fftSize : 48000 / 2048;
    const band = (low: number, high: number, linear = false) => {
      const start = Math.min(frequency.length - 1, Math.max(1, Math.floor(low / binHz)));
      const end = Math.min(frequency.length, Math.max(start + 1, Math.ceil(high / binHz)));
      let sum = 0;
      for (let i = start; i < end; i++) {
        const value = (frequency[i] || 0) / 255;
        sum += linear ? (frequency[i] ? Math.pow(10, (value * 75 - 90) / 10) : 0) : value;
      }
      return linear ? Math.sqrt(sum) : sum / Math.max(1, end - start);
    };
    const flux = [0, 0, 0],
      counts = [0, 0, 0];
    let weight = 0,
      brightness = 0;
    for (let i = 0; i < f.bands.length; i++) {
      const low = 35 * Math.pow(16000 / 35, i / f.bands.length);
      const high = 35 * Math.pow(16000 / 35, (i + 1) / f.bands.length);
      const value = band(low, high);
      const group = high <= 250 ? 0 : high <= 2600 ? 1 : 2;
      // Half-wave rectified spectral flux: a new hat or note is detectable
      // even when a compressor keeps the overall RMS almost unchanged.
      flux[group] += Math.max(0, value - this.previousSpectrum[i]);
      counts[group]++;
      this.previousSpectrum[i] = value;
      f.bands[i] = smooth(f.bands[i], value);
      const power = Math.max(0, value - 0.18) ** 3;
      brightness += (power * i) / 63;
      weight += power;
    }
    const floatWave = waveform instanceof Float32Array;
    const rawSample = (i: number) => {
      const value = floatWave ? (waveform[i] ?? 0) : ((waveform[i] ?? 128) - 128) / 128;
      return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    };
    let mean = 0;
    for (let i = 0; i < waveform.length; i++) mean += rawSample(i);
    mean /= Math.max(1, waveform.length);
    const sample = (i: number) => (i < waveform.length ? rawSample(i) - mean : 0);
    let power = 0;
    for (let i = 0; i < waveform.length; i++) power += sample(i) ** 2;
    const rms = Math.sqrt(power / Math.max(1, waveform.length));
    f.rawRms = rms;
    for (let i = 0; i < f.wave.length; i++)
      // A contiguous window avoids aliasing a high note into an apparent flat line.
      f.wave[i] = sample(i);
    // Decibel magnitudes compress musical dynamics. Recover linear band energy
    // before following the bass, instruments, and percussion independently.
    const bass = band(35, 240, true);
    const follow = (value: number, index: number, old: number) => {
      this.peaks[index] = Math.max(0.001, value, this.peaks[index] * Math.exp(-delta / 4));
      const target = rms > 0.0003 ? clamp((value / this.peaks[index]) * 0.85) : 0;
      return old + (target - old) * (1 - Math.exp(-delta / (target > old ? 0.012 : 0.11)));
    };
    f.bass = follow(bass, 0, f.bass);
    f.mid = follow(band(240, 2500, true), 1, f.mid);
    f.treble = follow(band(2500, 14000, true), 2, f.treble);
    const hits = [f.bassHit, f.midHit, f.trebleHit];
    let novelty = 0,
      spectralHit = false;
    for (let i = 0; i < 3; i++) {
      const value = flux[i] / Math.max(1, counts[i]);
      this.onsetCooldown[i] = Math.max(0, this.onsetCooldown[i] - delta);
      const threshold = Math.max(0.012, this.fluxMean[i] * 1.7 + this.fluxDeviation[i] * 1.4);
      const hit =
        this.initialized && rms > 0.0003 && this.onsetCooldown[i] === 0 && value > threshold;
      hits[i] = hit
        ? clamp(value / (threshold * 2))
        : hits[i] * Math.exp(-delta / [0.22, 0.14, 0.085][i]);
      if (hit) {
        this.onsetCooldown[i] = [0.16, 0.12, 0.075][i];
        spectralHit = true;
      }
      novelty = Math.max(novelty, rms > 0.0003 ? clamp(value / Math.max(0.04, threshold * 3)) : 0);
      const response = 1 - Math.exp(-delta / 1.2);
      this.fluxDeviation[i] +=
        (Math.abs(value - this.fluxMean[i]) - this.fluxDeviation[i]) * response;
      this.fluxMean[i] += (value - this.fluxMean[i]) * response;
    }
    [f.bassHit, f.midHit, f.trebleHit] = hits;
    f.flux = Math.max(novelty, f.flux * Math.exp(-delta / 0.22));
    f.centroid +=
      ((rms > 0.0003 && weight > 0 ? brightness / weight : 0) - f.centroid) *
      (1 - Math.exp(-delta / 0.4));
    const slow = 1 - Math.exp(-delta / 1.1);
    f.bassSlow += (f.bass - f.bassSlow) * slow;
    f.midSlow += (f.mid - f.midSlow) * slow;
    f.trebleSlow += (f.treble - f.trebleSlow) * slow;
    // Output-device taps can arrive far below full scale. Normalize against a
    // slowly decaying peak so quiet listening still has visible dynamics. Keep
    // the raw waveform intact for the oscilloscope, and never amplify silence.
    this.peakRms = Math.max(0.01, rms, this.peakRms * Math.exp(-delta / 6));
    const level = clamp(rms * Math.min(48, 0.75 / this.peakRms));
    const response = level > f.rms ? 0.018 : 0.14;
    f.rms += (level - f.rms) * (1 - Math.exp(-delta / response));
    f.energy = smooth(f.energy, clamp(level * 0.75 + (f.bass + f.mid + f.treble) / 12));
    f.sustain += (f.energy - f.sustain) * (1 - Math.exp(-delta / 2.4));
    this.cooldown = Math.max(0, this.cooldown - delta);
    // Prime the adaptive envelope before detecting a transient. Silence never beats.
    const hit =
      this.initialized &&
      (spectralHit ||
        (bass > this.previousBass * 1.08 + 0.00015 && bass > this.averageBass * 1.15 + 0.0002) ||
        (rms > this.previousRms * 1.06 + 0.0007 && rms > this.averageRms * 1.18 + 0.001)) &&
      rms > 0.001 &&
      this.cooldown === 0;
    if (hit) this.cooldown = 0.18;
    if (hit) f.onsetId++;
    f.beat = hit ? 1 : f.beat * Math.exp(-delta / 0.15);
    this.averageBass += (bass - this.averageBass) * (1 - Math.exp(-delta / 0.8));
    this.averageRms += (rms - this.averageRms) * (1 - Math.exp(-delta / 0.7));
    this.previousRms = rms;
    this.previousBass = bass;
    this.initialized = true;
    return f;
  }
}
