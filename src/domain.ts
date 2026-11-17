import type { Library, MediaItem, Playlist, View } from './types';

export function seconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const n = Math.floor(value),
    h = Math.floor(n / 3600),
    m = Math.floor(n / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export function playlistItems(
  playlist: Playlist,
  items: MediaItem[],
  now = Date.now() / 1000,
): MediaItem[] {
  switch (playlist.rule) {
    case 'favorites':
      return items.filter((i) => i.favorite);
    case 'unplayed':
      return items.filter((i) => i.playCount === 0);
    case 'lossless':
      return items.filter((i) => ['FLAC', 'ALAC', 'WAV', 'AIFF'].includes(i.format));
    case 'recent':
      return items.filter((i) => now - i.addedAt < 86400 * 30);
    default: {
      const byId = new Map(items.map((i) => [i.id, i]));
      return playlist.itemIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    }
  }
}

export function viewItems(view: View, library: Library, all: MediaItem[]): MediaItem[] {
  if (view.startsWith('artist:')) return artistItems(all, view.slice(7));
  if (view.startsWith('album:'))
    return all.filter((i) => i.kind === 'music' && albumKey(i) === view.slice(6));
  if (view.startsWith('playlist:')) {
    const p = library.playlists.find((p) => p.id === view.slice(9));
    return p ? playlistItems(p, all) : [];
  }
  switch (view) {
    case 'audiobooks':
      return all.filter((i) => i.kind === 'audiobook');
    case 'movies':
      return all.filter((i) => i.kind === 'movie');
    case 'tv':
      return all.filter((i) => i.kind === 'tv');
    case 'music':
    case 'albums':
    case 'artists':
      return all.filter((i) => i.kind === 'music');
    case 'favorites':
      return all.filter((i) => i.favorite);
    case 'recent':
      return [...all].sort((a, b) => b.addedAt - a.addedAt);
    default:
      return all;
  }
}

export function artistItems(items: MediaItem[], artist: string): MediaItem[] {
  return items.filter(
    (item) =>
      item.kind === 'music' &&
      (item.artist === artist ||
        item.albumArtist === artist ||
        (artist === 'Unknown artist' && !item.artist && !item.albumArtist)),
  );
}

export function filterItems(
  items: MediaItem[],
  search: string,
  genre: string,
  artist: string,
  album: string,
): MediaItem[] {
  const words = search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(
    (i) =>
      (!genre || i.genre === genre) &&
      (!artist || (i.albumArtist || i.artist || 'Unknown artist') === artist) &&
      (!album || i.album === album) &&
      words.every((w) =>
        `${i.title} ${i.artist} ${i.albumArtist} ${i.album} ${i.genre} ${i.year} ${i.series}`
          .toLocaleLowerCase()
          .includes(w),
      ),
  );
}

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function nextIndex(
  index: number,
  length: number,
  repeat: 'off' | 'all' | 'one',
  ended = false,
): number | null {
  if (!length) return null;
  if (repeat === 'one' && ended) return index;
  if (index + 1 < length) return index + 1;
  return repeat === 'all' ? 0 : null;
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function albumKey(item: MediaItem): string {
  return `${item.albumArtist || item.artist}\u0000${item.album || 'Untitled album'}`;
}
export function albumGroups(
  items: MediaItem[],
): { key: string; name: string; artist: string; items: MediaItem[] }[] {
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = albumKey(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups].map(([key, group]) => ({
    key,
    name: group[0].album || 'Untitled album',
    artist: group[0].albumArtist || group[0].artist || 'Unknown artist',
    items: group.sort(
      (a, b) => a.disc - b.disc || a.track - b.track || a.title.localeCompare(b.title),
    ),
  }));
}

export const isAudio = (item: MediaItem) => item.kind === 'music' || item.kind === 'audiobook';
