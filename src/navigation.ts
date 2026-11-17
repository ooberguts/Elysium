import { useCallback, useState } from 'react';
import type { View } from './types';

export type Navigation = { entries: View[]; index: number };
export function visit(state: Navigation, view: View): Navigation {
  if (state.entries[state.index] === view) return state;
  return { entries: [...state.entries.slice(0, state.index + 1), view], index: state.index + 1 };
}
export function step(state: Navigation, direction: -1 | 1): Navigation {
  const index = Math.max(0, Math.min(state.entries.length - 1, state.index + direction));
  return { ...state, index };
}
export function useNavigation() {
  const [state, setState] = useState<Navigation>({ entries: ['home'], index: 0 });
  const setView = useCallback((view: View) => setState((state) => visit(state, view)), []);
  const go = useCallback((direction: -1 | 1) => setState((state) => step(state, direction)), []);
  return {
    view: state.entries[state.index],
    setView,
    go,
    canBack: state.index > 0,
    canForward: state.index < state.entries.length - 1,
  };
}
