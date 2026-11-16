import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type MenuAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
  divider?: boolean;
  icon?: ReactNode;
};
export function ContextMenu({
  x,
  y,
  title,
  actions,
  close,
}: {
  x: number;
  y: number;
  title: string;
  actions: MenuAction[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) closeRef.current();
    };
    const dismiss = () => closeRef.current();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      if (menu.contains(document.activeElement) && previousFocus?.isConnected)
        previousFocus.focus();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [x, y, title]);
  return (
    <div
      ref={ref}
      className="app-context-menu"
      role="menu"
      aria-label={title}
      style={{ left: x, top: y }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          return;
        }
        if (e.key === 'Tab') {
          close();
          return;
        }
        const buttons = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : e.key === 'ArrowUp'
              ? (index - 1 + buttons.length) % buttons.length
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? buttons.length - 1
                  : -1;
        if (next >= 0) {
          e.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      <div className="app-context-title">{title}</div>
      {actions.map((action) => (
        <button
          type="button"
          role="menuitem"
          key={action.label}
          disabled={action.disabled}
          className={action.divider ? 'menu-divider' : ''}
          onClick={() => {
            close();
            action.run();
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
