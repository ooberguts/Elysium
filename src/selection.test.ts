import { expect, it } from 'vitest';
import { contextSelection, selectLibraryItem } from './selection';
const a = { id: 'a' },
  b = { id: 'b' },
  c = { id: 'c' };
it('targets the song under the pointer when it is outside the current selection', () => {
  expect(contextSelection([a, b, c], new Set(['a', 'b']), c)).toEqual([c]);
});
it('keeps a selected group, including filtered-out items, without repeating playlist entries', () => {
  expect(contextSelection([b, a, b, c], new Set(['a', 'b', 'c']), b)).toEqual([b, a, c]);
});
it('never produces an empty context menu for a clicked item during a library refresh', () => {
  expect(contextSelection([], new Set(['b']), b)).toEqual([b]);
});

it('touch selection toggles items without modifier keys', () => {
  const first = selectLibraryItem([a, b, c], new Set(['a']), b, 0, {
    touch: true,
    additive: false,
    range: false,
  });
  expect([...first]).toEqual(['a', 'b']);
  expect([
    ...selectLibraryItem([a, b, c], first, a, 1, { touch: true, additive: false, range: false }),
  ]).toEqual(['b']);
});
it('standard selection and shift ranges retain their existing behavior', () => {
  expect([
    ...selectLibraryItem([a, b, c], new Set(['a']), b, 0, {
      touch: false,
      additive: false,
      range: false,
    }),
  ]).toEqual(['b']);
  expect([
    ...selectLibraryItem([a, b, c], new Set(['a']), c, 0, {
      touch: false,
      additive: false,
      range: true,
    }),
  ]).toEqual(['a', 'b', 'c']);
});
