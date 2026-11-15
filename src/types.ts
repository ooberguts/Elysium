export type MediaKind = 'music' | 'movie' | 'tv';
export type View =
  | 'home'
  | 'music'
  | 'albums'
  | 'artists'
  | 'movies'
  | 'tv'
  | 'favorites'
  | 'recent'
  | 'sources'
  | 'jellyfin'
  | 'settings'
  | `playlist:${string}`;

export interface MediaItem {
  id: string;
  path: string;
  sourceId: string | null;
  relativePath: string;
  kind: MediaKind;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  track: number;
  disc: number;
  duration: number;
  format: string;
  sampleRate: number;
  bitrate: number;
  artwork: string | null;
  favorite: boolean;
  rating: number;
  playCount: number;
  addedAt: number;
  lastPlayed: number;
  resume: number;
  watched: boolean;
  available: boolean;
  series: string;
  season: number;
  episode: number;
  overview: string;
  overrides: Record<string, string>;
  serverId?: string;
}
export interface Source {
  id: string;
  name: string;
  path: string;
  kind: string;
  online: boolean;
  scannedAt: number;
  count: number;
}
export interface Playlist {
  id: string;
  name: string;
  rule: string | null;
  itemIds: string[];
}
export interface Library {
  items: MediaItem[];
  sources: Source[];
  playlists: Playlist[];
  settings: Record<string, string>;
}
export interface MetadataEdit {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  track: number;
  disc: number;
  series: string;
  season: number;
  episode: number;
  overview: string;
}
export interface ScanProgress {
  sourceId: string;
  processed: number;
  current: string;
}
export interface Match {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  score: number;
}
export interface JellyfinLibrary {
  serverId: string;
  serverName: string;
  userName: string;
  items: MediaItem[];
}
export interface PlayerState {
  currentId: string | null;
  queue: string[];
  index: number;
  playing: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
}
export const EMPTY_LIBRARY: Library = { items: [], sources: [], playlists: [], settings: {} };
