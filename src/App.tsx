import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Album,
  ArrowDownAZ,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Film,
  FolderOpen,
  Grid2X2,
  Heart,
  Home,
  Info,
  ListMusic,
  LoaderCircle,
  Maximize2,
  Mic2,
  Minimize2,
  Music2,
  Pause,
  Pin,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Tv,
  Upload,
  Volume2,
  VolumeX,
  X,
  Server,
  CircleHelp,
} from 'lucide-react';
import { getCurrentWindow, LogicalSize, type PhysicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  AddSourceDialog,
  AddToPlaylist,
  Artwork,
  EmptyCollection,
  MediaCards,
  MetadataDialog,
  Modal,
  PlaylistDialog,
  Rating,
  SourcesView,
  TrackTable,
  VideoDetail,
  Visualizer,
} from './components';
import { chooseFiles, chooseFolder, desktop, loadLibrary, native, open, savePath } from './bridge';
import { albumGroups, filterItems, seconds, unique, viewItems } from './domain';
import { usePlayer } from './player';
import {
  EMPTY_LIBRARY,
  type JellyfinLibrary,
  type Library,
  type MediaItem,
  type PlayerState,
  type Playlist,
  type ScanProgress,
  type Source,
  type View,
} from './types';
import './styles.css';

const nav = [
  { id: 'home', label: 'Listen & watch', icon: Home },
  { id: 'music', label: 'Songs', icon: Music2 },
  { id: 'albums', label: 'Albums', icon: Album },
  { id: 'artists', label: 'Artists', icon: Mic2 },
  { id: 'movies', label: 'Movies', icon: Film },
  { id: 'tv', label: 'TV shows', icon: Tv },
] as const;
const names: Record<string, string> = {
  home: 'Listen & watch',
  music: 'Music',
  albums: 'Albums',
  artists: 'Artists',
  movies: 'Movies',
  tv: 'TV shows',
  favorites: 'Favorites',
  recent: 'Recently added',
  sources: 'Sources',
  jellyfin: 'Jellyfin',
  settings: 'Preferences',
};
const subtitles: Record<string, string> = {
  home: 'Good things are worth coming back to.',
  music: 'Your collection, beautifully in order.',
  albums: 'Every record has a place.',
  artists: 'The people behind your soundtrack.',
  movies: 'Make tonight a movie night.',
  tv: 'Pick up where you left off.',
  favorites: 'Keep the good ones close.',
  recent: 'The newest additions to your collection.',
};

