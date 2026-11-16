import type { MediaItem } from './types';

type Checkpoint = { position: number; completed: boolean };
const key = (id: string) => `elysium.listening.${id}`;

// A synchronous checkpoint covers application/OS exits between SQLite saves.
// Each book has its own key; another queue item can never overwrite its position.
export function checkpoint(item: MediaItem, position: number, completed = false) {
  if (item.kind !== 'audiobook' || !Number.isFinite(position)) return;
  try {
    localStorage.setItem(
      key(item.id),
      JSON.stringify({
        position: completed ? 0 : Math.max(0, position),
        completed,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    /* SQLite remains the durable fallback. */
  }
}

export function listeningProgress(item: MediaItem): Checkpoint {
  if (item.kind === 'audiobook') {
    try {
      const value = JSON.parse(localStorage.getItem(key(item.id)) || 'null');
      if (
        value &&
        Number.isFinite(value.position) &&
        value.position >= 0 &&
        typeof value.completed === 'boolean' &&
        (value.updatedAt || 0) >= (item.progressUpdatedAt || 0)
      )
        return {
          position: value.completed ? 0 : Math.min(value.position, item.duration || value.position),
          completed: value.completed,
        };
    } catch {
      /* Use the library checkpoint when browser storage is unavailable. */
    }
  }
  return { position: item.resume, completed: item.watched };
}

export function resumePosition(item: MediaItem, restored?: number | null) {
  if (item.kind === 'audiobook') return listeningProgress(item).position;
  return restored ?? (item.kind === 'music' ? 0 : item.resume);
}
