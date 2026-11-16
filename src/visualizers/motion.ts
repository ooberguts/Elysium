import type { AudioFeatures } from './audio';

/** Integrate musical activity into continuous coordinates. No wall-clock jumps,
 * independent bass/melody/percussion gestures, and no movement during silence. */
export class MusicalMotion {
  time = 12;
  morph = 1.7;
  color = 0.27;
  travel = 0;
  turn = 0;
  update(dt: number, f: AudioFeatures, active: boolean, reduced: boolean) {
    if (!active || reduced || f.energy < 0.006) return;
    const delta = Math.max(0, Math.min(0.1, dt));
    this.time += delta * (0.16 + f.energy * 0.65 + f.rms * 0.35);
    this.morph += delta * (0.06 + f.midSlow * 0.17 + f.flux * 0.24);
    this.color += delta * (0.008 + f.centroid * 0.026 + f.trebleHit * 0.015);
    this.travel += delta * (0.09 + f.bassSlow * 0.24 + f.bassHit * 0.32);
    this.turn += delta * (f.midSlow - f.trebleSlow) * 0.11;
  }
}

/** Build a show around musical events. Wait at least 45 seconds, then use a
 * fresh onset or a quiet passage; ambient music gets a bounded 80-second dwell. */
export class ShowClock {
  elapsed = 0;
  private onset = 0;
  tick(dt: number, f: AudioFeatures, active: boolean, reduced: boolean) {
    const newOnset = f.onsetId !== this.onset;
    this.onset = f.onsetId;
    if (!active || reduced || f.energy < 0.006) return false;
    this.elapsed += Math.max(0, Math.min(0.1, dt));
    const quiet = f.sustain > 0.15 && f.energy < f.sustain * 0.65;
    if (this.elapsed >= 45 && (newOnset || quiet || this.elapsed >= 80)) {
      this.elapsed = 0;
      return true;
    }
    return false;
  }
}
