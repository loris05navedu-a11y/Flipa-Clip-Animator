import { apply, type Mat } from '../../core/geometry/matrix';
import { intersectRect, pixelRect, unionRect, type Rect } from '../../core/util/math';
import { copyRegion, ctx2d, pool } from '../canvas';
import { getColoredTip, grainTile, tipResolution } from './tips';
import type { BrushSettings } from './types';

export interface InputPoint {
  x: number;
  y: number;
  /** 0..1 */
  pressure: number;
}

export interface StrokeParams {
  target: HTMLCanvasElement;
  settings: BrushSettings;
  /** CSS colour of the paint (ignored when erasing). */
  color: string;
  erase: boolean;
  symmetry: Mat[];
  /** Selection mask (project size) limiting where paint lands. */
  clipMask: HTMLCanvasElement | null;
  /** Current zoom, used to express the stabiliser radius in screen pixels. */
  zoom: number;
  /** When false, pressure is ignored (mouse, touch, or disabled in settings). */
  usePressure: boolean;
  /** Global multiplier from app settings (1 = neutral). */
  globalSmoothing?: number;
}

export interface StrokeResult {
  rect: Rect | null;
  before: HTMLCanvasElement | null;
  after: HTMLCanvasElement | null;
}

/** Pulled-string stabiliser followed by exponential smoothing. */
export class Smoother {
  private b: InputPoint | null = null;
  private s: InputPoint | null = null;
  constructor(
    private radius: number,
    private smoothing: number,
  ) {}

  push(p: InputPoint): InputPoint | null {
    if (!this.b) {
      this.b = { ...p };
      this.s = { ...p };
      return { ...p };
    }
    const b = this.b;
    const dx = p.x - b.x,
      dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (this.radius > 0) {
      if (d <= this.radius) {
        b.pressure = p.pressure;
        return null;
      }
      const k = (d - this.radius) / d;
      b.x += dx * k;
      b.y += dy * k;
    } else {
      b.x = p.x;
      b.y = p.y;
    }
    b.pressure = p.pressure;
    const s = this.s!;
    const a = 1 - this.smoothing;
    s.x += (b.x - s.x) * a;
    s.y += (b.y - s.y) * a;
    s.pressure += (b.pressure - s.pressure) * Math.min(1, a * 1.5);
    return { ...s };
  }

  /** Points that bring the stroke to the pen's final position. */
  finish(last: InputPoint): InputPoint[] {
    if (!this.s) return [];
    const s = this.s;
    const out: InputPoint[] = [];
    const d = Math.hypot(last.x - s.x, last.y - s.y);
    const steps = Math.min(24, Math.ceil(d / 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      out.push({ x: s.x + (last.x - s.x) * t, y: s.y + (last.y - s.y) * t, pressure: s.pressure + (last.pressure - s.pressure) * t });
    }
    return out;
  }
}

/**
 * A single brush / eraser stroke.
 *
 * Dabs are accumulated in a scratch buffer at full strength; the buffer is
 * then composited onto a snapshot of the layer with the stroke opacity. This
 * gives correct translucent strokes (no darkening where the stroke overlaps
 * itself), live eraser preview and a free "before" image for undo.
 */
export class Stroke {
  private snapshot: HTMLCanvasElement;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private tctx: CanvasRenderingContext2D;
  private smoother: Smoother;
  private pts: InputPoint[] = [];
  private lastDab: InputPoint | null = null;
  private residual = 0;
  private travelled = 0;
  private pending: Rect | null = null;
  private total: Rect | null = null;
  private lastInput: InputPoint | null = null;
  private seed = 1;
  private w: number;
  private h: number;
  private tip: HTMLCanvasElement;
  private tipRes: number;
  private done = false;

