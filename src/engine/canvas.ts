import type { Rect } from '../core/util/math';

export type Ctx = CanvasRenderingContext2D;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): Ctx {
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('canvas-2d-unavailable');
  return ctx;
}

/** Context tuned for frequent pixel reads (software backed). */
export const readCtx = (c: HTMLCanvasElement): Ctx => ctx2d(c, { willReadFrequently: true });

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode-failed'))), type, quality),
  );
}

/** Copy a region of a canvas into a new canvas of the region's size. */
export function copyRegion(src: CanvasImageSource & { width: number; height: number }, r: Rect): HTMLCanvasElement {
  const c = createCanvas(r.w, r.h);
  const ctx = ctx2d(c);
  ctx.drawImage(src as CanvasImageSource, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** Replace a region of `dst` with the content of `patch` (same size as the region). */
export function putRegion(dst: HTMLCanvasElement, patch: CanvasImageSource, r: Rect): void {
  const ctx = ctx2d(dst);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(r.x, r.y, r.w, r.h);
  ctx.drawImage(patch, r.x, r.y);
  ctx.restore();
}

export async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions).catch(() =>
    createImageBitmap(blob),
  );
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-decode-failed'));
    };
    img.src = url;
  });
}

let checkerTile: HTMLCanvasElement | null = null;
/** 16px checkerboard tile used to show transparency. */
export function checkerboard(dark = false): HTMLCanvasElement {
  if (checkerTile && (checkerTile as unknown as { dark: boolean }).dark === dark) return checkerTile;
  const c = createCanvas(16, 16);
  const ctx = ctx2d(c);
  ctx.fillStyle = dark ? '#3a3a44' : '#ffffff';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = dark ? '#2c2c34' : '#dcdce4';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  (c as unknown as { dark: boolean }).dark = dark;
  checkerTile = c;
  return c;
}

/** Simple pool of scratch canvases to avoid GC churn during strokes. */
export class CanvasPool {
  private free: HTMLCanvasElement[] = [];
  acquire(w: number, h: number): HTMLCanvasElement {
    const i = this.free.findIndex((c) => c.width === w && c.height === h);
    const c = i >= 0 ? this.free.splice(i, 1)[0] : createCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    return c;
  }
  release(c: HTMLCanvasElement): void {
    if (this.free.length < 4) this.free.push(c);
  }
  clear(): void {
    this.free = [];
  }
}
export const pool = new CanvasPool();
