import { createCanvas, ctx2d } from '../canvas';
import type { TipShape } from './types';

/**
 * Brush tips are alpha masks rendered once and cached, then tinted with the
 * current colour. Anti-aliased tips are rendered at a power-of-two resolution
 * and scaled; aliased (pixel) tips are rendered at their exact integer size.
 */
const tipCache = new Map<string, HTMLCanvasElement>();
const colorCache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE = 48;

function remember<K, V>(map: Map<K, V>, key: K, value: V): V {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value as K);
  map.set(key, value);
  return value;
}

export function tipResolution(diameter: number, antialias: boolean): number {
  if (!antialias) return Math.max(1, Math.round(diameter));
  const d = Math.max(8, Math.min(512, Math.ceil(diameter)));
  return 2 ** Math.ceil(Math.log2(d));
}

function renderTip(res: number, hardness: number, shape: TipShape, antialias: boolean): HTMLCanvasElement {
  const c = createCanvas(res, res);
  const ctx = ctx2d(c);
  const r = res / 2;
  if (!antialias) {
    const img = ctx.createImageData(res, res);
    for (let y = 0; y < res; y++)
      for (let x = 0; x < res; x++) {
        const dx = x + 0.5 - r,
          dy = y + 0.5 - r;
        const inside = shape === 'square' || dx * dx + dy * dy <= r * r + (res <= 2 ? 1 : 0);
        if (inside) img.data[(y * res + x) * 4 + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const h = Math.min(0.999, Math.max(0, hardness));
  if (shape === 'square') {
    if (h > 0.95) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, res, res);
    } else {
      // Soft square: blur approximation with inset rectangles.
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const inset = (1 - h) * r * t;
        ctx.globalAlpha = 1 / steps + (h * 0.5) / steps;
        ctx.fillRect(inset, inset, res - 2 * inset, res - 2 * inset);
      }
    }
    return c;
  }
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(h, 'rgba(0,0,0,1)');
  if (h < 0.9) g.addColorStop(h + (1 - h) * 0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function getTip(res: number, hardness: number, shape: TipShape, antialias: boolean): HTMLCanvasElement {
  const key = `${res}|${hardness.toFixed(2)}|${shape}|${antialias}`;
  return tipCache.get(key) ?? remember(tipCache, key, renderTip(res, hardness, shape, antialias));
}

/** Tip tinted with a solid colour (alpha mask * colour). */
export function getColoredTip(res: number, hardness: number, shape: TipShape, antialias: boolean, color: string): HTMLCanvasElement {
  const key = `${res}|${hardness.toFixed(2)}|${shape}|${antialias}|${color}`;
  const hit = colorCache.get(key);
  if (hit) return hit;
  const mask = getTip(res, hardness, shape, antialias);
  const c = createCanvas(res, res);
  const ctx = ctx2d(c);
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, res, res);
  return remember(colorCache, key, c);
}

let grain: HTMLCanvasElement | null = null;
/** Tileable paper-grain noise used by textured brushes. */
export function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const size = 128;
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // Value noise at two octaves for an organic paper feel.
  const cell = (s: number) => {
    const n = size / s;
    const v = new Float32Array((n + 1) * (n + 1)).map(() => rnd());
    return (x: number, y: number) => {
      const gx = (x / s) % n,
        gy = (y / s) % n;
      const x0 = Math.floor(gx),
        y0 = Math.floor(gy);
      const fx = gx - x0,
        fy = gy - y0;
      const at = (i: number, j: number) => v[((j % n) * (n + 1)) + (i % n)];
      const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      return a * (1 - fy) + b * fy;
    };
  };
  const o1 = cell(4),
    o2 = cell(2);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = o1(x, y) * 0.55 + o2(x, y) * 0.3 + rnd() * 0.15;
      img.data[(y * size + x) * 4 + 3] = Math.round(Math.pow(v, 1.6) * 255);
    }
  ctx.putImageData(img, 0, 0);
  grain = c;
  return c;
}
