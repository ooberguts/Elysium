import { useEffect, useRef } from 'react';
import type { Player } from '../player';
import { AudioFeaturesReader } from './audio';
import {
  getVisualizer,
  nextShowPreset,
  VISUALIZER_FAMILIES,
  VISUALIZER_PRESETS,
  type VisualizerQuality,
} from './catalog';
import { VisualizerRenderer } from './renderer';
import { GpuVisualizer } from './gpu';
import type { ExternalAudioFeed } from './capture';
import { ShowClock } from './motion';

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
  intensity = 1,
  external,
  auto = false,
  onPresetChange,
}: {
  player: Player;
  mode?: string;
  large?: boolean;
  active?: boolean;
  quality?: VisualizerQuality;
  reducedMotion?: boolean;
  intensity?: number;
  external?: ExternalAudioFeed;
  auto?: boolean;
  onPresetChange?: (id: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const playing = external ? external.running : player.state.playing;
  const latest = useRef({
    playing,
    mode,
    reducedMotion,
    intensity,
    external,
    auto,
    onPresetChange,
  });
  latest.current = { playing, mode, reducedMotion, intensity, external, auto, onPresetChange };
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const host = surface.current!;
    if (!active) return;
    let element = document.createElement('canvas');
    host.replaceChildren(element);
    let gpu = large ? GpuVisualizer.create(element) : null;
    let fallback: VisualizerRenderer | null = null;
    let context: CanvasRenderingContext2D | null = null;
    const reader = new AudioFeaturesReader();
    const show = new ShowClock();
    let previousPreset = '';
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0,
      last = 0,
      dirty = true,
      visible = !document.hidden;
    let width = 0,
      height = 0,
      appliedMode = '';
    let frequency = new Uint8Array(0),
      waveform = new Float32Array(0);
    const silence = new Uint8Array(1024),
      neutral = new Uint8Array(2048).fill(128);
    let tint = '#75cabb';
    const reduced = () => latest.current.reducedMotion || mediaQuery.matches;
    const useFallback = () => {
      // A canvas cannot change context type after WebGL creation (or failure).
      element.removeEventListener('webglcontextlost', contextLost);
      gpu?.dispose(true);
      gpu = null;
      element = document.createElement('canvas');
      host.replaceChildren(element);
      context = element.getContext('2d', { alpha: !large });
      if (context)
        fallback = new VisualizerRenderer(context, getVisualizer(latest.current.mode), quality);
      host.dataset.renderer = 'canvas';
    };
    const resize = () => {
      const box = host.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const maxPixels = quality === 'high' ? 1800000 : 900000;
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        quality === 'high' ? 2 : 1.5,
        Math.sqrt(maxPixels / Math.max(1, width * height)),
      );
      element.width = Math.max(1, Math.round(width * dpr));
      element.height = Math.max(1, Math.round(height * dpr));
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      tint = getComputedStyle(host).getPropertyValue('--visual-color').trim() || '#75cabb';
      try {
        gpu?.resize(element.width, element.height);
      } catch {
        useFallback();
        resize();
        return;
      }
      fallback?.reset();
      dirty = true;
      wake.current();
    };
    function contextLost(event: Event) {
      event.preventDefault();
      useFallback();
      resize();
    }
    if (!gpu) useFallback();
    else {
      host.dataset.renderer = 'webgl';
      element.addEventListener('webglcontextlost', contextLost);
    }
    const applyMode = () => {
      if (appliedMode === latest.current.mode) return;
      previousPreset = appliedMode;
      appliedMode = latest.current.mode;
      show.elapsed = 0;
      gpu?.setPreset(getVisualizer(appliedMode), reduced());
      if (context) fallback = new VisualizerRenderer(context, getVisualizer(appliedMode), quality);
    };
    const draw = (now: number) => {
      frame = 0;
      if (!visible) return;
      const interval = reduced() ? 100 : quality === 'high' ? 1000 / 60 : 1000 / 30;
      if (
        now - last >= interval - 0.5 &&
        width &&
        height &&
        (latest.current.playing || dirty || gpu?.transitioning)
      ) {
        const delta = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
        last = now;
        applyMode();
        const analyser = player.graph.current?.analyser;
        const feed = latest.current.external;
        if (feed) {
          const packet = feed.frame.current;
          if (packet && performance.now() - packet.receivedAt < 500 && feed.running)
            reader.update(packet.frequency, packet.waveform, packet.sampleRate, 2048, delta);
          else reader.update(silence, neutral, 48000, 2048, delta);
        } else if (analyser && latest.current.playing) {
          if (frequency.length !== analyser.frequencyBinCount) {
            frequency = new Uint8Array(analyser.frequencyBinCount);
            waveform = new Float32Array(analyser.fftSize);
          }
          analyser.getByteFrequencyData(frequency);
          analyser.getFloatTimeDomainData(waveform);
          reader.update(frequency, waveform, analyser.context.sampleRate, analyser.fftSize, delta);
        }
        gpu?.draw(
          delta,
          reader.features,
          reduced(),
          latest.current.intensity,
          latest.current.playing,
        );
        fallback?.draw(
          width,
          height,
          latest.current.playing ? delta : 0,
          reader.features,
          reduced(),
          large,
          tint,
        );
        if (
          latest.current.auto &&
          large &&
          show.tick(delta, reader.features, latest.current.playing, reduced())
        )
          latest.current.onPresetChange?.(nextShowPreset(appliedMode, previousPreset).id);
        if (!latest.current.auto) show.elapsed = 0;
        dirty = false;
      }
      if (width && height && (latest.current.playing || dirty || gpu?.transitioning))
        frame = requestAnimationFrame(draw);
    };
    wake.current = () => {
      dirty = true;
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
      if (visible) wake.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    mediaQuery.addEventListener('change', wake.current);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('webglcontextlost', contextLost);
      mediaQuery.removeEventListener('change', wake.current);
      document.removeEventListener('visibilitychange', visibilityChanged);
      wake.current = () => {};
      gpu?.dispose(true);
      host.replaceChildren();
    };
  }, [large, active, quality, player.graph]);

  useEffect(() => {
    wake.current();
  }, [mode, playing, reducedMotion, intensity, !!external]);
  return (
    <div
      ref={surface}
      className={`visualizer ${large ? 'large' : ''}`}
      aria-label={`${getVisualizer(mode).name} audio visualizer`}
      role="img"
    />
  );
}
