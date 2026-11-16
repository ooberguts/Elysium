import { BookOpen, FolderOpen, Info, Play, Plus } from 'lucide-react';
import { Artwork } from './components';
import { seconds } from './domain';
import { listeningProgress } from './listening';
import type { MediaItem } from './types';
import './audiobooks.css';

export function Audiobooks({
  items,
  play,
  add,
  folder,
  info,
  contextMenu,
}: {
  items: MediaItem[];
  play: (item: MediaItem) => void;
  add: () => void;
  folder: () => void;
  info: (item: MediaItem) => void;
  contextMenu: (item: MediaItem, event: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  const continuing = items.filter((i) => listeningProgress(i).position > 0);
  const card = (item: MediaItem) => {
    const { position, completed } = listeningProgress(item);
    const percent = item.duration > 0 ? Math.min(100, (position / item.duration) * 100) : 0;
    return (
      <article
        className="book-card"
        key={item.id}
        onContextMenu={(e) => contextMenu(item, e)}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) contextMenu(item, e);
        }}
      >
        <button
          className="book-cover"
          onClick={() => play(item)}
          aria-label={`${position ? 'Resume' : 'Play'} ${item.title}`}
        >
          <Artwork item={item} />
          <span className="book-play">
            <Play size={24} fill="currentColor" />
          </span>
        </button>
        <div className="book-copy">
          <h3>{item.title}</h3>
          <p>{item.artist || item.albumArtist || 'Unknown author'}</p>
          {item.album && item.album !== item.title && <small>{item.album}</small>}
          <progress
            aria-label={`${item.title} listening progress`}
            max={100}
            value={completed ? 100 : percent}
          />
          <span className="book-progress">
            {completed
              ? 'Finished · listen again'
              : position > 0
                ? `${seconds(position)} of ${seconds(item.duration)}`
                : `${seconds(item.duration)} · Not started`}
          </span>
          <div className="book-actions">
            <button className="small-button" onClick={() => play(item)} disabled={!item.available}>
              <Play size={13} />
              {position > 0 ? 'Resume' : completed ? 'Listen again' : 'Listen'}
            </button>
            <button
              className="icon-button"
              aria-label={`Details for ${item.title}`}
              onClick={() => info(item)}
            >
              <Info size={16} />
            </button>
          </div>
        </div>
      </article>
    );
  };
  return (
    <section className="audiobooks-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">YOUR LISTENING SHELF</p>
          <h1>Audiobooks</h1>
          <p>A place for every story. Your place, remembered.</p>
        </div>
        <div className="view-header-actions">
          <button onClick={folder}>
            <FolderOpen size={16} />
            Add folder
          </button>
          <button className="primary" onClick={add}>
            <Plus size={16} />
            Add audiobooks
          </button>
        </div>
      </div>
      <div className="book-note">
        <BookOpen size={19} />
        <span>
          Your place saves as you listen, when you pause, and when you switch books. M4B files are
          recognized automatically; import other audio here to keep it on this shelf.
        </span>
      </div>
      {!!continuing.length && (
        <>
          <h2>Continue listening</h2>
          <div className="book-grid">{continuing.map(card)}</div>
        </>
      )}
      <h2>
        {continuing.length ? 'Your whole shelf' : 'Your books'} <small>{items.length}</small>
      </h2>
      {items.length ? (
        <div className="book-grid">{items.map(card)}</div>
      ) : (
        <div className="books-empty">
          <BookOpen size={38} />
          <h3>Your next story starts here</h3>
          <p>
            Add M4B, MP3, M4A, or other audio files. Each file keeps its own listening position.
          </p>
          <button className="primary" onClick={add}>
            <Plus size={16} />
            Add your first audiobook
          </button>
        </div>
      )}
    </section>
  );
}
