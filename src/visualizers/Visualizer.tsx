import { useEffect, useRef } from 'react';
import type { Player } from '../player';
import { AudioFeaturesReader } from './audio';
import {
  getVisualizer,
  VISUALIZER_FAMILIES,
  VISUALIZER_PRESETS,
  type VisualizerQuality,
} from './catalog';
import { VisualizerRenderer } from './renderer';

export function VisualizerOptions() {
  return VISUALIZER_FAMILIES.map((family) => (
    <optgroup key={family.id} label={family.label}>
      {VISUALIZER_PRESETS.filter((p) => p.family === family.id).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </optgroup>
  ));
}

export function Visualizer({
  player,
  mode = 'spectrum',
  large = false,
  active = true,
  quality = 'balanced',
  reducedMotion = false,
}: {
  player: Player;
  mode?: string;
  large?: boolean;
  active?: boolean;
  quality?: VisualizerQuality;
  reducedMotion?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playing = useRef(player.state.playing);
  const wake = useRef<() => void>(() => {});
  playing.current = player.state.playing;

  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d', { alpha: !large });
    if (!ctx || !active) return;
    const reader = new AudioFeaturesReader();
    const renderer = new VisualizerRenderer(ctx, getVisualizer(mode), quality);
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = reducedMotion || mediaQuery.matches;
    let frame = 0,
      last = 0,
      dirty = true,
      visible = !document.hidden;
    let width = 0,
      height = 0;
    let frequency = new Uint8Array(0),
      waveform = new Uint8Array(0);
    let tint = '#83c8c0';
    const resize = () => {
      const box = element.getBoundingClientRect();
      width = box.width;
      height = box.height;
      // Cap the backing store as well as the device ratio on very large displays.
      const maxPixels = quality === 'high' ? 3200000 : 1600000;
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        quality === 'high' ? 2 : 1.5,
        Math.sqrt(maxPixels / Math.max(1, width * height)),
      );
      element.width = Math.max(1, Math.round(width * dpr));
      element.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tint = getComputedStyle(element).getPropertyValue('--visual-color').trim() || '#83c8c0';
      renderer.reset();
      dirty = true;
      wake.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const motionChanged = () => {
      reduced = reducedMotion || mediaQuery.matches;
      dirty = true;
      renderer.reset();
      wake.current();
    };
    mediaQuery.addEventListener('change', motionChanged);

    const draw = (now: number) => {
      frame = 0;
      if (!visible) return;
      const interval = reduced ? 100 : quality === 'high' ? 1000 / 60 : 1000 / 30;
      if (now - last >= interval - 0.5 && width && height && (playing.current || dirty)) {
        const delta = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
        last = now;
        const analyser = player.graph.current?.analyser;
        if (analyser && playing.current) {
          if (frequency.length !== analyser.frequencyBinCount) {
            frequency = new Uint8Array(analyser.frequencyBinCount);
            waveform = new Uint8Array(analyser.fftSize);
          }
          analyser.getByteFrequencyData(frequency);
          analyser.getByteTimeDomainData(waveform);
          reader.update(frequency, waveform, analyser.context.sampleRate, analyser.fftSize, delta);
        }
        renderer.draw(width, height, delta, reader.features, reduced, large, tint);
        dirty = false;
      }
      if (width && height && (playing.current || dirty)) frame = requestAnimationFrame(draw);
    };
    wake.current = () => {
      if (!frame && visible) {
        last = 0;
        frame = requestAnimationFrame(draw);
      }
    };
    const visibilityChanged = () => {
      visible = !document.hidden;
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (visible && (playing.current || dirty)) frame = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    if (visible) frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      wake.current = () => {};
      observer.disconnect();
      mediaQuery.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [mode, large, active, quality, reducedMotion, player.graph]);

  useEffect(() => {
    wake.current();
  }, [player.state.playing]);

  return (
    <canvas
      ref={canvas}
      className={`visualizer ${large ? 'large' : ''}`}
      aria-label={`${getVisualizer(mode).name} audio visualizer`}
      role="img"
    />
  );
}
