import type { Snapshot } from './useBroadcast';

export function pauseAction(state: Pick<Snapshot, 'station' | 'listening' | 'paused'>) {
  if (state.station?.active) return { command: 'broadcast_pause', paused: !state.station.paused };
  if (state.listening?.active && state.listening.phase !== 'paused')
    return { command: 'broadcast_pause_room', paused: !state.paused };
  return null;
}
