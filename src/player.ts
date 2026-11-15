import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mediaUrl, native } from './bridge';
import { nextIndex, shuffled } from './domain';
import type { MediaItem, PlayerState } from './types';

const initial: PlayerState = {
  currentId: null,
  queue: [],
  index: -1,
  playing: false,
  shuffle: false,
  repeat: 'off',
  position: 0,
  duration: 0,
  volume: 0.75,
  muted: false,
};
type Graph = {
  context: AudioContext;
  analyser: AnalyserNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
};

export function usePlayer(
  items: MediaItem[],
  notify: (message: string) => void,
  onProgress: () => void,
) {
  const audio = useRef<HTMLAudioElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const [state, set] = useState<PlayerState>(initial),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState('');
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 });
  const graph = useRef<Graph | null>(null),
    counted = useRef(false),
    lastSave = useRef(0),
    generation = useRef(0),
    prepared = useRef(false),
    startAt = useRef<number | null>(null);
  const stateRef = useRef(state),
    itemsRef = useRef(items),
    currentRef = useRef<MediaItem | undefined>(undefined),
    progressCallback = useRef(onProgress);
  stateRef.current = state;
  itemsRef.current = items;
  progressCallback.current = onProgress;
  const current = items.find((i) => i.id === state.currentId);
  currentRef.current = current;
  const element = useCallback(
    () => (currentRef.current?.kind === 'music' ? audio.current : video.current),
    [],
  );

  const enableAudio = useCallback(async () => {
    try {
      if (!graph.current) {
        const context = new AudioContext(),
          analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.8;
        const low = context.createBiquadFilter();
        low.type = 'lowshelf';
        low.frequency.value = 200;
        const mid = context.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 0.8;
        const high = context.createBiquadFilter();
        high.type = 'highshelf';
        high.frequency.value = 4000;
        low.connect(mid).connect(high).connect(analyser).connect(context.destination);
        graph.current = { context, analyser, low, mid, high, sources: new WeakMap() };
      }
      for (const media of [audio.current, video.current]) {
        if (media && !graph.current.sources.has(media)) {
          const node = graph.current.context.createMediaElementSource(media);
          node.connect(graph.current.low);
          graph.current.sources.set(media, node);
        }
      }
      await graph.current.context.resume();
    } catch {
      /* Playback remains available when Web Audio is unavailable. */
    }
  }, []);

  useEffect(() => {
    if (graph.current) {
      graph.current.low.gain.value = eq.low;
      graph.current.mid.gain.value = eq.mid;
      graph.current.high.gain.value = eq.high;
    }
  }, [eq]);
  useEffect(() => {
    for (const media of [audio.current, video.current])
      if (media) {
        media.volume = state.volume;
        media.muted = state.muted;
      }
  }, [state.volume, state.muted, state.currentId]);

  const persistProgress = useCallback(
    async (completed = false, forceCount = false) => {
      const item = currentRef.current,
        media = element();
      if (!item || !media) return;
      const pos = media.currentTime || 0,
        duration = Number.isFinite(media.duration) ? media.duration : item.duration;
      const done = completed || media.ended;
      const countPlay = !counted.current && (forceCount || pos >= Math.min(30, duration / 2));
      if (countPlay) counted.current = true;
      try {
        if (item.serverId)
          await native('remote_progress', {
            serverId: item.serverId,
            itemId: item.path,
            position: pos,
            paused: media.paused,
            stopped: done,
          });
        else
          await native('update_progress', {
            id: item.id,
            position: pos,
            duration,
            completed: done,
            countPlay,
          });
        if (countPlay || done) progressCallback.current();
      } catch {
        /* Local playback continues through temporary server failures. */
      }
    },
    [element],
  );

  useEffect(() => {
    const item = itemsRef.current.find((i) => i.id === state.currentId);
    const token = ++generation.current;
    for (const media of [audio.current, video.current]) {
      media?.pause();
      media?.removeAttribute('src');
      media?.load();
    }
    setError('');
    setPreparing(false);
    counted.current = false;
    prepared.current = false;
    lastSave.current = 0;
    if (!item) return;
    const chosen = item.kind === 'music' ? audio.current : video.current;
    if (!chosen) return;
    const media = chosen;
    set((s) => ({ ...s, position: 0, duration: item.duration }));
    const resume = startAt.current ?? (item.kind !== 'music' ? item.resume : 0);
    startAt.current = null;
    let loaded = false;
    const start = async () => {
      if (loaded || token !== generation.current) return;
      loaded = true;
      if (resume > 0 && resume < media.duration - 2)
        media.currentTime = Math.max(0, resume - (item.kind === 'music' ? 0 : 2));
      set((s) => ({
        ...s,
        duration: Number.isFinite(media.duration) ? media.duration : item.duration,
      }));
      if (stateRef.current.playing) {
        try {
          await media.play();
        } catch {
          set((s) => ({ ...s, playing: false }));
        }
      }
    };
    media.addEventListener('loadedmetadata', start);
    async function load() {
      try {
        await native('cancel_conversion');
      } catch {
        /* No active conversion. */
      }
      if (token !== generation.current) return;
      let url = mediaUrl(item!);
      if (
        !item!.serverId &&
        !['MP3', 'WAV', 'WAVE', 'M4A', 'AAC', 'FLAC', 'MP4', 'M4V', 'MOV'].includes(item!.format)
      ) {
        setPreparing(true);
        prepared.current = true;
        try {
          url = convertFileSrc(await native<string>('prepare_playback', { id: item!.id }));
        } catch (e) {
          if (token === generation.current) {
            setError(String(e));
            set((s) => ({ ...s, playing: false }));
          }
          return;
        } finally {
          if (token === generation.current) setPreparing(false);
        }
      }
      if (token !== generation.current) return;
      media.src = url;
      media.load();
    }
    void load();
    return () => {
      media.removeEventListener('loadedmetadata', start);
    };
  }, [state.currentId, state.index, current?.path]);

  useEffect(() => {
    const tick = () => {
      const media = element();
      if (!media || !currentRef.current) return;
      set((s) => ({
        ...s,
        position: media.currentTime || 0,
        duration: Number.isFinite(media.duration) ? media.duration : s.duration,
      }));
      if (media.currentTime - lastSave.current > 5 || media.currentTime < lastSave.current) {
        lastSave.current = media.currentTime;
        void persistProgress();
      }
    };
    const onPlay = () => {
      set((s) => ({ ...s, playing: true }));
      void enableAudio();
    };
    const onPause = (event: Event) => {
      const active = element();
      if (
        active &&
        event.target === active &&
        active.readyState > 0 &&
        active.paused &&
        !active.ended
      ) {
        set((s) => ({ ...s, playing: false }));
        void persistProgress();
      }
    };
    const ended = async () => {
      const token = generation.current;
      await persistProgress(true, true);
      if (token !== generation.current) return;
      const s = stateRef.current,
        next = nextIndex(s.index, s.queue.length, s.repeat, true);
      if (next === s.index) {
        const media = element();
        if (media) {
          media.currentTime = 0;
          counted.current = false;
          await media.play().catch(() => {});
        }
      } else if (next !== null)
        set((prev) => ({ ...prev, index: next, currentId: prev.queue[next], playing: true }));
      else set((prev) => ({ ...prev, playing: false, position: 0 }));
    };
    const failed = async () => {
      const item = currentRef.current,
        media = element(),
        token = generation.current;
      if (!item || !media || !media.error || media.error.code === 1) return;
      if (prepared.current || item.serverId) {
        setError(
          item.serverId
            ? 'This stream cannot be directly played by this system. Jellyfin transcoding is planned for the next build.'
            : 'This media could not be played. Try another file or rescan its folder.',
        );
        set((s) => ({ ...s, playing: false }));
        return;
      }
      prepared.current = true;
      setPreparing(true);
      try {
        const path = await native<string>('prepare_playback', { id: item.id });
        if (token !== generation.current) return;
        media.src = convertFileSrc(path);
        media.load();
        media.addEventListener(
          'canplay',
          () => {
            if (stateRef.current.playing) void media.play().catch(() => {});
          },
          { once: true },
        );
      } catch (e) {
        if (token === generation.current) {
          setError(String(e));
          set((s) => ({ ...s, playing: false }));
        }
      } finally {
        if (token === generation.current) setPreparing(false);
      }
    };
    for (const media of [audio.current, video.current]) {
      media?.addEventListener('timeupdate', tick);
      media?.addEventListener('play', onPlay);
      media?.addEventListener('pause', onPause);
      media?.addEventListener('ended', ended);
      media?.addEventListener('error', failed);
    }
    return () => {
      for (const media of [audio.current, video.current]) {
        media?.removeEventListener('timeupdate', tick);
        media?.removeEventListener('play', onPlay);
        media?.removeEventListener('pause', onPause);
        media?.removeEventListener('ended', ended);
        media?.removeEventListener('error', failed);
      }
    };
  }, [element, enableAudio, persistProgress]);

  const play = useCallback(
    async (item: MediaItem, collection: MediaItem[] = [item]) => {
      if (!item.available) {
        notify('Reconnect this source to play this item.');
        return;
      }
      await persistProgress();
      await enableAudio();
      let queue = collection.filter((i) => i.available).map((i) => i.id);
      if (!queue.includes(item.id)) queue = [item.id, ...queue];
      if (stateRef.current.shuffle)
        queue = [item.id, ...shuffled(queue.filter((id) => id !== item.id))];
      if (stateRef.current.currentId === item.id) {
        const media = element();
        if (media) {
          if (media.ended) media.currentTime = 0;
          await media.play().catch(() => notify('Press Play again to start playback.'));
        }
      }
      set((s) => ({
        ...s,
        queue,
        currentId: item.id,
        index: queue.indexOf(item.id),
        playing: true,
      }));
    },
    [element, enableAudio, notify, persistProgress],
  );

  const toggle = useCallback(async () => {
    await enableAudio();
    const media = element();
    if (!media || !stateRef.current.currentId) return;
    if (media.paused)
      await media.play().catch(() => notify('This file could not start. Try selecting it again.'));
    else media.pause();
  }, [element, enableAudio, notify]);
  const go = useCallback(
    async (direction: number) => {
      await persistProgress();
      const s = stateRef.current,
        media = element();
      if (direction < 0 && (media?.currentTime || 0) > 3) {
        if (media) media.currentTime = 0;
        return;
      }
      const idx =
        direction > 0 ? nextIndex(s.index, s.queue.length, s.repeat) : Math.max(0, s.index - 1);
      if (idx !== null) set((s) => ({ ...s, index: idx, currentId: s.queue[idx], playing: true }));
    },
    [element, persistProgress],
  );
  const seek = useCallback(
    (position: number) => {
      const media = element();
      if (media && Number.isFinite(position)) {
        media.currentTime = Math.max(
          0,
          Math.min(position, Number.isFinite(media.duration) ? media.duration : position),
        );
        set((s) => ({ ...s, position: media.currentTime }));
      }
    },
    [element],
  );
  const enqueue = useCallback(
    (id: string, next = false) => {
      set((s) => {
        const queue = [...s.queue];
        if (next) queue.splice(s.index + 1, 0, id);
        else queue.push(id);
        return { ...s, queue };
      });
      notify(next ? 'Added to play next' : 'Added to the queue');
    },
    [notify],
  );
  const toggleShuffle = useCallback(
    () =>
      set((s) => {
        const queue = s.shuffle
          ? s.queue
          : [...s.queue.slice(0, s.index + 1), ...shuffled(s.queue.slice(s.index + 1))];
        return { ...s, shuffle: !s.shuffle, queue };
      }),
    [],
  );
  const restore = useCallback((saved: Partial<PlayerState>) => {
    startAt.current = saved.position || 0;
    set({ ...initial, ...saved, playing: false });
  }, []);
  const jump = useCallback(
    async (index: number) => {
      await persistProgress();
      set((s) => ({ ...s, index, currentId: s.queue[index], playing: true }));
    },
    [persistProgress],
  );

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
    });
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => {
        void toggle();
      },
      pause: () => {
        void toggle();
      },
      previoustrack: () => {
        void go(-1);
      },
      nexttrack: () => {
        void go(1);
      },
      seekto: (d) => {
        if (d.seekTime !== undefined) seek(d.seekTime);
      },
      seekbackward: (d) => seek(stateRef.current.position - (d.seekOffset || 10)),
      seekforward: (d) => seek(stateRef.current.position + (d.seekOffset || 10)),
    };
    for (const [action, fn] of Object.entries(handlers))
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, fn!);
      } catch {
        /* OS-dependent action. */
      }
    return () => {
      for (const action of Object.keys(handlers))
        try {
          navigator.mediaSession.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* OS-dependent action. */
        }
    };
  }, [current, toggle, go, seek]);

  const stop = useCallback(async () => {
    await persistProgress();
    await native('cancel_conversion').catch(() => {});
    set((s) => ({ ...s, currentId: null, playing: false, position: 0, duration: 0 }));
  }, [persistProgress]);
  return {
    state,
    set,
    current,
    audio,
    video,
    graph,
    preparing,
    error,
    eq,
    setEq,
    element,
    play,
    toggle,
    go,
    seek,
    enqueue,
    toggleShuffle,
    restore,
    jump,
    persistProgress,
    stop,
  };
}
export type Player = ReturnType<typeof usePlayer>;
