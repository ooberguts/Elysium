import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radio,
  Wifi,
  Headphones,
  MonitorSpeaker,
  Play,
  Square,
  SkipForward,
  SkipBack,
  Waves,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Film,
  BookOpen,
  Pause,
} from 'lucide-react';
import { native, desktop } from '../bridge';
import { seconds } from '../domain';
import type { Library } from '../types';
import type { Broadcast, Output } from './useBroadcast';
import { albumKey, broadcastSelection, type SourceKind } from './selection';
import './broadcast.css';

export function BroadcastPanel({
  broadcast: b,
  library,
  queue,
  prepare,
  visualize,
  createPlaylist,
  addMusic,
}: {
  broadcast: Broadcast;
  library: Library;
  queue: string[];
  prepare: () => Promise<void>;
  visualize: () => void;
  createPlaylist: () => void;
  addMusic: () => void;
}) {
  const s = b.state;
  const [media, setMedia] = useState<'music' | 'video' | 'audiobook'>('music');
  const [volume, setVolume] = useState(s.volume);
  useEffect(() => setVolume(s.volume), [s.volume]);
  const [room, setRoom] = useState(library.settings.lanRoomName || 'This computer');
  const [name, setName] = useState('Home radio'),
    [kind, setKind] = useState<SourceKind>(library.playlists.length ? 'playlist' : 'all'),
    [source, setSource] = useState('');
  const [resumeBooks, setResumeBooks] = useState(true);
  const [mode, setMode] = useState('repeat'),
    [minutes, setMinutes] = useState(60),
    [finishTrack, setFinishTrack] = useState(true);
  const [shuffle, setShuffle] = useState(false),
    [playHere, setPlayHere] = useState(true),
    [output, setOutput] = useState(s.outputDevice || library.settings.lanOutputDevice || '');
  useEffect(() => {
    if (s.enabled) setOutput(s.outputDevice || '');
  }, [s.enabled, s.outputDevice]);
  const [outputs, setOutputs] = useState<Output[]>([]),
    [direct, setDirect] = useState(''),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [roomResults, setRoomResults] = useState<Record<string, string>>({}),
    [copied, setCopied] = useState('');
  const [outputsBusy, setOutputsBusy] = useState(false),
    [outputsError, setOutputsError] = useState('');
  const refreshOutputs = useCallback(async () => {
    if (!desktop) return;
    setOutputsBusy(true);
    setOutputsError('');
    try {
      setOutputs(await native<Output[]>('broadcast_outputs'));
    } catch (error) {
      setOutputsError(String(error));
    } finally {
      setOutputsBusy(false);
    }
  }, []);
  useEffect(() => {
    void refreshOutputs();
  }, [refreshOutputs]);
  const music = useMemo(
    () =>
      library.items.filter(
        (i) =>
          !i.serverId &&
          (media === 'music'
            ? i.kind === 'music'
            : media === 'audiobook'
              ? i.kind === 'audiobook'
              : i.kind === 'movie' || i.kind === 'tv'),
      ),
    [library.items, media],
  );
  const options = useMemo(() => {
    if (kind === 'book')
      return music.map((i) => ({
        value: i.id,
        label: `${i.title}${i.artist ? ` · ${i.artist}` : ''}`,
      }));
    if (kind === 'movie')
      return music.filter((i) => i.kind === 'movie').map((i) => ({ value: i.id, label: i.title }));
    if (kind === 'series')
      return [...new Set(music.filter((i) => i.kind === 'tv').map((i) => i.series))]
        .sort()
        .map((value) => ({ value, label: value }));
    if (kind === 'playlist') return library.playlists.map((p) => ({ value: p.id, label: p.name }));
    if (kind === 'album')
      return [
        ...new Map(
          music.map((i) => [
            albumKey(i),
            {
              value: albumKey(i),
              label: `${i.album || 'Untitled album'} · ${i.albumArtist || i.artist || 'Unknown artist'}`,
            },
          ]),
        ).values(),
      ];
    if (kind === 'artist' || kind === 'genre')
      return [
        ...new Set(
          music
            .flatMap((i) => (kind === 'artist' ? [i.artist, i.albumArtist] : [i.genre]))
            .filter(Boolean),
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value }));
    return [];
  }, [kind, library.playlists, music]);
  const chosen = options.some((o) => o.value === source) ? source : options[0]?.value || '';
  const tracks = useMemo(
    () => broadcastSelection(library, kind, chosen, queue, media),
    [library, kind, chosen, queue, media],
  );
  const disabled = !!b.busy;
  const invoke = (command: string, args?: Record<string, unknown>) =>
    void b.call(command, args).catch(() => {});
  const enable = async () => {
    if (!s.enabled) await b.call('broadcast_enable', { name: room });
  };
  const start = async () => {
    try {
      await enable();
      await prepare();
      await b.call('broadcast_start', {
        request: {
          name,
          itemIds: tracks.map((t) => t.id),
          mode,
          minutes,
          finishTrack,
          resumeBooks: media === 'audiobook' && resumeBooks,
          shuffle,
          playHere,
          outputDevice: output || null,
        },
      });
    } catch {
      /* The hook displays the actionable failure. */
    }
  };
  const join = async (address: string, station = '') => {
    try {
      await enable();
      await prepare();
      await b.call('broadcast_join', {
        request: { address, station, outputDevice: output || null },
      });
    } catch {}
  };
  const settings = (changes: Record<string, unknown>) =>
    invoke('broadcast_settings', {
      name: s.name,
      allowRequests: s.allowRequests,
      volume: s.volume,
      delayMs: s.delayMs,
      outputDevice: output || null,
      ...changes,
    });
  const invite = async () => {
    const results = await Promise.allSettled(
      [...selected].map(async (peerId) => {
        const result = await native<string>('broadcast_invite', { peerId });
        return { peerId, result };
      }),
    );
    const ids = [...selected];
    setRoomResults(
      Object.fromEntries(
        results.map((r, i) => [
          ids[i],
          r.status === 'fulfilled' ? r.value.result : String(r.reason),
        ]),
      ),
    );
    await b.refresh();
  };
  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
    } catch {
      setCopied('');
    }
  };
  const sources =
    media === 'audiobook'
      ? [
          ['book', 'Book'],
          ['artist', 'Author'],
          ['album', 'Book collection'],
          ['playlist', 'Playlist'],
          ['genre', 'Genre'],
          ['queue', 'Current queue'],
          ['all', 'All audiobooks'],
        ]
      : media === 'video'
        ? ([
            ['movie', 'Movie'],
            ['series', 'TV series'],
            ['playlist', 'Playlist'],
            ['genre', 'Genre'],
            ['queue', 'Current queue'],
            ['all', 'All videos'],
          ] as const)
        : ([
            ['playlist', 'Playlist'],
            ['artist', 'Artist'],
            ['album', 'Album'],
            ['genre', 'Genre'],
            ['queue', 'Current queue'],
            ['all', 'All music'],
          ] as const);
  const station = s.station,
    listening = s.listening;
  return (
    <div className="broadcast-view">
      <div className="broadcast-heading">
        <div>
          <p className="eyebrow">MUSIC, STORIES & VIDEO THROUGHOUT YOUR HOME</p>
          <h1>One broadcast. Every room.</h1>
          <p>Send your library around the house, or tune in to another Elysium computer.</p>
        </div>
        <span className={s.enabled ? 'lan-status online' : 'lan-status'}>
          <Wifi size={14} />
          {s.enabled ? 'LAN connected' : 'LAN off'}
        </span>
      </div>
      {!desktop && (
        <p className="broadcast-notice">LAN radio is available in the Elysium desktop app.</p>
      )}
      {(b.error || s.message) && (
        <div className="broadcast-notice error" role="alert">
          {b.error || s.message}
        </div>
      )}
      {!s.enabled && (
        <div className="lan-enable">
          <MonitorSpeaker size={28} />
          <div>
            <h2>Name this room</h2>
            <p>Other Elysium computers on your local network will see this name.</p>
          </div>
          <input
            aria-label="This room's name"
            maxLength={60}
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <button
            className="primary"
            disabled={disabled || !desktop || !room.trim()}
            onClick={() => void enable().catch(() => {})}
          >
            <Wifi size={15} />
            Enable LAN broadcast
          </button>
        </div>
      )}
      {!!s.invitations.length && (
        <div className="broadcast-invitations">
          {s.invitations.map((i) => (
            <div key={i.id}>
              <Radio size={22} />
              <div>
                <strong>{i.name}</strong>
                <p>Another computer invited this room to listen.</p>
              </div>
              <button
                onClick={() =>
                  invoke('broadcast_answer_invite', { id: i.id, accept: false, outputDevice: null })
                }
              >
                Decline
              </button>
              <button
                className="primary"
                onClick={() =>
                  void prepare()
                    .then(() =>
                      b.call('broadcast_answer_invite', {
                        id: i.id,
                        accept: true,
                        outputDevice: output || null,
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
      <div className="broadcast-columns">
        <section className="broadcast-card">
          <div className="broadcast-card-heading">
            <Radio size={21} />
            <div>
              <h2>Broadcast from here</h2>
              <p>Program music, audiobooks, or video for every room.</p>
            </div>
          </div>
          {station?.active ? (
            <div className="live-station">
              <span className="on-air">ON AIR</span>
              <h3>{station.name}</h3>
              <div className="radio-now">
                <Waves size={32} />
                <div>
                  <strong>{station.track?.title || 'Preparing broadcast…'}</strong>
                  <span>
                    {station.track?.artist ||
                      (station.track ? 'Live broadcast' : 'Loading your selection')}
                  </span>
                </div>
              </div>
              <div className="radio-progress">
                <span>{seconds(station.position + (station.track?.startPosition || 0))}</span>
                <progress
                  max={(station.track?.duration || 1) + (station.track?.startPosition || 0)}
                  value={station.position + (station.track?.startPosition || 0)}
                />
                <span>
                  {seconds((station.track?.duration || 0) + (station.track?.startPosition || 0))}
                </span>
              </div>
              <p className="radio-run">
                {station.mode === 'repeat'
                  ? 'Repeating continuously'
                  : station.mode === 'once'
                    ? 'Playing this selection once'
                    : `${Math.max(0, Math.ceil(station.minutes - station.elapsed / 60))} min remaining · ${station.finishTrack ? 'finishes the item' : 'stops at the limit'}`}{' '}
                · {s.listeners.length} listening {s.listeners.length === 1 ? 'room' : 'rooms'}
              </p>
              {station.message && <p className="broadcast-notice">{station.message}</p>}
              <div className="broadcast-actions">
                <button disabled={disabled} onClick={() => invoke('broadcast_previous')}>
                  <SkipBack size={15} />
                  Previous item
                </button>
                <button
                  disabled={disabled || !station.track}
                  onClick={() => void b.toggle().catch(() => {})}
                >
                  {station.paused ? <Play size={15} /> : <Pause size={15} />}
                  {station.paused ? 'Resume broadcast' : 'Pause broadcast'}
                </button>
                <button disabled={disabled} onClick={() => invoke('broadcast_next')}>
                  <SkipForward size={15} />
                  Next item
                </button>
                <button disabled={disabled} onClick={() => invoke('broadcast_stop')}>
                  <Square size={14} />
                  Stop broadcast
                </button>
                {station.playHere && (
                  <button onClick={visualize}>
                    <Waves size={15} />
                    {b.state.video ? 'Watch video' : 'Visualizer'}
                  </button>
                )}
              </div>
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
              {s.addresses.map((address) => (
                <div className="station-address" key={address}>
                  <code>{address}</code>
                  <button aria-label={`Copy ${address}`} onClick={() => void copy(address)}>
                    {copied === address ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="broadcast-form">
              <div className="broadcast-media">
                <button
                  aria-pressed={media === 'music'}
                  onClick={() => {
                    setMedia('music');
                    setKind('playlist');
                    setSource('');
                  }}
                >
                  <Radio size={15} />
                  Music
                </button>
                <button
                  aria-pressed={media === 'video'}
                  onClick={() => {
                    setMedia('video');
                    setKind('movie');
                    setSource('');
                  }}
                >
                  <Film size={15} />
                  Video
                </button>
                <button
                  aria-pressed={media === 'audiobook'}
                  onClick={() => {
                    setMedia('audiobook');
                    setKind('book');
                    setSource('');
                    setMode('once');
                    setShuffle(false);
                  }}
                >
                  <BookOpen size={15} />
                  Audiobooks
                </button>
              </div>
              {media === 'audiobook' && (
                <>
                  <label className="broadcast-check">
                    <input
                      type="checkbox"
                      checked={resumeBooks}
                      onChange={(e) => setResumeBooks(e.target.checked)}
                    />
                    Resume books from their saved position
                  </label>
                  <p className="broadcast-note">
                    This computer saves each book’s broadcast position. Listeners join live; pausing
                    a room does not pause the story for everyone.
                  </p>
                </>
              )}
              {station?.message && <p className="broadcast-note">{station.message}</p>}
              <label>
                Station name
                <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="broadcast-source">
                <label>
                  Choose media
                  <select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as SourceKind);
                      setSource('');
                    }}
                  >
                    {sources.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {!['queue', 'all'].includes(kind) && (
                  <label>
                    Collection
                    <select
                      aria-label="Broadcast collection"
                      value={chosen}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      {!options.length && <option value="">No collections yet</option>}
                      {options.map((o) => (
                        <option value={o.value} key={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="broadcast-selection">
                <div>
                  <strong>
                    {tracks.length}{' '}
                    {media === 'video'
                      ? tracks.length === 1
                        ? 'video'
                        : 'videos'
                      : media === 'audiobook'
                        ? tracks.length === 1
                          ? 'book'
                          : 'books'
                        : tracks.length === 1
                          ? 'track'
                          : 'tracks'}
                  </strong>
                  <span>
                    {seconds(tracks.reduce((sum, t) => sum + t.duration, 0))} of{' '}
                    {media === 'video' ? 'video' : media === 'audiobook' ? 'audiobooks' : 'music'}
                  </span>
                  {kind === 'playlist' && (
                    <button onClick={createPlaylist}>
                      <Plus size={13} />
                      New playlist
                    </button>
                  )}
                </div>
                <ol>
                  {tracks.slice(0, 4).map((t, i) => (
                    <li key={`${t.id}-${i}`}>
                      <span>{t.title}</span>
                      <small>{t.artist}</small>
                    </li>
                  ))}
                </ol>
                {tracks.length > 4 && <small>And {tracks.length - 4} more</small>}
                {!music.length ? (
                  <p className="broadcast-note">
                    Add{' '}
                    {media === 'video' ? 'videos' : media === 'audiobook' ? 'audiobooks' : 'music'}{' '}
                    to your library to start a broadcast.{' '}
                    <button onClick={addMusic}>Add media</button>
                  </p>
                ) : (
                  !tracks.length && (
                    <p className="broadcast-note">
                      This selection is empty. Add media from your library, or choose another
                      collection.
                    </p>
                  )
                )}
              </div>
              <label>
                Run the station
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="repeat">Keep repeating</option>
                  <option value="once">Play once</option>
                  <option value="duration">Play for a set time</option>
                </select>
              </label>
              {mode === 'duration' && (
                <div className="broadcast-source">
                  <label>
                    Minutes
                    <input
                      type="number"
                      min={1}
                      max={10080}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    At the time limit
                    <select
                      value={finishTrack ? 'finish' : 'stop'}
                      onChange={(e) => setFinishTrack(e.target.value === 'finish')}
                    >
                      <option value="finish">Finish the current item</option>
                      <option value="stop">Stop exactly at the limit</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="broadcast-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={shuffle}
                    onChange={(e) => setShuffle(e.target.checked)}
                  />
                  Shuffle selection
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={playHere}
                    onChange={(e) => setPlayHere(e.target.checked)}
                  />
                  Play on this computer too
                </label>
              </div>
              <button
                className="primary start-broadcast"
                disabled={
                  disabled ||
                  !desktop ||
                  !tracks.length ||
                  !name.trim() ||
                  (mode === 'duration' && (!minutes || minutes < 1 || minutes > 10080))
                }
                onClick={() => void start()}
              >
                <Radio size={16} />
                {b.busy === 'broadcast_start' ? 'Starting…' : 'Start broadcast'}
              </button>
              <p className="broadcast-note">
                Streams your local library. Video uses adaptive quality with a longer startup
                buffer. Each room keeps its own volume and can pause independently.
              </p>
            </div>
          )}
        </section>
        <div className="broadcast-right">
          <section className="broadcast-card">
            <div className="broadcast-card-heading">
              <Headphones size={21} />
              <div>
                <h2>Listen in this room</h2>
                <p>Join a live station whenever you like.</p>
              </div>
            </div>
            {listening?.active ? (
              <div className="listening-station">
                <span className="on-air">
                  {listening.phase === 'playing' ? 'LISTENING' : listening.phase.toUpperCase()}
                </span>
                <h3>{listening.name}</h3>
                <strong>{listening.track?.title || 'Waiting for the music…'}</strong>
                <p>{listening.track?.artist}</p>
                {listening.message && <p className="broadcast-note">{listening.message}</p>}
                <div className="broadcast-actions">
                  <button onClick={() => invoke('broadcast_leave')}>
                    <Square size={14} />
                    Leave station
                  </button>
                  <button onClick={visualize}>
                    <Waves size={15} />
                    {b.state.video ? 'Watch video' : 'Visualizer'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {listening?.message && <p className="broadcast-note">{listening.message}</p>}
                <div className="available-stations">
                  {s.peers
                    .filter((p) => p.stationId)
                    .map((p) => (
                      <div key={p.id}>
                        <Radio size={18} />
                        <div>
                          <strong>{p.stationName}</strong>
                          <small>{p.name}</small>
                        </div>
                        <button
                          disabled={disabled || !!station?.active}
                          onClick={() => void join(p.address, p.stationId)}
                        >
                          <Play size={13} />
                          Join
                        </button>
                      </div>
                    ))}
                </div>
                {!s.peers.some((p) => p.stationId) && (
                  <p className="broadcast-empty">
                    {s.enabled
                      ? 'No stations on the network yet. Start one on another computer running Elysium.'
                      : 'Enable LAN broadcast to discover nearby stations.'}
                  </p>
                )}
                <div className="direct-join">
                  <input
                    aria-label="Station LAN address"
                    placeholder="LAN address:port"
                    value={direct}
                    onChange={(e) => setDirect(e.target.value)}
                  />
                  <button
                    disabled={disabled || !direct.trim() || !!station?.active}
                    onClick={() => void join(direct)}
                  >
                    Join by address
                  </button>
                </div>
              </>
            )}
          </section>
          <section className="broadcast-card room-settings">
            <div className="broadcast-card-heading">
              <MonitorSpeaker size={21} />
              <div>
                <h2>This room</h2>
                <p>Choose where the music plays.</p>
              </div>
            </div>
            {b.active && (
              <button
                disabled={listening?.phase === 'paused'}
                onClick={() => void b.toggle().catch(() => {})}
              >
                {s.paused ? <Play size={14} /> : <Pause size={14} />}{' '}
                {listening?.phase === 'paused'
                  ? 'Paused by broadcaster'
                  : s.paused
                    ? 'Resume live'
                    : 'Pause in this room'}
              </button>
            )}
            <label>
              Video quality
              <select
                aria-label="Room video quality"
                value={b.quality}
                onChange={(e) => b.setQuality(e.target.value as Broadcast['quality'])}
              >
                <option value="auto">Auto · keep live</option>
                <option value="high">High · up to 1080p</option>
                <option value="medium">Medium · up to 720p</option>
                <option value="low">Low · up to 480p</option>
              </select>
              <small>
                Auto adapts the picture to your connection. Resuming always returns to live.
              </small>
            </label>
            {s.enabled && (
              <label>
                Room name
                <input
                  aria-label="Room name"
                  maxLength={60}
                  key={s.id}
                  defaultValue={s.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== s.name)
                      settings({ name: e.target.value.trim() });
                  }}
                />
              </label>
            )}
            <label>
              Audio output
              <select
                value={output}
                disabled={b.active || !s.enabled}
                onChange={(e) => {
                  setOutput(e.target.value);
                  if (s.enabled) settings({ outputDevice: e.target.value || null });
                }}
              >
                <option value="">System default</option>
                {output && !outputs.some((d) => d.id === output) && (
                  <option value={output}>Saved device unavailable</option>
                )}
                {outputs.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name}
                    {d.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="refresh-outputs"
              disabled={b.active || outputsBusy}
              onClick={() => void refreshOutputs()}
            >
              <RefreshCw size={13} />
              {outputsBusy ? 'Checking devices…' : 'Refresh outputs'}
            </button>
            {outputsError && (
              <p className="broadcast-note" role="alert">
                {outputsError}
              </p>
            )}
            {b.active && (
              <small className="broadcast-note">
                Stop this session to change its output device.
              </small>
            )}
            {s.enabled && (
              <>
                <label className="room-volume">
                  Room volume <output>{Math.round(volume * 100)}%</output>
                  <input
                    aria-label="LAN room volume"
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    onPointerUp={(e) => settings({ volume: Number(e.currentTarget.value) })}
                    onKeyUp={(e) => settings({ volume: Number(e.currentTarget.value) })}
                  />
                </label>
                <label>
                  Timing adjustment (ms)
                  <input
                    aria-label="Room timing adjustment"
                    type="number"
                    min="-500"
                    max="500"
                    step="5"
                    defaultValue={s.delayMs}
                    key={s.id}
                    onBlur={(e) => settings({ delayMs: Number(e.target.value) || 0 })}
                  />
                  <small>
                    Positive values delay this room. Useful for Bluetooth speakers or audio
                    receivers.
                  </small>
                </label>
                <label className="room-opt-in">
                  <input
                    type="checkbox"
                    checked={s.allowRequests}
                    onChange={(e) => settings({ allowRequests: e.target.checked })}
                  />
                  <span>
                    Accept playback requests while idle
                    <small>
                      Other Elysium computers on this LAN can start playback here. Otherwise, this
                      room asks before joining.
                    </small>
                  </span>
                </label>
                <button className="quiet-danger" onClick={() => invoke('broadcast_disable')}>
                  Turn off LAN broadcast
                </button>
              </>
            )}
          </section>
        </div>
      </div>
      {station?.active && (
        <section className="broadcast-card broadcast-rooms">
          <div className="broadcast-card-heading">
            <Wifi size={21} />
            <div>
              <h2>Bring in more rooms</h2>
              <p>Ready rooms join automatically. Other rooms receive an invitation.</p>
            </div>
          </div>
          <div className="room-grid">
            {s.peers.map((p) => (
              <label className="room-choice" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  disabled={p.mode !== 'idle'}
                  onChange={(e) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <MonitorSpeaker size={21} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {roomResults[p.id] ||
                      (p.mode === 'idle'
                        ? p.accepting
                          ? 'Ready to play'
                          : 'Will ask on device'
                        : p.mode === 'broadcasting'
                          ? 'Broadcasting'
                          : p.mode === 'listening'
                            ? 'Already listening'
                            : 'Playing local audio')}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!s.peers.length && (
            <p className="broadcast-empty">
              Enable LAN broadcast on your other computers to find them here.
            </p>
          )}
          <button
            className="primary"
            disabled={!selected.size}
            onClick={() => void invite().catch(() => {})}
          >
            Play in selected rooms
          </button>
        </section>
      )}
      <p className="broadcast-footnote">
        Mac and Windows computers must be on the same local network. Audio is buffered to align
        rooms; late joiners tune in to the current moment. Allow local-network access if your system
        asks. Keep Elysium open; active stations and listeners prevent idle system sleep.
      </p>
    </div>
  );
}
