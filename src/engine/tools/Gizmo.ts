import { angle, apply, compose, invert, rotate, skewX, transformedCorners, type Pt, type TransformParams } from '../../core/geometry/matrix';
import type { Viewport } from '../Viewport';

export type Handle = 'move' | 'rotate' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const SIGNS: Record<string, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  nw: [-1, -1],
  ne: [1, -1],
  sw: [-1, 1],
  se: [1, 1],
};

export interface GizmoTarget {
  get(): { t: TransformParams; w: number; h: number };
  set(t: TransformParams): void;
}

export interface GizmoOptions {
  proportional: () => boolean;
  snapRotation: () => boolean;
  snapPoint?: (p: Pt) => Pt;
}

/** Move / scale / rotate handles for any transformable content. */
export class Gizmo {
  private active: Handle | null = null;
  private start: { p: Pt; t: TransformParams } | null = null;

  constructor(
    private target: GizmoTarget,
    private opts: GizmoOptions,
  ) {}

  get dragging(): boolean {
    return this.active !== null;
  }

  private screenCorners(vp: Viewport): Pt[] {
    const { t, w, h } = this.target.get();
    return transformedCorners(t, w, h).map((p) => vp.screenOf(p.x, p.y));
  }

  private handles(vp: Viewport): { id: Handle; p: Pt }[] {
    const [tl, tr, br, bl] = this.screenCorners(vp);
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const top = mid(tl, tr);
    const centre = mid(tl, br);
    const up = { x: top.x - centre.x, y: top.y - centre.y };
    const len = Math.hypot(up.x, up.y) || 1;
    const rot = { x: top.x + (up.x / len) * 32, y: top.y + (up.y / len) * 32 };
    return [
      { id: 'nw', p: tl },
      { id: 'ne', p: tr },
      { id: 'se', p: br },
      { id: 'sw', p: bl },
      { id: 'n', p: top },
      { id: 'e', p: mid(tr, br) },
      { id: 's', p: mid(br, bl) },
      { id: 'w', p: mid(bl, tl) },
      { id: 'rotate', p: rot },
    ];
  }

  hitTest(sx: number, sy: number, vp: Viewport, touch = false): Handle | null {
    const r = touch ? 24 : 12;
    let best: Handle | null = null;
    let bestD = r;
    for (const h of this.handles(vp)) {
      const d = Math.hypot(h.p.x - sx, h.p.y - sy);
      if (d <= bestD) {
        bestD = d;
        best = h.id;
      }
    }
    if (best) return best;
    return pointInPolygon({ x: sx, y: sy }, this.screenCorners(vp)) ? 'move' : null;
  }

  begin(handle: Handle, p: Pt): void {
    this.active = handle;
    this.start = { p, t: { ...this.target.get().t } };
  }

  drag(p: Pt, shift = false): void {
    if (!this.active || !this.start) return;
    const t0 = this.start.t;
    const { w, h } = this.target.get();
    const t = { ...t0 };
    if (this.active === 'move') {
      t.cx = t0.cx + p.x - this.start.p.x;
      t.cy = t0.cy + p.y - this.start.p.y;
      if (this.opts.snapPoint) {
        const s = this.opts.snapPoint({ x: t.cx, y: t.cy });
        t.cx = s.x;
        t.cy = s.y;
      }
    } else if (this.active === 'rotate') {
      const c = { x: t0.cx, y: t0.cy };
      let r = t0.rotation + angle(c, p) - angle(c, this.start.p);
      if (this.opts.snapRotation() || shift) {
        const step = Math.PI / 12;
        r = Math.round(r / step) * step;
      }
      t.rotation = r;
    } else {
      const [hx, hy] = SIGNS[this.active];
      // Work in the content's local (unrotated, unskewed but scaled) frame.
      const rk = compose(rotate(t0.rotation), skewX(t0.skew));
      const toLocal = invert(rk);
      const q = apply(toLocal, { x: p.x - t0.cx, y: p.y - t0.cy });
      const anchor = { x: (-hx * w * t0.sx) / 2, y: (-hy * h * t0.sy) / 2 };
      let sx = t0.sx,
        sy = t0.sy;
      const corner = hx !== 0 && hy !== 0;
      if (corner && (this.opts.proportional() || shift)) {
        const d = { x: hx * w * t0.sx, y: hy * h * t0.sy };
        const f = ((q.x - anchor.x) * d.x + (q.y - anchor.y) * d.y) / (d.x * d.x + d.y * d.y || 1);
        sx = t0.sx * f;
        sy = t0.sy * f;
      } else {
        if (hx !== 0) sx = (q.x - anchor.x) / (hx * w);
        if (hy !== 0) sy = (q.y - anchor.y) / (hy * h);
      }
      const minS = 1 / Math.max(w, h);
      if (Math.abs(sx) < minS) sx = sx < 0 ? -minS : minS;
      if (Math.abs(sy) < minS) sy = sy < 0 ? -minS : minS;
      const handle = { x: anchor.x + hx * w * sx, y: anchor.y + hy * h * sy };
      const midLocal = { x: hx ? (anchor.x + handle.x) / 2 : 0, y: hy ? (anchor.y + handle.y) / 2 : 0 };
      // Keep the non-dragged axis centre where it was.
      const c = apply(rk, midLocal);
      t.sx = sx;
      t.sy = sy;
      t.cx = t0.cx + c.x;
      t.cy = t0.cy + c.y;
    }
    this.target.set(t);
  }

  end(): void {
    this.active = null;
    this.start = null;
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, accent = '#6c5ce7'): void {
    const corners = this.screenCorners(vp);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent;
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    const hs = this.handles(vp);
    const top = hs.find((h) => h.id === 'n')!.p;
    const rot = hs.find((h) => h.id === 'rotate')!.p;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
    for (const h of hs) {
      ctx.beginPath();
      if (h.id === 'rotate') ctx.arc(h.p.x, h.p.y, 7, 0, Math.PI * 2);
      else ctx.rect(h.p.x - 5.5, h.p.y - 5.5, 11, 11);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}
