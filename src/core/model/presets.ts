export interface SizePreset {
  id: string;
  /** i18n key */
  label: string;
  group: 'video' | 'social' | 'square' | 'other';
  width: number;
  height: number;
  fps?: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'hd', label: 'preset.hd', group: 'video', width: 1280, height: 720 },
  { id: 'fhd', label: 'preset.fhd', group: 'video', width: 1920, height: 1080 },
  { id: 'sd', label: 'preset.sd', group: 'video', width: 854, height: 480 },
  { id: 'uhd', label: 'preset.uhd', group: 'video', width: 3840, height: 2160 },
  { id: 'story', label: 'preset.story', group: 'social', width: 1080, height: 1920, fps: 24 },
  { id: 'insta45', label: 'preset.insta45', group: 'social', width: 1080, height: 1350 },
  { id: 'yt', label: 'preset.youtube', group: 'social', width: 1920, height: 1080 },
  { id: 'sq1080', label: 'preset.square1080', group: 'square', width: 1080, height: 1080 },
  { id: 'sq512', label: 'preset.square512', group: 'square', width: 512, height: 512, fps: 12 },
  { id: 'sticker', label: 'preset.sticker', group: 'square', width: 512, height: 512, fps: 12 },
  { id: 'small', label: 'preset.small', group: 'other', width: 640, height: 360, fps: 12 },
];

export const FPS_CHOICES = [6, 8, 10, 12, 15, 18, 24, 25, 30, 48, 50, 60];

export const MIN_SIZE = 16;
export const MAX_SIZE = 4096;
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MAX_HOLD = 240;

/** Rough RAM needed for one fully decoded cel. */
export const celBytes = (w: number, h: number): number => w * h * 4;
