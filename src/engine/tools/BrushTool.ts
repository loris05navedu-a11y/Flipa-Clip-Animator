import { hexToCss } from '../../core/color/color';
import { settings } from '../../storage/settings';
import { tools } from '../../editor/toolStore';
import { Stroke, type InputPoint } from '../brush/Stroke';
import { eraserToBrush, type BrushSettings, type BrushTool as BrushKind } from '../brush/types';
import type { CelLink } from '../commands';
import { copyRegion, ctx2d } from '../canvas';
import { pixelRect, type Rect } from '../../core/util/math';
import type { Pt } from '../../core/geometry/matrix';
import type { Tool, ToolHost, ToolId, ToolPointer } from './Tool';
import type { Viewport } from '../Viewport';

/** Freehand painting (brush, pencil, pen) and erasing. */
export class BrushTool implements Tool {
  cursor = 'none';
  private stroke: Stroke | null = null;
  private celId: string | null = null;
  private link: CelLink | null = null;
  // Area erase (rect / lasso)
  private area: Pt[] | null = null;
  private areaStart: Pt | null = null;

  constructor(
    readonly id: ToolId,
    private host: ToolHost,
  ) {}

  private get erasing(): boolean {
    return this.id === 'eraser';
  }

  private brushSettings(): BrushSettings {
    const t = tools();
    const app = settings();
    const base = this.erasing ? eraserToBrush(t.eraser) : { ...t.activePreset(this.id as BrushKind).settings };
    base.stabilizer = Math.min(1, base.stabilizer + app.stabilization);
    return base;
  }

  cursorSize(): number {
    if (this.erasing && tools().eraser.mode !== 'freehand') return 0;
    return this.brushSettings().size;
  }

  down(p: ToolPointer): void {
    const s = this.host.session;
    const blocker = s.editBlocker();
    if (blocker) {
      this.host.toast(blocker === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
      return;
    }
    if (this.erasing && tools().eraser.mode !== 'freehand') {
      this.area = [{ x: p.x, y: p.y }];
      this.areaStart = { x: p.x, y: p.y };
      return;
    }
    const target = s.activeCanvasSync();
    if (!target) {
      this.host.toast('toast.loading', 'info');
      return;
    }
    this.celId = target.celId;
    this.link = target.link;
    if (this.link) s.linkCel(this.link.frameId, this.link.layerId, this.link.celId);
    const app = settings();
    const t = tools();
    this.stroke = new Stroke({
      target: target.canvas,
      settings: this.brushSettings(),
      color: hexToCss(t.primary),
      erase: this.erasing,
      symmetry: this.host.viewport.symmetry(),
      clipMask: s.selection?.mask ?? null,
      zoom: this.host.viewport.view.zoom,
      usePressure: app.pressure && p.pointerType === 'pen',
      globalSmoothing: app.smoothing,
    });
    s.interacting = true;
    this.feed([p]);
  }

  private feed(points: ToolPointer[]): void {
    if (!this.stroke) return;
    const pts: InputPoint[] = points.map((q) => ({ x: q.x, y: q.y, pressure: q.pointerType === 'pen' ? q.pressure : 1 }));
    const r = this.stroke.add(pts);
    if (r) this.host.viewport.invalidateRect(r);
  }

  move(points: ToolPointer[], hover: boolean): void {
    const last = points[points.length - 1];
    const vp = this.host.viewport;
    vp.cursor = { x: last.sx, y: last.sy, size: this.cursorSize() };
    if (hover) {
      vp.requestRender();
      return;
    }
    if (this.area) {
      if (tools().eraser.mode === 'lasso') for (const q of points) this.area.push({ x: q.x, y: q.y });
      else this.area = [this.areaStart!, { x: last.x, y: last.y }];
      vp.requestRender();
      return;
    }
    this.feed(points);
  }

  up(p: ToolPointer): void {
    if (this.area) {
      this.finishArea();
      return;
    }
    if (!this.stroke) return;
    this.feed([p]);
    const res = this.stroke.end();
    this.stroke = null;
    const s = this.host.session;
    s.interacting = false;
    if (res.rect && res.before && res.after && this.celId) {
      this.host.viewport.invalidateRect(res.rect);
      s.commitPixels(this.erasing ? 'history.erase' : 'history.draw', [{ celId: this.celId, rect: res.rect, before: res.before, after: res.after }], this.link ? [this.link] : []);
    } else if (this.link) {
      s.linkCel(this.link.frameId, this.link.layerId, null);
    }
    this.celId = null;
    this.link = null;
  }

  private finishArea(): void {
    const pts = this.area!;
    this.area = null;
    const s = this.host.session;
    const mode = tools().eraser.mode;
    const poly = mode === 'rect' && pts.length === 2 ? rectPoly(pts[0], pts[1]) : pts;
    if (poly.length < 3) {
      this.host.viewport.requestRender();
      return;
    }
    const xs = poly.map((q) => q.x),
      ys = poly.map((q) => q.y);
    const bounds: Rect | null = pixelRect(
      { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      s.doc.width,
      s.doc.height,
      1,
    );
    const celId = s.frame.cels[s.layerId];
    if (!bounds || !celId) {
      this.host.viewport.requestRender();
      return;
    }
    const opacity = tools().eraser.opacity;
    const sel = s.selection;
    void s.editActive('history.erase', bounds, (ctx) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = opacity;
      if (sel) {
        // Erase only inside both the area and the selection.
        const tmp = copyRegion(sel.mask, bounds);
        const tctx = ctx2d(tmp);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.translate(-bounds.x, -bounds.y);
        tctx.beginPath();
        poly.forEach((q, i) => (i ? tctx.lineTo(q.x, q.y) : tctx.moveTo(q.x, q.y)));
        tctx.closePath();
        tctx.fillStyle = '#000';
        tctx.fill();
        ctx.drawImage(tmp, bounds.x, bounds.y);
      } else {
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  cancel(): void {
    this.area = null;
    if (this.stroke) {
      this.stroke.cancel();
      const r = this.stroke.changedRect;
      this.stroke = null;
      this.host.session.interacting = false;
      if (this.link) this.host.session.linkCel(this.link.frameId, this.link.layerId, null);
      this.link = null;
      if (r) this.host.viewport.invalidateRect(r);
    }
  }

  deactivate(): void {
    this.host.viewport.cursor = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.area) return;
    const mode = tools().eraser.mode;
    const pts = mode === 'rect' && this.area.length === 2 ? rectPoly(this.area[0], this.area[1]) : this.area;
    ctx.save();
    ctx.beginPath();
    pts.forEach((q, i) => {
      const sp = vp.screenOf(q.x, q.y);
      if (i) ctx.lineTo(sp.x, sp.y);
      else ctx.moveTo(sp.x, sp.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,60,90,0.15)';
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ff3c5a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export function rectPoly(a: Pt, b: Pt): Pt[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}
