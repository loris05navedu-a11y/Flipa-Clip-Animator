import { useSyncExternalStore } from 'react';
import type { BlendMode } from '../core/model/types';
import { Emitter } from '../core/util/emitter';

/** Pixels copied from a selection (shared across projects). */
export interface PixelClip {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

export interface FrameClipLayer {
  name: string;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

/** Frames copied from the timeline, with their pixels (by layer index). */
export interface FrameClip {
  width: number;
  height: number;
  layers: FrameClipLayer[];
  frames: { hold: number; cels: ({ canvas: HTMLCanvasElement; x: number; y: number } | null)[] }[];
}

const changed = new Emitter<void>();
let version = 0;
let pixels: PixelClip | null = null;
let frames: FrameClip | null = null;

/** Application-wide clipboard (kept in memory for the whole session); observable by the UI. */
export const clipboard = {
  get pixels(): PixelClip | null {
    return pixels;
  },
  set pixels(v: PixelClip | null) {
    pixels = v;
    version++;
    changed.emit();
  },
  get frames(): FrameClip | null {
    return frames;
  },
  set frames(v: FrameClip | null) {
    frames = v;
    version++;
    changed.emit();
  },
};

/** Re-render when the clipboard content changes. */
export function useClipboard(): typeof clipboard {
  useSyncExternalStore(
    (cb) => changed.on(cb),
    () => version,
  );
  return clipboard;
}
