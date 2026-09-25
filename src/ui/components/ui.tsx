import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';

export type IconType = ComponentType<{ size?: number | string; strokeWidth?: number; 'aria-hidden'?: boolean }>;

interface IconButtonProps {
  icon: IconType;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  toggled?: boolean;
  disabled?: boolean;
  danger?: boolean;
  small?: boolean;
  tipSide?: 'bottom' | 'right' | 'left' | 'top';
  badge?: boolean;
  className?: string;
  testId?: string;
}

/** Icon-only button with an accessible label and tooltip. */
export function IconButton({ icon: Icon, label, onClick, active, toggled, disabled, danger, small, tipSide, badge, className, testId }: IconButtonProps) {
  const cls = ['icon-btn', active && 'active', toggled && 'toggled', danger && 'danger', small && 'sm', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      aria-pressed={active || toggled ? true : undefined}
      data-tip={label}
      data-tip-side={tipSide}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden strokeWidth={1.9} />
      {badge && <span className="badge" />}
    </button>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  icon?: IconType;
  disabled?: boolean;
  small?: boolean;
  block?: boolean;
  type?: 'button' | 'submit';
  testId?: string;
  title?: string;
}

export function Button({ children, onClick, variant = 'default', icon: Icon, disabled, small, block, type = 'button', testId, title }: ButtonProps) {
  const cls = ['btn', variant !== 'default' && variant, small && 'small', block && 'block'].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} data-testid={testId} title={title}>
      {Icon && <Icon size={18} aria-hidden />}
      {children}
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Called when the user releases the slider. */
  onCommit?: (v: number) => void;
  format?: (v: number) => string;
  /** Display multiplier (e.g. 100 for percentages). */
  scale?: number;
  unit?: string;
  testId?: string;
  disabled?: boolean;
}

/** Labelled range input with an editable numeric value. */
export function Slider({ label, value, min, max, step = 1, onChange, onCommit, format, scale = 1, unit = '', testId, disabled }: SliderProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const fill = ((value - min) / (max - min || 1)) * 100;
  const shown = format ? format(value) : `${Math.round(value * scale * 100) / 100}${unit}`;
  const commitText = () => {
    if (text === null) return;
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n)) {
      const v = Math.min(max, Math.max(min, n / scale));
      onChange(v);
      onCommit?.(v);
    }
    setText(null);
  };
  return (
    <div className="slider">
      <label className="slider-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="slider-value"
        aria-label={`${label} (valeur)`}
        value={text ?? shown}
        disabled={disabled}
        onFocus={() => setText(String(Math.round(value * scale * 100) / 100))}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        data-testid={testId}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange, testId, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; testId?: string; disabled?: boolean }) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.5 } : undefined}>
      <span className="toggle-label">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} data-testid={testId} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
    </label>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: IconType;
  iconOnly?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, full, label }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; full?: boolean; label?: string }) {
  return (
    <div className={`segmented${full ? ' full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon aria-hidden />}
          {!o.iconOnly && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div id={id} style={{ display: 'contents' }}>
        {children}
      </div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function SelectInput<T extends string | number>({ value, options, onChange, label, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testId?: string }) {
  return (
    <select
      className="select"
      aria-label={label}
      value={String(value)}
      data-testid={testId}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Number input that commits on blur / Enter and clamps its value. */
export function NumberInput({ value, onChange, min, max, step = 1, label, testId, width }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; testId?: string; width?: number }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 1000) / 1000));
  }, [value]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(n)) return setText(String(value));
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (step >= 1) v = Math.round(v);
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <input
      className="input num"
      inputMode="decimal"
      aria-label={label}
      data-testid={testId}
      style={width ? { width } : undefined}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Progress({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div className={`progress${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Swatch({ color, selected, onClick, label, size = 28 }: { color: string; selected?: boolean; onClick?: () => void; label: string; size?: number }) {
  return (
    <button type="button" className={`swatch${selected ? ' selected' : ''}`} style={{ width: size, height: size }} aria-label={label} title={label} onClick={onClick}>
      <span style={{ background: toCssColor(color) }} />
    </button>
  );
}

export function toCssColor(hex: string): string {
  const s = hex.replace('#', '');
  if (s.length === 8) {
    const a = parseInt(s.slice(6, 8), 16) / 255;
    return `rgba(${parseInt(s.slice(0, 2), 16)},${parseInt(s.slice(2, 4), 16)},${parseInt(s.slice(4, 6), 16)},${a.toFixed(3)})`;
  }
  return hex;
}
