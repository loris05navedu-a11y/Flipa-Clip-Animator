export type BrushTool = 'brush' | 'pencil' | 'pen';
export type TipShape = 'round' | 'square';

export interface BrushSettings {
  /** Diameter in project pixels. */
  size: number;
  /** Stroke opacity 0..1 (no build-up inside a stroke). */
  opacity: number;
  /** Per-dab opacity 0..1 (build-up inside a stroke). */
  flow: number;
  /** 0 (soft) .. 1 (hard edge) */
  hardness: number;
  /** Distance between dabs as a fraction of the size. */
  spacing: number;
  /** Input smoothing 0..1 (moving average). */
  smoothing: number;
  /** Stabiliser 0..1 ("pulled string" radius). */
  stabilizer: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  /** Pressure curve exponent: <1 softer touch, >1 needs more pressure. */
  sensitivity: number;
  /** Minimum size at zero pressure, fraction of size. */
  minSize: number;
  shape: TipShape;
  /** Tip aspect ratio (1 = round, lower = flat/calligraphic). */
  roundness: number;
  /** Tip angle in degrees. */
  angle: number;
  /** Paper-grain texture strength 0..1. */
  grain: number;
  sizeJitter: number;
  opacityJitter: number;
  /** Random offset as a fraction of size. */
  scatter: number;
  antialias: boolean;
  /** Length (px) of the thin start of a stroke. */
  taper: number;
}

export interface BrushPreset {
  id: string;
  name: string;
  tool: BrushTool;
  builtin: boolean;
  settings: BrushSettings;
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 12,
  opacity: 1,
  flow: 1,
  hardness: 0.8,
  spacing: 0.1,
  smoothing: 0.35,
  stabilizer: 0,
  pressureSize: true,
  pressureOpacity: false,
  sensitivity: 1,
  minSize: 0.15,
  shape: 'round',
  roundness: 1,
  angle: 0,
  grain: 0,
  sizeJitter: 0,
  opacityJitter: 0,
  scatter: 0,
  antialias: true,
  taper: 0,
};

const b = (id: string, name: string, tool: BrushTool, s: Partial<BrushSettings>): BrushPreset => ({
  id,
  name,
  tool,
  builtin: true,
  settings: { ...DEFAULT_BRUSH, ...s },
});

/** Built-in presets. Names are i18n keys. */
export const BUILTIN_BRUSHES: BrushPreset[] = [
  b('b-round', 'brush.round', 'brush', { size: 14, hardness: 0.85, smoothing: 0.35 }),
  b('b-soft', 'brush.soft', 'brush', { size: 40, hardness: 0.1, flow: 0.35, pressureOpacity: true, pressureSize: false }),
  b('b-airbrush', 'brush.airbrush', 'brush', { size: 80, hardness: 0, flow: 0.08, spacing: 0.08, pressureSize: false, pressureOpacity: true }),
  b('b-marker', 'brush.marker', 'brush', { size: 22, hardness: 0.95, opacity: 0.7, shape: 'square', roundness: 0.6, angle: 30, pressureSize: false }),
  b('b-watercolor', 'brush.watercolor', 'brush', { size: 36, hardness: 0.3, flow: 0.25, opacity: 0.8, grain: 0.35, sizeJitter: 0.1, pressureOpacity: true }),
  b('b-charcoal', 'brush.charcoal', 'brush', { size: 18, hardness: 0.6, flow: 0.7, grain: 0.7, scatter: 0.05, sizeJitter: 0.15, pressureOpacity: true }),
  b('b-fill', 'brush.flat', 'brush', { size: 30, hardness: 1, roundness: 0.35, angle: 45, smoothing: 0.4 }),
  b('p-hb', 'pencil.hb', 'pencil', { size: 3, hardness: 1, grain: 0.35, spacing: 0.15, smoothing: 0.1, pressureOpacity: true, pressureSize: false, antialias: true }),
  b('p-pixel', 'pencil.pixel', 'pencil', { size: 1, hardness: 1, spacing: 0.05, smoothing: 0, pressureSize: false, antialias: false, shape: 'square' }),
  b('p-sketch', 'pencil.sketch', 'pencil', { size: 6, hardness: 0.7, flow: 0.5, opacity: 0.8, grain: 0.55, pressureOpacity: true, pressureSize: true }),
  b('i-ink', 'pen.ink', 'pen', { size: 6, hardness: 0.97, spacing: 0.05, smoothing: 0.55, stabilizer: 0.2, minSize: 0.05, sensitivity: 1.2, taper: 20 }),
  b('i-fine', 'pen.fineliner', 'pen', { size: 3, hardness: 1, spacing: 0.05, smoothing: 0.5, pressureSize: false }),
  b('i-calli', 'pen.calligraphy', 'pen', { size: 16, hardness: 1, roundness: 0.2, angle: 40, spacing: 0.04, smoothing: 0.5, minSize: 0.3 }),
  b('i-brushpen', 'pen.brushpen', 'pen', { size: 12, hardness: 0.95, spacing: 0.04, smoothing: 0.6, stabilizer: 0.3, minSize: 0.02, sensitivity: 1.5, taper: 30 }),
];

