import type { FrameDef } from './types';

/** Tick index at which each frame starts (1 tick = 1/fps s). */
export function frameStarts(frames: readonly FrameDef[]): number[] {
  const out = new Array<number>(frames.length);
  let t = 0;
  for (let i = 0; i < frames.length; i++) {
    out[i] = t;
    t += Math.max(1, frames[i].hold | 0);
  }
  return out;
}

export function totalTicks(frames: readonly FrameDef[]): number {
  let t = 0;
  for (const f of frames) t += Math.max(1, f.hold | 0);
  return t;
}

export function durationSeconds(frames: readonly FrameDef[], fps: number): number {
  return totalTicks(frames) / fps;
}

/** Frame index displayed at a given tick (clamped). Binary search over starts. */
export function frameAtTick(starts: readonly number[], tick: number): number {
  if (starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  if (tick <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function frameAtTime(frames: readonly FrameDef[], fps: number, seconds: number): number {
  return frameAtTick(frameStarts(frames), Math.floor(seconds * fps + 1e-6));
}

/** Resample a sequence of frames to another frame rate: returns the frame index for each output frame. */
export function resampleIndices(frames: readonly FrameDef[], fps: number, outFps: number, first = 0, last = frames.length - 1): number[] {
  if (frames.length === 0 || last < first) return [];
  const starts = frameStarts(frames);
  const t0 = starts[first] / fps;
  const t1 = (starts[last] + Math.max(1, frames[last].hold)) / fps;
  const count = Math.max(1, Math.round((t1 - t0) * outFps));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = t0 + i / outFps;
    const idx = frameAtTick(starts, Math.floor(t * fps + 1e-6));
    out.push(Math.min(last, Math.max(first, idx)));
  }
  return out;
}
