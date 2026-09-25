import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushBack } from './back';
import type { IconType } from './ui';

export interface MenuItem {
  label: string;
  icon?: IconType;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  kbd?: string;
  checked?: boolean;
  testId?: string;
}
export type MenuEntry = MenuItem | 'sep' | { title: string };

interface MenuProps {
  anchor: HTMLElement | null;
  items?: MenuEntry[];
  children?: ReactNode;
  onClose: () => void;
  width?: number;
}

/** Popover anchored to an element; closes on outside tap, Escape or back. */
export function Menu({ anchor, items, children, onClose, width }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    let left = a.left;
    let top = a.bottom + 6;
    if (left + m.width > vw - 8) left = Math.max(8, a.right - m.width);
    if (top + m.height > vh - 8) top = Math.max(8, a.top - m.height - 6);
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const off = pushBack(() => {
      onClose();
      return true;
    });
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      off();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="menu" role="menu" style={{ ...pos, width }}>
      {items?.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" />;
        if ('title' in it) return <div key={i} className="menu-title">{it.title}</div>;
        const Icon = it.icon;
        return (
          <button
            key={i}
            type="button"
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked}
            className={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            data-testid={it.testId}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {Icon ? <Icon aria-hidden /> : it.checked !== undefined ? <span style={{ width: 18 }}>{it.checked ? '✓' : ''}</span> : null}
            <span className="grow">{it.label}</span>
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        );
      })}
      {children}
    </div>,
    document.body,
  );
}

/** Hook managing the open state of an anchored menu. */
export function useMenu(): { anchor: HTMLElement | null; open: (e: React.MouseEvent<HTMLElement>) => void; close: () => void } {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: (e) => setAnchor((cur) => (cur ? null : (e.currentTarget as HTMLElement))),
    close: () => setAnchor(null),
  };
}
