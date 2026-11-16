import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  BookOpen,
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
import { artworkUrl, chooseFolder } from './bridge';
import { seconds } from './domain';
import type { MediaItem, Playlist, Source } from './types';

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
            {item?.kind === 'audiobook' ? (
              <BookOpen />
            ) : item?.kind === 'music' ? (
              <Disc3 />
            ) : item ? (
              <Film />
            ) : (
              <Music2 />
            )}
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
  rate,
  ratingBusy,
  contextMenu,
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
  rate: (item: MediaItem, rating: number) => void;
  ratingBusy: ReadonlySet<string>;
  contextMenu: (item: MediaItem, event: React.MouseEvent | React.KeyboardEvent) => void;
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
        <span>Rating</span>
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
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
                    contextMenu(item, e);
                }}
                aria-selected={selected.has(item.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/elysium-item', item.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => select(item, e)}
                onDoubleClick={() => play(item)}
                onContextMenu={(e) => contextMenu(item, e)}
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
                <span className="track-rating" role="cell">
                  <Rating
                    item={item}
                    rate={(n) => rate(item, n)}
                    disabled={ratingBusy.has(item.id) || !!item.serverId}
                  />
                </span>
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
                        Edit metadata
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
  contextMenu,
  television = false,
}: {
  items: MediaItem[];
  play: (item: MediaItem) => void;
  detail: (item: MediaItem) => void;
  contextMenu?: (item: MediaItem, event: React.MouseEvent | React.KeyboardEvent) => void;
  television?: boolean;
}) {
  return (
    <div className={`media-grid ${television ? 'episode-grid' : ''}`}>
      {items.map((item) => (
        <article
          className="media-card"
          key={item.id}
          onContextMenu={(e) => contextMenu?.(item, e)}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) contextMenu?.(item, e);
          }}
        >
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

export function AddSourceDialog({
  initialKind = 'mixed',
  close,
  add,
}: {
  close: () => void;
  add: (path: string, kind: string, name: string) => Promise<void>;
  initialKind?: string;
}) {
  const [path, setPath] = useState(''),
    [name, setName] = useState(''),
    [kind, setKind] = useState(initialKind),
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
            <option value="audiobook">Audiobooks</option>
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

export function Rating({
  item,
  rate,
  disabled = false,
}: {
  item: MediaItem;
  rate: (rating: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="rating"
      role="group"
      aria-label={`${item.title}: ${item.rating ? `${item.rating} of 5 stars` : 'Unrated'}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          className="icon-button"
          disabled={disabled}
          aria-label={`Rate ${item.title} ${n} ${n === 1 ? 'star' : 'stars'}`}
          aria-pressed={item.rating === n}
          title={item.rating === n ? 'Click again to clear this rating' : `${n} of 5 stars`}
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
