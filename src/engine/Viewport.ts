import { BLEND_TO_COMPOSITE, type FrameDef, type LayerDef } from '../core/model/types';
import { apply, symmetryMatrices } from '../core/geometry/matrix';
import { intersectRect, type Rect } from '../core/util/math';
import type { EditorSession } from '../editor/EditorSession';
import { checkerboard, createCanvas, ctx2d } from './canvas';
import { drawFloating } from './Floating';
import { drawReferences, frameKey } from './render';
import { ViewTransform } from './ViewTransform';

export interface OverlayPainter {
  /** Draw tool overlays in screen space. */
  drawOverlay?(ctx: CanvasRenderingContext2D, vp: Viewport): void;
}

export interface ViewportTheme {
  workspace: string;
  dark: boolean;
  accent: string;
}

const RULER = 20;

/**
 * Renders the open frame on screen. Layers are composited at document
 * resolution into `work` (so blend modes behave exactly like in exports),
 * then `work` is drawn with the view transform. While drawing, only the
 * changed rectangle is recomposited.
 */
export class Viewport {
  readonly view = new ViewTransform();
  private ctx: CanvasRenderingContext2D;
  private work: HTMLCanvasElement;
  private wctx: CanvasRenderingContext2D;
  private below: HTMLCanvasElement;
  private belowKey = '';
  private composedVersion = -1;
  private pendingRect: Rect | null = null;
  private needsScreen = true;
  private raf = 0;
  private onion = new Map<string, HTMLCanvasElement>();
  dpr = 1;
  overlay: OverlayPainter | null = null;
  /** Image shown instead of the editable frame during playback. */
  playbackImage: CanvasImageSource | null = null;
  theme: ViewportTheme = { workspace: '#1d1d24', dark: true, accent: '#6c5ce7' };
  /** Cursor position (screen) for the brush outline. */
  cursor: { x: number; y: number; size: number } | null = null;
  showRulers = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    public session: EditorSession,
  ) {
    this.ctx = ctx2d(canvas);
    const { width, height } = session.doc;
    this.work = createCanvas(width, height);
    this.wctx = ctx2d(this.work);
    this.below = createCanvas(width, height);
    this.view.docW = width;
    this.view.docH = height;
  }

  /** Resize the screen canvas to its CSS size. */
  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.view.viewW = cssW;
    this.view.viewH = cssH;
    this.requestRender();
  }

  /** Called when the document size changed. */
  syncDocSize(): void {
    const { width, height } = this.session.doc;
    if (this.work.width !== width || this.work.height !== height) {
      this.work = createCanvas(width, height);
      this.wctx = ctx2d(this.work);
      this.below = createCanvas(width, height);
      this.belowKey = '';
      this.onion.clear();
    }
    this.view.docW = width;
    this.view.docH = height;
    this.composedVersion = -1;
  }

  /** Recompose only a region of the document (used while drawing). */
  invalidateRect(r: Rect | null): void {
    if (!r) return;
    const clipped = intersectRect(r, { x: 0, y: 0, w: this.session.doc.width, h: this.session.doc.height });
    if (!clipped) return;
    this.pendingRect = this.pendingRect
      ? {
          x: Math.min(this.pendingRect.x, clipped.x),
          y: Math.min(this.pendingRect.y, clipped.y),
          w: Math.max(this.pendingRect.x + this.pendingRect.w, clipped.x + clipped.w) - Math.min(this.pendingRect.x, clipped.x),
          h: Math.max(this.pendingRect.y + this.pendingRect.h, clipped.y + clipped.h) - Math.min(this.pendingRect.y, clipped.y),
        }
      : { ...clipped };
    this.requestRender();
  }

  requestRender(): void {
    this.needsScreen = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.onion.clear();
  }

  /* ----------------------------- Composition ---------------------------- */

  private layersSplit(): { below: LayerDef[]; active: LayerDef | null; above: LayerDef[] } {
    const layers = this.session.doc.layers;
    const i = this.session.layerIndex;
    return { below: layers.slice(0, Math.max(0, i)), active: layers[i] ?? null, above: layers.slice(i + 1) };
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: LayerDef, frame: FrameDef): void {
    if (!layer.visible) return;
    const celId = frame.cels[layer.id];
    const s = this.session;
    const floating = s.floating && s.floating.layerId === layer.id && s.floating.frameId === frame.id ? s.floating : null;
    if (!celId && !floating) return;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
    if (floating) {
      // Draw the cel and the floating content as one layer so opacity/blend apply once.
      const tmp = this.scratch();
      const t = ctx2d(tmp);
      t.clearRect(0, 0, tmp.width, tmp.height);
      if (celId) s.cels.draw(t, celId);
      drawFloating(t, floating);
      ctx.drawImage(tmp, 0, 0);
    } else if (celId) s.cels.draw(ctx, celId);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratch(): HTMLCanvasElement {
    const { width, height } = this.session.doc;
    if (!this.scratchCanvas || this.scratchCanvas.width !== width || this.scratchCanvas.height !== height)
      this.scratchCanvas = createCanvas(width, height);
    return this.scratchCanvas;
  }

  /** Background + references below + onion skins + layers below the active one. */
  private composeBelow(frame: FrameDef, below: LayerDef[]): void {
    const s = this.session;
    const doc = s.doc;
    const key = `${s.renderVersion}|${frame.id}|${s.layerId}`;
    if (key === this.belowKey) return;
    this.belowKey = key;
    const ctx = ctx2d(this.below);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, doc.width, doc.height);
    if (!doc.background.transparent) {
      ctx.fillStyle = doc.background.color;
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    drawReferences(ctx, doc, s, 'below', 'visible');
    this.drawOnion(ctx);
    for (const l of below) this.drawLayer(ctx, l, frame);
  }

  private compose(rect: Rect | null): void {
    const s = this.session;
    const doc = s.doc;
    const frame = s.frame;
    const { below, active, above } = this.layersSplit();
    this.composeBelow(frame, below);
    const ctx = this.wctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rect) {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    } else ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.drawImage(this.below, 0, 0);
    if (active) this.drawLayer(ctx, active, frame);
    for (const l of above) this.drawLayer(ctx, l, frame);
    drawReferences(ctx, doc, s, 'above', 'visible');
    ctx.restore();
  }

  /* ------------------------------ Onion skin ----------------------------- */

  private drawOnion(ctx: CanvasRenderingContext2D): void {
    const s = this.session;
    const o = s.doc.view.onion;
    if (!o.enabled || this.playbackImage) return;
    const frames = s.doc.frames;
    const n = frames.length;
    const draw = (offset: number, color: string) => {
      let idx = s.frameIndex + offset;
      if (o.loop) idx = (idx + n) % n;
      if (idx < 0 || idx >= n || idx === s.frameIndex) return;
      const img = this.onionImage(frames[idx], color);
      if (!img) return;
      const step = Math.abs(offset);
      ctx.globalAlpha = o.opacity * Math.pow(o.falloff, step - 1);
      ctx.drawImage(img, 0, 0, s.doc.width, s.doc.height);
      ctx.globalAlpha = 1;
    };
    for (let k = o.before; k >= 1; k--) draw(-k, o.colorBefore);
    for (let k = o.after; k >= 1; k--) draw(k, o.colorAfter);
  }

  private onionImage(frame: FrameDef, color: string): HTMLCanvasElement | null {
    const s = this.session;
    const doc = s.doc;
    const o = doc.view.onion;
    const layerFilter = o.allLayers ? null : s.layerId;
    const key = frameKey(doc, frame, s.cels, `${o.tint ? color : 'none'}|${layerFilter ?? '*'}`) + `|${frame.id}`;
    const hit = this.onion.get(key);
    if (hit) return hit;
    const scale = Math.min(1, 1600 / Math.max(doc.width, doc.height));
    const c = createCanvas(doc.width * scale, doc.height * scale);
    const ctx = ctx2d(c);
    ctx.scale(scale, scale);
    let complete = true;
    for (const l of doc.layers) {
      if (!l.visible || (layerFilter && l.id !== layerFilter)) continue;
      const celId = frame.cels[l.id];
      if (!celId) continue;
      if (!s.cels.isReady(celId)) {
        complete = false;
        s.cels.ensureLoaded(celId).then(() => {
          this.belowKey = '';
          this.composedVersion = -1;
          this.requestRender();
        });
        continue;
      }
      ctx.globalAlpha = l.opacity;
      s.cels.draw(ctx, celId);
    }
    if (o.tint) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.75;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    if (!complete) return c;
    if (this.onion.size > 24) this.onion.delete(this.onion.keys().next().value as string);
    this.onion.set(key, c);
    return c;
  }

  /* ------------------------------- Screen -------------------------------- */

  render(): void {
    const s = this.session;
    if (s.closed) return;
    if (this.work.width !== s.doc.width || this.work.height !== s.doc.height) this.syncDocSize();
    if (!this.playbackImage) {
      if (this.composedVersion !== s.renderVersion) {
        this.compose(null);
        this.composedVersion = s.renderVersion;
        this.pendingRect = null;
      } else if (this.pendingRect) {
        const r = intersectRect(this.pendingRect, { x: 0, y: 0, w: s.doc.width, h: s.doc.height });
        this.pendingRect = null;
        if (r) this.compose(r);
      }
    }
    if (!this.needsScreen) return;
    this.needsScreen = false;
    this.paintScreen();
  }

  private paintScreen(): void {
    const s = this.session;
    const doc = s.doc;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.theme.workspace;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const m = this.view.matrix();
    ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr);
    // Page shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18 * this.view.zoom;
    ctx.fillStyle = doc.background.transparent ? '#fff' : doc.background.color;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();
    if (doc.background.transparent || this.playbackImage) {
      const pat = ctx.createPattern(checkerboard(this.theme.dark), 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix([1 / this.view.zoom, 0, 0, 1 / this.view.zoom, 0, 0]));
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, doc.width, doc.height);
      }
      if (this.playbackImage && !doc.background.transparent) {
        ctx.fillStyle = doc.background.color;
        ctx.fillRect(0, 0, doc.width, doc.height);
      }
    }
    const pixelView = this.view.zoom >= 2;
    ctx.imageSmoothingEnabled = !pixelView;
    ctx.imageSmoothingQuality = this.view.zoom < 1 ? 'high' : 'low';
    ctx.drawImage(this.playbackImage ?? this.work, 0, 0, doc.width, doc.height);
    ctx.imageSmoothingEnabled = true;

    if (!this.playbackImage) {
      this.drawGrid(ctx);
      this.drawSymmetry(ctx);
      this.drawGuides(ctx);
      this.drawSelection(ctx);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.playbackImage) {
      this.overlay?.drawOverlay?.(ctx, this);
      this.drawCursor(ctx);
      if (doc.view.rulers && this.showRulers) this.drawRulers(ctx);
    }
  }

  /** Line width that stays `px` screen pixels thick in document space. */
  private hair(px = 1): number {
    return px / this.view.zoom;
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const g = this.session.doc.view.grid;
    if (!g.enabled) return;
    const { width, height } = this.session.doc;
    let step = g.size;
    while (step * this.view.zoom < 6) step *= 2;
    ctx.save();
    ctx.strokeStyle = g.color;
    ctx.globalAlpha = g.opacity;
    ctx.lineWidth = this.hair();
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawGuides(ctx: CanvasRenderingContext2D): void {
    const v = this.session.doc.view;
    if (!v.guidesVisible || !v.guides.length) return;
    const { width, height } = this.session.doc;
    const ext = Math.max(width, height) * 4;
    ctx.save();
    ctx.strokeStyle = '#00c2ff';
    ctx.lineWidth = this.hair(1.2);
    ctx.setLineDash([this.hair(6), this.hair(4)]);
    ctx.beginPath();
    for (const g of v.guides) {
      if (g.axis === 'x') {
        ctx.moveTo(g.pos, -ext);
        ctx.lineTo(g.pos, ext);
      } else {
        ctx.moveTo(-ext, g.pos);
        ctx.lineTo(ext, g.pos);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawSymmetry(ctx: CanvasRenderingContext2D): void {
    const sym = this.session.doc.view.symmetry;
    if (sym.mode === 'off' || !sym.visible) return;
    const { width, height } = this.session.doc;
    const len = Math.hypot(width, height);
    ctx.save();
    ctx.strokeStyle = '#ff6ad5';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = this.hair(1.5);
    ctx.setLineDash([this.hair(10), this.hair(6)]);
    ctx.beginPath();
    const line = (angle: number) => {
      ctx.moveTo(sym.cx, sym.cy);
      ctx.lineTo(sym.cx + Math.cos(angle) * len, sym.cy + Math.sin(angle) * len);
    };
    if (sym.mode === 'vertical' || sym.mode === 'quad') {
      ctx.moveTo(sym.cx, 0);
      ctx.lineTo(sym.cx, height);
    }
    if (sym.mode === 'horizontal' || sym.mode === 'quad') {
      ctx.moveTo(0, sym.cy);
      ctx.lineTo(width, sym.cy);
    }
    if (sym.mode === 'radial') {
      const n = sym.segments;
      for (let i = 0; i < n; i++) line(-Math.PI / 2 + (i * Math.PI * 2) / n);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sym.cx, sym.cy, this.hair(6), 0, Math.PI * 2);
    ctx.fillStyle = '#ff6ad5';
    ctx.fill();
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const sel = this.session.selection;
    if (!sel || this.session.floating) return;
    ctx.save();
    const t = (performance.now() / 60) % 16;
    if (sel.path) {
      ctx.beginPath();
      sel.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(26,115,255,0.08)';
      ctx.fill();
      ctx.lineWidth = this.hair(1.5);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.setLineDash([this.hair(6), this.hair(6)]);
      ctx.lineDashOffset = this.hair(t);
      ctx.strokeStyle = '#1a73ff';
      ctx.stroke();
    } else {
      const o = sel.outline();
      if (o) {
        const oo = o as unknown as { ox: number; oy: number };
        ctx.globalAlpha = 0.9;
        ctx.drawImage(o, oo.ox, oo.oy);
        if (sel.bounds) {
          ctx.globalAlpha = 1;
          ctx.setLineDash([this.hair(4), this.hair(4)]);
          ctx.lineWidth = this.hair(1);
          ctx.strokeStyle = '#1a73ff';
          ctx.strokeRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h);
        }
      }
    }
    ctx.restore();
  }

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const c = this.cursor;
    if (!c || c.size * this.view.zoom < 4) return;
    const r = (c.size * this.view.zoom) / 2;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(1, r - 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Rulers along the top and left edges (hidden when the view is rotated). */
  private drawRulers(ctx: CanvasRenderingContext2D): void {
    if (Math.abs(this.view.rotation) > 0.001) return;
    const vw = this.view.viewW,
      vh = this.view.viewH;
    const dark = this.theme.dark;
    ctx.save();
    ctx.fillStyle = dark ? 'rgba(20,20,28,0.92)' : 'rgba(245,245,250,0.95)';
    ctx.fillRect(0, 0, vw, RULER);
    ctx.fillRect(0, 0, RULER, vh);
    ctx.strokeStyle = dark ? '#8a8aa0' : '#6a6a80';
    ctx.fillStyle = dark ? '#c8c8d8' : '#40404f';
    ctx.font = '9px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const z = this.view.zoom;
    let step = 1;
    for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) {
      step = s;
      if (s * z >= 50) break;
    }
    const origin = this.view.toScreen({ x: 0, y: 0 });
    ctx.beginPath();
    const x0 = Math.floor(this.view.toDoc({ x: 0, y: 0 }).x / step) * step;
    for (let x = x0; ; x += step / 5) {
      const sx = origin.x + x * z;
      if (sx > vw) break;
      if (sx < RULER) continue;
      const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      ctx.moveTo(Math.round(sx) + 0.5, RULER);
      ctx.lineTo(Math.round(sx) + 0.5, major ? 4 : RULER - 5);
      if (major) ctx.fillText(String(Math.round(x)), sx + 2, 10);
    }
    const y0 = Math.floor(this.view.toDoc({ x: 0, y: 0 }).y / step) * step;
    for (let y = y0; ; y += step / 5) {
      const sy = origin.y + y * z;
      if (sy > vh) break;
      if (sy < RULER) continue;
      const major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
      ctx.moveTo(RULER, Math.round(sy) + 0.5);
      ctx.lineTo(major ? 4 : RULER - 5, Math.round(sy) + 0.5);
      if (major) {
        ctx.save();
        ctx.translate(10, sy + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(y)), -ctx.measureText(String(Math.round(y))).width, 0);
        ctx.restore();
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  get rulerSize(): number {
    return this.session.doc.view.rulers && Math.abs(this.view.rotation) < 0.001 ? RULER : 0;
  }

  /** Symmetry transforms for tools. */
  symmetry() {
    const s = this.session.doc.view.symmetry;
    return symmetryMatrices(s.mode, s.cx, s.cy, s.segments, s.mirror);
  }

  /** Screen position of a document point (CSS px). */
  screenOf(x: number, y: number) {
    return apply(this.view.matrix(), { x, y });
  }

  /** Current composite at document resolution (for the eyedropper). */
  get composite(): HTMLCanvasElement {
    return this.work;
  }
}
