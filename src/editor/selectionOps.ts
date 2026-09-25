import { parseHex, toCss } from '../core/color/color';
import { pixelRect, type Rect } from '../core/util/math';
import type { TransformParams } from '../core/geometry/matrix';
import { cloneCanvas, copyRegion, createCanvas, ctx2d } from '../engine/canvas';
import { clipboard } from '../engine/Clipboard';
import type { Floating, FloatingKind } from '../engine/Floating';
import { Selection } from '../engine/Selection';
import type { EditorSession } from './EditorSession';

const identityAt = (cx: number, cy: number): TransformParams => ({ cx, cy, sx: 1, sy: 1, rotation: 0, skew: 0 });

/** Pixels of the active cel inside the selection (or the whole content). */
async function selectedPixels(s: EditorSession): Promise<{ canvas: HTMLCanvasElement; rect: Rect; celId: string; created: boolean; source: HTMLCanvasElement } | null> {
  const t = await s.activeCanvas();
  const sel = s.selection;
  const content = s.cels.bounds(t.celId);
  const rect = sel?.bounds ?? content;
  if (!rect) {
    if (t.link) {
      /* nothing to lift: forget the empty cel */
    }
    return null;
  }
  const r = pixelRect(rect, s.doc.width, s.doc.height);
  if (!r) return null;
  const canvas = copyRegion(t.canvas, r);
  if (sel) {
    const c = ctx2d(canvas);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(sel.mask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  if (t.link) s.linkCel(t.link.frameId, t.link.layerId, t.link.celId);
  return { canvas, rect: r, celId: t.celId, created: !!t.link, source: t.canvas };
}

/**
 * Lift the selection (or the whole layer content) into a floating object
 * that can be moved / transformed, then committed with commitFloating().
 */
export async function liftSelection(s: EditorSession, keepSource = false): Promise<Floating | null> {
  if (s.floating) return s.floating;
  if (s.editBlocker()) return null;
  const px = await selectedPixels(s);
  if (!px) return null;
  const base = cloneCanvas(px.source);
  if (!keepSource) {
    const ctx = ctx2d(px.source);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    if (s.selection) ctx.drawImage(s.selection.mask, px.rect.x, px.rect.y, px.rect.w, px.rect.h, px.rect.x, px.rect.y, px.rect.w, px.rect.h);
    else ctx.fillRect(px.rect.x, px.rect.y, px.rect.w, px.rect.h);
    ctx.restore();
    s.cels.markChanged(px.celId, px.rect);
  }
  const t = identityAt(px.rect.x + px.rect.w / 2, px.rect.y + px.rect.h / 2);
  const f: Floating = {
    kind: 'selection',
    canvas: px.canvas,
    t,
    origin: { ...t },
    frameId: s.frame.id,
    layerId: s.layerId,
    celId: px.celId,
    created: px.created,
    base,
    liftRect: keepSource ? null : px.rect,
  };
  s.setFloating(f);
  return f;
}

/** Create a floating object from arbitrary pixels (paste, import, text). */
export async function floatCanvas(s: EditorSession, canvas: HTMLCanvasElement, kind: FloatingKind, at?: { x: number; y: number }, meta?: unknown): Promise<Floating | null> {
  if (s.floating) await s.commitFloating();
  if (s.editBlocker()) return null;
  const t = await s.activeCanvas();
  if (t.link) s.linkCel(t.link.frameId, t.link.layerId, t.link.celId);
  const p = identityAt(at?.x ?? s.doc.width / 2, at?.y ?? s.doc.height / 2);
  const f: Floating = {
    kind,
    canvas,
    t: p,
    origin: { ...p },
    frameId: s.frame.id,
    layerId: s.layerId,
    celId: t.celId,
    created: !!t.link,
    base: cloneCanvas(t.canvas),
    liftRect: null,
    meta,
  };
  s.setFloating(f);
  return f;
}

export async function copySelection(s: EditorSession): Promise<boolean> {
  if (s.floating) {
    const f = s.floating;
    clipboard.pixels = { canvas: cloneCanvas(f.canvas), x: f.t.cx - f.canvas.width / 2, y: f.t.cy - f.canvas.height / 2 };
    return true;
  }
  const px = await selectedPixels(s);
  if (!px) return false;
  clipboard.pixels = { canvas: px.canvas, x: px.rect.x, y: px.rect.y };
  if (px.created) s.linkCel(s.frame.id, s.layerId, null);
  return true;
}

export async function cutSelection(s: EditorSession): Promise<boolean> {
  if (!(await copySelection(s))) return false;
  if (s.floating) {
    // Cutting a floating object simply drops it (its source was already lifted).
    const f = s.floating;
    s.floating = null;
    const canvas = await s.cels.editable(f.celId);
    if (f.liftRect) {
      s.commitPixels('history.cut', [{ celId: f.celId, rect: f.liftRect, before: copyRegion(f.base, f.liftRect), after: copyRegion(canvas, f.liftRect) }]);
    }
    s.emit('floating');
    return true;
  }
  await deleteSelection(s, 'history.cut');
  return true;
}

export async function pasteClipboard(s: EditorSession): Promise<boolean> {
  const clip = clipboard.pixels;
  if (!clip) return false;
  const inside = clip.x + clip.canvas.width / 2 < s.doc.width && clip.y + clip.canvas.height / 2 < s.doc.height;
  const at = inside ? { x: clip.x + clip.canvas.width / 2, y: clip.y + clip.canvas.height / 2 } : undefined;
  return !!(await floatCanvas(s, cloneCanvas(clip.canvas), 'paste', at));
}

export async function duplicateSelection(s: EditorSession): Promise<boolean> {
  if (s.floating) {
    const f = s.floating;
    await s.commitFloating();
    return !!(await floatCanvas(s, cloneCanvas(f.canvas), 'paste', { x: f.t.cx + 16, y: f.t.cy + 16 }));
  }
  const f = await liftSelection(s, true);
  if (!f) return false;
  f.t = { ...f.t, cx: f.t.cx + 16, cy: f.t.cy + 16 };
  f.kind = 'paste';
  s.setFloating(f);
  return true;
}

export async function deleteSelection(s: EditorSession, label = 'history.deleteSelection'): Promise<boolean> {
  if (s.floating) {
    const f = s.floating;
    s.floating = null;
    if (f.liftRect) {
      const canvas = await s.cels.editable(f.celId);
      s.commitPixels(label, [{ celId: f.celId, rect: f.liftRect, before: copyRegion(f.base, f.liftRect), after: copyRegion(canvas, f.liftRect) }]);
    }
    s.emit('floating');
    return true;
  }
  const celId = s.frame.cels[s.layerId];
  if (!celId || s.editBlocker()) return false;
  const sel = s.selection;
  const rect = sel?.bounds ?? s.cels.bounds(celId);
  if (!rect) return false;
  await s.editActive(label, rect, (ctx) => {
    ctx.globalCompositeOperation = 'destination-out';
    if (sel) ctx.drawImage(sel.mask, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    else ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  });
  return true;
}

export async function fillSelection(s: EditorSession, hex: string): Promise<boolean> {
  const sel = s.selection;
  if (!sel?.bounds || s.editBlocker()) return false;
  const c = parseHex(hex);
  if (!c) return false;
  const r = sel.bounds;
  const tmp = createCanvas(r.w, r.h);
  const t = ctx2d(tmp);
  t.drawImage(sel.mask, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = toCss(c);
  t.fillRect(0, 0, r.w, r.h);
  await s.editActive('history.fill', r, (ctx) => ctx.drawImage(tmp, r.x, r.y));
  return true;
}

/** Mirror the selection (or the layer) in place. */
export async function flipSelection(s: EditorSession, axis: 'h' | 'v'): Promise<boolean> {
  const had = !!s.floating;
  const f = s.floating ?? (await liftSelection(s));
  if (!f) return false;
  f.t = axis === 'h' ? { ...f.t, sx: -f.t.sx } : { ...f.t, sy: -f.t.sy };
  s.setFloating(f);
  // A one-shot flip is applied immediately; during a transform it stays editable.
  if (!had) await s.commitFloating();
  return true;
}

/** Move the selected pixels of the active layer onto another layer (same frame). */
export async function moveSelectionToLayer(s: EditorSession, layerId: string): Promise<boolean> {
  if (layerId === s.layerId) return false;
  const target = s.doc.layers.find((l) => l.id === layerId);
  if (!target || target.locked) return false;
  if (s.floating) await s.commitFloating();
  const px = await selectedPixels(s);
  if (!px) return false;
  const r = px.rect;
  // 1. Remove from the source.
  const beforeSrc = copyRegion(px.source, r);
  const sctx = ctx2d(px.source);
  sctx.save();
  sctx.globalCompositeOperation = 'destination-out';
  if (s.selection) sctx.drawImage(s.selection.mask, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  else sctx.fillRect(r.x, r.y, r.w, r.h);
  sctx.restore();
  const afterSrc = copyRegion(px.source, r);
  // 2. Paste onto the destination cel (created if needed).
  const frame = s.frame;
  let destId = frame.cels[layerId];
  const links = px.created ? [{ frameId: frame.id, layerId: s.layerId, celId: px.celId }] : [];
  if (!destId) {
    destId = s.cels.create();
    links.push({ frameId: frame.id, layerId, celId: destId });
    s.linkCel(frame.id, layerId, destId);
  }
  const dest = await s.cels.editable(destId);
  const beforeDst = copyRegion(dest, r);
  ctx2d(dest).drawImage(px.canvas, r.x, r.y);
  const afterDst = copyRegion(dest, r);
  s.commitPixels(
    'history.moveToLayer',
    [
      { celId: px.celId, rect: r, before: beforeSrc, after: afterSrc },
      { celId: destId, rect: r, before: beforeDst, after: afterDst },
    ],
    links,
  );
  s.setLayer(layerId);
  return true;
}

export function selectAll(s: EditorSession): void {
  s.setSelection(Selection.rect(s.doc.width, s.doc.height, { x: 0, y: 0, w: s.doc.width, h: s.doc.height }));
}

export function invertSelection(s: EditorSession): void {
  if (!s.selection) return selectAll(s);
  const inv = s.selection.clone();
  inv.invert();
  s.setSelection(inv);
}

export function deselect(s: EditorSession): void {
  s.setSelection(null);
}

/** Selection covering the non-transparent pixels of the active layer. */
export function selectLayerContent(s: EditorSession): void {
  const celId = s.frame.cels[s.layerId];
  const b = celId ? s.cels.bounds(celId) : null;
  if (!celId || !b) return;
  const sel = new Selection(s.doc.width, s.doc.height);
  const ctx = ctx2d(sel.mask);
  s.cels.draw(ctx, celId);
  sel.recomputeBounds();
  s.setSelection(sel);
}