  constructor(private p: StrokeParams) {
    const { target } = p;
    this.w = target.width;
    this.h = target.height;
    this.snapshot = pool.acquire(this.w, this.h);
    ctx2d(this.snapshot).drawImage(target, 0, 0);
    this.buffer = pool.acquire(this.w, this.h);
    this.bctx = ctx2d(this.buffer);
    this.tctx = ctx2d(target);
    const s = p.settings;
    const stabPx = s.stabilizer * 48; // screen pixels
    const smoothing = Math.min(0.95, s.smoothing * (p.globalSmoothing ?? 1));
    this.smoother = new Smoother(stabPx / Math.max(0.05, p.zoom), smoothing * 0.9);
    this.tipRes = tipResolution(s.size, s.antialias);
    this.tip = getColoredTip(this.tipRes, s.hardness, s.shape, s.antialias, p.erase ? '#000' : p.color);
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private pressure(raw: number): number {
    if (!this.p.usePressure) return 1;
    const v = Math.min(1, Math.max(0, raw));
    return Math.pow(v, this.p.settings.sensitivity);
  }

  private sizeAt(pr: number): number {
    const s = this.p.settings;
    let f = 1;
    if (s.pressureSize) f = s.minSize + (1 - s.minSize) * pr;
    if (s.taper > 0 && this.travelled < s.taper) {
      const t = this.travelled / s.taper;
      f *= s.minSize + (1 - s.minSize) * Math.sqrt(t);
    }
    return Math.max(s.antialias ? 0.5 : 1, s.size * f);
  }

  private dab(x: number, y: number, rawPressure: number): void {
    const s = this.p.settings;
    const pr = this.pressure(rawPressure);
    let d = this.sizeAt(pr);
    if (s.sizeJitter) d *= 1 - s.sizeJitter * this.rnd();
    let alpha = s.flow * (s.pressureOpacity ? Math.max(0.05, pr) : 1);
    if (s.opacityJitter) alpha *= 1 - s.opacityJitter * this.rnd();
    if (s.scatter) {
      const a = this.rnd() * Math.PI * 2;
      const r = this.rnd() * s.scatter * s.size;
      x += Math.cos(a) * r;
      y += Math.sin(a) * r;
    }
    const ctx = this.bctx;
    ctx.globalAlpha = Math.min(1, Math.max(0.003, alpha));
    const angle = (s.angle * Math.PI) / 180;
    const hh = d * s.roundness;
    for (const m of this.p.symmetry) {
      const c = apply(m, { x, y });
      if (!s.antialias) {
        const di = Math.max(1, Math.round(d));
        const px = Math.round(c.x - di / 2);
        const py = Math.round(c.y - di / 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.tip, px, py, di, di);
        this.addDirty(px - 1, py - 1, di + 2, di + 2);
        continue;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.drawImage(this.tip, -d / 2, -hh / 2, d, hh);
      const r = d / 2 + 2;
      this.addDirty(c.x - r, c.y - r, r * 2, r * 2);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private addDirty(x: number, y: number, w: number, h: number): void {
    const r = { x, y, w, h };
    this.pending = unionRect(this.pending, r);
  }

  /** Lay dabs along a straight segment with the configured spacing. */
  private segment(a: InputPoint, b: InputPoint): void {
    const s = this.p.settings;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    let t = this.residual;
    while (t <= len) {
      const k = t / len;
      const pr = a.pressure + (b.pressure - a.pressure) * k;
      this.dab(a.x + dx * k, a.y + dy * k, pr);
      const d = this.sizeAt(this.pressure(pr));
      const step = s.antialias ? Math.max(0.5, d * s.spacing) : Math.max(1, Math.round(d * s.spacing));
      t += step;
    }
    this.residual = t - len;
    this.travelled += len;
  }

  /** Add smoothed points, drawing quadratic curves through midpoints. */
  private addSmoothed(p: InputPoint): void {
    const pts = this.pts;
    pts.push(p);
    if (pts.length === 1) {
      this.dab(p.x, p.y, p.pressure);
      this.lastDab = p;
      const s = this.p.settings;
      const d = this.sizeAt(this.pressure(p.pressure));
      this.residual = s.antialias ? Math.max(0.5, d * s.spacing) : Math.max(1, Math.round(d * s.spacing));
      return;
    }
    if (pts.length < 3) return;
    const [p0, p1, p2] = pts.slice(-3);
    const m0 = pts.length === 3 ? p0 : mid(p0, p1);
    const m1 = mid(p1, p2);
    this.curve(m0, p1, m1);
    if (pts.length > 3) pts.shift();
  }

  private curve(a: InputPoint, c: InputPoint, b: InputPoint): void {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    const n = Math.max(1, Math.min(64, Math.ceil(len / 3)));
    let prev = this.lastDab ?? a;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const q: InputPoint = {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        pressure: u * u * a.pressure + 2 * u * t * c.pressure + t * t * b.pressure,
      };
      this.segment(prev, q);
      prev = q;
    }
    this.lastDab = prev;
  }

  /** Feed raw input points. Returns the region of the layer that changed. */
  add(points: InputPoint[]): Rect | null {
    if (this.done) return null;
    for (const p of points) {
      this.lastInput = p;
      const s = this.smoother.push(p);
      if (s) this.addSmoothed(s);
    }
    return this.flush();
  }

  /** Composite pending dabs onto the layer. */
  private flush(): Rect | null {
    if (!this.pending) return null;
    const r = pixelRect(this.pending, this.w, this.h);
    this.pending = null;
    if (!r) return null;
    this.total = unionRect(this.total, r);
    this.compose(r);
    return r;
  }

  private compose(r: Rect): void {
    const s = this.p.settings;
    const t = this.tctx;
    t.save();
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(r.x, r.y, r.w, r.h);
    t.drawImage(this.snapshot, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    let src: HTMLCanvasElement = this.buffer;
    let sx = r.x,
      sy = r.y;
    if (this.p.clipMask || s.grain > 0) {
      src = copyRegion(this.buffer, r);
      sx = 0;
      sy = 0;
      const c = ctx2d(src);
      if (s.grain > 0) {
        c.globalCompositeOperation = 'destination-out';
        c.globalAlpha = s.grain;
        const pat = c.createPattern(grainTile(), 'repeat')!;
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, -r.x, -r.y]));
        c.fillStyle = pat;
        c.fillRect(0, 0, r.w, r.h);
      }
      if (this.p.clipMask) {
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(this.p.clipMask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      }
    }
    t.globalAlpha = s.opacity;
    t.globalCompositeOperation = this.p.erase ? 'destination-out' : 'source-over';
    t.drawImage(src, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
    t.restore();
  }

  /** Finish the stroke and return undo patches for the changed region. */
  end(): StrokeResult {
    if (this.done) return { rect: null, before: null, after: null };
    if (this.lastInput) {
      for (const q of this.smoother.finish(this.lastInput)) this.addSmoothed(q);
      if (this.pts.length >= 2) {
        const last = this.pts[this.pts.length - 1];
        const prev = this.pts[this.pts.length - 2];
        this.curve(this.pts.length === 2 ? prev : mid(prev, last), last, last);
      }
    }
    this.flush();
    this.done = true;
    const rect = this.total ? intersectRect(this.total, { x: 0, y: 0, w: this.w, h: this.h }) : null;
    let before: HTMLCanvasElement | null = null;
    let after: HTMLCanvasElement | null = null;
    if (rect) {
      before = copyRegion(this.snapshot, rect);
      after = copyRegion(this.p.target, rect);
    }
    this.release();
    return { rect, before, after };
  }

  /** Abort: restore the layer as it was. */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    if (this.total) {
      const r = this.total;
      const t = this.tctx;
      t.save();
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.globalAlpha = 1;
      t.clearRect(r.x, r.y, r.w, r.h);
      t.drawImage(this.snapshot, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      t.restore();
    }
    this.release();
  }

  get changedRect(): Rect | null {
    return this.total;
  }

  private release(): void {
    pool.release(this.snapshot);
    pool.release(this.buffer);
  }
}

const mid = (a: InputPoint, b: InputPoint): InputPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2 });
