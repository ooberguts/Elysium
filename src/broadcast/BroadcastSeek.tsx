import { useRef, useState } from 'react';
import { seconds } from '../domain';
import type { Broadcast } from './useBroadcast';

export function BroadcastSeek({ broadcast: b }: { broadcast: Broadcast }) {
  const host = !!b.state.station?.active;
  const offset = b.track?.startPosition || 0;
  const duration = Math.max(0, offset + (b.track?.duration || 0));
  const position = Math.min(
    duration,
    offset + (host ? b.state.station?.position || 0 : b.state.listening?.position || 0),
  );
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const shown = Math.min(duration, draft ?? position);
  const commit = () => {
    const value = draftRef.current;
    if (value === null) return;
    draftRef.current = null;
    setDraft(null);
    void b.call('broadcast_seek', { position: value }).catch(() => {});
  };
  return (
    <div className="seek-row broadcast-seek">
      <span>{seconds(shown)}</span>
      {host ? (
        <input
          type="range"
          aria-label="Seek broadcast playback"
          min="0"
          max={Math.max(0.1, duration)}
          step="0.1"
          value={shown}
          disabled={!b.track || !duration || !!b.busy}
          onChange={(event) => {
            const value = Number(event.target.value);
            draftRef.current = value;
            setDraft(value);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      ) : (
        <progress aria-label="Live broadcast position" max={Math.max(1, duration)} value={shown} />
      )}
      <span>{seconds(duration)}</span>
    </div>
  );
}
