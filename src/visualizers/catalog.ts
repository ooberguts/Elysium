export const VISUALIZER_FAMILIES = [
  { id: 'wmp', label: 'Windows Media Player inspired' },
  { id: 'itunes', label: 'iTunes inspired' },
  { id: 'xbox', label: 'Original Xbox inspired' },
  { id: 'xbox360', label: 'Xbox 360 inspired' },
  { id: 'essentials', label: 'Elysium essentials' },
] as const;

export type VisualizerFamily = (typeof VISUALIZER_FAMILIES)[number]['id'];
export type VisualizerQuality = 'balanced' | 'high';
export type VisualizerStyle =
  | 'prism'
  | 'ocean'
  | 'dots'
  | 'ribbons'
  | 'celestial'
  | 'stardust'
  | 'reactor'
  | 'liquid'
  | 'matrix'
  | 'neon'
  | 'tunnel'
  | 'bloom'
  | 'spectrum'
  | 'waveform'
  | 'ambient';

export type VisualizerPreset = {
  id: VisualizerStyle;
  family: VisualizerFamily;
  name: string;
  description: string;
  hue: number;
};

// These are Elysium's original renderers, not the proprietary engines or presets.
export const VISUALIZER_PRESETS: readonly VisualizerPreset[] = [
  {
    id: 'prism',
    family: 'wmp',
    name: 'Prismatic Alchemy',
    description: 'Kaleidoscopic petals and phosphor trails.',
    hue: 280,
  },
  {
    id: 'ocean',
    family: 'wmp',
    name: 'Spectral Ocean',
    description: 'Layers of luminous waves on a midnight sea.',
    hue: 200,
  },
  {
    id: 'dots',
    family: 'wmp',
    name: 'Dot Plane',
    description: 'A rolling landscape of sound and light.',
    hue: 190,
  },
  {
    id: 'ribbons',
    family: 'itunes',
    name: 'Classic Light Ribbons',
    description: 'Flowing rainbow ribbons, straight out of the CD era.',
    hue: 325,
  },
  {
    id: 'celestial',
    family: 'itunes',
    name: 'Celestial Orbits',
    description: 'An orbiting cloud of stars around a glowing core.',
    hue: 215,
  },
  {
    id: 'stardust',
    family: 'itunes',
    name: 'Stardust',
    description: 'Spiraling particles and long, colorful light trails.',
    hue: 30,
  },
  {
    id: 'reactor',
    family: 'xbox',
    name: 'Emerald Reactor',
    description: 'Green plasma, breathing membranes, and a molten core.',
    hue: 112,
  },
  {
    id: 'liquid',
    family: 'xbox',
    name: 'Liquid Chamber',
    description: 'An organic, luminous shell suspended in the dark.',
    hue: 140,
  },
  {
    id: 'matrix',
    family: 'xbox',
    name: 'Verdant Matrix',
    description: 'A green wire lattice pulsing with the bass.',
    hue: 105,
  },
  {
    id: 'neon',
    family: 'xbox360',
    name: 'Neon Continuum',
    description: 'Sweeping 3D light ribbons and electric color.',
    hue: 300,
  },
  {
    id: 'tunnel',
    family: 'xbox360',
    name: 'Infinity Tunnel',
    description: 'A twisting flight through concentric neon geometry.',
    hue: 225,
  },
  {
    id: 'bloom',
    family: 'xbox360',
    name: 'Cosmic Bloom',
    description: 'Symmetric laser flowers unfurl with every beat.',
    hue: 275,
  },
  {
    id: 'spectrum',
    family: 'essentials',
    name: 'Spectrum',
    description: 'The classic frequency meter.',
    hue: 168,
  },
  {
    id: 'waveform',
    family: 'essentials',
    name: 'Oscilloscope',
    description: 'An unfiltered view of the playing waveform.',
    hue: 168,
  },
  {
    id: 'ambient',
    family: 'essentials',
    name: 'Ambient Glow',
    description: 'A quiet pool of color that follows the music.',
    hue: 180,
  },
];

export const DEFAULT_VISUALIZER = 'ribbons';
export function getVisualizer(id: string | undefined): VisualizerPreset {
  return (
    VISUALIZER_PRESETS.find((p) => p.id === id) ||
    VISUALIZER_PRESETS.find((p) => p.id === DEFAULT_VISUALIZER)!
  );
}
export function stepVisualizer(id: string, direction: number): VisualizerPreset {
  const index = VISUALIZER_PRESETS.indexOf(getVisualizer(id));
  return VISUALIZER_PRESETS[
    (index + (Math.trunc(direction) % VISUALIZER_PRESETS.length) + VISUALIZER_PRESETS.length) %
      VISUALIZER_PRESETS.length
  ];
}
export function randomVisualizer(id: string, random = Math.random): VisualizerPreset {
  const choices = VISUALIZER_PRESETS.filter((p) => p.id !== getVisualizer(id).id);
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}

/** Only time spent visibly playing counts toward a preset rotation. */
export class PresetClock {
  elapsed = 0;
  tick(seconds: number, active: boolean, reducedMotion: boolean): boolean {
    if (!active || reducedMotion) return false;
    this.elapsed += Math.max(0, Math.min(seconds, 1));
    if (this.elapsed < 30) return false;
    this.elapsed = 0;
    return true;
  }
}
