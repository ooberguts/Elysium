import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Album,
  BookOpen,
  AudioLines,
  Radio,
  ArrowDownAZ,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  MonitorPlay,
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
  Square,
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
  Modal,
  PlaylistDialog,
  PlaylistEditDialog,
  Rating,
  SourcesView,
  TrackTable,
  VideoDetail,
} from './components';
import { chooseFiles, chooseFolder, desktop, loadLibrary, native, open, savePath } from './bridge';
import {
  albumGroups,
  albumKey,
  albumArtworkItem,
  artistItems,
  filterItems,
  isAudio,
  playlistItems,
  seconds,
  unique,
  viewItems,
} from './domain';
import { usePlayer } from './player';
import { Visualizer, VisualizerOptions } from './visualizers/Visualizer';
import { PresetGallery } from './visualizers/PresetGallery';
import { useAudioCapture, type AudioDevice } from './visualizers/capture';
import { AudioSourceDialog } from './visualizers/AudioSourceDialog';
import { useBroadcast } from './broadcast/useBroadcast';
import { BroadcastPanel } from './broadcast/BroadcastPanel';
import { BroadcastPreferences } from './broadcast/BroadcastPreferences';
import { BroadcastTransport } from './broadcast/BroadcastTransport';
import { Audiobooks } from './Audiobooks';
import { MetadataDialog } from './MetadataEditor';
import { ContextMenu, type MenuAction } from './ContextMenu';
import { contextSelection } from './selection';
import { AppUpdates, useUpdates } from './updates';
import { CollectionPage } from './CollectionPage';
import { useNavigation } from './navigation';
const BroadcastVideo = lazy(() =>
  import('./broadcast/VideoPlayer').then((m) => ({ default: m.BroadcastVideo })),
);
import {
  VISUALIZER_PRESETS,
  getVisualizer,
  stepVisualizer,
  randomVisualizer,
  VISUALIZER_FAMILIES,
  type VisualizerQuality,
} from './visualizers/catalog';
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
import './polish.css';

