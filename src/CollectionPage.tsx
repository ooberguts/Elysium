import { Heart, ImagePlus, Info, ListPlus, MoreHorizontal, Play } from 'lucide-react';
import { Artwork, Rating } from './components';
import { albumGroups, filterItems, seconds } from './domain';
import type { MediaItem } from './types';
import './collection.css';

export function collectionAlbums(items: MediaItem[]) {
  return albumGroups(items).sort(
    (a, b) =>
      (Number(b.items[0].year) || 0) - (Number(a.items[0].year) || 0) ||
      a.name.localeCompare(b.name),
  );
}

export function CollectionPage({
  artist,
  artistImage,
  chooseArtistImage,
  removeArtistImage,
  items,
  query,
  selected,
  currentId,
  touchMode,
  play,
  select,
  favorite,
  rate,
  info,
  enqueue,
  ratingBusy,
  contextMenu,
  openArtist,
  openAlbum,
}: {
  artist?: string;
  artistImage?: string;
  chooseArtistImage: (artist: string) => void;
  removeArtistImage: (artist: string) => void;
  items: MediaItem[];
  query: string;
  selected: Set<string>;
  currentId: string | null;
  touchMode: boolean;
  play: (item: MediaItem, items: MediaItem[]) => void;
  select: (item: MediaItem, event: React.MouseEvent, collection: MediaItem[]) => void;
  favorite: (item: MediaItem) => void;
  rate: (item: MediaItem, rating: number) => void;
  info: (item: MediaItem) => void;
  enqueue: (id: string) => void;
  ratingBusy: ReadonlySet<string>;
  contextMenu: (item: MediaItem, event: React.MouseEvent | React.KeyboardEvent) => void;
  openArtist: (artist: string) => void;
  openAlbum: (item: MediaItem) => void;
}) {
  const albums = collectionAlbums(items);
  const ordered = albums.flatMap((album) => album.items);
  const matches = new Set(filterItems(items, query, '', '', '').map((item) => item.id));
  const visibleAlbums = query
    ? albums
        .map((album) => ({
          ...album,
          items: album.items.filter((item) => matches.has(item.id)),
        }))
        .filter((album) => album.items.length)
    : albums;
  const visibleItems = visibleAlbums.flatMap((album) => album.items);
  const first = ordered[0];
  const name = artist || albums[0]?.name || 'Album unavailable';
  const albumArtist = albums[0]?.artist || 'Unknown artist';
  return (
    <div className={`collection-page ${artist ? 'artist-page' : 'album-page'}`}>
      <header className="collection-hero">
        <Artwork
          item={artist ? items.find((item) => item.artwork) || first : first}
          image={artist ? artistImage : undefined}
          label={name}
        />
        <div>
          <p className="eyebrow">{artist ? 'ARTIST · IN YOUR LIBRARY' : 'ALBUM'}</p>
          <h1>{name}</h1>
          <p>
            {!artist && (
              <>
                {albumArtist === 'Various Artists' &&
                !items.some(
                  (item) => item.artist === albumArtist || item.albumArtist === albumArtist,
                ) ? (
                  <span>{albumArtist}</span>
                ) : (
                  <button className="artist-link" onClick={() => openArtist(albumArtist)}>
                    {albumArtist}
                  </button>
                )}
                <span> · </span>
                {first?.year && <>{first.year} · </>}
              </>
            )}
            {artist && (
              <>
                {albums.length} {albums.length === 1 ? 'album' : 'albums'} ·{' '}
              </>
            )}
            {items.length} {items.length === 1 ? 'song' : 'songs'} ·{' '}
            {seconds(items.reduce((sum, item) => sum + item.duration, 0))}
          </p>
          <div className="collection-actions">
            <button
              className="primary"
              disabled={!first}
              onClick={() => first && play(first, ordered)}
            >
              <Play size={18} fill="currentColor" />
              Play {artist ? 'artist' : 'album'}
            </button>
            <button disabled={!first} onClick={() => ordered.forEach((item) => enqueue(item.id))}>
              <ListPlus size={17} />
              Add to queue
            </button>
            {artist && (
              <>
                <button onClick={() => chooseArtistImage(artist)}>
                  <ImagePlus size={17} />{' '}
                  {artistImage ? 'Change artist image' : 'Choose artist image'}
                </button>
                {artistImage && (
                  <button onClick={() => removeArtistImage(artist)}>Use album artwork</button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      {artist && albums.length > 0 && (
        <section className="artist-discography" aria-label="Albums">
          <h2>Albums</h2>
          <div className="artist-album-strip">
            {albums.map((album) => (
              <button key={album.key} onClick={() => openAlbum(album.items[0])}>
                <Artwork item={album.items[0]} />
                <strong>{album.name}</strong>
                <small>{album.items[0].year || album.artist}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="collection-songs">
        {artist && <h2>Discography</h2>}
        {visibleAlbums.map((album) => (
          <section className="collection-album" key={album.key} aria-label={`${album.name} songs`}>
            {artist && (
              <header>
                <Artwork item={album.items[0]} />
                <div>
                  <button onClick={() => openAlbum(album.items[0])}>
                    <h3>{album.name}</h3>
                  </button>
                  <p>
                    {[album.items[0].year, `${album.items.length} songs`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Play ${album.name}`}
                  onClick={() => play(album.items[0], album.items)}
                >
                  <Play size={20} fill="currentColor" />
                </button>
              </header>
            )}
            <ol className="collection-track-list" aria-label={`${album.name} track list`}>
              {album.items.map((item, index) => (
                <li
                  key={item.id}
                  className={`${currentId === item.id ? 'current' : ''} ${selected.has(item.id) ? 'selected' : ''} ${!item.available ? 'unavailable' : ''}`}
                  tabIndex={0}
                  aria-selected={selected.has(item.id)}
                  draggable={!touchMode}
                  onDragStart={(event) => {
                    const ids = selected.has(item.id)
                      ? visibleItems.filter((song) => selected.has(song.id)).map((song) => song.id)
                      : [item.id];
                    event.dataTransfer.setData('application/elysium-items', JSON.stringify(ids));
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={(event) => select(item, event, visibleItems)}
                  onDoubleClick={() => {
                    if (!touchMode) play(item, album.items);
                  }}
                  onContextMenu={(event) => contextMenu(item, event)}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
                      contextMenu(item, event);
                    if (event.key === 'Enter' && event.target === event.currentTarget)
                      play(item, album.items);
                  }}
                >
                  <button
                    className="collection-track-play"
                    aria-label={`Play ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      play(item, album.items);
                    }}
                  >
                    <span>{item.track || index + 1}</span>
                    <Play size={14} fill="currentColor" />
                  </button>
                  <div className="collection-track-title">
                    <strong>{item.title}</strong>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openArtist(item.artist || item.albumArtist || 'Unknown artist');
                      }}
                    >
                      {item.artist || item.albumArtist || 'Unknown artist'}
                    </button>
                    {!item.available && <small>Offline</small>}
                  </div>
                  <div
                    className="collection-track-rating"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Rating
                      item={item}
                      rate={(rating) => rate(item, rating)}
                      disabled={ratingBusy.has(item.id) || !!item.serverId}
                    />
                  </div>
                  <button
                    className={`icon-button ${item.favorite ? 'loved' : ''}`}
                    aria-label={`${item.favorite ? 'Unfavorite' : 'Favorite'} ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      favorite(item);
                    }}
                  >
                    <Heart size={15} fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <span className="tabular">{seconds(item.duration)}</span>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      info(item);
                    }}
                  >
                    <Info size={15} />
                  </button>
                  {touchMode && (
                    <button
                      className="icon-button"
                      aria-label={`Actions for ${item.title}`}
                      onClick={(event) => contextMenu(item, event)}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
        {!visibleAlbums.length && (
          <div className="empty-filter">
            <h3>{query ? 'No matching songs' : 'No songs in this collection'}</h3>
            <p>
              {query ? 'Try another search.' : 'Your imported albums and songs will appear here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
