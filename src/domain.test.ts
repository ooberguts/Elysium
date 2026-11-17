import { describe, expect, it } from 'vitest';
import {
  albumGroups,
  albumKey,
  artistItems,
  filterItems,
  nextIndex,
  playlistItems,
  seconds,
  shuffled,
  viewItems,
} from './domain';
import type { MediaItem, Playlist } from './types';
import { EMPTY_LIBRARY } from './types';

const media = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  path: '',
  sourceId: null,
  relativePath: '',
  kind: 'music',
  title: 'Night Drive',
  artist: 'The Artist',
  album: 'First Light',
  albumArtist: '',
  genre: 'Electronic',
  year: '2026',
  track: 1,
  disc: 1,
  duration: 210,
  format: 'FLAC',
  sampleRate: 44100,
  bitrate: 900,
  artwork: null,
  favorite: false,
  rating: 0,
  playCount: 0,
  addedAt: 100,
  lastPlayed: 0,
  resume: 0,
  watched: false,
  available: true,
  series: '',
  season: 0,
  episode: 0,
  overview: '',
  overrides: {},
  ...extra,
});

describe('queue transitions', () => {
  it('ends an ordinary queue instead of looping', () =>
    expect(nextIndex(2, 3, 'off', true)).toBeNull());
  it('repeats a single track only when it ends, allowing the Next button to advance', () => {
    expect(nextIndex(0, 3, 'one', true)).toBe(0);
    expect(nextIndex(0, 3, 'one', false)).toBe(1);
  });
  it('wraps repeat-all and handles an empty queue', () => {
    expect(nextIndex(2, 3, 'all')).toBe(0);
    expect(nextIndex(0, 0, 'all')).toBeNull();
  });
  it('shuffles without losing or duplicating entries or mutating the source', () => {
    const source = ['a', 'b', 'c', 'd'];
    const result = shuffled(source, () => 0);
    expect([...result].sort()).toEqual(source);
    expect(source).toEqual(['a', 'b', 'c', 'd']);
    expect(result).not.toEqual(source);
  });
});

describe('library organization', () => {
  it('artist pages include their own releases and contributions to compilation albums', () => {
    const solo = media('solo', { artist: 'Artist', albumArtist: 'Artist' });
    const compilation = media('compilation', {
      artist: 'Artist',
      albumArtist: 'Various Artists',
      album: 'Collection',
    });
    const other = media('other', { artist: 'Someone else' });
    const movie = media('movie', { kind: 'movie', artist: 'Artist' });
    expect(artistItems([solo, compilation, other, movie], 'Artist')).toEqual([solo, compilation]);
    expect(viewItems('artist:Artist', EMPTY_LIBRARY, [solo, compilation, other])).toEqual([
      solo,
      compilation,
    ]);
  });
  it('album destinations select a full release without mixing namesakes from other artists', () => {
    const album = [media('two', { track: 2 }), media('one', { track: 1 })];
    const other = media('other', { artist: 'Other artist' });
    const items = viewItems(`album:${albumKey(album[0])}`, EMPTY_LIBRARY, [...album, other]);
    expect(albumGroups(items)[0].items.map((item) => item.id)).toEqual(['one', 'two']);
    expect(items).toHaveLength(2);
  });
  it('searches all words across fields and applies column filters together', () => {
    const a = media('a'),
      b = media('b', { artist: 'Someone Else', genre: 'Jazz' });
    expect(filterItems([a, b], 'night artist', 'Electronic', '', '')).toEqual([a]);
    expect(filterItems([a, b], '', '', 'Someone Else', '')).toEqual([b]);
  });
  it('keeps albums with the same name by different artists separate and orders discs', () => {
    const groups = albumGroups([
      media('a', { disc: 2 }),
      media('b', { disc: 1 }),
      media('c', { artist: 'Another Artist' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('preserves explicit playlist order, including repeated tracks and missing-file gaps', () => {
    const list: Playlist = {
      id: 'p',
      name: 'Drive',
      rule: null,
      itemIds: ['b', 'missing', 'a', 'b'],
    };
    expect(playlistItems(list, [media('a'), media('b')]).map((i) => i.id)).toEqual(['b', 'a', 'b']);
  });
  it('evaluates smart rules from the latest item state', () => {
    const list: Playlist = { id: 'p', name: 'Favorites', rule: 'favorites', itemIds: [] };
    expect(playlistItems(list, [media('a', { favorite: true }), media('b')])).toHaveLength(1);
  });
  it('formats long media durations and invalid values', () => {
    expect(seconds(3661)).toBe('1:01:01');
    expect(seconds(61.9)).toBe('1:01');
    expect(seconds(Infinity)).toBe('0:00');
  });
});
