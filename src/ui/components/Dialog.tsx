import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { isTopBack, pushBack } from './back';
import { IconButton } from './ui';

interface DialogProps {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'wide' | 'normal';
  testId?: string;
  /** Prevent closing by tapping outside (long operations). */
  modal?: boolean;
}

export function Dialog({ title, onClose, children, footer, size = 'normal', testId, modal }: DialogProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)');
    (first ?? ref.current)?.focus({ preventScroll: true });
    const handler = () => {
      if (closeRef.current && !modal) closeRef.current();
      return true;
    };
    const off = pushBack(handler);
    // Escape closes the top-most dialog wherever the focus is.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopBack(handler)) {
        e.stopPropagation();
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      off();
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [modal]);
  return (
    <div
      className="overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !modal) onClose?.();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog ${size === 'normal' ? '' : size}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        data-testid={testId}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          {onClose && !modal && <IconButton icon={X} label={t('common.close')} onClick={onClose} small />}
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
