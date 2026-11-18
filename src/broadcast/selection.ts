import type { Library, MediaItem } from '../types';
import { albumKey as musicAlbumKey, viewItems } from '../domain';
export type SourceKind =
  'playlist' | 'artist' | 'album' | 'genre' | 'queue' | 'all' | 'movie' | 'series' | 'book';
export const albumKey = (item: MediaItem) =>
  item.kind === 'music'
    ? musicAlbumKey(item)
    : JSON.stringify([item.albumArtist || item.artist, item.album]);
export function broadcastSelection(
  library: Library,
  kind: SourceKind,
  value: string,
  queue: string[],
  media: 'music' | 'video' | 'audiobook' = 'music',
): MediaItem[] {
  const eligible = (item: MediaItem) =>
    !item.serverId &&
    (media === 'music'
      ? item.kind === 'music'
      : media === 'audiobook'
        ? item.kind === 'audiobook'
        : item.kind === 'movie' || item.kind === 'tv');
  const music = library.items.filter(eligible);
  if (kind === 'playlist')
    return viewItems(`playlist:${value}`, library, library.items).filter(eligible);
  if (kind === 'queue')
    return queue
      .map((id) => music.find((item) => item.id === id))
      .filter((item): item is MediaItem => !!item);
  if (kind === 'movie' || kind === 'book') return music.filter((i) => i.id === value);
  if (kind === 'series')
    return music
      .filter((i) => i.kind === 'tv' && i.series === value)
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (kind === 'artist')
    return music.filter((item) => item.artist === value || item.albumArtist === value);
  if (kind === 'album')
    return music
      .filter((item) => albumKey(item) === value)
      .sort((a, b) => a.disc - b.disc || a.track - b.track);
  if (kind === 'genre') return music.filter((item) => item.genre === value);
  return music;
}