export interface EraserSettings {
  size: number;
  opacity: number;
  hardness: number;
  shape: TipShape;
  smoothing: number;
  stabilizer: number;
  pressureSize: boolean;
  /** freehand, or erase a whole rectangle / lasso area */
  mode: 'freehand' | 'rect' | 'lasso';
}

export const DEFAULT_ERASER: EraserSettings = {
  size: 24,
  opacity: 1,
  hardness: 0.9,
  shape: 'round',
  smoothing: 0.3,
  stabilizer: 0,
  pressureSize: false,
  mode: 'freehand',
};

export function eraserToBrush(e: EraserSettings): BrushSettings {
  return {
    ...DEFAULT_BRUSH,
    size: e.size,
    opacity: e.opacity,
    hardness: e.hardness,
    shape: e.shape,
    smoothing: e.smoothing,
    stabilizer: e.stabilizer,
    pressureSize: e.pressureSize,
    pressureOpacity: false,
    minSize: 0.2,
    spacing: 0.08,
  };
}

/** Normalise untrusted brush data (imported projects / storage). */
export function sanitizeBrush(input: unknown): BrushPreset | null {
  if (typeof input !== 'object' || !input) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  const tool: BrushTool = o.tool === 'pencil' || o.tool === 'pen' ? o.tool : 'brush';
  const s = (typeof o.settings === 'object' && o.settings ? o.settings : {}) as Record<string, unknown>;
  const out: BrushSettings = { ...DEFAULT_BRUSH };
  const n = (k: keyof BrushSettings, min: number, max: number) => {
    const v = s[k];
    if (typeof v === 'number' && Number.isFinite(v)) (out as unknown as Record<string, number>)[k] = Math.min(max, Math.max(min, v));
  };
  n('size', 1, 1000);
  n('opacity', 0.01, 1);
  n('flow', 0.01, 1);
  n('hardness', 0, 1);
  n('spacing', 0.01, 2);
  n('smoothing', 0, 0.95);
  n('stabilizer', 0, 1);
  n('sensitivity', 0.2, 4);
  n('minSize', 0, 1);
  n('roundness', 0.05, 1);
  n('angle', -360, 360);
  n('grain', 0, 1);
  n('sizeJitter', 0, 1);
  n('opacityJitter', 0, 1);
  n('scatter', 0, 3);
  n('taper', 0, 400);
  out.pressureSize = s.pressureSize !== false;
  out.pressureOpacity = s.pressureOpacity === true;
  out.antialias = s.antialias !== false;
  out.shape = s.shape === 'square' ? 'square' : 'round';
  return { id: o.id.slice(0, 64), name: o.name.slice(0, 60), tool, builtin: false, settings: out };
}
