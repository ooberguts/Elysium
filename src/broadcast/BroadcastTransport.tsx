import { useEffect, useState } from 'react';
import {
  Headphones,
  Maximize2,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type { Broadcast } from './useBroadcast';
import { BroadcastSeek } from './BroadcastSeek';
import './transport.css';

export function BroadcastTransport({
  broadcast: b,
  visualize,
  settings,
  fullScreen,
}: {
  broadcast: Broadcast;
  visualize: () => void;
  settings: () => void;
  fullScreen: () => void;
}) {
  const host = !!b.state.station?.active;
  const sourcePaused = !host && b.state.listening?.phase === 'paused';
  const [volume, setVolume] = useState(b.state.volume);
  const [savedVolume, setSavedVolume] = useState(0.75);
  useEffect(() => setVolume(b.state.volume), [b.state.volume]);
  const changeVolume = (value: number) => {
    if (value > 0) setSavedVolume(value);
    setVolume(value);
    void b
      .call('broadcast_settings', {
        name: b.state.name,
        allowRequests: b.state.allowRequests,
        volume: value,
        delayMs: b.state.delayMs,
        outputDevice: b.state.outputDevice,
      })
      .catch(() => {});
  };
  return (
    <div
      className="broadcast-player"
      aria-label={host ? 'Broadcast playback controls' : 'Listener playback controls'}
    >
      <button
        className="broadcast-player-art"
        aria-label="Open broadcast Now Playing"
        onClick={visualize}
      >
        {host ? <Radio size={26} /> : <Headphones size={26} />}
      </button>
      <div className="broadcast-player-info">
        <span
          className={`broadcast-status ${host ? (b.paused ? 'broadcast-status-paused' : 'broadcast-status-live') : 'broadcast-status-listening'}`}
          role="status"
        >
          {host ? <Radio size={12} /> : <Headphones size={12} />}
          {host
            ? b.paused
              ? 'Broadcast paused'
              : 'Live broadcast'
            : b.paused
              ? 'Listening paused'
              : 'Listening to broadcast'}
        </span>
        <button onClick={visualize}>{b.track?.title || b.name}</button>
        <span>{b.track?.artist || b.name}</span>
        <small>
          {host
            ? b.paused
              ? 'Broadcast paused · all rooms'
              : 'Broadcasting · all rooms'
            : sourcePaused
              ? 'Paused by broadcaster'
              : b.state.paused
                ? 'This room paused · resume live'
                : `Listening · ${b.name}`}
        </small>
      </div>
      <div className="footer-playback">
        <div className="footer-transport">
          <div className="mini-transport">
            <button
              className="transport-small"
              aria-label="Previous broadcast track"
              disabled={!host || !b.track || !!b.busy}
              onClick={() => void b.call('broadcast_previous').catch(() => {})}
            >
              <SkipBack size={19} fill="currentColor" />
            </button>
            <button
              className="transport-play"
              aria-label={
                sourcePaused
                  ? 'Broadcast paused by host'
                  : host
                    ? b.paused
                      ? 'Resume broadcast'
                      : 'Pause broadcast'
                    : b.paused
                      ? 'Resume listening live'
                      : 'Pause listening'
              }
              disabled={!!b.busy || sourcePaused || !b.track}
              onClick={() => void b.toggle().catch(() => {})}
            >
              {b.paused ? (
                <Play size={24} fill="currentColor" />
              ) : (
                <Pause size={24} fill="currentColor" />
              )}
            </button>
            <button
              className="transport-small"
              aria-label="Next broadcast track"
              disabled={!host || !b.track || !!b.busy}
              onClick={() => void b.call('broadcast_next').catch(() => {})}
            >
              <SkipForward size={19} fill="currentColor" />
            </button>
            <button
              className="icon-button broadcast-stop"
              aria-label={host ? 'Stop broadcast' : 'Leave broadcast'}
              title={host ? 'Stop broadcast' : 'Leave broadcast'}
              disabled={!!b.busy}
              onClick={() => void b.stop().catch(() => {})}
            >
              <Square size={13} fill="currentColor" />
            </button>
          </div>
        </div>
        <BroadcastSeek broadcast={b} />
      </div>
      <div className="footer-tools">
        <div className="footer-volume">
          <button
            className="icon-button"
            aria-label={volume ? 'Mute this room' : 'Unmute this room'}
            onClick={() => changeVolume(volume ? 0 : savedVolume)}
          >
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input
            aria-label="Broadcast room volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
          />
        </div>
        <div className="footer-actions">
          <button
            className="icon-button"
            aria-label="Broadcast Now Playing"
            title="Now Playing"
            onClick={visualize}
          >
            <Waves size={18} />
          </button>
          <button
            className={`icon-button broadcast-settings ${host ? 'broadcast-settings-live' : 'broadcast-settings-listening'}`}
            aria-label={
              host ? 'Broadcast settings · broadcasting' : 'Broadcast settings · listening'
            }
            title="LAN broadcast"
            onClick={settings}
          >
            <Radio size={18} />
          </button>
          <button className="icon-button" aria-label="Full screen" onClick={fullScreen}>
            <Maximize2 size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
