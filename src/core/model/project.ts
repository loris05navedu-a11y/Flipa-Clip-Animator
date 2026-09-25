import { uid } from '../util/id';
import { clamp } from '../util/math';
import { MAX_FPS, MAX_HOLD, MAX_SIZE, MIN_FPS, MIN_SIZE } from './presets';
import {
  BLEND_MODES,
  FORMAT_ID,
  FORMAT_VERSION,
  type AudioClipDef,
  type AudioTrackDef,
  type BlendMode,
  type CelRecord,
  type FrameDef,
  type GuideDef,
  type LayerDef,
  type Palette,
  type ProjectData,
  type ProjectMeta,
  type ReferenceDef,
  type SavedProject,
  type ViewSettings,
} from './types';
import { durationSeconds } from './timing';

export interface NewProjectParams {
  name: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  background: string;
  transparent: boolean;
  /** Localised name of the first layer. */
  layerName?: string;
}

export function defaultView(width: number, height: number): ViewSettings {
  return {
    grid: { enabled: false, size: 64, color: '#4f7cff', opacity: 0.25, snap: false },
    rulers: false,
    guides: [],
    guidesVisible: true,
    snapGuides: true,
    symmetry: { mode: 'off', segments: 6, cx: width / 2, cy: height / 2, mirror: true, visible: true },
    onion: {
      enabled: true,
      before: 1,
      after: 0,
      opacity: 0.35,
      falloff: 0.6,
      tint: true,
      colorBefore: '#ff3b5c',
      colorAfter: '#1fbf75',
      allLayers: true,
      loop: false,
    },
    referencesVisible: true,
  };
}

export function newLayer(name: string): LayerDef {
  return { id: uid('l'), name, visible: true, locked: false, opacity: 1, blendMode: 'normal' };
}

export function newFrame(hold = 1): FrameDef {
  return { id: uid('f'), hold, cels: {} };
}

export const DEFAULT_PALETTE_COLORS = [
  '#000000ff', '#ffffffff', '#7f7f7fff', '#c3c3c3ff', '#e53935ff', '#fb8c00ff', '#fdd835ff', '#43a047ff',
  '#00acc1ff', '#1e88e5ff', '#5e35b1ff', '#d81b60ff', '#6d4c41ff', '#ffccbcff', '#f8bbd0ff', '#b3e5fcff',
];

export function createProject(p: NewProjectParams): ProjectData {
  const width = clamp(Math.round(p.width), MIN_SIZE, MAX_SIZE);
  const height = clamp(Math.round(p.height), MIN_SIZE, MAX_SIZE);
  const frames: FrameDef[] = [];
  const count = clamp(Math.round(p.frameCount) || 1, 1, 5000);
  for (let i = 0; i < count; i++) frames.push(newFrame());
  const now = Date.now();
  return {
    id: uid('p'),
    name: p.name.trim() || 'Animation',
    width,
    height,
    fps: clamp(Math.round(p.fps), MIN_FPS, MAX_FPS),
    background: { color: p.background, transparent: p.transparent },
    layers: [newLayer(p.layerName ?? 'Calque 1')],
    frames,
    audio: [],
    references: [],
    palettes: [{ id: uid('pal'), name: 'Projet', colors: [...DEFAULT_PALETTE_COLORS] }],
    brushes: [],
    view: defaultView(width, height),
    createdAt: now,
    modifiedAt: now,
  };
}

export function metaOf(doc: ProjectData, rev: number, thumbKey: string | null): ProjectMeta {
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    frameCount: doc.frames.length,
    layerCount: doc.layers.length,
    durationSec: durationSeconds(doc.frames, doc.fps),
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
    rev,
    thumbKey,
    deletedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Validation of untrusted project JSON (imported files, old saves)   */
/* ------------------------------------------------------------------ */

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v.toLowerCase() : fallback;
const safeId = (v: unknown, prefix: string): string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : uid(prefix);
const safeKey = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v) ? v : null);

/**
 * Validate and normalise a saved project. Unknown fields are dropped, numbers
 * are clamped, and structural problems raise a ProjectFormatError.
 */
