import { expect, it } from 'vitest';
import { AudioFeaturesReader } from './audio';
import { MusicalMotion, ShowClock } from './motion';
import { nextShowPreset } from './catalog';
const features = () =>
  Object.assign(new AudioFeaturesReader().features, {
    energy: 0.5,
    rms: 0.4,
    bassSlow: 0.5,
    midSlow: 0.4,
    trebleSlow: 0.2,
    centroid: 0.4,
    sustain: 0.5,
  });

it('integrates musical motion consistently at 30 and 60 fps, freezing silence and pause', () => {
  const a = new MusicalMotion(),
    b = new MusicalMotion(),
    f = features();
  for (let i = 0; i < 300; i++) a.update(1 / 30, f, true, false);
  for (let i = 0; i < 600; i++) b.update(1 / 60, f, true, false);
  expect(a.time).toBeCloseTo(b.time, 8);
  expect(a.morph).toBeCloseTo(b.morph, 8);
  const held = { ...a };
  a.update(0.1, f, false, false);
  a.update(0.1, f, true, true);
  a.update(0.1, { ...f, energy: 0 }, true, false);
  expect({ ...a }).toEqual(held);
});
it('waits for a fresh musical accent after its minimum dwell, never advancing in silence', () => {
  const clock = new ShowClock(),
    f = features();
  for (let i = 0; i < 470; i++) expect(clock.tick(0.1, f, true, false)).toBe(false);
  f.onsetId++;
  expect(clock.tick(0.1, f, true, false)).toBe(true);
  for (let i = 0; i < 900; i++)
    expect(clock.tick(0.1, { ...f, energy: 0 }, true, false)).toBe(false);
  expect(clock.elapsed).toBe(0);
  expect(clock.tick(0.1, f, true, true)).toBe(false);
});
it('gives ambient music a bounded dwell and keeps the show away from meters or recent scenes', () => {
  const clock = new ShowClock(),
    f = features();
  let changed = false;
  for (let i = 0; i < 810 && !changed; i++) changed = clock.tick(0.1, f, true, false);
  expect(changed).toBe(true);
  for (let i = 0; i < 100; i++) {
    const scene = nextShowPreset('current', 'garden', () => i / 100);
    expect(scene.family).not.toBe('essentials');
    expect(['current', 'garden']).not.toContain(scene.id);
  }
});
