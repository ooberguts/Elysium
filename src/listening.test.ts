import { beforeEach, expect, it, vi } from 'vitest';
import { checkpoint, listeningProgress, resumePosition } from './listening';
import { viewItems } from './domain';
import { EMPTY_LIBRARY, type MediaItem } from './types';
const book = (id: string, resume = 30) =>
  ({ id, kind: 'audiobook', duration: 7200, resume, watched: false }) as MediaItem;
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
it('restores each book independently, ahead of an older saved queue position', () => {
  checkpoint(book('a'), 1834.75);
  checkpoint(book('b'), 406.25);
  expect(resumePosition(book('a'), 2)).toBe(1834.75);
  expect(resumePosition(book('b'), 2)).toBe(406.25);
  expect(resumePosition(book('unopened'), 0)).toBe(30);
});
it('saves backwards seeks and starts completed books at the beginning', () => {
  checkpoint(book('a'), 1800);
  checkpoint(book('a'), 42);
  expect(resumePosition(book('a'))).toBe(42);
  checkpoint(book('a'), 7200, true);
  expect(listeningProgress(book('a'))).toEqual({ position: 0, completed: true });
});
it('survives unavailable storage using the durable library position', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw Error('unavailable');
    },
    setItem: () => {
      throw Error('unavailable');
    },
  });
  checkpoint(book('a'), 100);
  expect(resumePosition(book('a', 88), 1)).toBe(88);
});
it('keeps audiobooks separate from songs and movies', () => {
  const items = [book('a'), { ...book('song'), kind: 'music' as const }];
  expect(viewItems('audiobooks', EMPTY_LIBRARY, items).map((i) => i.id)).toEqual(['a']);
  expect(viewItems('music', EMPTY_LIBRARY, items).map((i) => i.id)).toEqual(['song']);
});

it('uses newer broadcast progress instead of an older local player checkpoint', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  checkpoint(book('a'), 20);
  expect(resumePosition({ ...book('a', 44), progressUpdatedAt: 2000 })).toBe(44);
  vi.restoreAllMocks();
});
