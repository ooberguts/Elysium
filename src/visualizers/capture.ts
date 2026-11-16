import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { desktop, native } from '../bridge';

export type AudioDevice = {
  id: string;
  name: string;
  kind: 'input' | 'output';
  isDefault: boolean;
};
type Packet = { session: number; frequency: number[]; waveform: number[]; sampleRate: number };
export type CaptureFrame = {
  frequency: Uint8Array;
  waveform: Float32Array;
  sampleRate: number;
  receivedAt: number;
};
export type ExternalAudioFeed = { frame: RefObject<CaptureFrame | null>; running: boolean };

export function useAudioCapture() {
  const frame = useRef<CaptureFrame | null>(null);
  const session = useRef<number | null>(null);
  const generation = useRef(0);
  const lastMeter = useRef(0);
  const connecting = useRef(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('External audio');
  const [level, setLevel] = useState(0);
  const readiness = useRef<Promise<unknown>>(Promise.resolve());
  const stop = useCallback(async () => {
    generation.current++;
    const id = session.current;
    const pending = connecting.current;
    connecting.current = false;
    session.current = null;
    frame.current = null;
    setRunning(false);
    setBusy(false);
    setLevel(0);
    if (id !== null || pending)
      await native('stop_audio_capture', { session: id }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const subscriptions = [
      listen<Packet>('visualizer-audio', ({ payload: p }) => {
        if (p.session !== session.current) return;
        const waveform = Float32Array.from(p.waveform);
        frame.current = {
          frequency: Uint8Array.from(p.frequency),
          waveform,
          sampleRate: p.sampleRate,
          receivedAt: performance.now(),
        };
        const power = waveform.reduce((sum, v) => sum + v * v, 0) / Math.max(1, waveform.length);
        if (performance.now() - lastMeter.current > 100) {
          lastMeter.current = performance.now();
          setLevel(Math.min(1, Math.sqrt(power) * 3));
        }
      }),
      listen<{ session: number; message: string }>('visualizer-capture-error', ({ payload: p }) => {
        if (p.session !== session.current) return;
        setError(p.message);
        void stop();
      }),
    ];
    readiness.current = Promise.all(subscriptions);
    return () => {
      generation.current++;
      const id = session.current;
      session.current = null;
      if (id !== null || connecting.current)
        void native('stop_audio_capture', { session: id }).catch(() => {});
      connecting.current = false;
      subscriptions.forEach((p) => void p.then((unlisten) => unlisten()).catch(() => {}));
    };
  }, [stop]);
  const refresh = useCallback(async () => {
    if (!desktop) {
      setError('Audio devices are available in the Elysium desktop app.');
      return;
    }
    try {
      setDevices(await native<AudioDevice[]>('list_audio_devices'));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const start = useCallback(
    async (device: AudioDevice) => {
      await stop();
      const ticket = ++generation.current;
      setBusy(true);
      setError('');
      try {
        await readiness.current;
        if (ticket !== generation.current) return;
        connecting.current = true;
        const id = await native<number>('start_audio_capture', {
          deviceId: device.id,
          kind: device.kind,
        });
        if (ticket !== generation.current) {
          await native('stop_audio_capture', { session: id });
          return;
        }
        session.current = id;
        setName(device.name);
        setRunning(true);
      } catch (e) {
        if (ticket === generation.current) setError(String(e));
      } finally {
        if (ticket === generation.current) {
          connecting.current = false;
          setBusy(false);
        }
      }
    },
    [stop],
  );
  return { frame, running, busy, error, devices, name, level, start, stop, refresh };
}
