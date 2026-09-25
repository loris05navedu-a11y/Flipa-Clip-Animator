import { apply, compose, invert, rotate, scale, translate, type Mat, type Pt } from '../core/geometry/matrix';
import { clamp } from '../core/util/math';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

/** Maps project space to screen (CSS pixel) space: pan, zoom and rotation around the view centre. */
export class ViewTransform {
  zoom = 1;
  /** Screen position of the document centre, relative to the view centre. */
  panX = 0;
  panY = 0;
  rotation = 0;
  viewW = 1;
  viewH = 1;
  docW = 1;
  docH = 1;

  matrix(): Mat {
    return compose(
      translate(this.viewW / 2 + this.panX, this.viewH / 2 + this.panY),
      rotate(this.rotation),
      scale(this.zoom),
      translate(-this.docW / 2, -this.docH / 2),
    );
  }

  toDoc(p: Pt): Pt {
    return apply(invert(this.matrix()), p);
  }

  toScreen(p: Pt): Pt {
    return apply(this.matrix(), p);
  }

  /** Zoom to fit the document in the view with a margin. */
  fit(margin = 24): void {
    const z = Math.min((this.viewW - margin * 2) / this.docW, (this.viewH - margin * 2) / this.docH);
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.panX = 0;
    this.panY = 0;
    this.rotation = 0;
  }

  /** 100 % zoom, centred. */
  actualSize(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  /** Zoom by `factor` keeping the screen point `at` fixed. */
  zoomAt(factor: number, at: Pt): void {
    const before = this.toDoc(at);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.toScreen(before);
    this.panX += at.x - after.x;
    this.panY += at.y - after.y;
  }

  /** Rotate by `delta` radians around the screen point `at`. */
  rotateAt(delta: number, at: Pt): void {
    const before = this.toDoc(at);
    this.rotation = normalizeAngle(this.rotation + delta);
    const after = this.toScreen(before);
    this.panX += at.x - after.x;
    this.panY += at.y - after.y;
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  snapshot(): { zoom: number; panX: number; panY: number; rotation: number } {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY, rotation: this.rotation };
  }
}

export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}
