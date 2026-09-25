import { BLEND_TO_COMPOSITE, type FrameDef, type LayerDef, type ProjectData, type ReferenceDef } from '../core/model/types';
import { transformMatrix } from '../core/geometry/matrix';
import type { CelStore } from './CelStore';

export interface ReferenceImages {
  get(ref: ReferenceDef): CanvasImageSource | null;
}

export interface ComposeOptions {
  /** Paint the project background colour (ignored if the project is transparent). */
  background: boolean;
  /** Which references to include: none, exportable ones, or all visible. */
  references: 'none' | 'exportable' | 'visible';
  /** Only these layers (default: all visible). */
  layerFilter?: (l: LayerDef) => boolean;
  /** Hook drawn right after a given layer (floating selection, live previews). */
  afterLayer?: (layerId: string, ctx: CanvasRenderingContext2D) => void;
  /** Draw hidden layers too (used for per-layer thumbnails). */
  includeHidden?: boolean;
}

export function drawReference(ctx: CanvasRenderingContext2D, ref: ReferenceDef, img: CanvasImageSource): void {
  const m = transformMatrix({ cx: ref.x, cy: ref.y, sx: ref.scale, sy: ref.scale, rotation: ref.rotation, skew: 0 });
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.globalAlpha *= ref.opacity;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -ref.naturalWidth / 2, -ref.naturalHeight / 2, ref.naturalWidth, ref.naturalHeight);
  ctx.restore();
}

export function drawReferences(
  ctx: CanvasRenderingContext2D,
  doc: ProjectData,
  refs: ReferenceImages | null,
  placement: 'below' | 'above',
  mode: ComposeOptions['references'],
): void {
  if (!refs || mode === 'none' || (mode === 'visible' && !doc.view.referencesVisible)) return;
  for (const r of doc.references) {
    if (r.placement !== placement || !r.visible) continue;
    if (mode === 'exportable' && !r.exportable) continue;
    const img = refs.get(r);
    if (img) drawReference(ctx, r, img);
  }
}

/**
 * Draw the layers of a frame into `ctx` (in project space). Returns false if
 * some cels were not decoded yet (they are skipped).
 */
export function composeFrame(
  ctx: CanvasRenderingContext2D,
  doc: ProjectData,
  frame: FrameDef,
  cels: CelStore,
  refs: ReferenceImages | null,
  opts: ComposeOptions,
): boolean {
  let complete = true;
  ctx.save();
  if (opts.background && !doc.background.transparent) {
    ctx.fillStyle = doc.background.color;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  drawReferences(ctx, doc, refs, 'below', opts.references);
  for (const layer of doc.layers) {
    if (!layer.visible && !opts.includeHidden) continue;
    if (opts.layerFilter && !opts.layerFilter(layer)) continue;
    const celId = frame.cels[layer.id];
    const hasHook = !!opts.afterLayer;
    if (!celId && !hasHook) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
    if (celId && !cels.draw(ctx, celId)) complete = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    opts.afterLayer?.(layer.id, ctx);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawReferences(ctx, doc, refs, 'above', opts.references);
  ctx.restore();
  return complete;
}

export function frameCelIds(doc: ProjectData, frame: FrameDef, visibleOnly = true): string[] {
  const out: string[] = [];
  for (const l of doc.layers) {
    if (visibleOnly && !l.visible) continue;
    const c = frame.cels[l.id];
    if (c) out.push(c);
  }
  return out;
}

export async function ensureFrameLoaded(doc: ProjectData, frame: FrameDef, cels: CelStore, visibleOnly = true): Promise<void> {
  await Promise.all(frameCelIds(doc, frame, visibleOnly).map((id) => cels.ensureLoaded(id)));
}

/** Stable key describing everything that affects a frame composite. */
export function frameKey(doc: ProjectData, frame: FrameDef, cels: CelStore, extra = ''): string {
  let k = `${doc.width}x${doc.height}|${doc.background.transparent ? 't' : doc.background.color}|${extra}`;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const c = frame.cels[l.id];
    k += `|${l.id}:${l.opacity}:${l.blendMode}:${c ? c + '@' + cels.version(c) : '-'}`;
  }
  return k;
}
