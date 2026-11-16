import { expect, it } from 'vitest';
import { contextSelection } from './selection';
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
