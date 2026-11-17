import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, Maximize2, Pause, Play, RefreshCw } from 'lucide-react';
import type { Broadcast } from './useBroadcast';

export function BroadcastVideo({
  broadcast: b,
  back,
  theater,
  toggleTheater,
}: {
  broadcast: Broadcast;
  back: () => void;
  theater: boolean;
  toggleTheater: () => void;
}) {
  const live = b.state.video!;
  const media = useRef<HTMLVideoElement>(null),
    engine = useRef<Hls | null>(null);
  const latest = useRef({ live, paused: b.paused, receivedAt: b.receivedAt });
  latest.current = { live, paused: b.paused, receivedAt: b.receivedAt };
  const [source, setSource] = useState(live.url),
    [retry, setRetry] = useState(0),
    [message, setMessage] = useState('Preparing the live picture…'),
    [level, setLevel] = useState('');
  useEffect(() => {
    if (!b.paused) setSource(live.url);
  }, [live.url, b.paused]);
  useEffect(() => {
    const video = media.current;
    if (!video) return;
    let disposed = false,
      lastSeek = 0,
      stopped = false,
      retries = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    setMessage('Preparing the live picture…');
    setLevel('');
    if (!Hls.isSupported()) {
      setMessage(
        'This system WebView does not support adaptive video. Update the operating system/WebView.',
      );
      return;
    }
    const target = () => {
      const { live, receivedAt } = latest.current;
      return Math.min(
        Math.max(0, live.duration - 0.05),
        Math.max(0, live.position + (live.playing ? (performance.now() - receivedAt) / 1000 : 0)),
      );
    };
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      liveSyncDuration: 6,
      liveMaxLatencyDuration: 12,
      maxLiveSyncPlaybackRate: 1,
      maxBufferLength: 12,
      backBufferLength: 6,
      capLevelToPlayerSize: true,
      startLevel: 0,
      startPosition: target(),
      abrEwmaDefaultEstimate: 1_500_000,
    });
    engine.current = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setMessage('Synchronizing picture…');
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      const selected = hls.levels[data.level];
      if (selected) setLevel(`${selected.height}p`);
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (disposed || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 12) {
        setMessage('Buffering video; staying with the live broadcast…');
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!disposed) hls.loadSource(source);
        }, 1000);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries++ < 12) {
        hls.recoverMediaError();
      } else
        setMessage('The picture could not keep up. Try Auto quality or reconnect to live video.');
    });
    hls.attachMedia(video);
    hls.loadSource(source);
    const update = () => {
      const { live, paused } = latest.current;
      if (paused || document.hidden) {
        video.pause();
        if (!stopped) {
          hls.stopLoad();
          stopped = true;
        }
        return;
      }
      if (stopped) {
        hls.startLoad(target());
        stopped = false;
        lastSeek = 0;
      }
      if (!live.playing) {
        video.pause();
        return;
      }
      const wanted = target(),
        drift = wanted - video.currentTime;
      if (
        video.readyState >= 1 &&
        !video.seeking &&
        Math.abs(drift) > 0.4 &&
        performance.now() - lastSeek > 1500
      ) {
        video.currentTime = wanted;
        lastSeek = performance.now();
      }
      video.playbackRate = Math.abs(drift) < 0.08 ? 1 : drift > 0 ? 1.03 : 0.97;
      if (video.readyState >= 2) {
        setMessage('');
        void video.play().catch(() => {
          if (!disposed) setMessage('Click Resume live to start the picture.');
        });
      }
    };
    const interval = setInterval(update, 200);
    document.addEventListener('visibilitychange', update);
    return () => {
      disposed = true;
      clearInterval(interval);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
      hls.destroy();
      engine.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [source, retry]);
  useEffect(() => {
    const hls = engine.current;
    if (!hls) return;
    const apply = () => {
      if (b.quality === 'auto') {
        hls.loadLevel = -1;
        hls.capLevelToPlayerSize = true;
        return;
      }
      hls.capLevelToPlayerSize = false;
      const sorted = hls.levels
        .map((l, i) => ({ i, bitrate: l.bitrate }))
        .sort((a, b) => a.bitrate - b.bitrate);
      const index =
        b.quality === 'high'
          ? sorted.length - 1
          : b.quality === 'medium'
            ? Math.min(1, sorted.length - 1)
            : 0;
      if (sorted[index]) hls.loadLevel = sorted[index].i;
    };
    apply();
    hls.on(Hls.Events.MANIFEST_PARSED, apply);
    return () => hls.off(Hls.Events.MANIFEST_PARSED, apply);
  }, [b.quality, source, retry]);
  const pause = () => void b.toggle().catch(() => {});
  return (
    <div className="broadcast-video">
      <video ref={media} muted playsInline preload="auto" aria-label="Live broadcast video" />
      <div className="stage-top">
        <button onClick={back}>
          <ArrowLeft size={15} />
          LAN broadcast
        </button>
        <strong>{b.track?.title || b.name}</strong>
        <button onClick={toggleTheater}>
          <Maximize2 size={15} />
          {theater ? 'Exit theater' : 'Theater'}
        </button>
      </div>
      <div className="broadcast-video-controls">
        <span className="on-air">
          {b.paused ? 'PAUSED' : 'LIVE'} {level && !b.paused ? `· ${level}` : ''}
        </span>
        <button
          disabled={!b.state.station?.active && b.state.listening?.phase === 'paused'}
          onClick={pause}
        >
          {b.paused ? <Play size={15} /> : <Pause size={15} />}{' '}
          {b.state.station?.active
            ? b.paused
              ? 'Resume broadcast'
              : 'Pause broadcast'
            : b.state.listening?.phase === 'paused'
              ? 'Paused by broadcaster'
              : b.paused
                ? 'Resume live'
                : 'Pause here'}
        </button>
        <label>
          Video quality
          <select
            aria-label="Video stream quality"
            value={b.quality}
            onChange={(e) => b.setQuality(e.target.value as Broadcast['quality'])}
          >
            <option value="auto">Auto · keep live</option>
            <option value="high">High · up to 1080p</option>
            <option value="medium">Medium · up to 720p</option>
            <option value="low">Low · up to 480p</option>
          </select>
        </label>
        <button onClick={() => setRetry((v) => v + 1)} title="Reload video at the live position">
          <RefreshCw size={14} />
          Reconnect picture
        </button>
      </div>
      {(message || b.paused) && (
        <div className="broadcast-video-message" role="status">
          {b.paused
            ? b.state.station?.active
              ? 'Broadcast paused for all rooms.'
              : b.state.listening?.phase === 'paused'
                ? 'The broadcaster paused playback.'
                : 'Paused in this room. Resume returns to the live broadcast.'
            : message}
        </div>
      )}
    </div>
  );
}