export default function App() {
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY),
    [loaded, setLoaded] = useState(false),
    [view, setView] = useState<View>('home');
  const [query, setQuery] = useState(''),
    [genre, setGenre] = useState(''),
    [artist, setArtist] = useState(''),
    [album, setAlbum] = useState(''),
    [series, setSeries] = useState('');
  const [theme, setTheme] = useState('silver'),
    [compact, setCompact] = useState(false),
    [browser, setBrowser] = useState(true),
    [grid, setGrid] = useState(false),
    [sort, setSort] = useState('title');
  const [mini, setMini] = useState(false),
    [pinned, setPinned] = useState(true),
    [queueOpen, setQueueOpen] = useState(false),
    [nowPlaying, setNowPlaying] = useState(false),
    [visualMode, setVisualMode] = useState('spectrum'),
    [eqOpen, setEqOpen] = useState(false);
  const [sourceDialog, setSourceDialog] = useState(false),
    [playlistDialog, setPlaylistDialog] = useState(false),
    [infoIds, setInfoIds] = useState<string[]>([]),
    [detailId, setDetailId] = useState<string | null>(null),
    [help, setHelp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(''),
    [progress, setProgress] = useState<ScanProgress | null>(null),
    [toast, setToast] = useState('');
  const [remotes, setRemotes] = useState<JellyfinLibrary[]>([]),
    [serverAddress, setServerAddress] = useState(''),
    [serverUser, setServerUser] = useState(''),
    [serverPassword, setServerPassword] = useState(''),
    [serverError, setServerError] = useState('');
  const [rate, setRate] = useState(1),
    [subtitleUrl, setSubtitleUrl] = useState(''),
    [subtitleName, setSubtitleName] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    normalSize = useRef<PhysicalSize | null>(null),
    search = useRef<HTMLInputElement>(null),
    initialized = useRef(false),
    selectedAnchor = useRef(0);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 7000);
  }, []);
  const refresh = useCallback(async () => {
    const data = await loadLibrary();
    setLibrary(data);
  }, []);
  const allItems = useMemo(
    () => [
      ...library.items.map((i) => ({
        ...i,
        available:
          i.available &&
          (!i.sourceId || library.sources.find((s) => s.id === i.sourceId)?.online !== false),
      })),
      ...remotes.flatMap((r) => r.items),
    ],
    [library.items, library.sources, remotes],
  );
  const player = usePlayer(allItems, notify, () => {
    void refresh().catch(() => {});
  });
  const { state: playback, current } = player;
  const selectedPlaylist = library.playlists.find((p) => view === `playlist:${p.id}`);
  const baseItems = useMemo(() => viewItems(view, library, allItems), [view, library, allItems]);
  const filtered = useMemo(() => {
    const result = filterItems(baseItems, query, genre, artist, album).filter(
      (i) => !series || i.series === series,
    );
    if (selectedPlaylist && !selectedPlaylist.rule && sort === 'playlist') return result;
    return [...result].sort((a, b) =>
      sort === 'added'
        ? b.addedAt - a.addedAt
        : sort === 'artist'
          ? a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.track - b.track
          : sort === 'album'
            ? a.album.localeCompare(b.album) || a.disc - b.disc || a.track - b.track
            : sort === 'rating'
              ? b.rating - a.rating || a.title.localeCompare(b.title)
              : a.title.localeCompare(b.title),
    );
  }, [baseItems, query, genre, artist, album, series, sort, selectedPlaylist]);
  const albums = useMemo(() => albumGroups(filtered.filter((i) => i.kind === 'music')), [filtered]);
  const artists = unique(
    filtered
      .filter((i) => i.kind === 'music')
      .map((i) => i.albumArtist || i.artist || 'Unknown artist'),
  );
  const filteredGenres = unique(baseItems.map((i) => i.genre));
  const filteredArtists = unique(
    baseItems
      .filter((i) => !genre || i.genre === genre)
      .map((i) => i.albumArtist || i.artist || 'Unknown artist'),
  );
  const filteredAlbums = unique(
    baseItems
      .filter(
        (i) =>
          (!genre || i.genre === genre) &&
          (!artist || (i.albumArtist || i.artist || 'Unknown artist') === artist),
      )
      .map((i) => i.album),
  );
  const infoItems = infoIds.flatMap((id) =>
    allItems.find((i) => i.id === id) ? [allItems.find((i) => i.id === id)!] : [],
  );
  const detail = allItems.find((i) => i.id === detailId);

  const task = useCallback(
    async (label: string, work: () => Promise<void>) => {
      setBusy(label);
      try {
        await work();
      } catch (e) {
        notify(String(e));
      } finally {
        setBusy('');
        setProgress(null);
      }
    },
    [notify],
  );
  const navigate = useCallback((next: View) => {
    setView(next);
    setGenre('');
    setArtist('');
    setAlbum('');
    setSeries('');
    setQuery('');
    setSelected(new Set());
    setNowPlaying(false);
    if (next.startsWith('playlist:')) setSort('playlist');
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!desktop) {
      setLoaded(true);
      return;
    }
    void loadLibrary()
      .then((data) => {
        setLibrary(data);
        setTheme(data.settings.theme || 'silver');
        setCompact(data.settings.compact === 'true');
        setBrowser(data.settings.browser !== 'false');
        setVisualMode(data.settings.visualMode || 'spectrum');
        setServerAddress(data.settings.serverAddress || '');
        if (data.settings.player)
          try {
            const saved = JSON.parse(data.settings.player) as Partial<PlayerState>;
            const ids = new Set(data.items.map((i) => i.id));
            saved.queue = (saved.queue || []).filter((id) => ids.has(id));
            saved.currentId = saved.currentId && ids.has(saved.currentId) ? saved.currentId : null;
            saved.index = saved.currentId ? saved.queue.indexOf(saved.currentId) : -1;
            if (saved.currentId)
              saved.position = data.items.find((i) => i.id === saved.currentId)?.resume || 0;
            player.restore(saved);
          } catch {
            /* Ignore a malformed old checkpoint. */
          }
        setLoaded(true);
      })
      .catch((e) => {
        notify(`Could not open the library: ${e}`);
        setLoaded(true);
      });
  }, [notify, player]);

  useEffect(() => {
    if (!loaded || !desktop) return;
    const timer = setTimeout(() => {
      void native('save_settings', {
        values: {
          theme,
          compact: String(compact),
          browser: String(browser),
          visualMode,
          serverAddress,
        },
      }).catch((e) => notify(String(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [theme, compact, browser, visualMode, serverAddress, loaded, notify]);
  useEffect(() => {
    if (!loaded || !desktop) return;
    const timer = setTimeout(() => {
      const saved = {
        ...playback,
        playing: false,
        queue: playback.queue.filter((id) => !id.includes(':')),
      };
      void native('save_settings', { values: { player: JSON.stringify(saved) } }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    playback.currentId,
    playback.queue,
    playback.index,
    playback.volume,
    playback.muted,
    playback.repeat,
    playback.shuffle,
    playback.playing,
    loaded,
  ]);

  useEffect(() => {
    if (!desktop) return;
    const unlisten = listen<ScanProgress>('scan-progress', (e) => setProgress(e.payload));
    const drop = getCurrentWebviewWindow().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') {
        const paths = e.payload.paths;
        void task('Adding dropped files…', async () => {
          const count = await native<number>('import_files', { paths });
          await refresh();
          notify(`${count} files added`);
        });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
      void drop.then((fn) => fn());
    };
  }, [task, refresh, notify]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.current?.focus();
      }
      if (editing || document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void player.toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i' && selected.size) {
        e.preventDefault();
        setInfoIds([...selected]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [player, selected]);

  useEffect(() => {
    if (player.video.current) player.video.current.playbackRate = rate;
    if (player.audio.current) player.audio.current.playbackRate = rate;
  }, [rate, playback.currentId, player.video, player.audio]);
  useEffect(() => {
    setSubtitleName('');
    setSubtitleUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  }, [playback.currentId]);

  async function importFiles() {
    await task('Adding media…', async () => {
      const paths = await chooseFiles();
      if (!paths.length) return;
      const count = await native<number>('import_files', { paths });
      await refresh();
      notify(`${count} files added to your library`);
      navigate('music');
    });
  }
  async function scan(source: Source) {
    await task(`Scanning ${source.name}…`, async () => {
      const result = await native<{ imported: number; skipped: number; cancelled: boolean }>(
        'scan_source',
        { sourceId: source.id },
      );
      await refresh();
      notify(
        `${result.cancelled ? 'Scan stopped' : 'Scan complete'} · ${result.imported} files${result.skipped ? ` · ${result.skipped} skipped` : ''}`,
      );
    });
  }
  async function addSource(path: string, kind: string, name: string) {
    const source = await native<Source>('add_source', { path, kind, name });
    await refresh();
    await scan(source);
  }
  async function samples() {
    await task('Preparing your sample library…', async () => {
      const source = await native<Source>('import_samples');
      await native('scan_source', { sourceId: source.id });
      await refresh();
      navigate('home');
      notify('Sample library added · 3 songs, a movie, and a TV episode');
    });
  }
  async function rebind(source: Source) {
    const path = await chooseFolder();
    if (path)
      await task('Locating source…', async () => {
        await native('rebind_source', { sourceId: source.id, path });
        await refresh();
        notify('Source location updated');
      });
  }
  async function favorite(item: MediaItem) {
    if (item.serverId) {
      notify('Manage Jellyfin favorites on your server in this build.');
      return;
    }
    try {
      await native('set_favorite', { id: item.id, favorite: !item.favorite });
      setLibrary((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === item.id ? { ...i, favorite: !i.favorite } : i)),
      }));
    } catch (e) {
      notify(String(e));
    }
  }
  async function rating(item: MediaItem, rating: number) {
    try {
      await native('set_rating', { id: item.id, rating });
      await refresh();
    } catch (e) {
      notify(String(e));
    }
  }
  function select(item: MediaItem, event: React.MouseEvent) {
    const index = filtered.findIndex((i) => i.id === item.id);
    setSelected((prev) => {
      const next = new Set(event.metaKey || event.ctrlKey ? prev : []);
      if (event.shiftKey) {
        for (const i of filtered.slice(
          Math.min(selectedAnchor.current, index),
          Math.max(selectedAnchor.current, index) + 1,
        ))
          next.add(i.id);
      } else if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!event.shiftKey) selectedAnchor.current = index;
  }
  function play(item: MediaItem, collection = filtered) {
    void player.play(item, collection);
    if (item.kind !== 'music') {
      setNowPlaying(true);
      setDetailId(null);
    }
  }
  async function toggleMini() {
    if (desktop) {
      const win = getCurrentWindow();
      try {
        if (!mini) {
          normalSize.current = await win.innerSize();
          await win.setMinSize(new LogicalSize(380, 200));
          await win.setSize(new LogicalSize(470, 225));
          await win.setAlwaysOnTop(pinned);
        } else {
          await win.setAlwaysOnTop(false);
          await win.setSize(normalSize.current || new LogicalSize(1280, 820));
          await win.setMinSize(new LogicalSize(850, 600));
        }
      } catch (e) {
        notify(String(e));
        return;
      }
    }
    setMini(!mini);
  }
  async function togglePin() {
    try {
      if (desktop) await getCurrentWindow().setAlwaysOnTop(!pinned);
      setPinned(!pinned);
    } catch (e) {
      notify(String(e));
    }
  }
  async function fullScreen() {
    try {
      if (desktop) {
        const win = getCurrentWindow();
        await win.setFullscreen(!(await win.isFullscreen()));
      } else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      notify(String(e));
    }
  }
  async function attachSubtitle() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }],
      });
      if (typeof path !== 'string') return;
      const content = await native<string>('load_subtitle', { path });
      if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
      setSubtitleUrl(URL.createObjectURL(new Blob([content], { type: 'text/vtt' })));
      setSubtitleName(path.split(/[\\/]/).pop() || 'Subtitles');
    } catch (e) {
      notify(String(e));
    }
  }
  async function addToPlaylist(id: string) {
    const list = library.playlists.find((p) => p.id === id);
    if (!list) return;
    try {
      await native('update_playlist', {
        id,
        itemIds: [...list.itemIds, ...[...selected].filter((id) => !id.includes(':'))],
      });
      await refresh();
      notify(`Added to ${list.name}`);
    } catch (e) {
      notify(String(e));
    }
  }
  async function importPlaylist() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8'] }],
      });
      if (typeof path === 'string')
        await task('Importing playlist…', async () => {
          const list = await native<Playlist>('import_playlist', { path });
          await refresh();
          navigate(`playlist:${list.id}`);
          notify(`Imported ${list.itemIds.length} playlist entries`);
        });
    } catch (e) {
      notify(String(e));
    }
  }
  async function exportBackup() {
    try {
      const path = await savePath('Elysium Library.json', 'json');
      if (path) {
        await native('export_library', { path });
        notify('Library backup exported');
      }
    } catch (e) {
      notify(String(e));
    }
  }
  async function restoreBackup() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Elysium backup', extensions: ['json'] }],
      });
      if (typeof path === 'string')
        await task('Restoring library backup…', async () => {
          const count = await native<number>('restore_library', { path });
          await refresh();
          notify(`Merged ${count} items from your backup`);
        });
    } catch (e) {
      notify(String(e));
    }
  }
  async function connectServer(e: React.FormEvent) {
    e.preventDefault();
    setServerError('');
    await task('Connecting to Jellyfin…', async () => {
      try {
        const remote = await native<JellyfinLibrary>('connect_jellyfin', {
          url: serverAddress,
          username: serverUser,
          password: serverPassword,
        });
        setServerPassword('');
        setRemotes((prev) => [...prev.filter((r) => r.serverId !== remote.serverId), remote]);
        notify(`Connected · ${remote.items.length} Jellyfin items`);
      } catch (e) {
        setServerError(String(e));
      }
    });
  }

  const transport = (
    <>
      <button
        className="transport-small"
        aria-label="Previous track"
        onClick={() => void player.go(-1)}
        disabled={!current}
      >
        <SkipBack fill="currentColor" size={19} />
      </button>
      <button
        className="transport-play"
        aria-label={playback.playing ? 'Pause' : 'Play'}
        disabled={!current || player.preparing}
        onClick={() => void player.toggle()}
      >
        {player.preparing ? (
          <LoaderCircle className="spin" size={24} />
        ) : playback.playing ? (
          <Pause size={24} fill="currentColor" />
        ) : (
          <Play size={24} fill="currentColor" />
        )}
      </button>
      <button
        className="transport-small"
        aria-label="Next track"
        onClick={() => void player.go(1)}
        disabled={!current}
      >
        <SkipForward fill="currentColor" size={19} />
      </button>
    </>
  );

  return (
    <div
      onClick={(e) => {
        const button = (e.target as HTMLElement).closest?.('button');
        const menu = button?.closest('details');
        if (menu) menu.removeAttribute('open');
      }}
      className={`app ${mini ? 'mini-mode' : ''} ${compact ? 'compact' : ''}`}
      data-theme={theme}
    >
      <audio ref={player.audio} crossOrigin="anonymous" preload="metadata" />
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">e</div>
          <span>elysium</span>
          <span className="version-label">0.1</span>
        </div>
        <div className="header-menus">
          <details>
            <summary>
              Library
              <ChevronDown size={11} />
            </summary>
            <div className="context-menu">
              <button onClick={() => void importFiles()}>
                <Plus size={15} />
                Add files…
              </button>
              <button onClick={() => setSourceDialog(true)}>
                <FolderOpen size={15} />
                Add folder…
              </button>
              <button onClick={() => setPlaylistDialog(true)}>
                <ListMusic size={15} />
                New playlist…
              </button>
              <button onClick={() => void importPlaylist()}>
                <Upload size={15} />
                Import M3U playlist…
              </button>
              <button disabled={!current} onClick={() => void player.stop()}>
                <Pause size={15} />
                Stop playback
              </button>
              <hr />
              <button onClick={() => void exportBackup()}>
                <Download size={15} />
                Export library backup…
              </button>
              <button onClick={() => void restoreBackup()}>
                <Upload size={15} />
                Restore backup…
              </button>
            </div>
          </details>
          <button onClick={() => navigate('settings')}>View</button>
          <button onClick={() => setHelp(true)}>Help</button>
        </div>
        <div className="header-right">
          <span className="local-label">
            <span />
            YOUR PERSONAL MEDIA CENTER
          </span>
          <button className="subtle-button" onClick={() => void toggleMini()}>
            <Minimize2 size={14} />
            Mini player
          </button>
        </div>
      </header>
      <div className="main-toolbar">
        <div className="toolbar-transport">{transport}</div>
        <div className="lcd-display" onDoubleClick={() => setNowPlaying(!nowPlaying)}>
          <span className="lcd-title">{current?.title || 'A place for all your favorites.'}</span>
          <span className="lcd-subtitle">
            {player.preparing
              ? 'Preparing a compatible copy · originals stay untouched'
              : current
                ? [current.artist || current.series, current.album || current.year]
                    .filter(Boolean)
                    .join(' · ') || current.format
                : 'Music · Movies · Television'}
          </span>
          <div className="lcd-progress">
            <div
              style={{
                width: `${playback.duration > 0 ? (playback.position / playback.duration) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="toolbar-volume">
          <button
            className="icon-button"
            aria-label={playback.muted ? 'Unmute' : 'Mute'}
            onClick={() => player.set((s) => ({ ...s, muted: !s.muted }))}
          >
            {playback.muted || !playback.volume ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            aria-label="Volume"
            min="0"
            max="1"
            step="0.01"
            value={playback.muted ? 0 : playback.volume}
            onChange={(e) =>
              player.set((s) => ({ ...s, volume: Number(e.target.value), muted: false }))
            }
          />
        </div>
        <label className="global-search">
          <Search size={16} />
          <input
            ref={search}
            aria-label="Search library"
            placeholder="Search your library"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (['home', 'sources', 'settings', 'jellyfin'].includes(view)) setView('music');
            }}
          />
          {query && (
            <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-group">
            <span className="sidebar-label">LIBRARY</span>
            {nav.map((n) => (
              <button
                key={n.id}
                className={view === n.id ? 'active' : ''}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={17} />
                <span>{n.label}</span>
                {n.id === 'music' && library.items.length > 0 && (
                  <small>{allItems.filter((i) => i.kind === 'music').length}</small>
                )}
              </button>
            ))}
          </div>
          <div className="sidebar-group">
            <span className="sidebar-label">YOUR COLLECTION</span>
            <button
              className={view === 'favorites' ? 'active' : ''}
              onClick={() => navigate('favorites')}
            >
              <Heart size={16} />
              <span>Favorites</span>
            </button>
            <button
              className={view === 'recent' ? 'active' : ''}
              onClick={() => navigate('recent')}
            >
              <Sparkles size={16} />
              <span>Recently added</span>
            </button>
          </div>
          <div className="sidebar-group playlist-nav">
            <div className="sidebar-label">
              PLAYLISTS
              <button
                className="icon-button"
                aria-label="Create playlist"
                onClick={() => setPlaylistDialog(true)}
              >
                <Plus size={14} />
              </button>
            </div>
            {library.playlists.map((p) => (
              <button
                key={p.id}
                className={view === `playlist:${p.id}` ? 'active' : ''}
                onClick={() => navigate(`playlist:${p.id}`)}
                onDragOver={(e) => {
                  if (!p.rule) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('application/elysium-item');
                  if (!id || p.rule) return;
                  void native('update_playlist', { id: p.id, itemIds: [...p.itemIds, id] })
                    .then(refresh)
                    .then(() => notify(`Added to ${p.name}`))
                    .catch((e) => notify(String(e)));
                }}
              >
                {p.rule ? <Sparkles size={15} /> : <ListMusic size={15} />}
                <span>{p.name}</span>
              </button>
            ))}
            {!library.playlists.length && (
              <button className="new-playlist" onClick={() => setPlaylistDialog(true)}>
                <Plus size={15} />
                Your first playlist
              </button>
            )}
          </div>
          <div className="sidebar-group sources-nav">
            <span className="sidebar-label">CONNECTED</span>
            <button
              className={view === 'sources' ? 'active' : ''}
              onClick={() => navigate('sources')}
            >
              <FolderOpen size={17} />
              <span>Library folders</span>
              <span
                className={`connection-dot ${library.sources.some((s) => s.online) ? 'online' : ''}`}
              />
            </button>
            <button
              className={view === 'jellyfin' ? 'active' : ''}
              onClick={() => navigate('jellyfin')}
            >
              <Server size={16} />
              <span>Jellyfin</span>
              {remotes.length > 0 && <span className="connection-dot online" />}
            </button>
          </div>
          <div className="sidebar-bottom">
            <Artwork item={current} label={current ? undefined : 'First Light'} />
            <div>
              <span>{current?.album || current?.series || 'Made for your collection'}</span>
              <small>{current?.artist || 'Make yourself at home.'}</small>
            </div>
          </div>
          <button
            className={`preferences-link ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={16} />
            Preferences
          </button>
        </aside>

        <main className="content">
          <div
            className={`video-stage ${nowPlaying && current?.kind !== 'music' && current ? 'shown' : ''}`}
          >
            <div className="stage-top">
              <button onClick={() => setNowPlaying(false)}>
                <ArrowLeft size={16} />
                Library
              </button>
              <span>{current?.title}</span>
              <button
                className="icon-button"
                aria-label="Full screen"
                onClick={() => void fullScreen()}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <video
              ref={player.video}
              crossOrigin="anonymous"
              playsInline
              preload="metadata"
              onDoubleClick={() => void fullScreen()}
              onClick={() => void player.toggle()}
            >
              {subtitleUrl && (
                <track
                  key={subtitleUrl}
                  src={subtitleUrl}
                  kind="subtitles"
                  srcLang="en"
                  label={subtitleName}
                  default
                />
              )}
            </video>
            <div className="stage-controls">
              <button onClick={() => player.seek(playback.position - 10)}>−10s</button>
              <button
                className="primary"
                aria-label={playback.playing ? 'Pause video' : 'Play video'}
                onClick={() => void player.toggle()}
              >
                {playback.playing ? <Pause size={16} /> : <Play size={16} />}
                {playback.playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => player.seek(playback.position + 10)}>+10s</button>
              <label>
                Speed
                <select
                  aria-label="Playback speed"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => void attachSubtitle()}>
                <Subtitles size={16} />
                {subtitleName || 'Add subtitles'}
              </button>
              {subtitleUrl && (
                <button
                  className="icon-button"
                  aria-label="Remove subtitles"
                  onClick={() => {
                    URL.revokeObjectURL(subtitleUrl);
                    setSubtitleUrl('');
                    setSubtitleName('');
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>

          <div className={`music-stage ${nowPlaying && current?.kind === 'music' ? 'shown' : ''}`}>
            <div className="stage-top">
              <button onClick={() => setNowPlaying(false)}>
                <ArrowLeft size={16} />
                Library
              </button>
              <select
                aria-label="Visualizer preset"
                value={visualMode}
                onChange={(e) => setVisualMode(e.target.value)}
              >
                <option value="spectrum">Spectrum</option>
                <option value="waveform">Oscilloscope</option>
                <option value="ambient">Ambient</option>
              </select>
              <button
                className="icon-button"
                aria-label="Full screen visualizer"
                onClick={() => void fullScreen()}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <div className="now-playing-art">
              <Artwork item={current} />
              <div>
                <p className="eyebrow">NOW PLAYING</p>
                <h1>{current?.title}</h1>
                <p>{current?.artist}</p>
                <small>{current?.album}</small>
              </div>
            </div>
            <Visualizer player={player} mode={visualMode} large />
          </div>

          <div className={`library-content ${nowPlaying && current ? 'covered' : ''}`}>
            {!loaded ? (
              <div className="loading-library">
                <LoaderCircle className="spin" />
                <p>Opening your library…</p>
              </div>
            ) : !allItems.length && !['sources', 'settings', 'jellyfin'].includes(view) ? (
              <EmptyCollection
                add={() => setSourceDialog(true)}
                files={() => void importFiles()}
                samples={() => void samples()}
                busy={!!busy}
              />
            ) : view === 'sources' ? (
              <SourcesView
                sources={library.sources}
                scan={(s) => void scan(s)}
                rebind={(s) => void rebind(s)}
                add={() => setSourceDialog(true)}
                busy={!!busy}
              />
            ) : view === 'jellyfin' ? (
              <div className="settings-view">
                <p className="eyebrow">YOUR HOME SERVER</p>
                <h1>Connect Jellyfin</h1>
                <p>Bring your server’s music, movies, and shows into Elysium.</p>
                {remotes.map((remote) => (
                  <div className="server-connected" key={remote.serverId}>
                    <Server />
                    <div>
                      <strong>{remote.serverName}</strong>
                      <p>
                        {remote.userName} · {remote.items.length} items
                      </p>
                    </div>
                    <button onClick={() => navigate('music')}>Music</button>
                    <button onClick={() => navigate('movies')}>Movies</button>
                    <button
                      onClick={() =>
                        void native('disconnect_jellyfin', { serverId: remote.serverId })
                          .then(() => {
                            if (current?.serverId === remote.serverId) player.element()?.pause();
                            setRemotes((r) => r.filter((s) => s.serverId !== remote.serverId));
                          })
                          .catch((e) => notify(String(e)))
                      }
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
                <form className="server-form" onSubmit={(e) => void connectServer(e)}>
                  <label>
                    Server address
                    <input
                      placeholder="http://your-nas:8096"
                      value={serverAddress}
                      onChange={(e) => setServerAddress(e.target.value)}
                      required
                      type="url"
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Username
                      <input
                        autoComplete="username"
                        value={serverUser}
                        onChange={(e) => setServerUser(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="form-note">
                    Sessions stay in memory. Sign in again when you reopen Elysium. This test build
                    supports direct-play streams and reports playback progress.
                  </p>
                  {serverError && (
                    <p className="error-message" role="alert">
                      {serverError}
                    </p>
                  )}
                  <button className="primary" disabled={!!busy}>
                    <Server size={16} />
                    Connect server
                  </button>
                </form>
              </div>
            ) : view === 'settings' ? (
              <div className="settings-view">
                <p className="eyebrow">MAKE YOURSELF AT HOME</p>
                <h1>Preferences</h1>
                <section>
                  <h2>Appearance</h2>
                  <div className="theme-choices">
                    <button
                      className={theme === 'silver' ? 'selected' : ''}
                      onClick={() => setTheme('silver')}
                    >
                      <div className="theme-swatch silver" />
                      <span>Classic Silver</span>
                      {theme === 'silver' && <Check size={15} />}
                    </button>
                    <button
                      className={theme === 'graphite' ? 'selected' : ''}
                      onClick={() => setTheme('graphite')}
                    >
                      <div className="theme-swatch graphite" />
                      <span>Graphite</span>
                      {theme === 'graphite' && <Check size={15} />}
                    </button>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={compact}
                      onChange={(e) => setCompact(e.target.checked)}
                    />
                    <span>
                      Compact song rows<small>More of your collection at a glance.</small>
                    </span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={browser}
                      onChange={(e) => setBrowser(e.target.checked)}
                    />
                    <span>Show the genre, artist, and album browser</span>
                  </label>
                </section>
                <section>
                  <h2>Sound & visuals</h2>
                  <label>
                    Visualizer
                    <select value={visualMode} onChange={(e) => setVisualMode(e.target.value)}>
                      <option value="spectrum">Spectrum</option>
                      <option value="waveform">Oscilloscope</option>
                      <option value="ambient">Ambient</option>
                    </select>
                  </label>
                  <div className="eq-sliders">
                    {(['low', 'mid', 'high'] as const).map((key) => (
                      <label key={key}>
                        {key === 'low' ? 'Bass' : key === 'mid' ? 'Mid' : 'Treble'}
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={player.eq[key]}
                          onChange={(e) =>
                            player.setEq((eq) => ({ ...eq, [key]: Number(e.target.value) }))
                          }
                        />
                        <span>
                          {player.eq[key] > 0 ? '+' : ''}
                          {player.eq[key]} dB
                        </span>
                      </label>
                    ))}
                  </div>
                  <button onClick={() => player.setEq({ low: 0, mid: 0, high: 0 })}>
                    Reset equalizer
                  </button>
                </section>
                <section>
                  <h2>Your library</h2>
                  <p>
                    Back up your metadata, playlists, source locations, and listening history. Your
                    media files stay in their original folders.
                  </p>
                  <div className="settings-actions">
                    <button onClick={() => void exportBackup()}>
                      <Download size={16} />
                      Export backup
                    </button>
                    <button onClick={() => void restoreBackup()}>
                      <Upload size={16} />
                      Restore backup
                    </button>
                    <button onClick={() => void samples()} disabled={!!busy}>
                      <Music2 size={16} />
                      Add sample library
                    </button>
                  </div>
                </section>
                <section>
                  <h2>Elysium 0.1.0</h2>
                  <p>An independent music and video player by ooberguts.</p>
                  <button onClick={() => setHelp(true)}>
                    <CircleHelp size={16} />
                    About this test release
                  </button>
                </section>
              </div>
            ) : view === 'home' && !query ? (
              <div className="home-view">
                <div className="home-intro">
                  <div>
                    <p className="eyebrow">WELCOME TO YOUR COLLECTION</p>
                    <h1>
                      A little more
                      <br />
                      listening. A little less noise.
                    </h1>
                    <p>
                      {allItems.filter((i) => i.kind === 'music').length} songs.{' '}
                      {allItems.filter((i) => i.kind !== 'music').length} stories. All yours.
                    </p>
                    <button className="primary" onClick={() => navigate('music')}>
                      <Music2 size={16} />
                      Explore your music
                    </button>
                  </div>
                  <div className="home-album-stack">
                    {albumGroups(allItems.filter((i) => i.kind === 'music'))
                      .slice(0, 3)
                      .map((group, index) => (
                        <button
                          key={group.key}
                          style={{ '--stack-index': index } as React.CSSProperties}
                          onClick={() => play(group.items[0], group.items)}
                          aria-label={`Play ${group.name}`}
                        >
                          <Artwork item={group.items[0]} />
                        </button>
                      ))}
                  </div>
                </div>
                {allItems.some((i) => i.resume > 0 && i.kind !== 'music') && (
                  <section>
                    <div className="section-heading">
                      <h2>Continue watching</h2>
                    </div>
                    <MediaCards
                      items={allItems.filter((i) => i.resume > 0 && i.kind !== 'music').slice(0, 6)}
                      play={(i) => play(i)}
                      detail={(i) => setDetailId(i.id)}
                    />
                  </section>
                )}
                <section>
                  <div className="section-heading">
                    <h2>Back to your albums</h2>
                    <button className="text-button" onClick={() => navigate('albums')}>
                      View all
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="album-grid home-albums">
                    {albumGroups(allItems.filter((i) => i.kind === 'music'))
                      .slice(0, 6)
                      .map((group) => (
                        <article className="album-card" key={group.key}>
                          <button
                            className="cover-button"
                            onClick={() => {
                              navigate('music');
                              setAlbum(group.items[0].album);
                              setArtist(
                                group.items[0].albumArtist ||
                                  group.items[0].artist ||
                                  'Unknown artist',
                              );
                            }}
                          >
                            <Artwork item={group.items[0]} />
                            <span
                              className="cover-play"
                              onClick={(e) => {
                                e.stopPropagation();
                                play(group.items[0], group.items);
                              }}
                            >
                              <Play size={20} fill="currentColor" />
                            </span>
                          </button>
                          <h3>{group.name}</h3>
                          <p>{group.artist}</p>
                        </article>
                      ))}
                  </div>
                </section>
                {allItems.some((i) => i.kind === 'movie') && (
                  <section>
                    <div className="section-heading">
                      <h2>Tonight’s possibilities</h2>
                      <button className="text-button" onClick={() => navigate('movies')}>
                        View movies
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <MediaCards
                      items={allItems.filter((i) => i.kind === 'movie').slice(0, 6)}
                      play={(i) => play(i)}
                      detail={(i) => setDetailId(i.id)}
                    />
                  </section>
                )}
              </div>
            ) : (
              <>
                <div className="view-header">
                  <div>
                    <p className="eyebrow">
                      {selectedPlaylist
                        ? selectedPlaylist.rule
                          ? 'SMART PLAYLIST'
                          : 'YOUR PLAYLIST'
                        : 'YOUR LIBRARY'}
                    </p>
                    <h1>{selectedPlaylist?.name || names[view]}</h1>
                    <p>
                      {selectedPlaylist
                        ? `${filtered.length} items · ${seconds(filtered.reduce((sum, i) => sum + i.duration, 0))}`
                        : subtitles[view]}
                    </p>
                  </div>
                  <div className="view-header-actions">
                    <button
                      className="subtle-button"
                      disabled={!filtered.length}
                      onClick={() => play(filtered[0])}
                    >
                      <Play size={15} fill="currentColor" />
                      Play
                    </button>
                    <button className="primary" onClick={() => void importFiles()}>
                      <Plus size={16} />
                      Add media
                    </button>
                  </div>
                </div>
                <div className="view-controls">
                  <div className="segmented">
                    <button
                      aria-label="List view"
                      className={!grid ? 'active' : ''}
                      onClick={() => setGrid(false)}
                    >
                      <ListMusic size={16} />
                    </button>
                    <button
                      aria-label="Artwork view"
                      className={grid ? 'active' : ''}
                      onClick={() => setGrid(true)}
                    >
                      <Grid2X2 size={16} />
                    </button>
                  </div>
                  {['music', 'favorites', 'recent'].includes(view) && (
                    <button
                      className={`icon-button browser-toggle ${browser ? 'active' : ''}`}
                      aria-label="Toggle column browser"
                      aria-pressed={browser}
                      onClick={() => setBrowser(!browser)}
                    >
                      <Columns3 size={17} />
                    </button>
                  )}
                  <span className="selection-label">
                    {selected.size ? `${selected.size} selected` : `${filtered.length} items`}
                  </span>
                  {selected.size > 0 && (
                    <>
                      <button className="small-button" onClick={() => setInfoIds([...selected])}>
                        <Info size={14} />
                        Get Info
                      </button>
                      <AddToPlaylist
                        playlists={library.playlists}
                        add={(id) => void addToPlaylist(id)}
                        disabled={![...selected].some((id) => !id.includes(':'))}
                      />
                    </>
                  )}
                  {view === 'tv' && (
                    <select
                      className="compact-select"
                      aria-label="Filter series"
                      value={series}
                      onChange={(e) => setSeries(e.target.value)}
                    >
                      <option value="">All series</option>
                      {unique(baseItems.map((i) => i.series)).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  )}
                  <div className="sort-control">
                    <ArrowDownAZ size={15} />
                    <select
                      aria-label="Sort library"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      {selectedPlaylist && <option value="playlist">Playlist order</option>}
                      <option value="title">Name</option>
                      <option value="artist">Artist</option>
                      <option value="album">Album</option>
                      <option value="added">Recently added</option>
                      <option value="rating">Rating</option>
                    </select>
                  </div>
                  {selectedPlaylist && (
                    <details>
                      <summary aria-label="Playlist actions">
                        <ChevronDown size={16} />
                      </summary>
                      <div className="context-menu align-right">
                        <button
                          onClick={async () => {
                            const path = await savePath(`${selectedPlaylist.name}.m3u8`, 'm3u8');
                            if (path)
                              await native('export_playlist', { id: selectedPlaylist.id, path })
                                .then(() => notify('Playlist exported'))
                                .catch((e) => notify(String(e)));
                          }}
                        >
                          <Download size={14} />
                          Export M3U8
                        </button>
                        {!selectedPlaylist.rule && selected.size > 0 && (
                          <button
                            onClick={() =>
                              void native('update_playlist', {
                                id: selectedPlaylist.id,
                                itemIds: selectedPlaylist.itemIds.filter((id) => !selected.has(id)),
                              })
                                .then(refresh)
                                .then(() => setSelected(new Set()))
                                .catch((e) => notify(String(e)))
                            }
                          >
                            Remove selected entries
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                {browser && ['music', 'favorites', 'recent'].includes(view) && !grid && (
                  <div className="column-browser">
                    {[
                      {
                        title: 'Genre',
                        values: filteredGenres,
                        value: genre,
                        change: (v: string) => {
                          setGenre(v);
                          setArtist('');
                          setAlbum('');
                        },
                      },
                      {
                        title: 'Artist',
                        values: filteredArtists,
                        value: artist,
                        change: (v: string) => {
                          setArtist(v);
                          setAlbum('');
                        },
                      },
                      { title: 'Album', values: filteredAlbums, value: album, change: setAlbum },
                    ].map((column) => (
                      <div key={column.title}>
                        <span className="column-label">{column.title}</span>
                        <div className="column-values">
                          <button
                            className={!column.value ? 'selected' : ''}
                            onClick={() => column.change('')}
                          >
                            All{' '}
                            {column.title.toLowerCase() === 'genre'
                              ? 'genres'
                              : column.title.toLowerCase() === 'artist'
                                ? 'artists'
                                : 'albums'}
                            <small>{column.values.length}</small>
                          </button>
                          {column.values.map((value) => (
                            <button
                              key={value}
                              className={column.value === value ? 'selected' : ''}
                              onClick={() => column.change(value)}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {view === 'movies' || view === 'tv' ? (
                  <div className="grid-scroll">
                    <MediaCards
                      items={filtered}
                      play={(i) => play(i)}
                      detail={(i) => setDetailId(i.id)}
                      television={view === 'tv'}
                    />
                    {!filtered.length && (
                      <div className="empty-filter">
                        <Film />
                        <h3>No {view === 'tv' ? 'episodes' : 'movies'} here yet</h3>
                        <p>Add a media folder or try the sample library.</p>
                      </div>
                    )}
                  </div>
                ) : view === 'albums' || grid ? (
                  <div className="grid-scroll">
                    <div className="album-grid">
                      {albums.map((group) => (
                        <article key={group.key} className="album-card">
                          <button
                            className="cover-button"
                            onClick={() => {
                              navigate('music');
                              setAlbum(group.items[0].album);
                              setArtist(
                                group.items[0].albumArtist ||
                                  group.items[0].artist ||
                                  'Unknown artist',
                              );
                            }}
                          >
                            <Artwork item={group.items[0]} />
                            <span
                              className="cover-play"
                              onClick={(e) => {
                                e.stopPropagation();
                                play(group.items[0], group.items);
                              }}
                            >
                              <Play size={20} fill="currentColor" />
                            </span>
                          </button>
                          <h3>{group.name}</h3>
                          <p>{group.artist}</p>
                          <small>{group.items.length} tracks</small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : view === 'artists' ? (
                  <div className="grid-scroll artist-grid">
                    {artists.map((name) => {
                      const group = filtered.filter(
                        (i) => (i.albumArtist || i.artist || 'Unknown artist') === name,
                      );
                      return (
                        <button
                          className="artist-card"
                          key={name}
                          onClick={() => {
                            navigate('music');
                            setArtist(name);
                          }}
                        >
                          <Artwork item={group[0]} label={name} />
                          <h3>{name}</h3>
                          <p>
                            {group.length} songs · {albumGroups(group).length} albums
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <TrackTable
                    items={filtered}
                    selected={selected}
                    currentId={playback.currentId}
                    play={(i) => play(i)}
                    select={select}
                    favorite={(i) => void favorite(i)}
                    info={(i) => setInfoIds([i.id])}
                    enqueue={player.enqueue}
                    compact={compact}
                  />
                )}
              </>
            )}
          </div>
        </main>

        {queueOpen && (
          <aside className="queue-drawer">
            <div className="queue-heading">
              <div>
                <p className="eyebrow">YOUR SOUNDTRACK</p>
                <h2>Up Next</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close queue"
                onClick={() => setQueueOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="queue-items">
              {playback.queue.map((id, index) => {
                const item = allItems.find((i) => i.id === id);
                if (!item) return null;
                return (
                  <div
                    className={`queue-item ${index === playback.index ? 'active' : ''}`}
                    key={`${index}:${id}`}
                  >
                    <button className="queue-item-main" onClick={() => void player.jump(index)}>
                      <Artwork item={item} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.artist || item.series || item.format}</small>
                      </span>
                    </button>
                    <div className="queue-item-actions">
                      <button
                        className="icon-button"
                        aria-label={`Move ${item.title} earlier`}
                        disabled={index <= playback.index + 1}
                        onClick={() =>
                          player.set((s) => {
                            const queue = [...s.queue];
                            [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]];
                            return { ...s, queue };
                          })
                        }
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${item.title} from queue`}
                        disabled={index === playback.index}
                        onClick={() =>
                          player.set((s) => ({
                            ...s,
                            queue: s.queue.filter((_, i) => i !== index),
                            index: index < s.index ? s.index - 1 : s.index,
                          }))
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!playback.queue.length && (
                <p className="queue-empty">Play an album or add something to your queue.</p>
              )}
            </div>
            <button
              className="text-button"
              onClick={() =>
                player.set((s) => ({
                  ...s,
                  queue: s.currentId ? [s.currentId] : [],
                  index: s.currentId ? 0 : -1,
                }))
              }
            >
              Clear upcoming items
            </button>
          </aside>
        )}
      </div>

      <div className="status-bar">
        <span>
          {busy ? (
            <>
              <LoaderCircle size={12} className="spin" />
              {progress ? `${busy} ${progress.processed} files · ${progress.current}` : busy}
            </>
          ) : (
            <>
              <span className="connection-dot online" />
              {allItems.length
                ? `${allItems.length} media items · ${library.sources.filter((s) => s.online).length} connected folders`
                : 'Ready for your collection'}
            </>
          )}
        </span>
        {busy && progress && (
          <button className="text-button" onClick={() => void native('cancel_scan')}>
            Stop scan
          </button>
        )}
        <span>{selected.size ? `${selected.size} selected` : 'LOCAL FIRST. ALWAYS YOURS.'}</span>
      </div>

      <div className="mini-header">
        <span>ELYSIUM</span>
        <button
          className="icon-button"
          aria-label={pinned ? 'Unpin mini player' : 'Pin mini player'}
          aria-pressed={pinned}
          onClick={() => void togglePin()}
        >
          <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
        </button>
        <button onClick={() => void toggleMini()}>
          <Maximize2 size={13} />
          Library
        </button>
      </div>
      <footer className="player-footer">
        <button
          className="now-art-button"
          aria-label="Open Now Playing"
          onClick={() => setNowPlaying(!nowPlaying)}
        >
          <Artwork item={current} />
        </button>
        <div className="footer-info">
          <button className="track-title-button" onClick={() => setNowPlaying(!nowPlaying)}>
            {current?.title || 'Nothing playing yet'}
          </button>
          <span>
            {current?.artist ||
              current?.series ||
              (current
                ? [current.year, current.kind === 'movie' ? 'Movie' : current.format]
                    .filter(Boolean)
                    .join(' · ')
                : 'Pick something you love.')}
          </span>
          {current && !current.serverId && (
            <Rating item={current} rate={(n) => void rating(current, n)} />
          )}
        </div>
        <button
          className={`icon-button footer-heart ${current?.favorite ? 'loved' : ''}`}
          aria-label="Favorite current item"
          disabled={!current}
          onClick={() => current && void favorite(current)}
        >
          <Heart size={18} fill={current?.favorite ? 'currentColor' : 'none'} />
        </button>
        <div className="footer-playback">
          <div className="footer-transport">
            <button
              className={`icon-button ${playback.shuffle ? 'active' : ''}`}
              aria-label="Shuffle"
              aria-pressed={playback.shuffle}
              onClick={player.toggleShuffle}
            >
              <Shuffle size={15} />
            </button>
            <div className="mini-transport">{transport}</div>
            <button
              className={`icon-button ${playback.repeat !== 'off' ? 'active' : ''}`}
              aria-label={`Repeat: ${playback.repeat}`}
              onClick={() =>
                player.set((s) => ({
                  ...s,
                  repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
                }))
              }
            >
              {playback.repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>
          </div>
          <div className="seek-row">
            <span>{seconds(playback.position)}</span>
            <input
              type="range"
              aria-label="Playback position"
              min="0"
              max={playback.duration || 1}
              step="0.1"
              value={Math.min(playback.position, playback.duration || 1)}
              onChange={(e) => player.seek(Number(e.target.value))}
              disabled={!current}
            />
            <span>{seconds(playback.duration)}</span>
          </div>
        </div>
        <div className="footer-visual">
          <Visualizer player={player} mode={visualMode} />
        </div>
        <div className="footer-actions">
          <button
            className={`icon-button ${eqOpen ? 'active' : ''}`}
            aria-label="Equalizer"
            onClick={() => setEqOpen(!eqOpen)}
          >
            <SlidersHorizontal size={18} />
          </button>
          <button
            className={`icon-button ${queueOpen ? 'active' : ''}`}
            aria-label="Open queue"
            aria-pressed={queueOpen}
            onClick={() => setQueueOpen(!queueOpen)}
          >
            <ListMusic size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Now Playing"
            onClick={() => setNowPlaying(!nowPlaying)}
          >
            <Maximize2 size={17} />
          </button>
        </div>
      </footer>
      {mini && (
        <div className="mini-seek">
          <span>{seconds(playback.position)}</span>
          <input
            type="range"
            aria-label="Mini player playback position"
            min="0"
            max={playback.duration || 1}
            value={Math.min(playback.position, playback.duration || 1)}
            step=".1"
            onChange={(e) => player.seek(Number(e.target.value))}
          />
          <span>{seconds(playback.duration)}</span>
        </div>
      )}
      {eqOpen && (
        <div className="eq-popover">
          <div>
            <h3>Equalizer</h3>
            <button
              className="icon-button"
              aria-label="Close equalizer"
              onClick={() => setEqOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="eq-sliders">
            {(['low', 'mid', 'high'] as const).map((key) => (
              <label key={key}>
                {key === 'low' ? 'Bass' : key === 'mid' ? 'Mid' : 'Treble'}
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={player.eq[key]}
                  onChange={(e) => player.setEq((eq) => ({ ...eq, [key]: Number(e.target.value) }))}
                />
                <span>{player.eq[key]} dB</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {(player.error || player.preparing) && (
        <div
          className={`playback-message ${player.error ? 'error' : ''}`}
          role={player.error ? 'alert' : 'status'}
        >
          {player.preparing ? (
            <>
              <LoaderCircle size={17} className="spin" />
              Preparing a compatible copy. This may take a moment; your original is unchanged.
            </>
          ) : (
            player.error
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!desktop && (
        <div className="browser-notice">
          Desktop preview · use <code>npm run desktop</code> to open your library and play media.
        </div>
      )}
      {sourceDialog && <AddSourceDialog close={() => setSourceDialog(false)} add={addSource} />}
      {playlistDialog && (
        <PlaylistDialog
          close={() => setPlaylistDialog(false)}
          create={async (name, rule) => {
            const list = await native<Playlist>('create_playlist', { name, rule });
            await refresh();
            navigate(`playlist:${list.id}`);
            notify('Playlist created');
          }}
        />
      )}
      {infoItems.length > 0 && (
        <MetadataDialog
          key={infoIds.join(',')}
          items={infoItems}
          close={() => setInfoIds([])}
          changed={refresh}
          notify={notify}
          activeId={playback.currentId}
        />
      )}
      {detail && (
        <VideoDetail
          item={detail}
          close={() => setDetailId(null)}
          play={() => play(detail)}
          info={() => {
            setDetailId(null);
            setInfoIds([detail.id]);
          }}
          watched={() =>
            void native('set_watched', { id: detail.id, watched: !detail.watched })
              .then(refresh)
              .catch((e) => notify(String(e)))
          }
        />
      )}
      {help && (
        <Modal title="Welcome to Elysium" close={() => setHelp(false)}>
          <div className="help-copy">
            <p className="eyebrow">VERSION 0.1.0 · TEST RELEASE</p>
            <h3>A new home for your collection.</h3>
            <p>
              Add a folder or try the original sample library. Double-click a song to play it. Use
              Get Info to edit one or several selected items. Drag songs onto a playlist, or use the
              selection toolbar.
            </p>
            <p>
              <strong>Keyboard:</strong> Space plays/pauses. Cmd/Ctrl+F searches. Cmd/Ctrl+I opens
              information for selected items.
            </p>
            <p>
              Music and video use your operating system’s media support. Unsupported local formats
              are prepared as compatible cached copies with FFmpeg. Large videos can take time to
              prepare.
            </p>
            <p>
              This build includes MP3/FLAC tag writes with backups, local NFO reading/export,
              mounted network folders, and Jellyfin direct play. Gapless playback, automatic movie
              artwork, Jellyfin transcoding, original WMP skin import, and Linux qualification are
              upcoming work.
            </p>
            <p>
              FFmpeg is distributed under its included GPL terms. Music metadata lookup uses
              MusicBrainz; suggestions are applied only when you choose them.
            </p>
            <div className="dialog-actions">
              <button className="primary" onClick={() => setHelp(false)}>
                Make yourself at home
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
