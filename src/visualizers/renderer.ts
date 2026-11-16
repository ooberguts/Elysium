import type { AudioFeatures } from './audio';
import type { VisualizerPreset, VisualizerQuality } from './catalog';

const TAU = Math.PI * 2;
const color = (h: number, a = 1, light = 65) => `hsla(${h % 360},100%,${light}%,${a})`;
type Point = { x: number; y: number; z: number };

/** Original, asset-free light-synth effects. All geometry is driven by one audio snapshot. */
export class VisualizerRenderer {
  private time = 0;
  private fresh = true;
  private readonly stars = Array.from({ length: 150 }, (_, i) => ({
    x: (((Math.sin(i * 127.1 + 1) * 43758.5453) % 1) + 1) % 1,
    y: (((Math.sin(i * 269.5 + 2) * 43758.5453) % 1) + 1) % 1,
    z: (((Math.sin(i * 183.3 + 3) * 43758.5453) % 1) + 1) % 1,
  }));
  private readonly plasma = document.createElement('canvas');
  private readonly plasmaContext: CanvasRenderingContext2D | null;
  private readonly plasmaPixels: ImageData | undefined;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly preset: VisualizerPreset,
    private readonly quality: VisualizerQuality,
  ) {
    this.plasma.width = quality === 'high' ? 200 : 140;
    this.plasma.height = Math.round(this.plasma.width * 0.625);
    this.plasmaContext = this.plasma.getContext('2d');
    this.plasmaPixels = this.plasmaContext?.createImageData(this.plasma.width, this.plasma.height);
  }

  reset() {
    this.fresh = true;
  }

  draw(
    w: number,
    h: number,
    delta: number,
    f: AudioFeatures,
    reduced: boolean,
    large: boolean,
    themeColor: string,
  ) {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    const dt = Math.max(0, Math.min(delta, 0.1));
    // Freeze spatial movement under reduced motion. Energy can still change color/height.
    if (!reduced && f.energy > 0.006) this.time += dt * (0.2 + f.energy * 0.9);
    const t = this.time;
    const style = this.preset.id;
    const trails = ['prism', 'ribbons', 'celestial', 'stardust', 'neon', 'bloom'].includes(style);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (large) {
      ctx.fillStyle = `rgba(2,4,12,${this.fresh || reduced || !trails ? 1 : 1 - Math.exp(-Math.max(dt, 0.016) / 0.19)})`;
      ctx.fillRect(0, 0, w, h);
    } else ctx.clearRect(0, 0, w, h);
    this.fresh = false;
    ctx.save();
    const scale = Math.min(w, h);
    switch (style) {
      case 'spectrum':
        this.spectrum(w, h, f, themeColor, large);
        break;
      case 'waveform':
        this.waveform(w, h, f, themeColor);
        break;
      case 'ambient':
        this.glow(
          w / 2,
          h / 2,
          scale * (0.3 + f.energy * 0.3),
          this.preset.hue,
          0.2 + f.energy * 0.8,
        );
        break;
      case 'garden':
      case 'prism':
        this.prism(w, h, f, t);
        break;
      case 'ocean':
        this.ocean(w, h, f, t);
        break;
      case 'dots':
        this.landscape(w, h, f, t, false);
        break;
      case 'matrix':
        this.landscape(w, h, f, t, true);
        break;
      case 'aurora':
      case 'ribbons':
        this.ribbons(w, h, f, t, false);
        break;
      case 'neon':
        this.ribbons(w, h, f, t, true);
        break;
      case 'celestial':
        this.orbits(w, h, f, t, false);
        break;
      case 'stardust':
        this.orbits(w, h, f, t, true);
        break;
      case 'reactor':
        this.reactor(w, h, f, t);
        break;
      case 'current':
      case 'liquid':
        this.liquid(w, h, f, t);
        break;
      case 'tunnel':
        this.tunnel(w, h, f, t);
        break;
      case 'bloom':
        this.bloom(w, h, f, t);
        break;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private glow(x: number, y: number, radius: number, hue: number, opacity: number) {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    gradient.addColorStop(0, color(hue, opacity, 85));
    gradient.addColorStop(0.12, color(hue, opacity * 0.55));
    gradient.addColorStop(0.5, color(hue, opacity * 0.13, 45));
    gradient.addColorStop(1, color(hue, 0, 20));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  private stroke(hue: number, width = 1.5, alpha = 0.8) {
    const ctx = this.ctx;
    ctx.strokeStyle = color(hue, alpha * 0.1);
    ctx.lineWidth = width * 5;
    ctx.stroke();
    ctx.strokeStyle = color(hue, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private project(x: number, y: number, z: number, rotation: number, w: number, h: number): Point {
    const xx = x * Math.cos(rotation) + z * Math.sin(rotation);
    const zz = -x * Math.sin(rotation) + z * Math.cos(rotation);
    const depth = 4.5 + zz;
    const factor = (Math.min(w, h) * 1.25) / Math.max(0.45, depth);
    return { x: w / 2 + xx * factor, y: h / 2 + y * factor, z: factor };
  }

  private starfield(w: number, h: number, t: number, energy: number) {
    const ctx = this.ctx;
    for (const star of this.stars) {
      const phase = (star.z + t * 0.035) % 1;
      const x = w / 2 + (star.x - 0.5) * w * (0.4 + phase);
      const y = h / 2 + (star.y - 0.5) * h * (0.4 + phase);
      ctx.fillStyle = `rgba(195,218,255,${0.1 + phase * 0.45 + energy * 0.1})`;
      ctx.fillRect(x, y, 0.6 + phase * 1.2, 0.6 + phase * 1.2);
    }
  }

  private spectrum(w: number, h: number, f: AudioFeatures, tint: string, large: boolean) {
    const ctx = this.ctx;
    const count = Math.max(1, Math.min(64, Math.floor(w / (large ? 12 : 4))));
    const step = w / count;
    for (let i = 0; i < count; i++) {
      const v = f.bands[Math.floor((i / count) * f.bands.length)];
      const height = Math.max(2, v * h * 0.86);
      ctx.fillStyle = large ? color(175 + (i / count) * 110, 0.7 + v * 0.3) : tint;
      ctx.fillRect(i * step, h - height, Math.max(1, step - (large ? 3 : 2)), height);
      if (large && height > 3) {
        ctx.fillStyle = '#e2fff5';
        ctx.fillRect(i * step, h - height, Math.max(1, step - 3), 2);
      }
    }
  }

  private waveform(w: number, h: number, f: AudioFeatures, tint: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < f.wave.length; i++) {
      const x = (i / (f.wave.length - 1)) * w;
      const y = h / 2 + f.wave[i] * h * 0.4;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private prism(w: number, h: number, f: AudioFeatures, t: number) {
    const ctx = this.ctx;
    const size = Math.min(w, h) * (0.25 + f.bass * 0.12);
    this.glow(w / 2, h / 2, size * 1.5, 280 + t * 12, 0.15 + f.energy * 0.25);
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 5; layer++) {
      ctx.beginPath();
      for (let i = 0; i <= 320; i++) {
        const angle = (i / 320) * TAU;
        const band = f.bands[Math.floor((i / 321) * 63)];
        const radius =
          size * (0.7 + Math.sin(angle * (5 + layer) + t + layer) * (0.2 + band * 0.35));
        const a = angle + t * 0.14 + layer * 0.23;
        const x = Math.cos(a) * radius * (1 + layer * 0.08);
        const y = Math.sin(a) * radius;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      this.stroke(220 + layer * 42 + t * 18, 1.1 + f.beat, 0.65);
    }
  }

  private ocean(w: number, h: number, f: AudioFeatures, t: number) {
    const ctx = this.ctx;
    this.glow(w * 0.5, h * 0.6, w * 0.5, 215, 0.2);
    for (let row = 0; row < 12; row++) {
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const x = (i / 160) * w;
        const band = f.bands[Math.min(63, Math.floor((i / 160) * 63))];
        const wave =
          Math.sin(i * 0.045 + t + row * 0.28) + Math.cos(i * 0.026 - t * 0.5 + row * 0.5);
        const y =
          h * 0.34 +
          row * h * 0.035 +
          wave * h * (0.035 + band * 0.1) +
          f.wave[Math.floor((i / 161) * 255)] * h * 0.06;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      this.stroke(180 + row * 8 + f.treble * 40, 1 + f.bass, 0.3 + row / 24);
    }
  }

  private landscape(w: number, h: number, f: AudioFeatures, t: number, matrix: boolean) {
    const ctx = this.ctx;
    this.glow(w / 2, h * 0.55, h * 0.5, matrix ? 115 : 220, 0.18 + f.bass * 0.16);
    const cols = this.quality === 'high' ? 55 : 38;
    for (let row = 30; row >= 0; row--) {
      ctx.beginPath();
      for (let col = 0; col <= cols; col++) {
        const x = (col / cols - 0.5) * 7;
        const z = (row / 30) * 5 - 0.8;
        const band = f.bands[Math.min(63, Math.floor((col / cols) * 63))];
        const y =
          0.7 +
          Math.sin(x * 1.6 + t * 1.2 + z) * (0.12 + f.bass * 0.4) -
          band * (0.35 + Math.sin(z * 2 + t) * 0.25);
        const depth = z + 3;
        const xx = w / 2 + (x * Math.min(w, h)) / depth;
        const yy = h * 0.38 + (y * h) / depth + (1 / depth) * h * 0.1;
        if (matrix) col ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        else {
          ctx.fillStyle = color(180 + band * 100 + row, 0.24 + (1 - row / 31) * 0.7);
          const radius = (0.8 + band * 2.7) * (1.5 / depth);
          ctx.fillRect(xx, yy, radius * 2, radius * 2);
        }
      }
      if (matrix) this.stroke(95 + row * 1.8, 0.7, 0.18 + (1 - row / 31) * 0.5);
    }
  }

  private ribbons(w: number, h: number, f: AudioFeatures, t: number, neon: boolean) {
    const ctx = this.ctx;
    this.starfield(w, h, t, f.energy);
    this.glow(w / 2, h / 2, h * 0.65, neon ? 295 : 220, 0.08 + f.bass * 0.22);
    ctx.globalCompositeOperation = 'lighter';
    const lines = neon ? 9 : 7;
    for (let line = 0; line < lines; line++) {
      ctx.beginPath();
      for (let i = 0; i <= 220; i++) {
        const u = (i / 220) * TAU;
        const band = f.bands[Math.floor((i / 221) * 63)];
        const phase = t * 0.3 + line * 0.16;
        const r = 1.05 + Math.sin(u * 3 + phase) * (0.12 + band * 0.2);
        const x = Math.sin(u * (neon ? 2 : 1) + phase) * r * 1.4;
        const y =
          Math.cos(u * 3 + phase * 1.4) * (0.65 + f.mid * 0.4) + Math.sin(phase + line) * 0.1;
        const z = Math.cos(u * 2 - phase) * (0.75 + f.bass * 0.5);
        const p = this.project(x, y, z, t * 0.16 + line * 0.035, w, h);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      this.stroke((neon ? 260 : 20) + line * 29 + t * 18, neon ? 1.8 : 1.3, 0.6 + f.energy * 0.3);
    }
  }

  private orbits(w: number, h: number, f: AudioFeatures, t: number, stardust: boolean) {
    const ctx = this.ctx;
    const scale = Math.min(w, h);
    this.starfield(w, h, t, f.energy);
    this.glow(
      w / 2,
      h / 2,
      scale * (0.25 + f.bass * 0.15),
      stardust ? 25 : 220,
      0.28 + f.energy * 0.4,
    );
    ctx.globalCompositeOperation = 'lighter';
    const count = this.quality === 'high' ? 130 : 85;
    for (let i = 0; i < count; i++) {
      const star = this.stars[i];
      const band = f.bands[i % 64];
      const phase = star.x * TAU + t * (0.15 + star.z * 0.3);
      const radius = (stardust ? 0.35 + star.y * 1.5 : 0.9 + star.y * 0.35) * (1 + f.bass * 0.2);
      const point = (a: number) => {
        const x = Math.cos(a) * radius;
        const y = stardust
          ? Math.sin(a * 2 + star.z * TAU) * radius * 0.55
          : Math.sin(a) * Math.sin(star.z * TAU) * radius;
        const z = Math.sin(a) * Math.cos(star.z * TAU) * radius;
        return this.project(x, y, z, t * 0.1, w, h);
      };
      ctx.beginPath();
      for (let j = 0; j < 9; j++) {
        const p = point(phase - j * (stardust ? 0.028 : 0.012));
        j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.lineWidth = 0.6 + band * 2;
      ctx.strokeStyle = color(star.z * 140 + t * 15 + (stardust ? 330 : 180), 0.4 + band * 0.5);
      ctx.stroke();
      const p = point(phase);
      ctx.fillStyle = color(star.z * 140 + t * 15 + 180, 0.8, 85);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.6 + band * 1.8, 0, TAU);
      ctx.fill();
    }
  }

  private reactor(w: number, h: number, f: AudioFeatures, t: number) {
    if (!this.plasmaContext || !this.plasmaPixels) return;
    const pw = this.plasma.width,
      ph = this.plasma.height;
    const pixels = this.plasmaPixels.data;
    const aspect = w / h;
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const px = (x / pw - 0.5) * Math.min(aspect, 2.5) * 3;
        const py = (y / ph - 0.5) * 3;
        const dist = Math.hypot(px, py);
        const angle = Math.atan2(py, px);
        const field =
          Math.sin(px * 3 + Math.sin(py * 3 + t)) +
          Math.cos(py * 3.5 - t) +
          Math.sin(dist * (8 + f.bass * 3) - t * 2 + Math.sin(angle * 4 + t));
        const membrane = Math.pow(Math.max(0, 1 - Math.abs(field) * 0.7), 5);
        const aura = Math.exp(-dist * dist * 0.8);
        const emission = Math.min(1, membrane * aura * (0.55 + f.energy * 1.5));
        const i = (y * pw + x) * 4;
        pixels[i] = emission * 100 + aura * 3;
        pixels[i + 1] = emission * 225 + aura * (12 + f.bass * 35);
        pixels[i + 2] = emission * 32 + aura * 5;
        pixels[i + 3] = 255;
      }
    this.plasmaContext.putImageData(this.plasmaPixels, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.plasma, 0, 0, w, h);
    this.glow(w / 2, h / 2, Math.min(w, h) * (0.3 + f.beat * 0.02), 100, 0.08 + f.bass * 0.2);
  }

  private liquid(w: number, h: number, f: AudioFeatures, t: number) {
    const ctx = this.ctx;
    this.glow(w / 2, h / 2, h * 0.52, 125, 0.22 + f.bass * 0.25);
    ctx.globalCompositeOperation = 'lighter';
    for (let ring = 0; ring < 32; ring++) {
      const latitude = (ring / 31 - 0.5) * Math.PI;
      ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const angle = (i / 128) * TAU;
        const band = f.bands[Math.floor((i / 129) * 63)];
        const r =
          1.1 + Math.sin(angle * 4 + latitude * 3 + t) * (0.13 + f.bass * 0.18) + band * 0.13;
        const p = this.project(
          Math.cos(angle) * Math.cos(latitude) * r,
          Math.sin(latitude) * r,
          Math.sin(angle) * Math.cos(latitude) * r,
          t * 0.22,
          w,
          h,
        );
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = color(105 + ring * 1.6, 0.2 + f.energy * 0.45);
      ctx.lineWidth = 0.7 + f.treble;
      ctx.stroke();
    }
  }

  private tunnel(w: number, h: number, f: AudioFeatures, t: number) {
    const ctx = this.ctx;
    const scale = Math.min(w, h);
    this.starfield(w, h, t * 2, f.energy);
    this.glow(w / 2, h / 2, scale * 0.4, 240 + t * 10, 0.18 + f.bass * 0.25);
    ctx.globalCompositeOperation = 'lighter';
    for (let ring = 29; ring >= 0; ring--) {
      const z = (ring / 30 + t * 0.09) % 1;
      const radius = (scale * 0.05) / Math.max(0.045, 1 - z);
      const twist = t * 0.3 + z * 2.5 + f.bass * 0.2;
      const cx = w / 2 + Math.sin(z * 3 + t * 0.3) * scale * 0.09;
      const cy = h / 2 + Math.cos(z * 4 + t * 0.3) * scale * 0.09;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * TAU + twist;
        const facet = 0.95 + Math.cos(a * 6) * (0.04 + f.bands[i % 64] * 0.1);
        const x = cx + Math.cos(a) * radius * facet;
        const y = cy + Math.sin(a) * radius * facet;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      this.stroke(205 + z * 120 + t * 13, 0.8 + z * 1.5, (1 - z) * 0.8);
    }
  }

  private bloom(w: number, h: number, f: AudioFeatures, t: number) {
    const ctx = this.ctx;
    const scale = Math.min(w, h);
    this.glow(w / 2, h / 2, scale * 0.6, 285 + t * 15, 0.08 + f.bass * 0.2);
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 8; layer++) {
      ctx.beginPath();
      for (let i = 0; i <= 256; i++) {
        const angle = (i / 256) * TAU;
        const band = f.bands[i % 64];
        const petal = Math.sin(angle * 6 + Math.sin(t * 0.5) * 1.2);
        const r = scale * (0.12 + layer * 0.026) * (1 + petal * (0.33 + f.mid * 0.3) + band * 0.18);
        const a = angle + t * 0.1 + layer * 0.045;
        const x = Math.cos(a) * r,
          y = Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      this.stroke(240 + layer * 21 + t * 18, 0.7 + f.bass, 0.6);
    }
  }
}