export function validateSavedProject(input: unknown): SavedProject {
  if (!isObj(input)) throw new ProjectFormatError('not-an-object');
  if (input.format !== FORMAT_ID) throw new ProjectFormatError('bad-format-id');
  const version = num(input.formatVersion, 0);
  if (version < 1) throw new ProjectFormatError('bad-version');
  if (version > FORMAT_VERSION) throw new ProjectFormatError('newer-version');

  const width = Math.round(num(input.width, NaN, MIN_SIZE, MAX_SIZE));
  const height = Math.round(num(input.height, NaN, MIN_SIZE, MAX_SIZE));
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new ProjectFormatError('bad-size');

  if (!Array.isArray(input.layers) || input.layers.length === 0) throw new ProjectFormatError('no-layers');
  const layerIds = new Set<string>();
  const layers: LayerDef[] = input.layers.filter(isObj).map((l, i) => {
    let id = safeId(l.id, 'l');
    if (layerIds.has(id)) id = uid('l');
    layerIds.add(id);
    const bm = (BLEND_MODES as readonly string[]).includes(l.blendMode as string) ? (l.blendMode as BlendMode) : 'normal';
    return {
      id,
      name: str(l.name, `Calque ${i + 1}`, 80),
      visible: bool(l.visible, true),
      locked: bool(l.locked, false),
      opacity: num(l.opacity, 1, 0, 1),
      blendMode: bm,
    };
  });
  if (layers.length === 0) throw new ProjectFormatError('no-layers');

  const celsIn = isObj(input.cels) ? input.cels : {};
  const cels: Record<string, CelRecord> = {};
  for (const [celId, c] of Object.entries(celsIn)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(celId) || !isObj(c)) continue;
    const w = Math.round(num(c.w, 0, 0, MAX_SIZE));
    const h = Math.round(num(c.h, 0, 0, MAX_SIZE));
    cels[celId] = {
      key: safeKey(c.key),
      x: Math.round(num(c.x, 0, -MAX_SIZE, MAX_SIZE * 2)),
      y: Math.round(num(c.y, 0, -MAX_SIZE, MAX_SIZE * 2)),
      w,
      h,
    };
  }

  if (!Array.isArray(input.frames)) throw new ProjectFormatError('no-frames');
  const frameIds = new Set<string>();
  const usedCels = new Set<string>();
  const frames: FrameDef[] = input.frames.filter(isObj).map((f) => {
    let id = safeId(f.id, 'f');
    if (frameIds.has(id)) id = uid('f');
    frameIds.add(id);
    const map: Record<string, string> = {};
    if (isObj(f.cels)) {
      for (const [layerId, celId] of Object.entries(f.cels)) {
        // A cel may only be referenced once; drop dangling / duplicate references.
        if (layerIds.has(layerId) && typeof celId === 'string' && cels[celId] && !usedCels.has(celId)) {
          map[layerId] = celId;
          usedCels.add(celId);
        }
      }
    }
    return { id, hold: Math.round(num(f.hold, 1, 1, MAX_HOLD)), cels: map };
  });
  if (frames.length === 0) frames.push(newFrame());
  for (const k of Object.keys(cels)) if (!usedCels.has(k)) delete cels[k];

  const audio: AudioTrackDef[] = (Array.isArray(input.audio) ? input.audio : []).filter(isObj).map((t, i) => ({
    id: safeId(t.id, 'at'),
    name: str(t.name, `Audio ${i + 1}`, 80),
    volume: num(t.volume, 1, 0, 2),
    muted: bool(t.muted, false),
    clips: (Array.isArray(t.clips) ? t.clips : [])
      .filter(isObj)
      .map((c): AudioClipDef | null => {
        const assetKey = safeKey(c.assetKey);
        if (!assetKey) return null;
        const sourceDuration = num(c.sourceDuration, 0, 0, 36000);
        const offset = num(c.offset, 0, 0, sourceDuration);
        return {
          id: safeId(c.id, 'ac'),
          name: str(c.name, 'Audio', 120),
          assetKey,
          mime: str(c.mime, 'audio/mpeg', 80),
          start: num(c.start, 0, 0, 36000),
          offset,
          duration: num(c.duration, sourceDuration - offset, 0.01, Math.max(0.01, sourceDuration - offset)),
          sourceDuration,
          volume: num(c.volume, 1, 0, 2),
          muted: bool(c.muted, false),
        };
      })
      .filter((c): c is AudioClipDef => c !== null),
  }));

  const references: ReferenceDef[] = (Array.isArray(input.references) ? input.references : [])
    .filter(isObj)
    .map((r): ReferenceDef | null => {
      const assetKey = safeKey(r.assetKey);
      if (!assetKey) return null;
      return {
        id: safeId(r.id, 'r'),
        name: str(r.name, 'Référence', 120),
        assetKey,
        mime: str(r.mime, 'image/png', 80),
        naturalWidth: Math.round(num(r.naturalWidth, 1, 1, 16384)),
        naturalHeight: Math.round(num(r.naturalHeight, 1, 1, 16384)),
        x: num(r.x, width / 2, -1e5, 1e5),
        y: num(r.y, height / 2, -1e5, 1e5),
        scale: num(r.scale, 1, 0.01, 100),
        rotation: num(r.rotation, 0, -100, 100),
        opacity: num(r.opacity, 0.5, 0, 1),
        visible: bool(r.visible, true),
        locked: bool(r.locked, false),
        placement: r.placement === 'above' ? 'above' : 'below',
        exportable: bool(r.exportable, false),
      };
    })
    .filter((r): r is ReferenceDef => r !== null);

  const palettes: Palette[] = (Array.isArray(input.palettes) ? input.palettes : []).filter(isObj).map((p) => ({
    id: safeId(p.id, 'pal'),
    name: str(p.name, 'Palette', 80),
    colors: (Array.isArray(p.colors) ? p.colors : []).map((c) => color(c, '')).filter(Boolean).slice(0, 256),
  }));

  const view = defaultView(width, height);
  if (isObj(input.view)) {
    const v = input.view;
    if (isObj(v.grid)) {
      view.grid = {
        enabled: bool(v.grid.enabled, false),
        size: num(v.grid.size, 64, 2, 1024),
        color: color(v.grid.color, view.grid.color).slice(0, 7),
        opacity: num(v.grid.opacity, 0.25, 0.05, 1),
        snap: bool(v.grid.snap, false),
      };
    }
    view.rulers = bool(v.rulers, false);
    view.guidesVisible = bool(v.guidesVisible, true);
    view.snapGuides = bool(v.snapGuides, true);
    view.referencesVisible = bool(v.referencesVisible, true);
    view.guides = (Array.isArray(v.guides) ? v.guides : [])
      .filter(isObj)
      .map((g): GuideDef => ({ id: safeId(g.id, 'g'), axis: g.axis === 'y' ? 'y' : 'x', pos: num(g.pos, 0, -MAX_SIZE, MAX_SIZE * 2) }))
      .slice(0, 200);
    if (isObj(v.symmetry)) {
      const s = v.symmetry;
      const modes = ['off', 'vertical', 'horizontal', 'quad', 'radial'];
      view.symmetry = {
        mode: modes.includes(s.mode as string) ? (s.mode as ViewSettings['symmetry']['mode']) : 'off',
        segments: Math.round(num(s.segments, 6, 2, 32)),
        cx: num(s.cx, width / 2, 0, width),
        cy: num(s.cy, height / 2, 0, height),
        mirror: bool(s.mirror, true),
        visible: bool(s.visible, true),
      };
    }
    if (isObj(v.onion)) {
      const o = v.onion;
      view.onion = {
        enabled: bool(o.enabled, true),
        before: Math.round(num(o.before, 1, 0, 10)),
        after: Math.round(num(o.after, 0, 0, 10)),
        opacity: num(o.opacity, 0.35, 0.02, 1),
        falloff: num(o.falloff, 0.6, 0.1, 1),
        tint: bool(o.tint, true),
        colorBefore: color(o.colorBefore, view.onion.colorBefore).slice(0, 7),
        colorAfter: color(o.colorAfter, view.onion.colorAfter).slice(0, 7),
        allLayers: bool(o.allLayers, true),
        loop: bool(o.loop, false),
      };
    }
  }

  const bg = isObj(input.background) ? input.background : {};
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    id: safeId(input.id, 'p'),
    name: str(input.name, 'Animation', 120),
    width,
    height,
    fps: Math.round(num(input.fps, 12, MIN_FPS, MAX_FPS)),
    background: { color: color(bg.color, '#ffffff').slice(0, 7), transparent: bool(bg.transparent, false) },
    layers,
    frames,
    cels,
    audio,
    references,
    palettes,
    brushes: Array.isArray(input.brushes) ? input.brushes.slice(0, 200) : [],
    view,
    createdAt: num(input.createdAt, Date.now()),
    modifiedAt: num(input.modifiedAt, Date.now()),
  };
}

/** Every asset key referenced by a saved document. */
export function referencedKeys(doc: SavedProject): Set<string> {
  const keys = new Set<string>();
  for (const c of Object.values(doc.cels)) if (c.key) keys.add(c.key);
  for (const t of doc.audio) for (const c of t.clips) keys.add(c.assetKey);
  for (const r of doc.references) keys.add(r.assetKey);
  return keys;
}
