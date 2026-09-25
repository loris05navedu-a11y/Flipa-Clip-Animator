import { regionMask } from '../../core/raster/fill';
import type { Pt } from '../../core/geometry/matrix';
import { tools, type SelectOp } from '../../editor/toolStore';
import { liftSelection } from '../../editor/selectionOps';
import { readCtx } from '../canvas';
import { Selection } from '../Selection';
import type { Viewport } from '../Viewport';
import { samplingCanvas } from './FillTool';
import { rectPoly } from './BrushTool';
import type { Tool, ToolHost, ToolPointer } from './Tool';

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  cursor = 'crosshair';
  private pts: Pt[] | null = null;
  private start: Pt | null = null;
  private op: SelectOp = 'new';
  private moving: { p: Pt; cx: number; cy: number } | null = null;
  private liftPending = false;

  constructor(private host: ToolHost) {}

  private opFor(p: ToolPointer): SelectOp {
    if (p.shift) return 'add';
    if (p.alt) return 'subtract';
    return tools().select.op;
  }

  private insideSelection(p: ToolPointer): boolean {
    const sel = this.host.session.selection;
    if (!sel?.bounds) return false;
    const x = Math.floor(p.x),
      y = Math.floor(p.y);
    if (x < sel.bounds.x || y < sel.bounds.y || x >= sel.bounds.x + sel.bounds.w || y >= sel.bounds.y + sel.bounds.h) return false;
    return readCtx(sel.mask).getImageData(x, y, 1, 1).data[3] > 127;
  }

  down(p: ToolPointer): void {
    const s = this.host.session;
    this.op = this.opFor(p);
    const cfg = tools().select;
    if (this.op === 'new' && cfg.mode !== 'wand' && this.insideSelection(p) && !s.editBlocker()) {
      // Drag inside the selection: move the pixels.
      this.liftPending = true;
      const start = { x: p.x, y: p.y };
      void liftSelection(s).then((f) => {
        this.liftPending = false;
        if (f) this.moving = { p: start, cx: f.t.cx, cy: f.t.cy };
      });
      return;
    }
    if (cfg.mode === 'wand') {
      this.wand(p);
      return;
    }
    this.start = this.host.snap(p);
    this.pts = [this.start];
  }

  private wand(p: ToolPointer): void {
    const s = this.host.session;
    const cfg = tools().select;
    const src = samplingCanvas(s, cfg.sampleAll);
    const data = readCtx(src).getImageData(0, 0, s.doc.width, s.doc.height);
    const res = regionMask(data, p.x, p.y, { tolerance: cfg.tolerance * 2.55, contiguous: cfg.contiguous });
    if (!res.bounds) return;
    this.apply(Selection.fromMask(s.doc.width, s.doc.height, res.mask));
  }

  private apply(sel: Selection): void {
    const s = this.host.session;
    if (this.op === 'new' || !s.selection) {
      if (this.op === 'subtract' || this.op === 'intersect') return;
      s.setSelection(sel);
      return;
    }
    const next = s.selection.clone();
    next.combine(sel, this.op);
    s.setSelection(next);
  }

  move(points: ToolPointer[], hover: boolean): void {
    if (hover) return;
    const last = points[points.length - 1];
    const s = this.host.session;
    if (this.moving && s.floating) {
      const f = s.floating;
      const c = this.host.snap({ x: this.moving.cx + last.x - this.moving.p.x, y: this.moving.cy + last.y - this.moving.p.y });
      f.t = { ...f.t, cx: c.x, cy: c.y };
      s.emit('floating');
      return;
    }
    if (!this.pts) return;
    if (tools().select.mode === 'lasso') for (const q of points) this.pts.push({ x: q.x, y: q.y });
    else this.pts = [this.start!, this.host.snap(last)];
    this.host.viewport.requestRender();
  }

  up(p: ToolPointer): void {
    const s = this.host.session;
    if (this.moving || this.liftPending) {
      this.moving = null;
      if (s.floating) this.host.setTool('transform');
      return;
    }
    const pts = this.pts;
    this.pts = null;
    if (!pts) return;
    const { width, height } = s.doc;
    const mode = tools().select.mode;
    if (mode === 'rect') {
      const b = this.host.snap(p);
      const a = this.start!;
      const r = { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(b.x - a.x)), h: Math.round(Math.abs(b.y - a.y)) };
      if (r.w < 2 || r.h < 2) {
        if (this.op === 'new') s.setSelection(null);
        this.host.viewport.requestRender();
        return;
      }
      this.apply(Selection.rect(width, height, r));
    } else {
      if (pts.length < 3) {
        if (this.op === 'new') s.setSelection(null);
        return;
      }
      this.apply(Selection.polygon(width, height, pts));
    }
    this.host.viewport.requestRender();
  }

  cancel(): void {
    this.pts = null;
    this.moving = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.pts) return;
    const mode = tools().select.mode;
    const pts = mode === 'rect' && this.pts.length === 2 ? rectPoly(this.pts[0], this.pts[1]) : this.pts;
    ctx.save();
    ctx.beginPath();
    pts.forEach((q, i) => {
      const sp = vp.screenOf(q.x, q.y);
      if (i) ctx.lineTo(sp.x, sp.y);
      else ctx.moveTo(sp.x, sp.y);
    });
    if (mode === 'rect') ctx.closePath();
    ctx.fillStyle = 'rgba(26,115,255,0.1)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#1a73ff';
    ctx.stroke();
    ctx.restore();
  }
}
