import { clipboard, type FrameClip } from '../engine/Clipboard';
import { createCanvas, ctx2d } from '../engine/canvas';
import { newLayer } from '../core/model/project';
import { insertFrames, uniqueLayerName } from '../core/model/ops';
import { uid } from '../core/util/id';
import type { FrameDef, LayerDef } from '../core/model/types';
import type { EditorSession } from './EditorSession';

/** Copy frames (with the pixels of every layer) to the app clipboard. */
export async function copyFrames(s: EditorSession, ids: string[]): Promise<number> {
  const set = new Set(ids);
  const frames = s.doc.frames.filter((f) => set.has(f.id));
  const clip: FrameClip = {
    width: s.doc.width,
    height: s.doc.height,
    layers: s.doc.layers.map((l) => ({ name: l.name, opacity: l.opacity, blendMode: l.blendMode, visible: l.visible })),
    frames: [],
  };
  for (const f of frames) {
    const cels: FrameClip['frames'][number]['cels'] = [];
    for (const l of s.doc.layers) {
      const celId = f.cels[l.id];
      const b = celId ? s.cels.bounds(celId) : null;
      if (!celId || !b || s.cels.isEmpty(celId)) {
        cels.push(null);
        continue;
      }
      await s.cels.ensureLoaded(celId);
      const c = createCanvas(b.w, b.h);
      const ctx = ctx2d(c);
      ctx.translate(-b.x, -b.y);
      s.cels.draw(ctx, celId);
      cels.push({ canvas: c, x: b.x, y: b.y });
    }
    clip.frames.push({ hold: f.hold, cels });
  }
  clipboard.frames = clip;
  return clip.frames.length;
}

/** Paste copied frames after the current frame. Missing layers are created. */
export async function pasteFrames(s: EditorSession): Promise<number> {
  const clip = clipboard.frames;
  if (!clip || !clip.frames.length) return 0;
  let layers: LayerDef[] = [...s.doc.layers];
  // Map clipboard layer i -> project layer (by position; extra layers are added on top).
  const map: string[] = [];
  for (let i = 0; i < clip.layers.length; i++) {
    if (layers[i]) map.push(layers[i].id);
    else {
      const l = { ...newLayer(uniqueLayerName(layers, s.opts.layerName)), opacity: clip.layers[i].opacity, blendMode: clip.layers[i].blendMode };
      layers = [...layers, l];
      map.push(l.id);
    }
  }
  const created: FrameDef[] = clip.frames.map((cf) => {
    const cels: Record<string, string> = {};
    cf.cels.forEach((c, i) => {
      if (c) cels[map[i]] = s.cels.createFrom(c.canvas, c.x, c.y);
    });
    return { id: uid('f'), hold: cf.hold, cels };
  });
  const at = s.frameIndex + 1;
  const frames = insertFrames(s.doc.frames, at, created);
  s.frameSelection = new Set(created.length > 1 ? created.map((f) => f.id) : []);
  s.change('history.pasteFrames', layers.length !== s.doc.layers.length ? { frames, layers } : { frames }, { frameIndex: at });
  return created.length;
}
