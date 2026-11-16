import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { desktop, native } from '../bridge';
import type { CaptureFrame } from '../visualizers/capture';

export type Track = {
  title: string;
  artist: string;
  album: string;
  duration: number;
  startPosition: number;
  index: number;
  total: number;
  kind: string;
  videoKey: string | null;
};
export type Peer = {
  id: string;
  name: string;
  address: string;
  stationId: string;
  stationName: string;
  accepting: boolean;
  mode: string;
};
export type Invitation = { id: string; name: string; address: string; station: string };
export type Station = {
  id: string;
  name: string;
  active: boolean;
  track: Track | null;
  position: number;
  elapsed: number;
  mode: string;
  minutes: number;
  finishTrack: boolean;
  playHere: boolean;
  skipped: number;
  message: string;
  output: string;
};
export type VideoQuality = 'auto' | 'high' | 'medium' | 'low';
export type Snapshot = {
  paused: boolean;
  video: { url: string; position: number; duration: number; playing: boolean } | null;
  enabled: boolean;
  id: string;
  name: string;
  addresses: string[];
  allowRequests: boolean;
  volume: number;
  delayMs: number;
  outputDevice: string | null;
  peers: Peer[];
  invitations: Invitation[];
  station: Station | null;
  listening: {
    active: boolean;
    name: string;
    address: string;
    phase: string;
    track: Track | null;
    message: string;
    output: string;
  } | null;
  listeners: { id: string; deviceId: string; name: string; address: string }[];
  message: string;
};
export type Output = { id: string; name: string; isDefault: boolean };
const initial: Snapshot = {
  paused: false,
  video: null,
  enabled: false,
  id: '',
  name: '',
  addresses: [],
  allowRequests: false,
  volume: 0.75,
  delayMs: 0,
  outputDevice: null,
  peers: [],
  invitations: [],
  station: null,
  listening: null,
  listeners: [],
  message: '',
};

export function useBroadcast() {
  const [state, setState] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [quality, setQuality] = useState<VideoQuality>(() => {
    const saved = localStorage.getItem('elysium.videoQuality');
    return ['high', 'medium', 'low'].includes(saved || '') ? (saved as VideoQuality) : 'auto';
  });
  useEffect(() => localStorage.setItem('elysium.videoQuality', quality), [quality]);
  const receivedAt = useRef(performance.now());
  const frame = useRef<CaptureFrame | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const started = performance.now();
    const next = await native<Snapshot>('broadcast_status');
    receivedAt.current = (started + performance.now()) / 2;
    if (mounted.current) setState(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!desktop) return;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try {
        await refresh();
      } catch {
        /* Retry transient status failures without interrupting music. */
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 500);
    const subscription = listen<{ frequency: number[]; waveform: number[]; sampleRate: number }>(
      'broadcast-audio',
      ({ payload }) => {
        frame.current = {
          frequency: Uint8Array.from(payload.frequency),
          waveform: Float32Array.from(payload.waveform),
          sampleRate: payload.sampleRate,
          receivedAt: performance.now(),
        };
      },
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
      void subscription.then((stop) => stop()).catch(() => {});
    };
  }, [refresh]);
  const call = useCallback(
    async <T = void>(command: string, args?: Record<string, unknown>): Promise<T> => {
      const ticket = ++operation.current;
      setBusy(command);
      setError('');
      try {
        const result = await native<T>(command, args);
        await refresh();
        return result;
      } catch (e) {
        setError(String(e));
        throw e;
      } finally {
        if (ticket === operation.current) setBusy('');
      }
    },
    [refresh],
  );
  const running =
    !state.paused &&
    !!(
      (state.station?.active && state.station.playHere) ||
      (state.listening?.active && state.listening.phase === 'playing')
    );
  const active = !!(state.station?.active || state.listening?.active);
  const name = state.station?.active ? state.station.name : state.listening?.name || 'LAN radio';
  const track = state.station?.active ? state.station.track : state.listening?.track;
  const stop = () => call(state.station?.active ? 'broadcast_stop' : 'broadcast_leave');
  return {
    state,
    frame,
    running,
    active,
    name,
    track,
    error,
    busy,
    call,
    refresh,
    stop,
    quality,
    setQuality,
    receivedAt: receivedAt.current,
  };
}
export type Broadcast = ReturnType<typeof useBroadcast>;
