import { describe, expect, it } from 'vitest';
import { createProject, newFrame, validateSavedProject, ProjectFormatError, referencedKeys } from '../../src/core/model/project';
import * as ops from '../../src/core/model/ops';
import { frameAtTick, frameStarts, totalTicks, resampleIndices, durationSeconds } from '../../src/core/model/timing';
import { FORMAT_ID, FORMAT_VERSION, type FrameDef, type SavedProject } from '../../src/core/model/types';

const base = () => createProject({ name: 'Test', width: 320, height: 240, fps: 12, frameCount: 4, background: '#ffffff', transparent: false });
let celCounter = 0;
const clone = (id: string) => `${id}-c${++celCounter}`;

describe('project creation', () => {
  it('creates the requested frames and one layer', () => {
    const p = base();
    expect(p.frames).toHaveLength(4);
    expect(p.layers).toHaveLength(1);
    expect(p.fps).toBe(12);
  });
  it('clamps absurd parameters', () => {
    const p = createProject({ name: '  ', width: 99999, height: 1, fps: 500, frameCount: 0, background: '#000000', transparent: true });
    expect(p.width).toBe(4096);
    expect(p.height).toBe(16);
    expect(p.fps).toBe(60);
    expect(p.frames).toHaveLength(1);
    expect(p.name).toBe('Animation');
  });
});

describe('timing', () => {
  const frames: FrameDef[] = [{ ...newFrame(1) }, { ...newFrame(3) }, { ...newFrame(2) }];
  it('computes starts and total', () => {
    expect(frameStarts(frames)).toEqual([0, 1, 4]);
    expect(totalTicks(frames)).toBe(6);
    expect(durationSeconds(frames, 12)).toBeCloseTo(0.5);
  });
  it('maps ticks to frames', () => {
    const s = frameStarts(frames);
    expect([0, 1, 2, 3, 4, 5, 99].map((t) => frameAtTick(s, t))).toEqual([0, 1, 1, 1, 2, 2, 2]);
    expect(frameAtTick([], 3)).toBe(-1);
  });
  it('resamples to another frame rate', () => {
    const f = [newFrame(1), newFrame(1)];
    expect(resampleIndices(f, 2, 4)).toEqual([0, 0, 1, 1]);
    expect(resampleIndices(f, 2, 1)).toEqual([0]);
  });
});

describe('frame operations', () => {
  it('inserts, removes and never leaves the timeline empty', () => {
    const p = base();
    const { frames, frame } = ops.insertEmptyFrame(p.frames, 2);
    expect(frames[2]).toBe(frame);
    expect(frames).toHaveLength(5);
    const none = ops.removeFrames(frames, frames.map((f) => f.id));
    expect(none).toHaveLength(1);
    expect(p.frames).toHaveLength(4); // input untouched
  });
  it('moves several frames preserving their order', () => {
    const f = [0, 1, 2, 3, 4].map(() => newFrame());
    const ids = f.map((x) => x.id);
    const moved = ops.moveFrames(f, [ids[0], ids[2]], 5);
    expect(moved.map((x) => ids.indexOf(x.id))).toEqual([1, 3, 4, 0, 2]);
    const front = ops.moveFrames(f, [ids[3], ids[4]], 0);
    expect(front.map((x) => ids.indexOf(x.id))).toEqual([3, 4, 0, 1, 2]);
    const mid = ops.moveFrames(f, [ids[4]], 2);
    expect(mid.map((x) => ids.indexOf(x.id))).toEqual([0, 1, 4, 2, 3]);
  });
  it('duplicates frames with cloned cels after the selection', () => {
    const p = base();
    const layer = p.layers[0].id;
    const frames = ops.setCel(p.frames, p.frames[1].id, layer, 'celA');
    const { frames: out, created } = ops.duplicateFrames(frames, [frames[1].id], clone);
    expect(out).toHaveLength(5);
    expect(out[2]).toBe(created[0]);
    expect(created[0].cels[layer]).toMatch(/^celA-c/);
    expect(created[0].id).not.toBe(frames[1].id);
  });
  it('sets hold and reverses', () => {
    const f = [newFrame(), newFrame(), newFrame()];
    expect(ops.setHold(f, [f[1].id], 1000)[1].hold).toBe(240);
    expect(ops.setHold(f, [f[1].id], 0)[1].hold).toBe(1);
    expect(ops.reverseFrames(f, f.map((x) => x.id)).map((x) => x.id)).toEqual([f[2].id, f[1].id, f[0].id]);
  });
  it('handles hundreds of frames', () => {
    let frames = Array.from({ length: 800 }, () => newFrame());
    frames = ops.moveFrames(frames, frames.slice(100, 400).map((f) => f.id), 800);
    expect(frames).toHaveLength(800);
    expect(new Set(frames.map((f) => f.id)).size).toBe(800);
    expect(totalTicks(frames)).toBe(800);
  });
});

