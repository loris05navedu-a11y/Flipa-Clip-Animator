import { parseHex, toHex } from '../../core/color/color';
import { dilateMask, regionMask } from '../../core/raster/fill';
import { tools } from '../../editor/toolStore';
import { createCanvas, ctx2d, readCtx } from '../canvas';
import { composeFrame } from '../render';
import type { EditorSession } from '../../editor/EditorSession';
import type { Tool, ToolHost, ToolPointer } from './Tool';

/** Pixels used to decide fill regions: the active cel or the merged visible layers. */
export function samplingCanvas(s: EditorSession, all: boolean): HTMLCanvasElement {
  const c = createCanvas(s.doc.width, s.doc.height);
  const ctx = readCtx(c);
  if (all) composeFrame(ctx, s.doc, s.frame, s.cels, null, { background: false, references: 'none' });
  else {
    const celId = s.frame.cels[s.layerId];
    if (celId) s.cels.draw(ctx, celId);
  }
  return c;
}

export class FillTool implements Tool {
  readonly id = 'fill' as const;
  cursor = 'crosshair';
  constructor(private host: ToolHost) {}

  down(p: ToolPointer): void {
    void this.fill(p);
  }

  private async fill(p: ToolPointer): Promise<void> {
    const s = this.host.session;
    const blocker = s.editBlocker();
    if (blocker) return this.host.toast(blocker === 'locked' ? 'toast.layerLocked' : 'toast.layerHidden', 'error');
    const cfg = tools().fill;
    const color = parseHex(tools().primary);
    if (!color) return;
    const { width, height } = s.doc;
    const x = Math.floor(p.x),
      y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const src = samplingCanvas(s, cfg.sampleAll);
    const data = readCtx(src).getImageData(0, 0, width, height);
    const clip = s.selection ? s.selection.byteMask() : null;
    const res = regionMask(data, x, y, { tolerance: cfg.tolerance * 2.55, contiguous: cfg.contiguous, clip });
    if (!res.bounds) return;
    let mask = res.mask;
    let b = res.bounds;
    if (cfg.grow > 0) {
      mask = dilateMask(mask, width, height, cfg.grow);
      if (clip) for (let i = 0; i < mask.length; i++) mask[i] &= clip[i];
      const g = cfg.grow;
      const x0 = Math.max(0, b.x - g),
        y0 = Math.max(0, b.y - g);
      b = { x: x0, y: y0, w: Math.min(width, b.x + b.w + g) - x0, h: Math.min(height, b.y + b.h + g) - y0 };
    }
    const paint = createCanvas(b.w, b.h);
    const pctx = ctx2d(paint);
    const img = pctx.createImageData(b.w, b.h);
    const a = Math.round(color.a * cfg.opacity * 255);
    for (let yy = 0; yy < b.h; yy++)
      for (let xx = 0; xx < b.w; xx++) {
        if (!mask[(b.y + yy) * width + b.x + xx]) continue;
        const i = (yy * b.w + xx) * 4;
        img.data[i] = color.r;
        img.data[i + 1] = color.g;
        img.data[i + 2] = color.b;
        img.data[i + 3] = a;
      }
    pctx.putImageData(img, 0, 0);
    await s.editActive('history.fill', b, (ctx) => ctx.drawImage(paint, b.x, b.y));
    this.host.viewport.requestRender();
  }

  move(): void {}
  up(): void {}
  cancel(): void {}
}

/** Read the colour under a point (merged visible layers or the active layer). */
export function pickColor(s: EditorSession, x: number, y: number, all: boolean): string | null {
  if (x < 0 || y < 0 || x >= s.doc.width || y >= s.doc.height) return null;
  const c = createCanvas(1, 1);
  const ctx = readCtx(c);
  ctx.translate(-Math.floor(x), -Math.floor(y));
  if (all) composeFrame(ctx, s.doc, s.frame, s.cels, null, { background: true, references: 'none' });
  else {
    const celId = s.frame.cels[s.layerId];
    if (celId) s.cels.draw(ctx, celId);
  }
  const d = ctx.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return all && !s.doc.background.transparent ? s.doc.background.color + 'ff' : null;
  return toHex({ r: d[0], g: d[1], b: d[2], a: d[3] / 255 });
}

export class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;
  cursor = 'crosshair';
  private preview: { sx: number; sy: number; color: string } | null = null;
  constructor(private host: ToolHost) {}

  private sample(p: ToolPointer): string | null {
    return pickColor(this.host.session, p.x, p.y, tools().eyedropperSampleAll);
  }

  down(p: ToolPointer): void {
    this.update(p);
  }

  private update(p: ToolPointer): void {
    const c = this.sample(p);
    this.preview = c ? { sx: p.sx, sy: p.sy, color: c } : null;
    this.host.viewport.requestRender();
  }

  move(points: ToolPointer[], hover: boolean): void {
    if (!hover) this.update(points[points.length - 1]);
  }

  up(p: ToolPointer): void {
    const c = this.sample(p);
    this.preview = null;
    if (c) this.host.setColor(c, p.alt ? 'secondary' : 'primary');
    else this.host.toast('toast.transparentPixel', 'info');
    this.host.viewport.requestRender();
  }

  cancel(): void {
    this.preview = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const pv = this.preview;
    if (!pv) return;
    const rgba = parseHex(pv.color)!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(pv.sx, pv.sy - 60, 28, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a})`;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();
  }
}

