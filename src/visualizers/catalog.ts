export const VISUALIZER_FAMILIES = [
  { id: 'signature', label: 'Elysium living worlds' },
  { id: 'wmp', label: 'Windows Media Player inspired' },
  { id: 'itunes', label: 'iTunes inspired' },
  { id: 'xbox', label: 'Original Xbox inspired' },
  { id: 'xbox360', label: 'Xbox 360 inspired' },
  { id: 'essentials', label: 'Elysium essentials' },
] as const;

export type VisualizerFamily = (typeof VISUALIZER_FAMILIES)[number]['id'];
export type VisualizerQuality = 'balanced' | 'high';
export type VisualizerStyle =
  | 'current'
  | 'garden'
  | 'aurora'
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
    description: 'An all-screen kaleidoscope of liquid color and recursive light.',
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
    description: 'A tilted celestial ring in a field of stars.',
    hue: 215,
  },
  {
    id: 'stardust',
    family: 'itunes',
    name: 'Stardust',
    description: 'Spiral nebulae, star fields, and drifting light.',
    hue: 30,
  },
  {
    id: 'reactor',
    family: 'xbox',
    name: 'Emerald Reactor',
    description: 'A sculpted plasma core with luminous veins.',
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
    description: 'Electric ribbons inside a shifting, mirrored color field.',
    hue: 300,
  },
  {
    id: 'tunnel',
    family: 'xbox360',
    name: 'Infinity Tunnel',
    description: 'A psychedelic flight through rippling walls of neon light.',
    hue: 225,
  },
  {
    id: 'bloom',
    family: 'xbox360',
    name: 'Cosmic Bloom',
    description: 'Fractal flowers and mirrored color surge with the bass.',
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
  {
    id: 'current',
    family: 'signature',
    name: 'Chromatic Current',
    description:
      'Iridescent liquid folds into flowing rivers of color. Bass moves the current; percussion leaves luminous traces.',
    hue: 185,
  },
  {
    id: 'garden',
    family: 'signature',
    name: 'Fractal Sanctuary',
    description:
      'A living Julia fractal: branching filaments unfurl, curl, and transform with the music.',
    hue: 285,
  },
  {
    id: 'aurora',
    family: 'signature',
    name: 'Aurora Cathedral',
    description:
      'Immense silk curtains of light breathe and intertwine. Melodies shape the folds; high notes ignite their edges.',
    hue: 165,
  },
];

export const DEFAULT_VISUALIZER = 'current';
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

/** Show mode keeps the immersive scenes together instead of cutting to meters. */
export function nextShowPreset(id: string, previous: string, random = Math.random) {
  const choices = VISUALIZER_PRESETS.filter(
    (p) => p.family !== 'essentials' && p.id !== id && p.id !== previous,
  );
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}
