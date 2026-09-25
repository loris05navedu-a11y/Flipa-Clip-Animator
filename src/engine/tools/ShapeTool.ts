import { hexToCss } from '../../core/color/color';
import { tools, type ShapeSettings } from '../../editor/toolStore';
import type { Pt } from '../../core/geometry/matrix';
import { pixelRect, type Rect } from '../../core/util/math';
import { copyRegion, ctx2d, pool } from '../canvas';
import type { CelLink } from '../commands';
import type { Tool, ToolHost, ToolPointer } from './Tool';

/** Build the path of a shape between two points. */
export function shapePath(ctx: CanvasRenderingContext2D | Path2D, s: ShapeSettings, a: Pt, b: Pt): void {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x),
    h = Math.abs(b.y - a.y);
  const cx = x + w / 2,
    cy = y + h / 2;
  switch (s.kind) {
    case 'line':
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      break;
    case 'arrow': {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const head = Math.min(len * 0.4, Math.max(12, s.width * 4));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      break;
    }
    case 'rect':
      if (s.radius > 0 && 'roundRect' in ctx) (ctx as CanvasRenderingContext2D).roundRect(x, y, w, h, Math.min(s.radius, w / 2, h / 2));
      else ctx.rect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.min(64, Math.round(s.sides)));
      const pts = s.kind === 'star' ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const t = -Math.PI / 2 + (i * Math.PI * 2) / pts;
        const r = s.kind === 'star' && i % 2 ? s.innerRatio : 1;
        const px = cx + Math.cos(t) * (w / 2) * r,
          py = cy + Math.sin(t) * (h / 2) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
  }
}

export class ShapeTool implements Tool {
  readonly id = 'shape' as const;
  cursor = 'crosshair';
  private a: Pt | null = null;
  private snapshot: HTMLCanvasElement | null = null;
  private target: { celId: string; canvas: HTMLCanvasElement; link: CelLink | null } | null = null;
  private last: Rect | null = null;
  private total: Rect | null = null;

  constructor(private host: ToolHost) {}

  down(p: ToolPointer): void {
    const s = this.host.session;
    const blocker = s.editBlocker();
    if (blocker) return this.host.toast(blocker === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
    const t = s.activeCanvasSync();
    if (!t) return this.host.toast('toast.loading', 'info');
    if (t.link) s.linkCel(t.link.frameId, t.link.layerId, t.link.celId);
    this.target = t;
    this.snapshot = pool.acquire(t.canvas.width, t.canvas.height);
    ctx2d(this.snapshot).drawImage(t.canvas, 0, 0);
    this.a = this.host.snap(p);
    this.total = null;
    s.interacting = true;
  }

  private endPoint(p: ToolPointer): Pt {
    const cfg = tools().shape;
    let b = this.host.snap(p);
    const a = this.a!;
    if (cfg.constrain || p.shift) {
      if (cfg.kind === 'line' || cfg.kind === 'arrow') {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      } else {
        const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        b = { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d };
      }
    }
    return b;
  }

  private draw(p: ToolPointer): void {
    const t = this.target!;
    const s = this.host.session;
    const cfg = tools().shape;
    let a = this.a!;
    let b = this.endPoint(p);
    if (cfg.fromCenter && cfg.kind !== 'line' && cfg.kind !== 'arrow') {
      a = { x: 2 * this.a!.x - b.x, y: 2 * this.a!.y - b.y };
    }
    const ctx = ctx2d(t.canvas);
    // Restore the previous preview region.
    if (this.last) {
      const r = this.last;
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(this.snapshot!, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    const mats = this.host.viewport.symmetry();
    const pad = cfg.width + 4;
    let bounds: Rect | null = null;
    const col = tools();
    const strokeColor = hexToCss(col.primary);
    const fillColor = hexToCss(cfg.stroke ? col.secondary : col.primary);
    const layer = pool.acquire(t.canvas.width, t.canvas.height);
    const lctx = ctx2d(layer);
    for (const m of mats) {
      lctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      lctx.beginPath();
      shapePath(lctx, cfg, a, b);
      lctx.lineJoin = 'round';
      lctx.lineCap = 'round';
      if (cfg.fill && cfg.kind !== 'line' && cfg.kind !== 'arrow') {
        lctx.fillStyle = fillColor;
        lctx.fill();
      }
      if (cfg.stroke || cfg.kind === 'line' || cfg.kind === 'arrow' || !cfg.fill) {
        lctx.lineWidth = cfg.width;
        lctx.strokeStyle = strokeColor;
        lctx.stroke();
      }
      const corners = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }].map((q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }));
      const xs = corners.map((q) => q.x),
        ys = corners.map((q) => q.y);
      const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      bounds = bounds
        ? { x: Math.min(bounds.x, r.x), y: Math.min(bounds.y, r.y), w: Math.max(bounds.x + bounds.w, r.x + r.w) - Math.min(bounds.x, r.x), h: Math.max(bounds.y + bounds.h, r.y + r.h) - Math.min(bounds.y, r.y) }
        : r;
    }
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    const rect = bounds ? pixelRect(bounds, t.canvas.width, t.canvas.height, pad) : null;
    if (rect) {
      if (s.selection) {
        lctx.globalCompositeOperation = 'destination-in';
        lctx.drawImage(s.selection.mask, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
        lctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = cfg.opacity;
      ctx.drawImage(layer, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
    }
    pool.release(layer);
    const inv = this.last && rect ? union(this.last, rect) : (rect ?? this.last);
    this.last = rect;
    if (rect) this.total = this.total ? union(this.total, rect) : rect;
    if (inv) this.host.viewport.invalidateRect(inv);
  }

  move(points: ToolPointer[], hover: boolean): void {
    if (hover || !this.a || !this.target) return;
    this.draw(points[points.length - 1]);
  }

  up(p: ToolPointer): void {
    if (!this.a || !this.target) return;
    this.draw(p);
    const s = this.host.session;
    const t = this.target;
    const rect = this.total;
    s.interacting = false;
    if (rect && (Math.abs(p.x - this.a.x) > 0.5 || Math.abs(p.y - this.a.y) > 0.5)) {
      s.commitPixels('history.shape', [{ celId: t.celId, rect, before: copyRegion(this.snapshot!, rect), after: copyRegion(t.canvas, rect) }], t.link ? [t.link] : []);
    } else {
      this.restore();
      if (t.link) s.linkCel(t.link.frameId, t.link.layerId, null);
    }
    this.finish();
  }

  private restore(): void {
    if (this.total && this.target && this.snapshot) {
      const r = this.total;
      const ctx = ctx2d(this.target.canvas);
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(this.snapshot, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      this.host.viewport.invalidateRect(r);
    }
  }

  private finish(): void {
    if (this.snapshot) pool.release(this.snapshot);
    this.snapshot = null;
    this.a = null;
    this.target = null;
    this.last = null;
    this.total = null;
  }

  cancel(): void {
    if (!this.a) return;
    this.restore();
    const t = this.target;
    if (t?.link) this.host.session.linkCel(t.link.frameId, t.link.layerId, null);
    this.host.session.interacting = false;
    this.finish();
  }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
