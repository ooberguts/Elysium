import { useState } from 'react';
import {
  Check,
  Copy,
  Headphones,
  MonitorSpeaker,
  Play,
  Radio,
  Square,
  Waves,
  Wifi,
} from 'lucide-react';
import { desktop, native } from '../bridge';
import type { Broadcast } from './useBroadcast';
import './broadcast.css';

export function BroadcastPanel({
  broadcast: b,
  prepare,
  visualize,
  preferences,
}: {
  broadcast: Broadcast;
  prepare: () => Promise<void>;
  visualize: () => void;
  preferences: () => void;
}) {
  const s = b.state;
  const [direct, setDirect] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const stations = s.peers.filter((peer) => peer.stationId);
  const hosting = !!s.station?.active;
  const invoke = (command: string, args?: Record<string, unknown>) =>
    void b.call(command, args).catch(() => {});
  const join = async (address: string, station = '') => {
    if (!s.enabled) return;
    try {
      await prepare();
      await b.call('broadcast_join', {
        request: { address, station, outputDevice: s.outputDevice || null },
      });
    } catch {
      /* The broadcast hook reports errors. */
    }
  };
  const invite = async () => {
    const ids = [...selected];
    const replies = await Promise.allSettled(
      ids.map((peerId) => native<string>('broadcast_invite', { peerId })),
    );
    setResults(
      Object.fromEntries(
        replies.map((reply, index) => [
          ids[index],
          reply.status === 'fulfilled' ? reply.value : String(reply.reason),
        ]),
      ),
    );
    await b.refresh();
  };
  return (
    <div className="broadcast-view listen-view">
      <div className="broadcast-heading">
        <div>
          <p className="eyebrow">LISTEN TOGETHER</p>
          <h1>Listen to broadcasts</h1>
          <p>Find and join an Elysium broadcast on your local network.</p>
        </div>
        <span className={s.enabled ? 'lan-status online' : 'lan-status'}>
          <Wifi size={14} />
          {s.enabled ? 'LAN connected' : 'LAN off'}
        </span>
      </div>
      {!desktop && (
        <p className="broadcast-notice">
          Broadcast listening is available in the Elysium desktop app.
        </p>
      )}
      {(b.error || s.message) && (
        <div className="broadcast-notice error" role="alert">
          {b.error || s.message}
        </div>
      )}
      {!s.enabled ? (
        <div className="broadcast-card listen-disabled">
          <Wifi size={24} />
          <div>
            <h2>LAN broadcasting is off</h2>
            <p>Turn it on in Preferences to find broadcasts or share your own playback.</p>
          </div>
          <button className="primary" onClick={preferences}>
            Open Preferences
          </button>
        </div>
      ) : (
        <>
          {!!s.invitations.length && (
            <div className="broadcast-invitations">
              {s.invitations.map((invitation) => (
                <div key={invitation.id}>
                  <Radio size={22} />
                  <div>
                    <strong>{invitation.name}</strong>
                    <p>Another computer invited this room to listen.</p>
                  </div>
                  <button
                    disabled={!!b.busy}
                    onClick={() =>
                      invoke('broadcast_answer_invite', {
                        id: invitation.id,
                        accept: false,
                        outputDevice: null,
                      })
                    }
                  >
                    Decline
                  </button>
                  <button
                    className="primary"
                    disabled={!!b.busy || hosting}
                    onClick={() =>
                      void prepare()
                        .then(() =>
                          b.call('broadcast_answer_invite', {
                            id: invitation.id,
                            accept: true,
                            outputDevice: s.outputDevice || null,
                          }),
                        )
                        .catch(() => {})
                    }
                  >
                    Join broadcast
                  </button>
                </div>
              ))}
            </div>
          )}
          {s.listening?.active && (
            <section className="broadcast-card listening-station">
              <span className="on-air">
                {s.listening.phase === 'playing' ? 'LISTENING' : s.listening.phase.toUpperCase()}
              </span>
              <h3>{s.listening.name}</h3>
              <strong>{s.listening.track?.title || 'Waiting for playback…'}</strong>
              <p>{s.listening.track?.artist}</p>
              {s.listening.message && <p className="broadcast-note">{s.listening.message}</p>}
              <div className="broadcast-actions">
                <button onClick={() => invoke('broadcast_leave')}>
                  <Square size={14} />
                  Leave broadcast
                </button>
                <button onClick={visualize}>
                  <Waves size={15} />
                  {s.video ? 'Watch video' : 'Now Playing'}
                </button>
              </div>
            </section>
          )}
          <section className="broadcast-card listen-stations">
            <div className="broadcast-card-heading">
              <Headphones size={21} />
              <div>
                <h2>Available broadcasts</h2>
                <p>Choose a broadcast to join from this room.</p>
              </div>
            </div>
            {hosting && (
              <p className="broadcast-note">
                Stop your current broadcast using the media controls before joining another.
              </p>
            )}
            <div className="available-stations">
              {stations.map((peer) => (
                <div key={peer.id}>
                  <Radio size={18} />
                  <div>
                    <strong>{peer.stationName || 'Live broadcast'}</strong>
                    <small>{peer.name}</small>
                  </div>
                  <button
                    disabled={!!b.busy || hosting}
                    onClick={() => void join(peer.address, peer.stationId)}
                  >
                    <Play size={13} />
                    Join
                  </button>
                </div>
              ))}
            </div>
            {!stations.length && (
              <p className="broadcast-empty">
                No live broadcasts found. Start one from the media controls on another Elysium
                computer on this network.
              </p>
            )}
            <div className="direct-join">
              <input
                aria-label="Broadcast LAN address"
                placeholder="LAN address:port"
                value={direct}
                onChange={(event) => setDirect(event.target.value)}
              />
              <button
                disabled={!!b.busy || !direct.trim() || hosting}
                onClick={() => void join(direct)}
              >
                Join by address
              </button>
            </div>
          </section>
          {hosting && (
            <details className="broadcast-card broadcast-rooms">
              <summary>Share your current broadcast · {s.listeners.length} listening</summary>
              <p className="broadcast-note">
                Invite a room below or share your address. Playback is controlled from the media
                bar.
              </p>
              {s.addresses.map((address) => (
                <div className="station-address" key={address}>
                  <code>{address}</code>
                  <button
                    aria-label={`Copy ${address}`}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(address)
                        .then(() => setCopied(address))
                        .catch(() => setCopied(''))
                    }
                  >
                    {copied === address ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ))}
              <div className="connected-list">
                {s.listeners.map((listener) => (
                  <div key={listener.id}>
                    <Headphones size={17} />
                    <span>{listener.name}</span>
                    <small>Listening</small>
                    <button
                      onClick={() => invoke('broadcast_remove_listener', { id: listener.id })}
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
              <div className="room-grid">
                {s.peers.map((peer) => (
                  <label className="room-choice" key={peer.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(peer.id)}
                      disabled={peer.mode !== 'idle'}
                      onChange={(event) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (event.target.checked) next.add(peer.id);
                          else next.delete(peer.id);
                          return next;
                        })
                      }
                    />
                    <MonitorSpeaker size={21} />
                    <span>
                      <strong>{peer.name}</strong>
                      <small>
                        {results[peer.id] ||
                          (peer.mode === 'idle'
                            ? peer.accepting
                              ? 'Ready to play'
                              : 'Will ask on device'
                            : peer.mode === 'broadcasting'
                              ? 'Broadcasting'
                              : peer.mode === 'listening'
                                ? 'Already listening'
                                : 'Playing local audio')}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {!s.peers.length && (
                <p className="broadcast-empty">No other rooms found on this network.</p>
              )}
              <button
                className="primary"
                disabled={!selected.size || !!b.busy}
                onClick={() => void invite().catch(() => {})}
              >
                Invite selected rooms
              </button>
            </details>
          )}
        </>
      )}
    </div>
  );
}
