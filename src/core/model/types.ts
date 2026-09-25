/**
 * Document model. Everything here is plain JSON-serialisable data.
 * Pixel data never lives in the document: frames reference cels by id and the
 * CelStore (engine) owns the bitmaps. See docs/FORMAT.md for the on-disk format.
 */

export const FORMAT_ID = 'frameloom-project';
export const FORMAT_VERSION = 1;

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'add',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'erase',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Canvas 2D composite operation used for each blend mode. */
export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  add: 'lighter',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  erase: 'destination-out',
};

export interface LayerDef {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
}

export interface FrameDef {
  id: string;
  /** Exposure in timeline ticks (1 tick = 1/fps second). Always >= 1. */
  hold: number;
  /** layerId -> celId. A missing entry means the cel is empty. */
  cels: Record<string, string>;
}

/** Persisted cel: a cropped bitmap placed at (x, y) in project space. */
export interface CelRecord {
  /** Asset key of the encoded PNG, or null when the cel is empty. */
  key: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AudioClipDef {
  id: string;
  name: string;
  /** Asset key of the original audio file. */
  assetKey: string;
  mime: string;
  /** Position on the timeline, in seconds. */
  start: number;
  /** Offset into the source, in seconds (trim in). */
  offset: number;
  /** Played length, in seconds (trim out = offset + duration). */
  duration: number;
  /** Length of the whole source, in seconds. */
  sourceDuration: number;
  /** 0..2 */
  volume: number;
  muted: boolean;
}

export interface AudioTrackDef {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
  clips: AudioClipDef[];
}

export interface ReferenceDef {
  id: string;
  name: string;
  assetKey: string;
  mime: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Centre position in project pixels. */
  x: number;
  y: number;
  scale: number;
  /** Radians */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  placement: 'below' | 'above';
  /** When false (default) the reference never appears in exports. */
  exportable: boolean;
}

export interface Palette {
  id: string;
  name: string;
  /** #rrggbbaa */
  colors: string[];
}

export interface GuideDef {
  id: string;
  axis: 'x' | 'y';
  /** Position in project pixels (x for vertical guides, y for horizontal ones). */
  pos: number;
}

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quad' | 'radial';

export interface ViewSettings {
  grid: { enabled: boolean; size: number; color: string; opacity: number; snap: boolean };
  rulers: boolean;
  guides: GuideDef[];
  guidesVisible: boolean;
  snapGuides: boolean;
  symmetry: { mode: SymmetryMode; segments: number; cx: number; cy: number; mirror: boolean; visible: boolean };
  onion: {
    enabled: boolean;
    before: number;
    after: number;
    opacity: number;
    /** Opacity multiplier applied per step away from the current frame. */
    falloff: number;
    tint: boolean;
    colorBefore: string;
    colorAfter: string;
    /** true: all visible layers; false: active layer only. */
    allLayers: boolean;
    loop: boolean;
  };
  referencesVisible: boolean;
}

export interface ProjectBackground {
  color: string;
  transparent: boolean;
}

/** In-memory project document (without cel records, which live in the CelStore). */
export interface ProjectData {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: ProjectBackground;
  /** Bottom -> top */
  layers: LayerDef[];
  frames: FrameDef[];
  audio: AudioTrackDef[];
  references: ReferenceDef[];
  palettes: Palette[];
  /** Snapshot of the user's custom brushes at save time. */
  brushes: unknown[];
  view: ViewSettings;
  createdAt: number;
  modifiedAt: number;
}

/** Serialised project (project.json inside a .frameloom file / IndexedDB doc). */
export interface SavedProject extends ProjectData {
  format: typeof FORMAT_ID;
  formatVersion: number;
  cels: Record<string, CelRecord>;
}

/** Light-weight listing information for the home screen. */
export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  layerCount: number;
  durationSec: number;
  createdAt: number;
  modifiedAt: number;
  /** Current saved revision number. */
  rev: number;
  thumbKey: string | null;
  deletedAt: number | null;
}
