/**
 * Pure structural operations on frames and layers. They never mutate their
 * inputs, which lets the editor keep cheap before/after snapshots for undo.
 * Cel pixel data is handled elsewhere: callers pass `cloneCel` when a copy of
 * a cel's content is needed and get back the id of the new cel.
 */
import { uid } from '../util/id';
import { clamp } from '../util/math';
import { MAX_HOLD } from './presets';
import type { FrameDef, LayerDef } from './types';
import { newFrame } from './project';

export type CloneCel = (celId: string) => string;

export function indexOfFrame(frames: readonly FrameDef[], id: string): number {
  return frames.findIndex((f) => f.id === id);
}

export function insertFrames(frames: readonly FrameDef[], index: number, added: FrameDef[]): FrameDef[] {
  const i = clamp(index, 0, frames.length);
  return [...frames.slice(0, i), ...added, ...frames.slice(i)];
}

export function insertEmptyFrame(frames: readonly FrameDef[], index: number, hold = 1): { frames: FrameDef[]; frame: FrameDef } {
  const frame = newFrame(hold);
  return { frames: insertFrames(frames, index, [frame]), frame };
}

/** Remove frames. The timeline always keeps at least one (empty) frame. */
export function removeFrames(frames: readonly FrameDef[], ids: Iterable<string>): FrameDef[] {
  const set = new Set(ids);
  const out = frames.filter((f) => !set.has(f.id));
  return out.length ? out : [newFrame()];
}

/**
 * Move a set of frames so the block (kept in timeline order) is inserted
 * before the frame currently at `target` (an index in the original list,
 * `frames.length` means "at the end").
 */
export function moveFrames(frames: readonly FrameDef[], ids: Iterable<string>, target: number): FrameDef[] {
  const set = new Set(ids);
  const moving = frames.filter((f) => set.has(f.id));
  if (!moving.length) return [...frames];
  const t = clamp(target, 0, frames.length);
  let insertAt = 0;
  for (let i = 0; i < t; i++) if (!set.has(frames[i].id)) insertAt++;
  const rest = frames.filter((f) => !set.has(f.id));
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

/** Deep copy of frames with new frame ids and cloned cels. */
export function cloneFrames(source: readonly FrameDef[], cloneCel: CloneCel, layerMap?: Record<string, string>): FrameDef[] {
  return source.map((f) => {
    const cels: Record<string, string> = {};
    for (const [layerId, celId] of Object.entries(f.cels)) {
      const target = layerMap ? layerMap[layerId] : layerId;
      if (target) cels[target] = cloneCel(celId);
    }
    return { id: uid('f'), hold: f.hold, cels };
  });
}

/** Duplicate the given frames; the copies are inserted right after the last selected frame. */
export function duplicateFrames(
  frames: readonly FrameDef[],
  ids: Iterable<string>,
  cloneCel: CloneCel,
): { frames: FrameDef[]; created: FrameDef[] } {
  const set = new Set(ids);
  const selected = frames.filter((f) => set.has(f.id));
  if (!selected.length) return { frames: [...frames], created: [] };
  let last = -1;
  frames.forEach((f, i) => {
    if (set.has(f.id)) last = i;
  });
  const created = cloneFrames(selected, cloneCel);
  return { frames: insertFrames(frames, last + 1, created), created };
}

export function setHold(frames: readonly FrameDef[], ids: Iterable<string>, hold: number): FrameDef[] {
  const set = new Set(ids);
  const h = clamp(Math.round(hold), 1, MAX_HOLD);
  return frames.map((f) => (set.has(f.id) ? { ...f, hold: h } : f));
}

export function reverseFrames(frames: readonly FrameDef[], ids: Iterable<string>): FrameDef[] {
  const set = new Set(ids);
  const positions: number[] = [];
  frames.forEach((f, i) => set.has(f.id) && positions.push(i));
  const out = [...frames];
  const picked = positions.map((i) => frames[i]).reverse();
  positions.forEach((pos, k) => (out[pos] = picked[k]));
  return out;
}

/** Set (or clear with null) the cel of a layer in one frame. */
export function setCel(frames: readonly FrameDef[], frameId: string, layerId: string, celId: string | null): FrameDef[] {
  return frames.map((f) => {
    if (f.id !== frameId) return f;
    const cels = { ...f.cels };
    if (celId) cels[layerId] = celId;
    else delete cels[layerId];
    return { ...f, cels };
  });
}

/* ------------------------------- Layers ------------------------------- */

export function addLayer(layers: readonly LayerDef[], index: number, layer: LayerDef): LayerDef[] {
  const i = clamp(index, 0, layers.length);
  return [...layers.slice(0, i), layer, ...layers.slice(i)];
}

/** Remove a layer and its cels from every frame. At least one layer always remains. */
export function removeLayer(
  layers: readonly LayerDef[],
  frames: readonly FrameDef[],
  layerId: string,
): { layers: LayerDef[]; frames: FrameDef[]; removedCels: string[] } | null {
  if (layers.length <= 1) return null;
  const removedCels: string[] = [];
  const nextFrames = frames.map((f) => {
    if (!(layerId in f.cels)) return f;
    const cels = { ...f.cels };
    removedCels.push(cels[layerId]);
    delete cels[layerId];
    return { ...f, cels };
  });
  return { layers: layers.filter((l) => l.id !== layerId), frames: nextFrames, removedCels };
}

export function moveLayer(layers: readonly LayerDef[], from: number, to: number): LayerDef[] {
  if (from < 0 || from >= layers.length) return [...layers];
  const out = [...layers];
  const [l] = out.splice(from, 1);
  out.splice(clamp(to, 0, out.length), 0, l);
  return out;
}

export function updateLayer(layers: readonly LayerDef[], id: string, patch: Partial<LayerDef>): LayerDef[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch, id: l.id } : l));
}

/** Duplicate a layer (placed just above) including a copy of each of its cels. */
export function duplicateLayer(
  layers: readonly LayerDef[],
  frames: readonly FrameDef[],
  layerId: string,
  cloneCel: CloneCel,
  copySuffix = ' copie',
): { layers: LayerDef[]; frames: FrameDef[]; layer: LayerDef } | null {
  const idx = layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return null;
  const src = layers[idx];
  const layer: LayerDef = { ...src, id: uid('l'), name: (src.name + copySuffix).slice(0, 80) };
  const nextFrames = frames.map((f) => {
    const celId = f.cels[layerId];
    if (!celId) return f;
    return { ...f, cels: { ...f.cels, [layer.id]: cloneCel(celId) } };
  });
  return { layers: addLayer(layers, idx + 1, layer), frames: nextFrames, layer };
}

export function uniqueLayerName(layers: readonly LayerDef[], base: string): string {
  const names = new Set(layers.map((l) => l.name));
  for (let i = layers.length + 1; ; i++) {
    const n = `${base} ${i}`;
    if (!names.has(n)) return n;
  }
}
