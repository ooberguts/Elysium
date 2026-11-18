import { expect, it } from 'vitest';
import { albumKey, broadcastSelection } from './selection';
import { EMPTY_LIBRARY, type MediaItem } from '../types';

const song = (id: string, extra: Partial<MediaItem> = {}) =>
  ({
    id,
    kind: 'music',
    artist: 'Artist',
    albumArtist: 'Album Artist',
    album: 'Collection',
    genre: 'Electronic',
    disc: 1,
    track: 1,
    ...extra,
  }) as MediaItem;
const a = song('a', { disc: 2 }),
  b = song('b'),
  c = song('c', { artist: 'Other', albumArtist: 'Other' });
const movie = song('movie', { kind: 'movie' });
const remote = song('remote', { serverId: 'server' });
const library = {
  ...EMPTY_LIBRARY,
  items: [a, b, c, movie, remote],
  playlists: [
    { id: 'p', name: 'Radio', rule: null, itemIds: ['b', 'missing', 'a', 'movie', 'b', 'remote'] },
  ],
};

it('broadcasts local playlist and queue entries in order, preserving repeats', () => {
  expect(broadcastSelection(library, 'playlist', 'p', []).map((i) => i.id)).toEqual([
    'b',
    'a',
    'b',
  ]);
  expect(
    broadcastSelection(library, 'queue', '', ['c', 'missing', 'b', 'b', 'movie', 'remote']).map(
      (i) => i.id,
    ),
  ).toEqual(['c', 'b', 'b']);
});
it('separates albums by artist and sorts discs without mutating the library', () => {
  expect(broadcastSelection(library, 'album', albumKey(a), []).map((i) => i.id)).toEqual([
    'b',
    'a',
  ]);
  expect(library.items[0].id).toBe('a');
  expect(broadcastSelection(library, 'artist', 'Album Artist', []).map((i) => i.id)).toEqual([
    'a',
    'b',
  ]);
});
it('genre and all-music stations exclude videos and server-only media', () => {
  expect(broadcastSelection(library, 'genre', 'Electronic', []).map((i) => i.id)).toEqual([
    'a',
    'b',
    'c',
  ]);
  expect(broadcastSelection(library, 'all', '', []).map((i) => i.id)).toEqual(['a', 'b', 'c']);
});

it('video programming includes local movies and ordered series, excluding music and remote video', () => {
  const videos = {
    ...library,
    items: [
      ...library.items,
      song('episode2', { kind: 'tv', series: 'Show', season: 1, episode: 2 }),
      song('episode1', { kind: 'tv', series: 'Show', season: 1, episode: 1 }),
      song('remote-movie', { kind: 'movie', serverId: 'remote' }),
    ],
  };
  expect(broadcastSelection(videos, 'movie', 'movie', [], 'video').map((i) => i.id)).toEqual([
    'movie',
  ]);
  expect(broadcastSelection(videos, 'series', 'Show', [], 'video').map((i) => i.id)).toEqual([
    'episode1',
    'episode2',
  ]);
  expect(broadcastSelection(videos, 'playlist', 'p', [], 'video').map((i) => i.id)).toEqual([
    'movie',
  ]);
});

it('broadcasts books by title, author and ordered collection without including songs', () => {
  const books = {
    ...library,
    items: [
      ...library.items,
      song('chapter2', { kind: 'audiobook', track: 2 }),
      song('chapter1', { kind: 'audiobook', track: 1 }),
    ],
  };
  expect(broadcastSelection(books, 'book', 'chapter2', [], 'audiobook').map((i) => i.id)).toEqual([
    'chapter2',
  ]);
  expect(broadcastSelection(books, 'artist', 'Artist', [], 'audiobook').map((i) => i.id)).toEqual([
    'chapter2',
    'chapter1',
  ]);
  expect(
    broadcastSelection(
      books,
      'album',
      albumKey(books.items[books.items.length - 1]),
      [],
      'audiobook',
    ).map((i) => i.id),
  ).toEqual(['chapter1', 'chapter2']);
});

it('broadcasts every performer on a compilation without an album artist', () => {
  const compilation = {
    ...library,
    items: [
      song('a', { artist: 'First', albumArtist: '' }),
      song('b', { artist: 'Second', albumArtist: '' }),
    ],
  };
  expect(
    broadcastSelection(compilation, 'album', albumKey(compilation.items[0]), []).map(
      (item) => item.id,
    ),
  ).toEqual(['a', 'b']);
});
