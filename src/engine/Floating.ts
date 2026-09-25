import { boundsOf, transformedCorners, transformMatrix, type TransformParams } from '../core/geometry/matrix';
import { pixelRect, type Rect } from '../core/util/math';
import { ctx2d } from './canvas';

export type FloatingKind = 'selection' | 'paste' | 'text' | 'import';

/**
 * Content being moved / transformed before it is committed to a layer:
 * a lifted selection, pasted pixels, an imported image or a text block.
 */
export interface Floating {
  kind: FloatingKind;
  canvas: HTMLCanvasElement;
  t: TransformParams;
  /** Transform at creation (for "reset"). */
  origin: TransformParams;
  frameId: string;
  layerId: string;
  celId: string;
  /** The cel was created for this operation (empty slot). */
  created: boolean;
  /** Copy of the whole cel before the operation (undo + cancel). */
  base: HTMLCanvasElement;
  /** Region of the cel modified by lifting the pixels. */
  liftRect: Rect | null;
  /** Free data for tools (text settings...). */
  meta?: unknown;
}

export function floatingBounds(f: Floating): Rect {
  return boundsOf(transformedCorners(f.t, f.canvas.width, f.canvas.height));
}

export function floatingPixelRect(f: Floating, w: number, h: number): Rect | null {
  return pixelRect(floatingBounds(f), w, h, 2);
}

/** Draw the floating content (ctx in project space). */
export function drawFloating(ctx: CanvasRenderingContext2D, f: Floating, smooth = true): void {
  const m = transformMatrix(f.t);
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f.canvas, -f.canvas.width / 2, -f.canvas.height / 2);
  ctx.restore();
}

export function stampFloating(target: HTMLCanvasElement, f: Floating): void {
  const ctx = ctx2d(target);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pixelExact =
    f.t.rotation === 0 && f.t.skew === 0 && Math.abs(Math.abs(f.t.sx) - 1) < 1e-6 && Math.abs(Math.abs(f.t.sy) - 1) < 1e-6;
  drawFloating(ctx, f, !pixelExact);
  ctx.restore();
}
