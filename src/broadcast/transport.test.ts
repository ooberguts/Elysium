import { expect, it } from 'vitest';
import { pauseAction } from './transport';
import type { Snapshot } from './useBroadcast';

it('host pause controls every room, even without local playback', () => {
  const state = {
    station: { active: true, paused: false, playHere: false },
    listening: null,
    paused: false,
  } as Snapshot;
  expect(pauseAction(state)).toEqual({ command: 'broadcast_pause', paused: true });
  state.station!.paused = true;
  expect(pauseAction(state)).toEqual({ command: 'broadcast_pause', paused: false });
});
it('listener pause only controls its own room and cannot resume a paused host', () => {
  const state = {
    station: null,
    listening: { active: true, phase: 'playing' },
    paused: false,
  } as Snapshot;
  expect(pauseAction(state)).toEqual({ command: 'broadcast_pause_room', paused: true });
  state.paused = true;
  expect(pauseAction(state)).toEqual({ command: 'broadcast_pause_room', paused: false });
  state.listening!.phase = 'paused';
  expect(pauseAction(state)).toBeNull();
});