describe('layer operations', () => {
  it('adds, duplicates, moves and removes layers with their cels', () => {
    const p = base();
    const l1 = p.layers[0];
    let frames = ops.setCel(p.frames, p.frames[0].id, l1.id, 'c1');
    const dup = ops.duplicateLayer(p.layers, frames, l1.id, clone)!;
    expect(dup.layers).toHaveLength(2);
    expect(dup.layers[1].id).toBe(dup.layer.id);
    expect(dup.frames[0].cels[dup.layer.id]).toMatch(/^c1-c/);
    frames = dup.frames;
    const moved = ops.moveLayer(dup.layers, 1, 0);
    expect(moved[0].id).toBe(dup.layer.id);
    const removed = ops.removeLayer(moved, frames, l1.id)!;
    expect(removed.layers).toHaveLength(1);
    expect(removed.removedCels).toEqual(['c1']);
    expect(removed.frames[0].cels[l1.id]).toBeUndefined();
    expect(ops.removeLayer(removed.layers, removed.frames, removed.layers[0].id)).toBeNull();
  });
});

describe('validation of saved projects', () => {
  const saved = (): SavedProject => ({ ...base(), format: FORMAT_ID, formatVersion: FORMAT_VERSION, cels: {} });
  it('accepts a valid document', () => {
    const d = saved();
    const layer = d.layers[0].id;
    d.frames[0].cels[layer] = 'cel1';
    d.cels.cel1 = { key: 'asset1', x: 0, y: 0, w: 10, h: 10 };
    const v = validateSavedProject(JSON.parse(JSON.stringify(d)));
    expect(v.frames[0].cels[layer]).toBe('cel1');
    expect([...referencedKeys(v)]).toEqual(['asset1']);
  });
  it('rejects garbage with a typed error', () => {
    for (const bad of [null, 42, 'x', [], {}, { format: FORMAT_ID, formatVersion: 1 }, { format: FORMAT_ID, formatVersion: 99, width: 10, height: 10 }]) {
      expect(() => validateSavedProject(bad)).toThrow(ProjectFormatError);
    }
  });
  it('repairs dangling references and clamps values', () => {
    const d = saved() as unknown as Record<string, unknown>;
    const frames = d.frames as FrameDef[];
    frames[0].cels['ghost-layer'] = 'x';
    frames[1].cels[(d.layers as { id: string }[])[0].id] = 'missing-cel';
    frames[2].hold = -5;
    (d.layers as { opacity: number; blendMode: string }[])[0].opacity = 7;
    (d.layers as { opacity: number; blendMode: string }[])[0].blendMode = '<script>';
    d.fps = 1000;
    const v = validateSavedProject(d);
    expect(v.frames[0].cels).toEqual({});
    expect(v.frames[1].cels).toEqual({});
    expect(v.frames[2].hold).toBe(1);
    expect(v.layers[0].opacity).toBe(1);
    expect(v.layers[0].blendMode).toBe('normal');
    expect(v.fps).toBe(60);
  });
  it('drops a cel referenced twice', () => {
    const d = saved();
    const layer = d.layers[0].id;
    d.frames[0].cels[layer] = 'c';
    d.frames[1].cels[layer] = 'c';
    d.cels.c = { key: 'k', x: 0, y: 0, w: 1, h: 1 };
    const v = validateSavedProject(d);
    expect(v.frames[0].cels[layer]).toBe('c');
    expect(v.frames[1].cels[layer]).toBeUndefined();
  });
});