const nav = [
  { id: 'home', label: 'Listen & watch', icon: Home },
  { id: 'music', label: 'Songs', icon: Music2 },
  { id: 'albums', label: 'Albums', icon: Album },
  { id: 'artists', label: 'Artists', icon: Mic2 },
  { id: 'audiobooks', label: 'Audiobooks', icon: BookOpen },
  { id: 'movies', label: 'Movies', icon: Film },
  { id: 'tv', label: 'TV shows', icon: Tv },
] as const;
const names: Record<string, string> = {
  home: 'Listen & watch',
  music: 'Music',
  albums: 'Albums',
  artists: 'Artists',
  audiobooks: 'Audiobooks',
  movies: 'Movies',
  tv: 'TV shows',
  favorites: 'Favorites',
  recent: 'Recently added',
  sources: 'Sources',
  jellyfin: 'Jellyfin',
  broadcast: 'Listen to broadcasts',
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
  const updates = useUpdates();
  const navigation = useNavigation();
  const { view, setView } = navigation;
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY),
    [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState(''),
    [series, setSeries] = useState('');
  const [theme, setTheme] = useState('silver'),
    [compact, setCompact] = useState(false),
    [grid, setGrid] = useState(false),
    [sort, setSort] = useState('title');
  const [mini, setMini] = useState(false),
    [pinned, setPinned] = useState(true),
    [queueOpen, setQueueOpen] = useState(false),
    [nowPlaying, setNowPlaying] = useState(false),
    [visualizerOnly, setVisualizerOnly] = useState(false),
    [visualMode, setVisualMode] = useState('album-art'),
    [visualQuality, setVisualQuality] = useState<VisualizerQuality>('balanced'),
    [visualAuto, setVisualAuto] = useState(false),
    [visualInfo, setVisualInfo] = useState(true),
    [visualReduced, setVisualReduced] = useState(false),
    [visualIntensity, setVisualIntensity] = useState(1),
    [visualGallery, setVisualGallery] = useState(false),
    [theater, setTheater] = useState(false),
    [visualExternal, setVisualExternal] = useState(false),
    [audioSourceOpen, setAudioSourceOpen] = useState(false),
    [eqOpen, setEqOpen] = useState(false);
  const [sourceDialog, setSourceDialog] = useState(false),
    [playlistDialog, setPlaylistDialog] = useState(false),
    [playlistEdit, setPlaylistEdit] = useState<Playlist | null>(null),
    [playlistDelete, setPlaylistDelete] = useState<Playlist | null>(null),
    [playlistDeleteBusy, setPlaylistDeleteBusy] = useState(false),
    [lanNotice, setLanNotice] = useState(false),
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
    selectedAnchor = useRef(0),
    lanPreferences = useRef<HTMLElement>(null),
    focusLanPreferences = useRef(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 7000);
  }, []);
  const refresh = useCallback(async () => {
    const data = await loadLibrary();
    setLibrary(data);
  }, []);
  const artistArtwork = useMemo<Record<string, string>>(() => {
    try {
      const value: unknown = JSON.parse(library.settings.artistArtwork || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }, [library.settings.artistArtwork]);
  const artistImage = (name: string) =>
    Object.hasOwn(artistArtwork, name) ? artistArtwork[name] : undefined;
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
  const capture = useAudioCapture();
  const broadcast = useBroadcast();
  useEffect(() => {
    if (broadcast.error) notify(broadcast.error);
  }, [broadcast.error, notify]);
  const seenInvitations = useRef(new Set<string>());
  const wasBroadcasting = useRef(false);
  useEffect(() => {
    const active = !!broadcast.state.station?.active;
    if (wasBroadcasting.current && !active) void refresh().catch(() => {});
    wasBroadcasting.current = active;
  }, [broadcast.state.station?.active, refresh]);
  useEffect(() => {
    for (const invitation of broadcast.state.invitations) {
      if (!seenInvitations.current.has(invitation.id)) {
        seenInvitations.current.add(invitation.id);
        notify(`${invitation.name} invited this room. Open Listen to broadcasts to join.`);
      }
    }
  }, [broadcast.state.invitations, notify]);
  useEffect(() => {
    if (broadcast.active && playback.playing) {
      player.pause();
    }
  }, [broadcast.active, playback.playing, player.pause]);
  useEffect(() => {
    if (broadcast.state.enabled)
      void native('broadcast_activity', { busy: playback.playing || capture.running }).catch(
        () => {},
      );
  }, [broadcast.state.enabled, playback.playing, capture.running]);
  async function prepareBroadcast() {
    await player.stop();
    await capture.stop();
  }
  async function broadcastCurrent() {
    if (!current || current.serverId || !current.available) return;
    const wasPlaying = playback.playing;
    let pausedForHandoff = false;
    const remaining = playback.queue
      .slice(Math.max(0, playback.index))
      .filter((id) => library.items.some((item) => item.id === id && item.available));
    const itemIds =
      remaining[0] === current.id
        ? remaining
        : [current.id, ...remaining.filter((id) => id !== current.id)];
    if (!broadcast.state.enabled) {
      setLanNotice(true);
      return;
    }
    try {
      const position = player.element()?.currentTime ?? playback.position;
      player.pause();
      pausedForHandoff = true;
      await capture.stop();
      await broadcast.call('broadcast_start', {
        request: {
          name: Array.from(current.title).slice(0, 80).join('') || 'Now playing',
          itemIds,
          mode: 'once',
          minutes: 60,
          finishTrack: true,
          resumeBooks: false,
          startPosition: position,
          shuffle: false,
          playHere: true,
          outputDevice: broadcast.state.outputDevice || null,
        },
      });
      setVisualizerOnly(false);
      setNowPlaying(true);
      notify('Broadcast started. Other rooms can join from Listen to broadcasts.');
    } catch {
      if (wasPlaying && pausedForHandoff) void player.toggle();
    }
  }
  async function setLanEnabled(enabled: boolean, name: string) {
    try {
      await broadcast.call(
        enabled ? 'broadcast_enable' : 'broadcast_disable',
        enabled ? { name: name.trim() || 'This computer' } : undefined,
      );
      await refresh();
      notify(enabled ? 'LAN broadcasting is on.' : 'LAN broadcasting is off.');
    } catch {
      /* The broadcast hook reports the error. */
    }
  }
  function openLanPreferences() {
    setLanNotice(false);
    focusLanPreferences.current = true;
    if (view === 'settings') {
      requestAnimationFrame(() => {
        lanPreferences.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        lanPreferences.current
          ?.querySelector<HTMLInputElement>('input[role="switch"]')
          ?.focus({ preventScroll: true });
        focusLanPreferences.current = false;
      });
    } else navigate('settings');
  }
  const [showControls, setShowControls] = useState(true);
  useEffect(() => {
    if (!theater || !nowPlaying || mini) return;
    let timer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setShowControls(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowControls(false), 3000);
    };
    reveal();
    window.addEventListener('pointermove', reveal);
    window.addEventListener('pointerdown', reveal);
    window.addEventListener('keydown', reveal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', reveal);
      window.removeEventListener('pointerdown', reveal);
      window.removeEventListener('keydown', reveal);
    };
  }, [theater, nowPlaying, mini]);
  const broadcastVideoStage = nowPlaying && !!broadcast.state.video && !visualizerOnly;
  const musicStage =
    nowPlaying &&
    !broadcastVideoStage &&
    (broadcast.active || visualizerOnly || visualExternal || !current || isAudio(current));
  const visualCurrentItem = broadcast.active
    ? library.items.find(
        (item) =>
          item.title === broadcast.track?.title &&
          item.album === broadcast.track?.album &&
          (item.artist === broadcast.track?.artist || !broadcast.track?.artist),
      )
    : current;
  const visualArtworkItem = albumArtworkItem(visualCurrentItem, allItems);
  const visualActive = broadcast.active
    ? broadcast.running
    : visualExternal
      ? capture.running
      : playback.playing;
  async function chooseAudioDevice(device: AudioDevice) {
    if (broadcast.active) await broadcast.stop();
    if (playback.playing) await player.toggle();
    setVisualExternal(true);
    setNowPlaying(true);
    await capture.start(device);
  }
  useEffect(() => {
    if (!nowPlaying || mini || !visualExternal) void capture.stop();
  }, [nowPlaying, mini, visualExternal, capture.stop]);
  useEffect(() => {
    if (capture.running) setAudioSourceOpen(false);
  }, [capture.running]);
  const selectedPlaylist = library.playlists.find((p) => view === `playlist:${p.id}`);
  const baseItems = useMemo(() => viewItems(view, library, allItems), [view, library, allItems]);
  const filtered = useMemo(() => {
    const result = filterItems(baseItems, query, '', '', '').filter(
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
  }, [baseItems, query, series, sort, selectedPlaylist]);
  const albums = useMemo(() => albumGroups(filtered.filter((i) => i.kind === 'music')), [filtered]);
  const artists = unique(
    filtered
      .filter((i) => i.kind === 'music')
      .flatMap((i) =>
        [i.artist || i.albumArtist || 'Unknown artist', i.albumArtist].filter(Boolean),
      ),
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
  const navigate = useCallback(
    (next: View) => {
      setView(next);
      setSeries('');
      setQuery('');
      setSelected(new Set());
      setNowPlaying(false);
      if (next.startsWith('playlist:')) setSort('playlist');
    },
    [setView],
  );
  const openArtist = (name: string) => navigate(`artist:${name}`);
  const openAlbum = (item: MediaItem) => navigate(`album:${albumKey(item)}`);
  const collectionTitle = view.startsWith('artist:')
    ? view.slice(7)
    : view.startsWith('album:')
      ? baseItems[0]?.album || 'Untitled album'
      : '';
  const goBackOrForward = (direction: -1 | 1) => {
    setSeries('');
    setQuery('');
    setSelected(new Set());
    setNowPlaying(false);
    navigation.go(direction);
  };

  useEffect(() => {
    if (view === 'settings' && focusLanPreferences.current && lanPreferences.current) {
      focusLanPreferences.current = false;
      lanPreferences.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
      lanPreferences.current
        .querySelector<HTMLInputElement>('input[role="switch"]')
        ?.focus({ preventScroll: true });
    }
  }, [view]);
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
        if (data.settings.lanEnabled === 'true') {
          void broadcast
            .call('broadcast_enable', { name: data.settings.lanRoomName || 'This computer' })
            .catch(() => {});
        }
        if (
          data.items.some(
            (item) =>
              (item.kind === 'movie' || item.kind === 'tv') &&
              !item.artwork &&
              item.available &&
              !('artwork' in item.overrides),
          )
        ) {
          void native<number>('fill_video_artwork')
            .then((count) => {
              if (count) void refresh();
            })
            .catch(() => {});
        }
        setTheme(data.settings.theme || 'silver');
        setCompact(data.settings.compact === 'true');
        setVisualMode(
          !data.settings.visualMode ||
            data.settings.visualMode === 'album-art' ||
            (!data.settings.visualDefaultVersion && data.settings.visualMode === 'current')
            ? 'album-art'
            : getVisualizer(data.settings.visualMode).id,
        );
        setVisualQuality(data.settings.visualQuality === 'high' ? 'high' : 'balanced');
        setVisualAuto(data.settings.visualAuto === 'true');
        setVisualInfo(data.settings.visualInfo !== 'false');
        setVisualReduced(data.settings.visualReduced === 'true');
        const savedIntensity = Number(data.settings.visualIntensity);
        setVisualIntensity(
          Number.isFinite(savedIntensity) && savedIntensity >= 0.5 && savedIntensity <= 1.5
            ? savedIntensity
            : 1,
        );
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
          visualMode,
          visualDefaultVersion: '2',
          visualQuality,
          visualAuto: String(visualAuto),
          visualInfo: String(visualInfo),
          visualReduced: String(visualReduced),
          visualIntensity: String(visualIntensity),
          serverAddress,
        },
      }).catch((e) => notify(String(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [
    theme,
    compact,
    visualMode,
    visualQuality,
    visualAuto,
    visualInfo,
    visualReduced,
    visualIntensity,
    serverAddress,
    loaded,
    notify,
  ]);
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
          const count = await native<number>('import_files', {
            paths,
            kind: view === 'audiobooks' ? 'audiobook' : null,
          });
          await refresh();
          notify(`${count} files added`);
        });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
      void drop.then((fn) => fn());
    };
  }, [task, refresh, notify, view]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.matches('input,textarea,select,[contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.current?.focus();
      }
      if (editing || document.querySelector('dialog[open], [role=menu]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !nowPlaying) {
        e.preventDefault();
        setSelected(new Set(filtered.map((i) => i.id)));
      }
      if (e.key === 'Escape') {
        if (theater && nowPlaying) {
          if (desktop)
            void getCurrentWindow()
              .isFullscreen()
              .then((full) => {
                if (full) void getCurrentWindow().setFullscreen(false);
              });
          else if (document.fullscreenElement) void document.exitFullscreen();
          setTheater(false);
        } else setNowPlaying(false);
      }
      if (musicStage && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setVisualMode((v) => stepVisualizer(v, 1).id);
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setVisualMode((v) => stepVisualizer(v, -1).id);
        }
        if (e.key.toLowerCase() === 't') setTheater((t) => !t);
      }
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button,summary,a')) {
        e.preventDefault();
        if (broadcast.active) {
          void broadcast.toggle().catch(() => {});
        } else if (visualExternal && musicStage) {
          if (capture.running) void capture.stop();
          else setAudioSourceOpen(true);
        } else void player.toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i' && selected.size) {
        e.preventDefault();
        setInfoIds([...selected]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    player,
    selected,
    nowPlaying,
    theater,
    musicStage,
    broadcastVideoStage,
    broadcast,
    visualExternal,
    capture.running,
    capture.stop,
    filtered,
  ]);

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

  async function importFiles(kind?: 'audiobook') {
    await task('Adding media…', async () => {
      const paths = await chooseFiles();
      if (!paths.length) return;
      const count = await native<number>('import_files', {
        paths,
        kind: kind || (view === 'audiobooks' ? 'audiobook' : null),
      });
      await refresh();
      notify(`${count} files added to your library`);
      navigate(kind === 'audiobook' || view === 'audiobooks' ? 'audiobooks' : 'music');
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
  async function chooseArtistImage(artist: string) {
    try {
      const path = await open({
        multiple: false,
        title: `Choose an image for ${artist}`,
        filters: [{ name: 'Artist image', extensions: ['jpg', 'jpeg', 'png'] }],
      });
      if (typeof path !== 'string') return;
      await native('set_artist_artwork', { artist, path });
      await refresh();
      notify(`Artist image updated for ${artist}`);
    } catch (error) {
      notify(String(error));
    }
  }
  async function removeArtistImage(artist: string) {
    try {
      await native('set_artist_artwork', { artist, path: null });
      await refresh();
      notify(`Using album artwork for ${artist} when available`);
    } catch (error) {
      notify(String(error));
    }
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
  type MenuState = {
    x: number;
    y: number;
    items: MediaItem[];
    ratings?: boolean;
    playlists?: boolean;
    queueIndex?: number;
    playlist?: Playlist;
  };
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null);
  function openItemMenu(
    items: MediaItem[],
    event: React.MouseEvent | React.KeyboardEvent,
    queueIndex?: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      items,
      queueIndex,
      x: 'clientX' in event ? event.clientX : rect.left + 20,
      y: 'clientY' in event ? event.clientY : rect.top + 20,
    });
  }
  function openPlaylistMenu(playlist: Playlist, event: React.MouseEvent | React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      playlist,
      items: [],
      x: 'clientX' in event ? event.clientX : rect.left + 20,
      y: 'clientY' in event ? event.clientY : rect.top + 20,
    });
  }
  function openTrackMenu(item: MediaItem, event: React.MouseEvent | React.KeyboardEvent) {
    const targets = contextSelection([...filtered, ...allItems], selected, item);
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    openItemMenu(targets, event);
  }
  function menuActions(menu: MenuState): MenuAction[] {
    if (menu.playlist) {
      const playlist = menu.playlist;
      return [
        { label: 'Edit playlist…', run: () => setPlaylistEdit(playlist) },
        { label: 'Delete playlist…', divider: true, run: () => setPlaylistDelete(playlist) },
      ];
    }
    const local = menu.items.every((i) => !i.serverId);
    if (menu.playlists)
      return library.playlists
        .filter((p) => !p.rule)
        .map((p) => ({
          label: p.name,
          run: () =>
            void addToPlaylist(
              p.id,
              menu.items.map((i) => i.id),
            ),
        }));
    if (menu.ratings)
      return [0, 1, 2, 3, 4, 5].map((n) => ({
        label: n ? `${'★'.repeat(n)} · ${n} of 5 stars` : 'Clear rating',
        run: () =>
          void task('Saving ratings…', async () => {
            const result = await native<{
              saved: number;
              embedded: number;
              errors: string[];
              warnings: string[];
            }>('update_metadata', {
              ids: menu.items.map((i) => i.id),
              changes: { rating: String(n) },
              writeFiles: true,
            });
            await refresh();
            notify(
              `${result.saved} ratings saved · ${result.embedded} files updated${result.warnings.length ? ` · ${result.warnings.length} library only` : ''}${result.errors.length ? ` · ${result.errors.join('; ')}` : ''}`,
            );
          }),
      }));
    if (menu.items.length)
      return [
        {
          label: menu.items.length > 1 ? `Play ${menu.items.length} selected items` : 'Play',
          icon: <Play size={15} />,
          run: () => {
            if (
              menu.queueIndex !== undefined &&
              playback.queue[menu.queueIndex] === menu.items[0].id
            )
              broadcast.active
                ? play(menu.items[0], menu.items)
                : void player.jump(menu.queueIndex);
            else play(menu.items[0], menu.items);
          },
          disabled: !menu.items[0].available,
        },
        {
          label: 'Play next',
          run: () => {
            [...menu.items].reverse().forEach((i) => player.enqueue(i.id, true));
          },
        },
        {
          label: 'Add to queue',
          run: () => {
            menu.items.forEach((i) => player.enqueue(i.id));
          },
        },
        ...(menu.queueIndex === undefined
          ? []
          : [
              {
                label: 'Remove from queue',
                disabled: menu.queueIndex === playback.index,
                run: () =>
                  player.set((s) => {
                    const index = menu.queueIndex!;
                    if (s.index === index || s.queue[index] !== menu.items[0].id) return s;
                    return {
                      ...s,
                      queue: s.queue.filter((_, i) => i !== index),
                      index: index < s.index ? s.index - 1 : s.index,
                    };
                  }),
              },
            ]),
        {
          label: 'Add to playlist…',
          disabled: !local || !library.playlists.some((p) => !p.rule),
          run: () => setContextMenu({ ...menu, playlists: true }),
        },
        ...(menu.items.length === 1
          ? [
              {
                label: menu.items[0].favorite ? 'Remove from favorites' : 'Add to favorites',
                disabled: !local,
                run: () => void favorite(menu.items[0]),
              },
            ]
          : []),
        {
          label:
            menu.items.length > 1
              ? `Edit metadata for ${menu.items.length} items…`
              : 'Edit metadata…',
          icon: <Info size={15} />,
          divider: true,
          run: () => setInfoIds(menu.items.map((i) => i.id)),
        },
        {
          label: 'Set rating…',
          disabled: !local,
          run: () => setContextMenu({ ...menu, ratings: true }),
        },
        {
          label:
            menu.items.length === 1
              ? 'Remove from library…'
              : `Remove ${menu.items.length} items from library…`,
          disabled: !local,
          divider: true,
          run: () => void removeFromLibrary(menu.items),
        },
        {
          label: 'Select all visible items',
          divider: true,
          run: () => setSelected(new Set(filtered.map((i) => i.id))),
        },
        { label: 'Clear selection', run: () => setSelected(new Set()) },
      ];
    return [
      { label: 'Add media files…', run: () => void importFiles() },
      { label: 'Add media folder…', run: () => setSourceDialog(true) },
      {
        label: 'Select all visible items',
        disabled: !filtered.length || nowPlaying,
        run: () => setSelected(new Set(filtered.map((i) => i.id))),
      },
      { label: 'Preferences', divider: true, run: () => navigate('settings') },
    ];
  }
  const ratingPending = useRef(new Set<string>());
  const [ratingBusy, setRatingBusy] = useState<Set<string>>(new Set());
  async function rating(item: MediaItem, rating: number) {
    if (item.serverId) {
      notify('Jellyfin ratings are managed on your server.');
      return;
    }
    if (ratingPending.current.has(item.id)) return;
    ratingPending.current.add(item.id);
    setRatingBusy(new Set(ratingPending.current));
    try {
      const result = await native<{ embedded: boolean; warning?: string }>('set_rating', {
        id: item.id,
        rating,
      });
      await refresh();
      notify(
        result.warning ||
          `${rating ? `${rating} of 5 stars` : 'Rating cleared'} · saved in Elysium and file metadata`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      ratingPending.current.delete(item.id);
      setRatingBusy(new Set(ratingPending.current));
    }
  }
  function select(item: MediaItem, event: React.MouseEvent, collection = filtered) {
    const index = collection.findIndex((i) => i.id === item.id);
    setSelected((prev) => {
      const next = new Set(event.metaKey || event.ctrlKey ? prev : []);
      if (event.shiftKey) {
        for (const i of collection.slice(
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
    if (broadcast.state.station?.active) {
      if (item.serverId) {
        notify('Broadcasting items from a connected server is not supported yet.');
        return;
      }
      if (!item.available) {
        notify('Reconnect this source to play this item.');
        return;
      }
      const index = collection.findIndex((entry) => entry.id === item.id);
      const remaining =
        item.kind === 'audiobook' ? [item] : index < 0 ? [item] : collection.slice(index);
      const itemIds = remaining
        .filter((entry) => !entry.serverId && entry.available)
        .map((entry) => entry.id);
      void broadcast
        .call('broadcast_replace_queue', { itemIds })
        .then(() => {
          setVisualExternal(false);
          setVisualizerOnly(false);
          if (!isAudio(item)) {
            setNowPlaying(true);
            setDetailId(null);
          }
        })
        .catch(() => {});
      return;
    }
    if (broadcast.state.listening?.active) {
      notify('Choose the next item on the computer hosting this broadcast.');
      return;
    }
    setVisualExternal(false);
    setVisualizerOnly(false);
    void player.play(item, item.kind === 'audiobook' ? [item] : collection);
    if (!isAudio(item)) {
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
      const entering = desktop
        ? !(await getCurrentWindow().isFullscreen())
        : !document.fullscreenElement;
      if (entering) {
        setNowPlaying(true);
        setTheater(true);
      } else setTheater(false);
      if (desktop) await getCurrentWindow().setFullscreen(entering);
      else if (entering) await document.documentElement.requestFullscreen();
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
  async function removeFromLibrary(items: MediaItem[]) {
    if (
      !window.confirm(
        `Remove ${items.length === 1 ? `“${items[0].title}”` : `${items.length} items`} from your library? The files will stay on your computer. You can add them again by importing the files.`,
      )
    )
      return;
    const ids = items.map((item) => item.id);
    try {
      if (current && ids.includes(current.id)) await player.stop();
      await native('remove_from_library', { ids });
      player.set((state) => {
        const before = state.queue.slice(0, state.index).filter((id) => !ids.includes(id)).length;
        return { ...state, queue: state.queue.filter((id) => !ids.includes(id)), index: before };
      });
      setSelected(new Set());
      await refresh();
      notify('Removed from library. Original files were kept.');
    } catch (error) {
      notify(String(error));
    }
  }
  async function addToPlaylist(id: string, itemIds: string[] = [...selected]) {
    const list = library.playlists.find((p) => p.id === id);
    if (!list) return;
    try {
      await native('update_playlist', {
        id,
        itemIds: [...list.itemIds, ...itemIds.filter((id) => !id.includes(':'))],
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

  const volumeControls = (
    <div className="footer-volume">
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
  );

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
        disabled={(!current && !filtered.length) || player.preparing}
        onClick={() => (current ? void player.toggle() : filtered[0] && play(filtered[0]))}
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
      <button
        className="icon-button"
        aria-label="Stop playback"
        title="Stop playback"
        disabled={!current}
        onClick={() => void player.stop()}
      >
        <Square size={13} fill="currentColor" />
      </button>
    </>
  );

  return (
    <div
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
        e.preventDefault();
        if ((e.target as HTMLElement).closest('dialog')) return;
        const inLibrary =
          (e.target as HTMLElement).closest('.content') &&
          !['home', 'settings', 'sources', 'broadcast', 'jellyfin'].includes(view);
        openItemMenu(
          nowPlaying && (e.target as HTMLElement).closest('.music-stage,.video-stage')
            ? current && !visualExternal && !broadcast.active
              ? [current]
              : []
            : inLibrary
              ? allItems.filter((i) => selected.has(i.id))
              : [],
          e,
        );
      }}
      onClick={(e) => {
        const button = (e.target as HTMLElement).closest?.('button');
        const menu = button?.closest('details');
        if (menu) menu.removeAttribute('open');
      }}
      className={`app ${mini ? 'mini-mode' : ''} ${compact ? 'compact' : ''} ${theater && nowPlaying && !mini ? 'theater-mode' : ''} ${(nowPlaying || current?.kind === 'audiobook') && !mini ? 'expanded-player' : ''}`}
      data-theme={theme}
      data-controls={showControls ? 'shown' : 'hidden'}
    >
      {contextMenu && (
        <ContextMenu
          {...contextMenu}
          title={
            contextMenu.playlist
              ? contextMenu.playlist.name
              : contextMenu.playlists
                ? 'Add to playlist'
                : contextMenu.ratings
                  ? 'Set rating'
                  : contextMenu.items.length > 1
                    ? `${contextMenu.items.length} selected items`
                    : contextMenu.items[0]?.title || 'Library actions'
          }
          actions={menuActions(contextMenu)}
          close={() => setContextMenu(null)}
        />
      )}
      <audio ref={player.audio} crossOrigin="anonymous" preload="metadata" />
      <div className="main-toolbar">
        <div className="library-location">
          <button
            className="icon-button"
            aria-label="Go back"
            onClick={() => (nowPlaying ? setNowPlaying(false) : goBackOrForward(-1))}
            disabled={!navigation.canBack && !nowPlaying}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Go forward"
            disabled={!navigation.canForward}
            onClick={() => goBackOrForward(1)}
          >
            <ChevronRight size={18} />
          </button>
          <button className="navigation-home" onClick={() => navigate('home')}>
            Library
          </button>
          <ChevronRight size={12} />
          <strong>
            {nowPlaying
              ? musicStage
                ? 'Visualizer'
                : 'Now Playing'
              : collectionTitle || selectedPlaylist?.name || names[view]}
          </strong>
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
              setNowPlaying(false);
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
                className={
                  !nowPlaying &&
                  (view === n.id ||
                    (n.id === 'artists' && view.startsWith('artist:')) ||
                    (n.id === 'albums' && view.startsWith('album:')))
                    ? 'active'
                    : ''
                }
                aria-current={!nowPlaying && view === n.id ? 'page' : undefined}
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
              className={!nowPlaying && view === 'favorites' ? 'active' : ''}
              onClick={() => navigate('favorites')}
            >
              <Heart size={16} />
              <span>Favorites</span>
            </button>
            <button
              className={!nowPlaying && view === 'recent' ? 'active' : ''}
              onClick={() => navigate('recent')}
            >
              <Sparkles size={16} />
              <span>Recently added</span>
            </button>
          </div>
          <div className="sidebar-group visualizer-nav">
            <button
              className={!nowPlaying && view === 'broadcast' ? 'active' : ''}
              onClick={() => navigate('broadcast')}
            >
              <Radio size={17} />
              <span>Listen to broadcasts</span>
              {!!broadcast.state.invitations.length ? (
                <span className="nav-new">{broadcast.state.invitations.length}</span>
              ) : (
                broadcast.active && <span className="nav-new">LIVE</span>
              )}
            </button>
            <button
              className={musicStage ? 'active' : ''}
              aria-current={musicStage ? 'page' : undefined}
              onClick={() => {
                setVisualizerOnly(true);
                setNowPlaying(true);
              }}
            >
              <AudioLines size={17} />
              <span>Visualizer</span>
              <span className="nav-new">LIVE</span>
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
                className={!nowPlaying && view === `playlist:${p.id}` ? 'active' : ''}
                onClick={() => navigate(`playlist:${p.id}`)}
                onContextMenu={(e) => openPlaylistMenu(p, e)}
                onKeyDown={(e) => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
                    openPlaylistMenu(p, e);
                }}
                onDragOver={(e) => {
                  if (!p.rule) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (p.rule) return;
                  try {
                    const ids = JSON.parse(
                      e.dataTransfer.getData('application/elysium-items'),
                    ) as string[];
                    if (Array.isArray(ids) && ids.length) void addToPlaylist(p.id, ids);
                  } catch {
                    /* Ignore unrelated drags. */
                  }
                }}
              >
                {p.artwork ? (
                  <Artwork image={p.artwork} label={p.name} className="playlist-nav-art" />
                ) : p.rule ? (
                  <Sparkles size={15} />
                ) : (
                  <ListMusic size={15} />
                )}
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
          <div className="sidebar-group sidebar-library-actions">
            <details>
              <summary>
                <FolderOpen size={16} /> Library actions <ChevronDown size={13} />
              </summary>
              <div className="sidebar-action-items">
                <button onClick={() => void importFiles()}>
                  <Plus size={15} /> Add files
                </button>
                <button onClick={() => setSourceDialog(true)}>
                  <FolderOpen size={15} /> Add folder
                </button>
                <button onClick={() => void importPlaylist()}>
                  <Upload size={15} /> Import playlist
                </button>
                <button onClick={() => void exportBackup()}>
                  <Download size={15} /> Export backup
                </button>
                <button onClick={() => void restoreBackup()}>
                  <Upload size={15} /> Restore backup
                </button>
              </div>
            </details>
            <button onClick={() => setHelp(true)}>
              <CircleHelp size={16} />
              <span>Help</span>
            </button>
          </div>
          <div className="sidebar-group sources-nav">
            <span className="sidebar-label">CONNECTED</span>
            <button
              className={!nowPlaying && view === 'sources' ? 'active' : ''}
              onClick={() => navigate('sources')}
            >
              <FolderOpen size={17} />
              <span>Library folders</span>
              <span
                className={`connection-dot ${library.sources.some((s) => s.online) ? 'online' : ''}`}
              />
            </button>
            <button
              className={!nowPlaying && view === 'jellyfin' ? 'active' : ''}
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
            className={`preferences-link ${!nowPlaying && view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={16} />
            Preferences
            {updates.latest?.available && !updates.build?.dirty && (
              <span className="update-badge">Update</span>
            )}
          </button>
        </aside>

        <main className="content">
          {broadcastVideoStage && (
            <Suspense fallback={<div className="broadcast-video-message">Loading live video…</div>}>
              <BroadcastVideo
                broadcast={broadcast}
                theater={theater}
                toggleTheater={() => setTheater((t) => !t)}
                fullScreen={() => void fullScreen()}
                back={() => {
                  setTheater(false);
                  navigate('broadcast');
                }}
              />
            </Suspense>
          )}
          <div
            className={`video-stage ${nowPlaying && !broadcastVideoStage && !musicStage && current && !isAudio(current) ? 'shown' : ''}`}
          >
            <div className="stage-top">
              <button onClick={() => setNowPlaying(false)}>
                <ArrowLeft size={16} />
                Library
              </button>
              <span>{current?.title}</span>
              <button onClick={() => void fullScreen()}>
                <Maximize2 size={15} /> Full screen
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
          </div>

          <div className={`music-stage ${musicStage ? 'shown' : ''}`}>
            <div className="stage-top">
              <button
                onClick={() => {
                  setNowPlaying(false);
                  setTheater(false);
                }}
              >
                <ArrowLeft size={16} /> Library
              </button>
              <button
                className="stage-source"
                onClick={() =>
                  broadcast.active ? navigate('broadcast') : setAudioSourceOpen(true)
                }
              >
                <AudioLines size={15} />
                {broadcast.active
                  ? broadcast.name
                  : visualExternal
                    ? capture.name
                    : 'Elysium player'}
                <ChevronDown size={12} />
              </button>
              <div className="stage-actions">
                <button onClick={() => setVisualGallery(true)}>
                  <Grid2X2 size={15} /> Atmospheres
                </button>
                <button
                  aria-pressed={theater}
                  title="Theater view (T)"
                  onClick={() => setTheater(!theater)}
                >
                  <Maximize2 size={15} /> {theater ? 'Exit theater' : 'Theater'}
                </button>
              </div>
            </div>
            {musicStage && !mini && visualMode === 'album-art' && (
              <div className="album-art-stage">
                <Artwork
                  item={visualArtworkItem}
                  label={
                    visualArtworkItem?.album ||
                    broadcast.track?.album ||
                    broadcast.track?.title ||
                    'Album artwork'
                  }
                />
                <div className="album-art-stage-copy">
                  <strong>
                    {broadcast.active
                      ? broadcast.track?.title || broadcast.name
                      : current?.title || 'Nothing playing yet'}
                  </strong>
                  <span>{broadcast.active ? broadcast.track?.artist : current?.artist}</span>
                  <small>{broadcast.active ? broadcast.track?.album : current?.album}</small>
                </div>
              </div>
            )}
            {musicStage && !mini && visualMode !== 'album-art' && (
              <Visualizer
                player={player}
                mode={visualMode}
                auto={visualAuto}
                onPresetChange={setVisualMode}
                quality={visualQuality}
                reducedMotion={visualReduced}
                intensity={visualIntensity}
                external={broadcast.active ? broadcast : visualExternal ? capture : undefined}
                large
              />
            )}
            {visualMode !== 'album-art' && (
              <div className="visualizer-identity">
                <span>
                  {
                    VISUALIZER_FAMILIES.find((f) => f.id === getVisualizer(visualMode).family)
                      ?.label
                  }
                </span>
                <strong>{getVisualizer(visualMode).name}</strong>
                <small>
                  <i className={visualActive ? 'live-dot' : ''} />
                  {visualActive
                    ? !broadcast.active && visualExternal && capture.level < 0.005
                      ? 'LISTENING FOR MUSIC'
                      : 'REACTING TO YOUR MUSIC'
                    : 'PAUSED'}
                </small>
              </div>
            )}
            <div
              className={`now-playing-art ${visualMode !== 'album-art' && visualInfo && !visualExternal && !broadcast.active && current ? '' : 'hidden'}`}
            >
              <Artwork item={current} />
              <div>
                <p className="eyebrow">NOW PLAYING</p>
                <h1>{current?.title}</h1>
                <p>{current?.artist}</p>
                <small>{current?.album}</small>
              </div>
            </div>
          </div>

          <div className={`library-content ${nowPlaying ? 'covered' : ''}`}>
            {!loaded ? (
              <div className="loading-library">
                <LoaderCircle className="spin" />
                <p>Opening your library…</p>
              </div>
            ) : !allItems.length &&
              !view.startsWith('playlist:') &&
              !['sources', 'settings', 'jellyfin', 'broadcast', 'audiobooks'].includes(view) ? (
              <EmptyCollection
                add={() => setSourceDialog(true)}
                files={() => void importFiles()}
                samples={() => void samples()}
                busy={!!busy}
              />
            ) : view === 'broadcast' ? (
              <BroadcastPanel
                broadcast={broadcast}
                prepare={prepareBroadcast}
                visualize={() => {
                  setVisualizerOnly(!broadcast.state.video);
                  setNowPlaying(true);
                }}
                preferences={openLanPreferences}
              />
            ) : view === 'audiobooks' ? (
              <Audiobooks
                contextMenu={openTrackMenu}
                items={filtered}
                play={(i) => play(i, [i])}
                add={() => void importFiles('audiobook')}
                folder={() => setSourceDialog(true)}
                info={(i) => setInfoIds([i.id])}
              />
            ) : view === 'sources' ? (
              <SourcesView
                sources={library.sources}
                scan={(s) => void scan(s)}
                refreshAll={() =>
                  void task('Refreshing library folders…', async () => {
                    let failed = 0;
                    for (const source of library.sources) {
                      try {
                        await native('scan_source', { sourceId: source.id });
                      } catch {
                        failed++;
                      }
                    }
                    await refresh();
                    notify(
                      failed
                        ? `Refreshed library · ${failed} folder${failed === 1 ? '' : 's'} could not be scanned`
                        : 'Library folders refreshed',
                    );
                  })
                }
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
                <section ref={lanPreferences} className="lan-preferences" tabIndex={-1}>
                  <BroadcastPreferences
                    broadcast={broadcast}
                    library={library}
                    setEnabled={setLanEnabled}
                    refresh={refresh}
                  />
                </section>
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
                </section>
                <section>
                  <h2>Sound & visuals</h2>
                  <label>
                    Visualizer
                    <select value={visualMode} onChange={(e) => setVisualMode(e.target.value)}>
                      <VisualizerOptions />
                    </select>
                  </label>
                  <p className="visualizer-note">
                    {VISUALIZER_PRESETS.length} original scenes, from flowing color and living
                    fractals to classic desktop-inspired effects. Open Visualizer in the sidebar,
                    then choose the Elysium player, system audio, or an input device. Use
                    Atmospheres to explore the collection.
                  </p>
                  <label>
                    Visualizer performance
                    <select
                      value={visualQuality}
                      onChange={(e) => setVisualQuality(e.target.value as VisualizerQuality)}
                    >
                      <option value="balanced">Balanced · 30 fps</option>
                      <option value="high">Smooth · 60 fps</option>
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={visualReduced}
                      onChange={(e) => setVisualReduced(e.target.checked)}
                    />
                    <span>
                      Reduce visualizer motion
                      <small>
                        System reduced-motion preferences are always respected. Automatic preset
                        changes pause in reduced motion.
                      </small>
                    </span>
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
                <AppUpdates updates={updates} />
                <section>
                  <button onClick={() => setHelp(true)}>
                    <CircleHelp size={16} />
                    About this test release
                  </button>
                </section>
              </div>
            ) : view.startsWith('artist:') || view.startsWith('album:') ? (
              <CollectionPage
                artist={view.startsWith('artist:') ? view.slice(7) : undefined}
                artistImage={view.startsWith('artist:') ? artistImage(view.slice(7)) : undefined}
                chooseArtistImage={chooseArtistImage}
                removeArtistImage={removeArtistImage}
                items={baseItems}
                query={query}
                selected={selected}
                currentId={playback.currentId}
                play={play}
                select={select}
                favorite={(item) => void favorite(item)}
                rate={(item, value) => void rating(item, value)}
                ratingBusy={ratingBusy}
                info={(item) => setInfoIds([item.id])}
                enqueue={player.enqueue}
                contextMenu={openTrackMenu}
                openArtist={openArtist}
                openAlbum={openAlbum}
              />
            ) : view === 'home' && !query ? (
              <div className="home-view">
                <div className="home-intro">
                  <div>
                    <p className="eyebrow">YOUR PERSONAL COLLECTION</p>
                    <h1>
                      A little more music.
                      <br />A little less noise.
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
                {allItems.some((i) => i.kind === 'music' && i.available) && (
                  <button
                    className="light-show-entry"
                    onClick={() => {
                      setVisualExternal(false);
                      setVisualizerOnly(true);
                      if (current?.kind !== 'music') {
                        const music = allItems.filter((i) => i.kind === 'music' && i.available);
                        if (music[0]) play(music[0], music);
                      } else if (!broadcast.active && !playback.playing) void player.toggle();
                      setNowPlaying(true);
                    }}
                  >
                    <span className="light-show-symbol">
                      <Sparkles size={24} />
                    </span>
                    <span>
                      <small>MADE FOR LISTENING</small>
                      <strong>Give your music a whole new dimension.</strong>
                      <span>
                        Explore {VISUALIZER_PRESETS.length} immersive, audio-reactive atmospheres.
                      </span>
                    </span>
                    <span className="light-show-cta">
                      Enter the light show <ChevronRight size={16} />
                    </span>
                  </button>
                )}
                {allItems.some((i) => i.resume > 0 && i.kind !== 'music') && (
                  <section>
                    <div className="section-heading">
                      <h2>Pick up where you left off</h2>
                    </div>
                    <MediaCards
                      contextMenu={openTrackMenu}
                      items={allItems.filter((i) => i.resume > 0 && i.kind !== 'music').slice(0, 6)}
                      play={(i) => play(i)}
                      detail={(i) =>
                        i.kind === 'audiobook' ? setInfoIds([i.id]) : setDetailId(i.id)
                      }
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
                        <article
                          className="album-card"
                          key={group.key}
                          onContextMenu={(e) => openItemMenu(group.items, e)}
                        >
                          <button
                            className="cover-button"
                            onClick={() => openAlbum(group.items[0])}
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
                          <h3>
                            <button
                              className="artist-link"
                              onClick={() => openAlbum(group.items[0])}
                            >
                              {group.name}
                            </button>
                          </h3>
                          <p>
                            {group.artist === 'Various Artists' &&
                            !group.items.some(
                              (item) =>
                                item.artist === group.artist || item.albumArtist === group.artist,
                            ) ? (
                              group.artist
                            ) : (
                              <button
                                className="artist-link"
                                onClick={() => openArtist(group.artist)}
                              >
                                {group.artist}
                              </button>
                            )}
                          </p>
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
                      contextMenu={openTrackMenu}
                      items={allItems.filter((i) => i.kind === 'movie').slice(0, 6)}
                      play={(i) => play(i)}
                      detail={(i) =>
                        i.kind === 'audiobook' ? setInfoIds([i.id]) : setDetailId(i.id)
                      }
                    />
                  </section>
                )}
              </div>
            ) : (
              <>
                <div className="view-header">
                  <div className={selectedPlaylist ? 'playlist-heading' : undefined}>
                    {selectedPlaylist && (
                      <Artwork
                        item={baseItems.find((item) => item.artwork) || baseItems[0]}
                        image={selectedPlaylist.artwork || undefined}
                        label={selectedPlaylist.name}
                      />
                    )}
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
                      {selectedPlaylist && !selectedPlaylist.rule && (
                        <p>
                          Drag songs to arrange them in list view with Playlist order selected and
                          filters cleared.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="view-header-actions">
                    {selectedPlaylist && (
                      <button onClick={() => setPlaylistEdit(selectedPlaylist)}>
                        Edit playlist
                      </button>
                    )}
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
                  <span className="selection-label">
                    {selected.size ? `${selected.size} selected` : `${filtered.length} items`}
                  </span>
                  <button
                    className="small-button"
                    onClick={() =>
                      setSelected(
                        new Set(
                          filtered.length > 0 && filtered.every((i) => selected.has(i.id))
                            ? []
                            : filtered.map((i) => i.id),
                        ),
                      )
                    }
                  >
                    {filtered.length > 0 && filtered.every((i) => selected.has(i.id))
                      ? 'Clear selection'
                      : 'Select all'}
                  </button>
                  {selected.size > 0 && (
                    <>
                      <button className="small-button" onClick={() => setInfoIds([...selected])}>
                        <Info size={14} />
                        Edit metadata
                      </button>
                      <button
                        className="small-button"
                        onClick={() =>
                          void removeFromLibrary(
                            allItems.filter((item) => selected.has(item.id) && !item.serverId),
                          )
                        }
                        disabled={
                          ![...selected].some((id) => library.items.some((item) => item.id === id))
                        }
                      >
                        Remove from library
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
                {view === 'movies' || view === 'tv' ? (
                  <div className="grid-scroll">
                    <MediaCards
                      contextMenu={openTrackMenu}
                      items={filtered}
                      play={(i) => play(i)}
                      detail={(i) =>
                        i.kind === 'audiobook' ? setInfoIds([i.id]) : setDetailId(i.id)
                      }
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
                ) : view === 'albums' || (grid && view !== 'artists') ? (
                  <div className="grid-scroll">
                    <div className="album-grid">
                      {albums.map((group) => (
                        <article
                          key={group.key}
                          className="album-card"
                          onContextMenu={(e) => openItemMenu(group.items, e)}
                        >
                          <button
                            className="cover-button"
                            onClick={() => openAlbum(group.items[0])}
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
                          <h3>
                            <button
                              className="artist-link"
                              onClick={() => openAlbum(group.items[0])}
                            >
                              {group.name}
                            </button>
                          </h3>
                          <p>
                            {group.artist === 'Various Artists' &&
                            !group.items.some(
                              (item) =>
                                item.artist === group.artist || item.albumArtist === group.artist,
                            ) ? (
                              group.artist
                            ) : (
                              <button
                                className="artist-link"
                                onClick={() => openArtist(group.artist)}
                              >
                                {group.artist}
                              </button>
                            )}
                          </p>
                          <small>{group.items.length} tracks</small>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : view === 'artists' ? (
                  <div className="grid-scroll artist-grid">
                    {artists.map((name) => {
                      const group = artistItems(filtered, name);
                      return (
                        <button
                          className="artist-card"
                          onContextMenu={(e) => openItemMenu(group, e)}
                          key={name}
                          onClick={() => {
                            openArtist(name);
                          }}
                        >
                          <Artwork
                            item={
                              artistItems(allItems, name).find((item) => item.artwork) || group[0]
                            }
                            image={artistImage(name)}
                            label={name}
                          />
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
                    rate={(i, n) => void rating(i, n)}
                    ratingBusy={ratingBusy}
                    contextMenu={openTrackMenu}
                    openArtist={openArtist}
                    openAlbum={openAlbum}
                    playlistId={selectedPlaylist?.id}
                    reorder={
                      selectedPlaylist &&
                      !selectedPlaylist.rule &&
                      sort === 'playlist' &&
                      !query &&
                      !series &&
                      filtered.length === selectedPlaylist.itemIds.length
                        ? (from, to) => {
                            if (from === to) return;
                            const itemIds = [...selectedPlaylist.itemIds];
                            const [moved] = itemIds.splice(from, 1);
                            itemIds.splice(to, 0, moved);
                            void native('update_playlist', { id: selectedPlaylist.id, itemIds })
                              .then(refresh)
                              .catch((e) => notify(String(e)));
                          }
                        : undefined
                    }
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
                    onContextMenu={(e) => openItemMenu([item], e, index)}
                    onKeyDown={(e) => {
                      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
                        openItemMenu([item], e, index);
                    }}
                  >
                    <button
                      className="queue-item-main"
                      onClick={() =>
                        broadcast.active
                          ? play(
                              item,
                              playback.queue
                                .slice(index)
                                .flatMap((id) => allItems.find((entry) => entry.id === id) || []),
                            )
                          : void player.jump(index)
                      }
                    >
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
        <button onClick={() => void toggleMini()}>
          <Maximize2 size={13} />
          Library
        </button>
      </div>
      <footer className="player-footer">
        {broadcast.active ? (
          <BroadcastTransport
            broadcast={broadcast}
            visualize={() => {
              setVisualizerOnly(!broadcast.state.video);
              setNowPlaying(true);
            }}
            settings={() => navigate('broadcast')}
            fullScreen={() => void fullScreen()}
          />
        ) : visualExternal && nowPlaying && !mini ? (
          <div className="external-transport">
            <div className="external-device-icon">
              <AudioLines size={26} />
            </div>
            <div className="external-device-copy">
              <strong>{capture.name}</strong>
              <span>
                {capture.busy
                  ? 'Connecting to audio device…'
                  : capture.running
                    ? capture.level > 0.005
                      ? 'Receiving audio · live visualization'
                      : 'Listening · play something in your other app'
                    : 'Listening stopped'}
              </span>
            </div>
            <meter min="0" max="1" value={capture.level} aria-label="Audio input level" />
            {capture.error && (
              <span className="capture-error" role="alert">
                {capture.error}
              </span>
            )}
            {capture.running ? (
              <button onClick={() => void capture.stop()}>
                <Square size={13} />
                Stop listening
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => setAudioSourceOpen(true)}
                disabled={capture.busy}
              >
                Choose audio source
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Change audio source"
              onClick={() => setAudioSourceOpen(true)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Full screen"
              onClick={() => void fullScreen()}
            >
              <Maximize2 size={18} />
            </button>
          </div>
        ) : (
          <>
            <button
              className="now-art-button"
              aria-label="Open Now Playing"
              onClick={() => setNowPlaying(!nowPlaying)}
            >
              <Artwork item={current} />
            </button>
            <div
              className="footer-info"
              onContextMenu={(e) => {
                if (current) openItemMenu([current], e);
              }}
            >
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
              <small className="broadcast-status broadcast-status-off">Not broadcasting</small>
              {current && !current.serverId && (
                <Rating
                  item={current}
                  rate={(n) => void rating(current, n)}
                  disabled={ratingBusy.has(current.id) || !!current.serverId}
                />
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
              {visualMode === 'album-art' ? (
                <Artwork item={visualArtworkItem} />
              ) : (
                <Visualizer player={player} active={!mini && !nowPlaying} mode={visualMode} />
              )}
            </div>
            <div className="footer-tools">
              {volumeControls}
              <div className="footer-actions">
                <button
                  className="broadcast-start"
                  aria-label="Start broadcasting current playback"
                  title="Start broadcasting current playback"
                  disabled={
                    !current || !!current.serverId || !current.available || !!broadcast.busy
                  }
                  onClick={() => void broadcastCurrent()}
                >
                  <Radio size={16} />
                  <span>Broadcast</span>
                </button>
                <button
                  className={`icon-button ${eqOpen ? 'active' : ''}`}
                  aria-label="Equalizer"
                  title="Equalizer"
                  onClick={() => setEqOpen(!eqOpen)}
                >
                  <SlidersHorizontal size={18} />
                </button>
                <button
                  className={`icon-button ${queueOpen ? 'active' : ''}`}
                  aria-label="Open queue"
                  title="Up Next"
                  aria-pressed={queueOpen}
                  onClick={() => setQueueOpen(!queueOpen)}
                >
                  <ListMusic size={20} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Mini player"
                  title="Mini player"
                  onClick={() => void toggleMini()}
                >
                  <Minimize2 size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Now Playing"
                  title="Now Playing"
                  onClick={() => setNowPlaying(!nowPlaying)}
                >
                  <MonitorPlay size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Full screen"
                  title="Full screen"
                  onClick={() => void fullScreen()}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
            </div>
          </>
        )}
        {current?.kind === 'audiobook' && !broadcast.active && !musicStage && !mini && (
          <div className="book-transport">
            <button onClick={() => player.seek(playback.position - 15)}>−15s</button>
            <button onClick={() => player.seek(playback.position + 30)}>+30s</button>
            <label>
              Speed
              <select
                aria-label="Audiobook speed"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
            <span>Listening position saved automatically</span>
          </div>
        )}
        {nowPlaying &&
          !broadcastVideoStage &&
          (musicStage || current?.kind !== 'audiobook') &&
          !mini &&
          (!musicStage ? (
            <div className="footer-extra-controls">
              <button onClick={() => player.seek(playback.position - 10)}>−10s</button>

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
          ) : (
            <div className="footer-extra-controls visualizer-controls">
              <button
                className="gallery-button"
                onClick={() => setVisualGallery(true)}
                title="Browse atmospheres"
              >
                <Grid2X2 size={14} />
                <span>Browse</span>
              </button>
              <div className="preset-stepper">
                <button
                  className="icon-button"
                  aria-label="Previous visualizer"
                  title="Previous visualizer"
                  onClick={() => setVisualMode(stepVisualizer(visualMode, -1).id)}
                >
                  <ChevronLeft size={15} />
                </button>
                <select
                  aria-label="Visualizer preset"
                  value={visualMode}
                  onChange={(e) => setVisualMode(e.target.value)}
                >
                  <VisualizerOptions />
                </select>
                <button
                  className="icon-button"
                  aria-label="Next visualizer"
                  title="Next visualizer"
                  onClick={() => setVisualMode(stepVisualizer(visualMode, 1).id)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
              <button
                className="icon-button"
                aria-label="Random visualizer"
                title="Random visualizer"
                onClick={() => setVisualMode(randomVisualizer(visualMode).id)}
              >
                <Sparkles size={15} />
              </button>
              {visualMode !== 'album-art' && (
                <>
                  <label title="Flows to another immersive scene on a musical accent after 45–80 seconds; stays still during silence or reduced motion">
                    <input
                      type="checkbox"
                      checked={visualAuto}
                      onChange={(e) => setVisualAuto(e.target.checked)}
                    />
                    Auto show
                  </label>
                  {!visualExternal && !broadcast.active && (
                    <label>
                      <input
                        type="checkbox"
                        checked={visualInfo}
                        onChange={(e) => setVisualInfo(e.target.checked)}
                      />
                      Track info
                    </label>
                  )}
                  <label className="intensity-control">
                    Intensity
                    <input
                      type="range"
                      aria-label="Visualizer intensity"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={visualIntensity}
                      onChange={(e) => setVisualIntensity(Number(e.target.value))}
                    />
                  </label>
                  <select
                    aria-label="Visualizer performance"
                    value={visualQuality}
                    onChange={(e) => setVisualQuality(e.target.value as VisualizerQuality)}
                  >
                    <option value="balanced">30 fps</option>
                    <option value="high">60 fps</option>
                  </select>
                </>
              )}
            </div>
          ))}
      </footer>
      {audioSourceOpen && (
        <AudioSourceDialog
          capture={capture}
          external={visualExternal}
          usePlayer={() => setVisualExternal(false)}
          choose={(device) => void chooseAudioDevice(device)}
          close={() => {
            if (capture.busy) void capture.stop();
            setAudioSourceOpen(false);
          }}
        />
      )}
      {visualGallery && (
        <PresetGallery
          current={visualMode}
          select={setVisualMode}
          close={() => setVisualGallery(false)}
        />
      )}
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
          <button
            className="icon-button"
            aria-label={pinned ? 'Unpin mini player' : 'Pin mini player'}
            aria-pressed={pinned}
            onClick={() => void togglePin()}
          >
            <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          {volumeControls}
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
      {sourceDialog && (
        <AddSourceDialog
          initialKind={
            view === 'audiobooks'
              ? 'audiobook'
              : view === 'movies'
                ? 'movie'
                : view === 'music' || view === 'tv'
                  ? view
                  : 'mixed'
          }
          close={() => setSourceDialog(false)}
          add={addSource}
        />
      )}
      {lanNotice && (
        <Modal title="LAN broadcasting is off" close={() => setLanNotice(false)}>
          <p className="dialog-intro">
            Turn on LAN broadcasting in Preferences to share your current playback with other rooms.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setLanNotice(false)}>Not now</button>
            <button className="primary" onClick={openLanPreferences}>
              Open Preferences
            </button>
          </div>
        </Modal>
      )}
      {playlistEdit && (
        <PlaylistEditDialog
          playlist={playlistEdit}
          fallback={playlistItems(playlistEdit, allItems).find((item) => item.artwork)}
          close={() => setPlaylistEdit(null)}
          save={async (name, changeArtwork, artworkPath) => {
            await native('edit_playlist', {
              id: playlistEdit.id,
              name,
              changeArtwork,
              artworkPath,
            });
            await refresh();
            notify('Playlist updated');
          }}
        />
      )}
      {playlistDelete && (
        <Modal
          title="Delete playlist?"
          close={() => {
            if (!playlistDeleteBusy) setPlaylistDelete(null);
          }}
        >
          <p className="dialog-intro">
            Delete “{playlistDelete.name}”? Your songs and files will stay in your library.
          </p>
          <div className="dialog-actions">
            <button disabled={playlistDeleteBusy} onClick={() => setPlaylistDelete(null)}>
              No
            </button>
            <button
              className="primary"
              disabled={playlistDeleteBusy}
              onClick={() => {
                setPlaylistDeleteBusy(true);
                void native('delete_playlist', { id: playlistDelete.id })
                  .then(async () => {
                    if (view === `playlist:${playlistDelete.id}`) navigate('music');
                    setPlaylistDelete(null);
                    await refresh();
                    notify('Playlist deleted');
                  })
                  .catch((error) => notify(String(error)))
                  .finally(() => setPlaylistDeleteBusy(false));
              }}
            >
              {playlistDeleteBusy ? 'Deleting…' : 'Yes, delete playlist'}
            </button>
          </div>
        </Modal>
      )}
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
          stopPlayback={player.stop}
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
            <p className="eyebrow">VERSION 0.2.0 · TEST RELEASE</p>
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
