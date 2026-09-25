export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
export const isEmptyRect = (r: Rect | null | undefined): boolean => !r || r.w <= 0 || r.h <= 0;

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || isEmptyRect(a)) return b && !isEmptyRect(b) ? { ...b } : null;
  if (!b || isEmptyRect(b)) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bt <= y) return null;
  return { x, y, w: r - x, h: bt - y };
}

/** Expand to integer pixel bounds and clip to the canvas. */
export function pixelRect(r: Rect, width: number, height: number, pad = 0): Rect | null {
  const x = Math.floor(r.x - pad);
  const y = Math.floor(r.y - pad);
  const rr = Math.ceil(r.x + r.w + pad);
  const b = Math.ceil(r.y + r.h + pad);
  return intersectRect({ x, y, w: rr - x, h: b - y }, { x: 0, y: 0, w: width, h: height });
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}
