/** 2D affine matrix [a b c d e f] as in DOMMatrix / canvas setTransform. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const identity = (): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function multiply(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export const apply = (m: Mat, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const translate = (x: number, y: number): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const scale = (sx: number, sy = sx): Mat => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export function rotate(rad: number): Mat {
  const c = Math.cos(rad),
    s = Math.sin(rad);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}
export const skewX = (rad: number): Mat => ({ a: 1, b: 0, c: Math.tan(rad), d: 1, e: 0, f: 0 });

export function compose(...ms: Mat[]): Mat {
  return ms.reduce((acc, m) => multiply(acc, m), identity());
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angle = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x);

/**
 * Parameters of a free transform (used by selections, pasted content, text and
 * references). The content (size w×h) is centred on the origin, then scaled,
 * skewed, rotated and moved to (cx, cy).
 */
export interface TransformParams {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  rotation: number;
  skew: number;
}

export function transformMatrix(t: TransformParams): Mat {
  return compose(translate(t.cx, t.cy), rotate(t.rotation), skewX(t.skew), scale(t.sx, t.sy));
}

/** Corners of a w×h box under a transform: TL, TR, BR, BL. */
export function transformedCorners(t: TransformParams, w: number, h: number): Pt[] {
  const m = transformMatrix(t);
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => apply(m, p));
}

export function boundsOf(points: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Snap a value to the closest candidate when within `threshold`. */
export function snapValue(v: number, candidates: number[], threshold: number): number {
  let best = v;
  let bestD = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Symmetry transforms (applied in project space around (cx, cy)). */
export function symmetryMatrices(
  mode: 'off' | 'vertical' | 'horizontal' | 'quad' | 'radial',
  cx: number,
  cy: number,
  segments = 6,
  mirror = false,
): Mat[] {
  const around = (m: Mat) => compose(translate(cx, cy), m, translate(-cx, -cy));
  const flipX = scale(-1, 1);
  const flipY = scale(1, -1);
  switch (mode) {
    case 'vertical':
      return [identity(), around(flipX)];
    case 'horizontal':
      return [identity(), around(flipY)];
    case 'quad':
      return [identity(), around(flipX), around(flipY), around(scale(-1, -1))];
    case 'radial': {
      const n = Math.max(2, Math.min(32, Math.round(segments)));
      const out: Mat[] = [];
      for (let i = 0; i < n; i++) {
        const r = around(rotate((i * 2 * Math.PI) / n));
        out.push(r);
        if (mirror) out.push(multiply(r, around(flipX)));
      }
      return out;
    }
    default:
      return [identity()];
  }
}
