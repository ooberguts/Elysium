import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Library, MediaItem } from './types';

export const desktop = isTauri();
export async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop) throw new Error('Open Elysium’s desktop app to import and play your collection.');
  return invoke<T>(command, args);
}
export const loadLibrary = () => native<Library>('get_library');
export function mediaUrl(item: MediaItem): string {
  return item.serverId
    ? convertFileSrc(`${item.serverId}/${item.path}/stream`, 'jellyfin')
    : convertFileSrc(item.path);
}
export function artworkUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith('jellyfin:')
    ? convertFileSrc(path.slice(9), 'jellyfin')
    : convertFileSrc(path);
}
export async function chooseFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    title: 'Add music and video',
    filters: [
      {
        name: 'Media files',
        extensions: [
          'mp3',
          'flac',
          'm4a',
          'aac',
          'alac',
          'wav',
          'aif',
          'aiff',
          'ogg',
          'oga',
          'opus',
          'wma',
          'ape',
          'wv',
          'mp4',
          'm4v',
          'mkv',
          'mov',
          'webm',
          'avi',
          'wmv',
          'mpg',
          'mpeg',
          'ts',
          'm2ts',
          'ogv',
        ],
      },
    ],
  });
  return result ? (Array.isArray(result) ? result : [result]) : [];
}
export async function chooseFolder(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: 'Choose a media folder or mounted network share',
  });
  return typeof result === 'string' ? result : null;
}
export async function savePath(name: string, extension: string): Promise<string | null> {
  return save({
    defaultPath: name,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}
export { open };
