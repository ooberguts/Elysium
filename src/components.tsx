import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Music2,
  Film,
  Play,
  Heart,
  Star,
  X,
  Search,
  LoaderCircle,
  Disc3,
  MoreHorizontal,
  ListPlus,
  Info,
  Check,
  FolderOpen,
  RefreshCw,
  PlugZap,
  WifiOff,
  MonitorPlay,
} from 'lucide-react';
import { artworkUrl, chooseFolder, native, savePath } from './bridge';
import { seconds } from './domain';
import type { Match, MediaItem, Playlist, Source } from './types';

export function Artwork({
  item,
  className = '',
  label,
}: {
  item?: MediaItem;
  className?: string;
  label?: string;
}) {
  const [failed, fail] = useState(false);
  const url = artworkUrl(item?.artwork || null);
  useEffect(() => fail(false), [url]);
  const name = label || item?.album || item?.series || item?.title || 'Elysium';
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <div
      className={`artwork ${className}`}
      style={{ '--art-hue': `${seed % 360}` } as React.CSSProperties}
    >
      {url && !failed ? (
        <img src={url} onError={() => fail(true)} alt="" loading="lazy" />
      ) : (
        <>
          <div className="art-orbit" />
          <span className="art-caption">{name}</span>
          <span className="art-mark">
            {item?.kind === 'music' ? <Disc3 /> : item ? <Film /> : <Music2 />}
          </span>
        </>
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [close]);
  return (
    <dialog
      className={`dialog ${wide ? 'wide' : ''}`}
      ref={ref}
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function TrackTable({
  items,
  selected,
  currentId,
  play,
  select,
  favorite,
  info,
  enqueue,
  compact,
}: {
  items: MediaItem[];
  selected: Set<string>;
  currentId: string | null;
  play: (item: MediaItem) => void;
  select: (item: MediaItem, event: React.MouseEvent) => void;
  favorite: (item: MediaItem) => void;
  info: (item: MediaItem) => void;
  enqueue: (id: string, next?: boolean) => void;
  compact: boolean;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => (compact ? 35 : 46),
    overscan: 12,
  });
  useEffect(() => virtualizer.measure(), [compact, virtualizer]);
  return (
    <div className="track-table">
      <div className="track-header">
        <span />
        <span>Name</span>
        <span>Artist</span>
        <span>Album</span>
        <span>Time</span>
        <span />
      </div>
      <div
        className="track-scroll"
        ref={parent}
        role="table"
        aria-label="Media library"
        aria-rowcount={items.length}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];
            return (
              <div
                className={`track-row ${selected.has(item.id) ? 'selected' : ''} ${currentId === item.id ? 'current' : ''} ${!item.available ? 'unavailable' : ''}`}
                key={item.id}
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                role="row"
                aria-selected={selected.has(item.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/elysium-item', item.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => select(item, e)}
                onDoubleClick={() => play(item)}
              >
                <span role="cell">
                  <button
                    className="row-play"
                    onClick={(e) => {
                      e.stopPropagation();
                      play(item);
                    }}
                    aria-label={`Play ${item.title}`}
                  >
                    <Play size={13} fill="currentColor" />
                  </button>
                </span>
                <span className="track-name" role="cell">
                  <span>{item.title}</span>
                  {!item.available && <small>Offline</small>}
                </span>
                <span role="cell">{item.artist || 'Unknown artist'}</span>
                <span role="cell">{item.album || '—'}</span>
                <span className="tabular" role="cell">
                  {seconds(item.duration)}
                </span>
                <span className="row-actions" role="cell">
                  <button
                    className={`icon-button ${item.favorite ? 'loved' : ''}`}
                    aria-label={`${item.favorite ? 'Unfavorite' : 'Favorite'} ${item.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      favorite(item);
                    }}
                  >
                    <Heart size={14} fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <details onClick={(e) => e.stopPropagation()}>
                    <summary aria-label={`Actions for ${item.title}`}>
                      <MoreHorizontal size={17} />
                    </summary>
                    <div className="context-menu">
                      <button onClick={() => enqueue(item.id, true)}>
                        <Play size={14} />
                        Play next
                      </button>
                      <button onClick={() => enqueue(item.id)}>
                        <ListPlus size={14} />
                        Add to queue
                      </button>
                      <button onClick={() => info(item)}>
                        <Info size={14} />
                        Get Info
                      </button>
                    </div>
                  </details>
                </span>
              </div>
            );
          })}
        </div>
        {!items.length && (
          <div className="empty-filter">
            <Search />
            <h3>No matches</h3>
            <p>Try a different search or clear the column filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function MediaCards({
  items,
  play,
  detail,
  television = false,
}: {
  items: MediaItem[];
  play: (item: MediaItem) => void;
  detail: (item: MediaItem) => void;
  television?: boolean;
}) {
  return (
    <div className={`media-grid ${television ? 'episode-grid' : ''}`}>
      {items.map((item) => (
        <article className="media-card" key={item.id}>
          <button
            className="cover-button"
            onClick={() => detail(item)}
            aria-label={`Details for ${item.title}`}
          >
            <Artwork item={item} className={item.kind === 'movie' ? 'poster' : 'album-cover'} />
            <span
              className="cover-play"
              onClick={(e) => {
                e.stopPropagation();
                play(item);
              }}
            >
              <Play size={23} fill="currentColor" />
            </span>
            {item.watched && (
              <span className="watched-mark">
                <Check size={13} />
                Watched
              </span>
            )}
          </button>
          <button className="card-title" onClick={() => detail(item)}>
            {item.title}
          </button>
          <p>
            {television
              ? `${item.series || 'Unknown series'} · S${String(item.season).padStart(2, '0')} E${String(item.episode).padStart(2, '0')}`
              : [item.year, seconds(item.duration)].filter(Boolean).join(' · ')}
          </p>
          {item.resume > 0 && item.duration > 0 && (
            <div className="resume-track">
              <span style={{ width: `${Math.min(100, (item.resume / item.duration) * 100)}%` }} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

const fields = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['albumArtist', 'Album artist'],
  ['genre', 'Genre'],
  ['year', 'Year'],
  ['track', 'Track'],
  ['disc', 'Disc'],
] as const;
export function MetadataDialog({
  items,
  close,
  changed,
  notify,
  activeId,
}: {
  items: MediaItem[];
  close: () => void;
  changed: () => Promise<void>;
  notify: (message: string) => void;
  activeId: string | null;
}) {
  const [changes, setChanges] = useState<Record<string, string>>({}),
    [write, setWrite] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [matches, setMatches] = useState<Match[] | null>(null),
    [lookup, setLookup] = useState(false),
    [tab, setTab] = useState('details');
  const item = items[0],
    single = items.length === 1,
    video = item.kind !== 'music',
    remote = items.some((i) => i.serverId);
  const fieldValue = (key: string) => {
    const values = new Set(
      items.map((i) => String((i as unknown as Record<string, unknown>)[key] ?? '')),
    );
    return values.size === 1 ? [...values][0] : '';
  };
  const value = (key: string) => changes[key] ?? fieldValue(key);
  const update = (key: string, value: string) => setChanges((prev) => ({ ...prev, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!Object.keys(changes).length) return;
    if (write && items.some((i) => i.id === activeId)) {
      setError(
        'Stop or switch away from this item before writing its file tags. Library-only changes can be saved during playback.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await native<{ saved: number; errors: string[] }>('update_metadata', {
        ids: items.map((i) => i.id),
        changes,
        writeFiles: write,
      });
      await changed();
      if (result.errors.length) setError(`${result.saved} saved. ${result.errors.join('\n')}`);
      else {
        notify(
          `${result.saved} ${result.saved === 1 ? 'item' : 'items'} updated${write ? ' · original file backed up' : ''}`,
        );
        close();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function find() {
    setLookup(true);
    setError('');
    try {
      setMatches(
        await native<Match[]>('find_metadata', { title: value('title'), artist: value('artist') }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLookup(false);
    }
  }
  async function nfo() {
    const path = await savePath(`${item.title}.nfo`, 'nfo');
    if (path) {
      await native('export_nfo', { id: item.id, path });
      notify('NFO sidecar exported');
    }
  }
  return (
    <Modal title={single ? 'Get Info' : `Edit ${items.length} items`} close={close} wide>
      <form onSubmit={submit}>
        <div className="info-overview">
          <Artwork item={item} />
          <div>
            <h3>{single ? item.title : `${items.length} selected items`}</h3>
            <p>
              {single
                ? item.artist || item.series || item.format
                : 'Only fields you change will be applied.'}
            </p>
            <small>
              {single
                ? `${item.format} · ${seconds(item.duration)}${item.sampleRate ? ` · ${item.sampleRate / 1000} kHz` : ''}`
                : 'Mixed values appear blank.'}
            </small>
          </div>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={tab === 'details' ? 'active' : ''}
            onClick={() => setTab('details')}
          >
            Details
          </button>
          <button
            type="button"
            className={tab === 'source' ? 'active' : ''}
            onClick={() => setTab('source')}
          >
            Source & recovery
          </button>
        </div>
        {tab === 'details' ? (
          <>
            <div className="form-grid">
              {(video
                ? [
                    ['title', 'Title'],
                    ['series', 'Series'],
                    ['season', 'Season'],
                    ['episode', 'Episode'],
                    ['genre', 'Genre'],
                    ['year', 'Year'],
                  ]
                : fields
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={value(key)}
                    placeholder={!single && !fieldValue(key) ? 'Mixed values' : ''}
                    type={['track', 'disc', 'season', 'episode'].includes(key) ? 'number' : 'text'}
                    min="0"
                    onChange={(e) => update(key, e.target.value)}
                    disabled={remote}
                  />
                </label>
              ))}
              {video && (
                <label className="full-span">
                  Overview
                  <textarea
                    rows={3}
                    value={value('overview')}
                    onChange={(e) => update('overview', e.target.value)}
                    disabled={remote}
                  />
                </label>
              )}
            </div>
            {single && !video && !remote && (
              <button
                type="button"
                className="lookup-button"
                disabled={lookup}
                onClick={() => void find()}
              >
                {lookup ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}Find
                matches on MusicBrainz
              </button>
            )}
            {matches && (
              <div className="match-list">
                {!matches.length && (
                  <p>No matches found. Try editing the title or artist before searching again.</p>
                )}
                {matches.map((match) => (
                  <button
                    type="button"
                    key={match.id}
                    onClick={() => {
                      setChanges((prev) => ({
                        ...prev,
                        title: match.title,
                        artist: match.artist,
                        ...(match.album ? { album: match.album } : {}),
                        ...(match.year ? { year: match.year } : {}),
                      }));
                      setMatches(null);
                    }}
                  >
                    <span>
                      <strong>{match.title}</strong>
                      <small>
                        {match.artist} · {match.album || 'Release not identified'} {match.year}
                      </small>
                    </span>
                    <span>{match.score}%</span>
                  </button>
                ))}
              </div>
            )}
            {!remote && !video && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={write}
                  onChange={(e) => setWrite(e.target.checked)}
                  disabled={items.some((i) => !['MP3', 'FLAC'].includes(i.format))}
                />
                <span>
                  Also write MP3 / FLAC file tags
                  <small>Creates a backup and verifies that the audio is unchanged.</small>
                </span>
              </label>
            )}
            {!write && !remote && (
              <p className="form-note">Changes are saved in Elysium and protected from rescans.</p>
            )}
            {remote && (
              <p className="notice">
                This item is managed by Jellyfin. Edit its metadata on your server.
              </p>
            )}
          </>
        ) : (
          <div className="source-information">
            <p className="file-path">{item.path}</p>
            <p>
              {Object.keys(item.overrides).length
                ? `${Object.keys(item.overrides).length} library overrides are protected from rescans.`
                : 'Information comes from embedded tags, local sidecars, or the filename.'}
            </p>
            {single && !remote && (
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await native('restore_tags', { id: item.id });
                    await changed();
                    notify('Original file tags restored');
                    close();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Restore last embedded-tag backup
              </button>
            )}
            {single && video && !remote && (
              <button type="button" onClick={() => void nfo().catch((e) => setError(String(e)))}>
                Export Kodi NFO sidecar
              </button>
            )}
          </div>
        )}
        {Object.keys(changes).length > 0 && (
          <div className="change-preview">
            <strong>Changes to save</strong>
            {Object.entries(changes).map(([key, next]) => (
              <div key={key}>
                <span>{key}</span>
                <span>{fieldValue(key) || '—'}</span>
                <span>→</span>
                <strong>{next || '(empty)'}</strong>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || remote || !Object.keys(changes).length}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AddSourceDialog({
  close,
  add,
}: {
  close: () => void;
  add: (path: string, kind: string, name: string) => Promise<void>;
}) {
  const [path, setPath] = useState(''),
    [name, setName] = useState(''),
    [kind, setKind] = useState('mixed'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a library folder" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await add(path, kind, name);
            close();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="dialog-intro">
          Add a folder on this computer, an external drive, or a network share mounted by your
          operating system.
        </p>
        <label>
          Folder
          <div className="input-action">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Choose a folder or paste its path"
              required
            />
            <button
              type="button"
              aria-label="Browse for a folder"
              onClick={async () => {
                const p = await chooseFolder();
                if (p) setPath(p);
              }}
            >
              <FolderOpen size={18} />
            </button>
          </div>
        </label>
        <label>
          Library name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home NAS"
          />
        </label>
        <label>
          Contains
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="mixed">Music, movies, and TV</option>
            <option value="music">Music</option>
            <option value="movie">Movies</option>
            <option value="tv">TV shows</option>
          </select>
        </label>
        <p className="form-note">
          For a NAS, connect it in Finder or File Explorer first. Originals stay in place.
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !path}>
            {busy ? 'Adding…' : 'Add & scan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PlaylistDialog({
  close,
  create,
}: {
  close: () => void;
  create: (name: string, rule: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [rule, setRule] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="New playlist" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await create(name, rule || null);
            close();
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="A soundtrack for…"
          />
        </label>
        <label>
          Type
          <select value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="">Playlist · add items yourself</option>
            <option value="favorites">Smart · favorites</option>
            <option value="unplayed">Smart · never played</option>
            <option value="lossless">Smart · lossless audio</option>
            <option value="recent">Smart · added in the last 30 days</option>
          </select>
        </label>
        {error && <p className="error-message">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={!name.trim()}>
            Create playlist
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SourcesView({
  sources,
  scan,
  rebind,
  add,
  busy,
}: {
  sources: Source[];
  scan: (source: Source) => void;
  rebind: (source: Source) => void;
  add: () => void;
  busy: boolean;
}) {
  return (
    <div className="sources-view">
      <div className="section-heading">
        <div>
          <h2>Your library sources</h2>
          <p>Files stay where they belong. Your collection stays together.</p>
        </div>
        <button className="primary" onClick={add}>
          <FolderOpen size={16} />
          Add folder
        </button>
      </div>
      {sources.map((source) => (
        <article className="source-card" key={source.id}>
          <div className={`source-icon ${source.online ? '' : 'offline'}`}>
            {source.online ? <PlugZap /> : <WifiOff />}
          </div>
          <div className="source-copy">
            <h3>
              {source.name}
              <span className={`status-dot ${source.online ? 'online' : ''}`}>
                {source.online ? 'Connected' : 'Offline'}
              </span>
            </h3>
            <p className="file-path">{source.path}</p>
            <small>
              {source.count} media files
              {source.scannedAt
                ? ` · scanned ${new Date(source.scannedAt * 1000).toLocaleDateString()}`
                : ' · ready to scan'}
            </small>
          </div>
          <div className="source-actions">
            <button onClick={() => scan(source)} disabled={busy}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button onClick={() => rebind(source)} disabled={busy}>
              Locate folder
            </button>
          </div>
        </article>
      ))}
      {!sources.length && (
        <div className="empty-filter">
          <FolderOpen />
          <h3>A home for your collection</h3>
          <p>Add your first folder to start building your library.</p>
        </div>
      )}
      <p className="source-footnote">
        Offline sources keep their entries, ratings, and playlists. Reconnect or locate the folder
        when you’re ready.
      </p>
    </div>
  );
}

export function VideoDetail({
  item,
  close,
  play,
  info,
  watched,
}: {
  item: MediaItem;
  close: () => void;
  play: () => void;
  info: () => void;
  watched: () => void;
}) {
  return (
    <Modal title={item.title} close={close} wide>
      <div className="video-details">
        <Artwork item={item} className="poster" />
        <div>
          <p className="eyebrow">
            {item.kind === 'tv'
              ? `${item.series} · Season ${item.season} · Episode ${item.episode}`
              : 'YOUR MOVIE COLLECTION'}
          </p>
          <h2>{item.title}</h2>
          <p className="detail-meta">
            {[item.year, item.genre, seconds(item.duration), item.format]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p>
            {item.overview || 'Add a description in Get Info to make this collection your own.'}
          </p>
          <div className="detail-actions">
            <button className="primary" onClick={play}>
              <Play size={17} fill="currentColor" />
              {item.resume > 0 ? `Resume at ${seconds(item.resume)}` : 'Play'}
            </button>
            <button onClick={info}>
              <Info size={16} />
              Get Info
            </button>
            {!item.serverId && (
              <button onClick={watched}>
                <Check size={16} />
                {item.watched ? 'Mark unwatched' : 'Mark watched'}
              </button>
            )}
          </div>
          {!item.available && (
            <p className="notice">This source is offline. Reconnect it to play.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Rating({ item, rate }: { item: MediaItem; rate: (rating: number) => void }) {
  return (
    <div className="rating" aria-label={`Rated ${item.rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className="icon-button"
          aria-label={`Rate ${n} stars`}
          onClick={() => rate(item.rating === n ? 0 : n)}
        >
          <Star size={16} fill={n <= item.rating ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

export function AddToPlaylist({
  playlists,
  add,
  disabled,
}: {
  playlists: Playlist[];
  add: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      className="compact-select"
      aria-label="Add selected items to playlist"
      value=""
      disabled={disabled || !playlists.some((p) => !p.rule)}
      onChange={(e) => {
        if (e.target.value) add(e.target.value);
      }}
    >
      <option value="">Add to playlist…</option>
      {playlists
        .filter((p) => !p.rule)
        .map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

export function EmptyCollection({
  add,
  files,
  samples,
  busy,
}: {
  add: () => void;
  files: () => void;
  samples: () => void;
  busy: boolean;
}) {
  return (
    <div className="welcome">
      <div className="welcome-emblem">
        <Music2 size={54} strokeWidth={1.3} />
        <div />
        <div />
      </div>
      <p className="eyebrow">YOUR COLLECTION. YOUR WAY.</p>
      <h1>
        Welcome back
        <br />
        to your music.
      </h1>
      <p>
        The albums you love. The films you return to.
        <br />A place for all of them, beautifully in order.
      </p>
      <div className="welcome-actions">
        <button className="primary" onClick={add} disabled={busy}>
          <FolderOpen size={17} />
          Add a library folder
        </button>
        <button onClick={files} disabled={busy}>
          Add files
        </button>
      </div>
      <button className="text-button sample-button" onClick={samples} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <MonitorPlay size={15} />}Try the
        sample library
      </button>
      <small>Local folders · External drives · Mounted network shares</small>
    </div>
  );
}
