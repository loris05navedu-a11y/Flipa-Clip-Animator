import type { BlendMode } from '../core/model/types';

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

/** Application-wide clipboard (kept in memory for the whole session). */
export const clipboard: { pixels: PixelClip | null; frames: FrameClip | null } = {
  pixels: null,
  frames: null,
};
