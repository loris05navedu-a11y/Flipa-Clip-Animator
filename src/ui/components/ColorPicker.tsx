import { useEffect, useRef, useState } from 'react';
import { hsvToRgb, parseHex, rgbToHsl, rgbToHsv, hslToRgb, toHex, type HSV } from '../../core/color/color';
import { useT } from '../../i18n';
import { Segmented, Slider } from './ui';

const SIZE = 216;
const RING = 20;

/** Colour wheel (hue ring + SV square) with numeric RGB / HSV / HSL / HEX / alpha. */
export function ColorPicker({ value, onChange, onCommit }: { value: string; onChange: (hex: string) => void; onCommit?: (hex: string) => void }) {
  const t = useT();
  const rgba = parseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  // Keep hue/saturation stable when the colour becomes grey/black.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(rgba));
  const lastHex = useRef(value);
  useEffect(() => {
    if (value !== lastHex.current) {
      const n = rgbToHsv(parseHex(value) ?? rgba);
      setHsv((h) => ({ h: n.s === 0 || n.v === 0 ? h.h : n.h, s: n.v === 0 ? h.s : n.s, v: n.v }));
      lastHex.current = value;
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'hsv' | 'rgb' | 'hsl'>('hsv');
  const [hexText, setHexText] = useState<string | null>(null);
  const wheel = useRef<HTMLCanvasElement>(null);
  const drag = useRef<'ring' | 'square' | null>(null);

  const emit = (next: HSV, a = rgba.a, commit = false) => {
    setHsv(next);
    const hex = toHex(hsvToRgb(next, a));
    lastHex.current = hex;
    onChange(hex);
    if (commit) onCommit?.(hex);
  };
  const emitRgb = (hex: string, commit = false) => {
    lastHex.current = hex;
    const n = rgbToHsv(parseHex(hex)!);
    setHsv((h) => ({ h: n.s === 0 ? h.h : n.h, s: n.s, v: n.v }));
    onChange(hex);
    if (commit) onCommit?.(hex);
  };

  // Draw the wheel.
  useEffect(() => {
    const c = wheel.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2,
      cy = SIZE / 2,
      R = SIZE / 2 - 2;
    const grad = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    for (let i = 0; i <= 12; i++) grad.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, R - RING, 0, Math.PI * 2, true);
    ctx.fillStyle = grad;
    ctx.fill();
    // SV square inscribed in the ring.
    const half = ((R - RING - 6) * Math.SQRT2) / 2;
    const x0 = cx - half,
      y0 = cy - half,
      s = half * 2;
    ctx.fillStyle = `hsl(${hsv.h},100%,50%)`;
    ctx.fillRect(x0, y0, s, s);
    const gw = ctx.createLinearGradient(x0, 0, x0 + s, 0);
    gw.addColorStop(0, '#fff');
    gw.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gw;
    ctx.fillRect(x0, y0, s, s);
    const gb = ctx.createLinearGradient(0, y0, 0, y0 + s);
    gb.addColorStop(0, 'rgba(0,0,0,0)');
    gb.addColorStop(1, '#000');
    ctx.fillStyle = gb;
    ctx.fillRect(x0, y0, s, s);
    // Markers
    const ang = (hsv.h * Math.PI) / 180 - Math.PI / 2;
    const rr = R - RING / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, RING / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x0 + hsv.s * s, y0 + (1 - hsv.v) * s, 7, 0, Math.PI * 2);
    ctx.strokeStyle = hsv.v > 0.6 && hsv.s < 0.4 ? '#222' : '#fff';
    ctx.stroke();
  }, [hsv]);

  const pick = (e: React.PointerEvent, commit = false) => {
    const rect = wheel.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    const cx = SIZE / 2,
      cy = SIZE / 2,
      R = SIZE / 2 - 2;
    const d = Math.hypot(x - cx, y - cy);
    if (!drag.current) drag.current = d > R - RING - 3 ? 'ring' : 'square';
    if (drag.current === 'ring') {
      let h = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      if (h < 0) h += 360;
      emit({ ...hsv, h }, rgba.a, commit);
    } else {
      const half = ((R - RING - 6) * Math.SQRT2) / 2;
      const s = Math.min(1, Math.max(0, (x - (cx - half)) / (half * 2)));
      const v = 1 - Math.min(1, Math.max(0, (y - (cy - half)) / (half * 2)));
      emit({ ...hsv, s, v }, rgba.a, commit);
    }
  };

  const hsl = rgbToHsl(rgba);
  return (
    <div className="color-picker">
      <canvas
        ref={wheel}
        className="color-wheel"
        style={{ width: SIZE, height: SIZE }}
        role="img"
        aria-label={t('color.wheel')}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = null;
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
        onPointerUp={(e) => {
          pick(e, true);
          drag.current = null;
        }}
      />
      <div className="col" style={{ gap: 6, minWidth: 0, flex: 1 }}>
        <div className="row">
          <label className="field-label" htmlFor="hex-input">
            {t('color.hex')}
          </label>
          <input
            id="hex-input"
            className="input"
            style={{ fontFamily: 'ui-monospace, monospace' }}
            value={hexText ?? value.toUpperCase()}
            data-testid="hex-input"
            onChange={(e) => setHexText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => {
              const c = hexText ? parseHex(hexText) : null;
              if (c) emitRgb(toHex(c), true);
              setHexText(null);
            }}
          />
        </div>
        <Segmented
          value={mode}
          full
          label="mode"
          onChange={setMode}
          options={[
            { value: 'hsv', label: t('color.hsv') },
            { value: 'rgb', label: t('color.rgb') },
            { value: 'hsl', label: t('color.hsl') },
          ]}
        />
        {mode === 'hsv' && (
          <>
            <Slider label={t('color.h')} value={hsv.h} min={0} max={360} onChange={(h) => emit({ ...hsv, h })} onCommit={() => onCommit?.(lastHex.current)} unit="°" />
            <Slider label={t('color.s')} value={hsv.s} min={0} max={1} step={0.01} scale={100} unit="%" onChange={(s) => emit({ ...hsv, s })} onCommit={() => onCommit?.(lastHex.current)} />
            <Slider label={t('color.v')} value={hsv.v} min={0} max={1} step={0.01} scale={100} unit="%" onChange={(v) => emit({ ...hsv, v })} onCommit={() => onCommit?.(lastHex.current)} />
          </>
        )}
        {mode === 'rgb' &&
          (['r', 'g', 'b'] as const).map((k) => (
            <Slider key={k} label={t(`color.${k}`)} value={Math.round(rgba[k])} min={0} max={255} onChange={(v) => emitRgb(toHex({ ...rgba, [k]: v }))} onCommit={() => onCommit?.(lastHex.current)} />
          ))}
        {mode === 'hsl' && (
          <>
            <Slider label={t('color.h')} value={hsl.h} min={0} max={360} unit="°" onChange={(h) => emitRgb(toHex(hslToRgb({ ...hsl, h }, rgba.a)))} onCommit={() => onCommit?.(lastHex.current)} />
            <Slider label={t('color.s')} value={hsl.s} min={0} max={1} step={0.01} scale={100} unit="%" onChange={(s) => emitRgb(toHex(hslToRgb({ ...hsl, s }, rgba.a)))} onCommit={() => onCommit?.(lastHex.current)} />
            <Slider label={t('color.l')} value={hsl.l} min={0} max={1} step={0.01} scale={100} unit="%" onChange={(l) => emitRgb(toHex(hslToRgb({ ...hsl, l }, rgba.a)))} onCommit={() => onCommit?.(lastHex.current)} />
          </>
        )}
        <Slider label={t('color.alpha')} value={rgba.a} min={0} max={1} step={0.01} scale={100} unit="%" onChange={(a) => emit(hsv, a)} onCommit={() => onCommit?.(lastHex.current)} />
      </div>
    </div>
  );
}
