/** Colour conversions. RGB channels are 0..255, alpha 0..1, H 0..360, S/V/L 0..1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
export interface HSL {
  h: number;
  s: number;
  l: number;
}

const c255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hex2 = (v: number) => c255(v).toString(16).padStart(2, '0');

/** Parse #rgb, #rgba, #rrggbb or #rrggbbaa. Returns null on invalid input. */
export function parseHex(input: string): RGBA | null {
  let s = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(s)) return null;
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 };
}

export function toHex(c: RGBA, withAlpha = true): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return withAlpha ? base + hex2(c.a * 255) : base;
}

export function toCss(c: RGBA): string {
  return `rgba(${c255(c.r)},${c255(c.g)},${c255(c.b)},${Math.max(0, Math.min(1, c.a)).toFixed(3)})`;
}

export function hexToCss(hex: string): string {
  const c = parseHex(hex);
  return c ? toCss(c) : 'rgba(0,0,0,1)';
}

export function rgbToHsv({ r, g, b }: RGBA): HSV {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV, a = 1): RGBA {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

export function rgbToHsl({ r, g, b }: RGBA): HSL {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const { h } = rgbToHsv({ r, g, b, a: 1 });
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL, a = 1): RGBA {
  const v = l + s * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return hsvToRgb({ h, s: sv, v }, a);
}

/** Relative luminance (for choosing readable text colours). */
export function luminance({ r, g, b }: RGBA): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function colorDistance(a: RGBA, b: RGBA): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a) * 255);
}
