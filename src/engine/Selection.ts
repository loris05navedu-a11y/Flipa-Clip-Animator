import type { Pt } from '../core/geometry/matrix';
import type { Rect } from '../core/util/math';
import { alphaBounds } from '../core/raster/fill';
import { createCanvas, ctx2d } from './canvas';

/**
 * A pixel selection: a full-size alpha mask plus cached helpers for display.
 * Rectangle and lasso selections keep their outline path for crisp display.
 */
export class Selection {
  readonly mask: HTMLCanvasElement;
  bounds: Rect | null = null;
  /** Outline polygon in project space when known (rect / lasso). */
  path: Pt[] | null = null;
  private outlineCache: HTMLCanvasElement | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.mask = createCanvas(width, height);
  }

  static rect(w: number, h: number, r: Rect): Selection {
    const s = new Selection(w, h);
    const ctx = ctx2d(s.mask);
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    s.path = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
    s.recomputeBounds();
    return s;
  }

  static polygon(w: number, h: number, pts: Pt[]): Selection {
    const s = new Selection(w, h);
    const ctx = ctx2d(s.mask);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    s.path = pts.map((p) => ({ ...p }));
    s.recomputeBounds();
    return s;
  }

  /** From a byte mask (1 per pixel), e.g. the magic wand result. */
  static fromMask(w: number, h: number, mask: Uint8Array): Selection {
    const s = new Selection(w, h);
    const ctx = ctx2d(s.mask);
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
    ctx.putImageData(img, 0, 0);
    s.recomputeBounds();
    return s;
  }

  clone(): Selection {
    const s = new Selection(this.width, this.height);
    ctx2d(s.mask).drawImage(this.mask, 0, 0);
    s.bounds = this.bounds ? { ...this.bounds } : null;
    s.path = this.path ? this.path.map((p) => ({ ...p })) : null;
    return s;
  }

  /** Combine with another selection. */
  combine(other: Selection, op: 'add' | 'subtract' | 'intersect'): void {
    const ctx = ctx2d(this.mask);
    ctx.save();
    ctx.globalCompositeOperation = op === 'add' ? 'source-over' : op === 'subtract' ? 'destination-out' : 'destination-in';
    ctx.drawImage(other.mask, 0, 0);
    ctx.restore();
    this.path = null;
    this.recomputeBounds();
  }

  invert(): void {
    const ctx = ctx2d(this.mask);
    ctx.save();
    ctx.globalCompositeOperation = 'xor';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
    this.path = null;
    this.recomputeBounds();
  }

  recomputeBounds(): void {
    this.outlineCache = null;
    const data = ctx2d(this.mask, { willReadFrequently: true }).getImageData(0, 0, this.width, this.height);
    this.bounds = alphaBounds(data, 8);
  }

  get isEmpty(): boolean {
    return !this.bounds;
  }

  /** Byte mask (for fills restricted to the selection). */
  byteMask(): Uint8Array {
    const data = ctx2d(this.mask).getImageData(0, 0, this.width, this.height).data;
    const out = new Uint8Array(this.width * this.height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    return out;
  }

  /**
   * Outline image (edge pixels of the mask) used to display free-form
   * selections. Computed as mask minus its 1px erosion.
   */
  outline(): HTMLCanvasElement | null {
    if (!this.bounds) return null;
    if (this.outlineCache) return this.outlineCache;
    const b = this.bounds;
    const pad = 2;
    const w = b.w + pad * 2,
      h = b.h + pad * 2;
    const eroded = createCanvas(w, h);
    const ectx = ctx2d(eroded);
    ectx.drawImage(this.mask, b.x - pad, b.y - pad, w, h, 0, 0, w, h);
    ectx.globalCompositeOperation = 'destination-in';
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      ectx.drawImage(this.mask, b.x - pad + dx, b.y - pad + dy, w, h, 0, 0, w, h);
    const out = createCanvas(w, h);
    const octx = ctx2d(out);
    octx.drawImage(this.mask, b.x - pad, b.y - pad, w, h, 0, 0, w, h);
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(eroded, 0, 0);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = '#1a73ff';
    octx.fillRect(0, 0, w, h);
    (out as unknown as { ox: number; oy: number }).ox = b.x - pad;
    (out as unknown as { ox: number; oy: number }).oy = b.y - pad;
    this.outlineCache = out;
    return out;
  }
}
