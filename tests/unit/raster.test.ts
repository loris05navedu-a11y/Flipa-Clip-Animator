import { describe, expect, it } from 'vitest';
import { regionMask, dilateMask, alphaBounds, paintMask, type PixelBuffer } from '../../src/core/raster/fill';
import { parseHex, toHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb } from '../../src/core/color/color';
import { symmetryMatrices, apply, transformMatrix, invert, multiply } from '../../src/core/geometry/matrix';

function buf(w: number, h: number): PixelBuffer {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}
function setPx(b: PixelBuffer, x: number, y: number, rgba: number[]) {
  b.data.set(rgba, (y * b.width + x) * 4);
}

describe('flood fill', () => {
  it('fills a closed region only', () => {
    const b = buf(10, 10);
    // Vertical black wall at x=5
    for (let y = 0; y < 10; y++) setPx(b, 5, y, [0, 0, 0, 255]);
    const r = regionMask(b, 1, 1, { tolerance: 0, contiguous: true });
    expect(r.count).toBe(50);
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 5, h: 10 });
    const all = regionMask(b, 1, 1, { tolerance: 0, contiguous: false });
    expect(all.count).toBe(90);
  });
  it('respects tolerance and clip masks', () => {
    const b = buf(4, 1);
    setPx(b, 0, 0, [100, 100, 100, 255]);
    setPx(b, 1, 0, [110, 100, 100, 255]);
    setPx(b, 2, 0, [200, 100, 100, 255]);
    setPx(b, 3, 0, [105, 100, 100, 255]);
    expect(regionMask(b, 0, 0, { tolerance: 10, contiguous: true }).count).toBe(2);
    expect(regionMask(b, 0, 0, { tolerance: 10, contiguous: false }).count).toBe(3);
    const clip = new Uint8Array([1, 0, 1, 1]);
    expect(regionMask(b, 0, 0, { tolerance: 10, contiguous: false, clip }).count).toBe(2);
    expect(regionMask(b, 1, 0, { tolerance: 10, contiguous: false, clip }).count).toBe(0);
  });
  it('handles out-of-bounds seeds and a large canvas', () => {
    const b = buf(1000, 1000);
    expect(regionMask(b, -1, 5, { tolerance: 0, contiguous: true }).count).toBe(0);
    expect(regionMask(b, 500, 500, { tolerance: 0, contiguous: true }).count).toBe(1_000_000);
  });
  it('dilates and paints', () => {
    const mask = new Uint8Array(25);
    mask[12] = 1;
    const d = dilateMask(mask, 5, 5, 1);
    expect(d.reduce((a, v) => a + v, 0)).toBe(9);
    const b = buf(5, 5);
    paintMask(b, d, 255, 0, 0, 255);
    expect(alphaBounds(b)).toEqual({ x: 1, y: 1, w: 3, h: 3 });
    expect(alphaBounds(buf(3, 3))).toBeNull();
  });
});

describe('colour', () => {
  it('parses and formats hex', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseHex('zz')).toBeNull();
    expect(toHex({ r: 255, g: 0, b: 128, a: 0.5 })).toBe('#ff008080');
  });
  it('round-trips HSV and HSL', () => {
    for (const hex of ['#ff0000', '#12ab9f', '#808080', '#000000', '#ffffff', '#3355ee']) {
      const c = parseHex(hex)!;
      expect(toHex(hsvToRgb(rgbToHsv(c)), false)).toBe(hex);
      expect(toHex(hslToRgb(rgbToHsl(c)), false)).toBe(hex);
    }
  });
});

describe('geometry', () => {
  it('mirrors points for symmetry modes', () => {
    const ms = symmetryMatrices('quad', 50, 50);
    const pts = ms.map((m) => apply(m, { x: 10, y: 20 }));
    expect(pts).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 10, y: 80 },
      { x: 90, y: 80 },
    ]);
    expect(symmetryMatrices('radial', 0, 0, 8, true)).toHaveLength(16);
  });
  it('inverts transforms', () => {
    const m = transformMatrix({ cx: 10, cy: -4, sx: 2, sy: 0.5, rotation: 0.7, skew: 0.2 });
    const id = multiply(m, invert(m));
    expect(id.a).toBeCloseTo(1);
    expect(id.b).toBeCloseTo(0);
    expect(id.e).toBeCloseTo(0);
  });
});
