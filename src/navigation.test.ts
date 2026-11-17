import { describe, expect, it } from 'vitest';
import { step, visit } from './navigation';

describe('library navigation', () => {
  it('returns between artist and album pages and drops forward history after a new destination', () => {
    const artist = visit({ entries: ['home'], index: 0 }, 'artist:Artist');
    const album = visit(artist, 'album:Artist\0Album');
    expect(step(album, -1).entries[step(album, -1).index]).toBe('artist:Artist');
    const replacement = visit(step(album, -1), 'music');
    expect(replacement.entries).toEqual(['home', 'artist:Artist', 'music']);
    expect(step(replacement, 1)).toEqual(replacement);
    expect(visit(replacement, 'music')).toBe(replacement);
  });
});
