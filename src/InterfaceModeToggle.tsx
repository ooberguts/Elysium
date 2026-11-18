import { Hand } from 'lucide-react';

export function InterfaceModeToggle({ touch, toggle }: { touch: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className="interface-mode-toggle"
      aria-label="Touch mode"
      aria-pressed={touch}
      title={touch ? 'Switch to standard controls' : 'Switch to touch-friendly controls'}
      onClick={toggle}
    >
      <Hand size={16} />
      <span>Touch mode</span>
      <small>{touch ? 'On' : 'Off'}</small>
    </button>
  );
}
