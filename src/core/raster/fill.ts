/**
 * Pixel algorithms working on raw RGBA buffers (ImageData-like). Pure and
 * DOM-free so they can be unit-tested and moved to a worker.
 */

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface FillOptions {
  /** 0..255: maximum per-channel difference accepted. */
  tolerance: number;
  /** Only pixels connected to the seed (flood fill) vs. every matching pixel. */
  contiguous: boolean;
  /** Optional mask (1 byte per pixel, >0 = allowed), e.g. the active selection. */
  clip?: Uint8Array | null;
}

export interface MaskResult {
  mask: Uint8Array;
  /** Bounding box of the selected pixels, or null if none. */
  bounds: { x: number; y: number; w: number; h: number } | null;
  count: number;
}

function matcher(buf: PixelBuffer, sx: number, sy: number, tolerance: number) {
  const d = buf.data;
  const i0 = (sy * buf.width + sx) * 4;
  const r0 = d[i0],
    g0 = d[i0 + 1],
    b0 = d[i0 + 2],
    a0 = d[i0 + 3];
  const tol = Math.max(0, Math.min(255, tolerance));
  return (p: number): boolean => {
    const i = p * 4;
    const a = d[i + 3];
    // Fully transparent pixels match each other regardless of their RGB.
    if (a0 === 0 && a === 0) return true;
    return (
      Math.abs(d[i] - r0) <= tol &&
      Math.abs(d[i + 1] - g0) <= tol &&
      Math.abs(d[i + 2] - b0) <= tol &&
      Math.abs(a - a0) <= tol
    );
  };
}

/** Compute the region selected by a fill / magic wand from a seed point. */
export function regionMask(buf: PixelBuffer, sx: number, sy: number, opts: FillOptions): MaskResult {
  const { width: w, height: h } = buf;
  const mask = new Uint8Array(w * h);
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, bounds: null, count: 0 };
  const clip = opts.clip ?? null;
  if (clip && !clip[sy * w + sx]) return { mask, bounds: null, count: 0 };
  const match = matcher(buf, sx, sy, opts.tolerance);
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1,
    count = 0;
  const mark = (p: number, x: number, y: number) => {
    mask[p] = 1;
    count++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const ok = (p: number) => !mask[p] && (!clip || clip[p] > 0) && match(p);

  if (!opts.contiguous) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (ok(p)) mark(p, x, y);
      }
  } else {
    // Scanline flood fill with an explicit stack (no recursion).
    const stack: number[] = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      let p = y * w + x;
      if (!ok(p)) continue;
      while (x > 0 && ok(p - 1)) {
        x--;
        p--;
      }
      let spanUp = false,
        spanDown = false;
      while (x < w && ok(p)) {
        mark(p, x, y);
        if (y > 0) {
          const up = ok(p - w);
          if (up && !spanUp) {
            stack.push(x, y - 1);
            spanUp = true;
          } else if (!up) spanUp = false;
        }
        if (y < h - 1) {
          const down = ok(p + w);
          if (down && !spanDown) {
            stack.push(x, y + 1);
            spanDown = true;
          } else if (!down) spanDown = false;
        }
        x++;
        p++;
      }
    }
  }
  const bounds = count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  return { mask, bounds, count };
}

/** Grow a mask by `radius` pixels (square dilation, separable). Used to hide anti-aliasing halos. */
export function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    let run = -Infinity;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) run = x;
      if (x - run <= radius) tmp[row + x] = 1;
    }
    run = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x]) run = x;
      if (run - x <= radius) tmp[row + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) run = y;
      if (y - run <= radius) out[y * w + x] = 1;
    }
    run = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) run = y;
      if (run - y <= radius) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Bounding box of the non-transparent pixels of a buffer (alpha > threshold). */
export function alphaBounds(buf: PixelBuffer, threshold = 0): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = buf;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    let rowHas = false;
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        rowHas = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (rowHas) {
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Write a solid colour into `buf` where `mask` is set. */
export function paintMask(buf: PixelBuffer, mask: Uint8Array, r: number, g: number, b: number, a: number): void {
  const d = buf.data;
  const alpha = a / 255;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    if (alpha >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    } else {
      // Source-over compositing of a translucent fill.
      const da = d[i + 3] / 255;
      const oa = alpha + da * (1 - alpha);
      if (oa <= 0) continue;
      d[i] = (r * alpha + d[i] * da * (1 - alpha)) / oa;
      d[i + 1] = (g * alpha + d[i + 1] * da * (1 - alpha)) / oa;
      d[i + 2] = (b * alpha + d[i + 2] * da * (1 - alpha)) / oa;
      d[i + 3] = oa * 255;
    }
  }
}
