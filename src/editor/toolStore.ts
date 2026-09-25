import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJSONStorage } from '../storage/safeStorage';
import { uid } from '../core/util/id';
import type { Palette } from '../core/model/types';
import { DEFAULT_PALETTE_COLORS } from '../core/model/project';
import {
  BUILTIN_BRUSHES,
  DEFAULT_ERASER,
  sanitizeBrush,
  type BrushPreset,
  type BrushSettings,
  type BrushTool,
  type EraserSettings,
} from '../engine/brush/types';
import type { ToolId } from '../engine/tools/Tool';

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'arrow';

export interface ShapeSettings {
  kind: ShapeKind;
  stroke: boolean;
  fill: boolean;
  width: number;
  sides: number;
  innerRatio: number;
  radius: number;
  fromCenter: boolean;
  constrain: boolean;
  opacity: number;
}

export interface FillSettings {
  tolerance: number;
  contiguous: boolean;
  sampleAll: boolean;
  grow: number;
  opacity: number;
}

export type SelectMode = 'rect' | 'lasso' | 'wand';
export type SelectOp = 'new' | 'add' | 'subtract' | 'intersect';

export interface SelectSettings {
  mode: SelectMode;
  op: SelectOp;
  tolerance: number;
  contiguous: boolean;
  sampleAll: boolean;
}

export interface TransformSettings {
  proportional: boolean;
  snapRotation: boolean;
}

export interface TextSettings {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  opacity: number;
}

export interface ToolState {
  tool: ToolId;
  presets: BrushPreset[];
  active: Record<BrushTool, string>;
  eraser: EraserSettings;
  shape: ShapeSettings;
  fill: FillSettings;
  select: SelectSettings;
  transform: TransformSettings;
  text: TextSettings;
  eyedropperSampleAll: boolean;
  primary: string;
  secondary: string;
  recent: string[];
  palettes: Palette[];
  /** 'project:<id>' or a global palette id */
  activePalette: string;
  /** Selected reference for the reference tool. */
  referenceId: string | null;
}

const initial: ToolState = {
  tool: 'brush',
  presets: BUILTIN_BRUSHES.map((b) => ({ ...b, settings: { ...b.settings } })),
  active: { brush: 'b-round', pencil: 'p-hb', pen: 'i-ink' },
  eraser: { ...DEFAULT_ERASER },
  shape: { kind: 'rect', stroke: true, fill: false, width: 6, sides: 5, innerRatio: 0.5, radius: 0, fromCenter: false, constrain: false, opacity: 1 },
  fill: { tolerance: 24, contiguous: true, sampleAll: true, grow: 1, opacity: 1 },
  select: { mode: 'rect', op: 'new', tolerance: 24, contiguous: true, sampleAll: false },
  transform: { proportional: true, snapRotation: false },
  text: {
    font: 'Inter',
    size: 64,
    bold: false,
    italic: false,
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    outline: false,
    outlineColor: '#ffffffff',
    outlineWidth: 4,
    shadow: false,
    shadowColor: '#00000099',
    shadowBlur: 6,
    shadowX: 3,
    shadowY: 3,
    opacity: 1,
  },
  eyedropperSampleAll: true,
  primary: '#1b1b24ff',
  secondary: '#ffffffff',
  recent: [],
  palettes: [
    { id: 'pal-default', name: 'Essentiels', colors: [...DEFAULT_PALETTE_COLORS] },
    {
      id: 'pal-skin',
      name: 'Peaux & tons chauds',
      colors: ['#ffe0bdff', '#ffcd94ff', '#eac086ff', '#c68642ff', '#8d5524ff', '#5c3a1eff', '#f4a582ff', '#d6604dff'],
    },
    {
      id: 'pal-pastel',
      name: 'Pastels',
      colors: ['#ffd1dcff', '#ffe5b4ff', '#fdfd96ff', '#c1e1c1ff', '#aec6cfff', '#cbaacbff', '#f49ac2ff', '#b39eb5ff'],
    },
  ],
  activePalette: 'pal-default',
  referenceId: null,
};

export interface ToolActions {
  setTool(tool: ToolId): void;
  setPrimary(hex: string): void;
  setSecondary(hex: string): void;
  swapColors(): void;
  pushRecent(hex: string): void;
  activePreset(tool: BrushTool): BrushPreset;
  selectPreset(tool: BrushTool, id: string): void;
  updatePreset(id: string, patch: Partial<BrushSettings>): void;
  renamePreset(id: string, name: string): void;
  duplicatePreset(id: string, name: string): string;
  createPreset(tool: BrushTool, name: string): string;
  deletePreset(id: string): void;
  resetPreset(id: string): void;
  importPresets(list: unknown[]): number;
  setEraser(patch: Partial<EraserSettings>): void;
  setShape(patch: Partial<ShapeSettings>): void;
  setFill(patch: Partial<FillSettings>): void;
  setSelect(patch: Partial<SelectSettings>): void;
  setTransform(patch: Partial<TransformSettings>): void;
  setText(patch: Partial<TextSettings>): void;
  set(patch: Partial<ToolState>): void;
  addPalette(name: string, colors?: string[]): string;
  updatePalette(id: string, patch: Partial<Palette>): void;
  deletePalette(id: string): void;
}

export const useTools = create<ToolState & ToolActions>()(
  persist(
    (set, get) => ({
      ...initial,
      setTool: (tool) => set({ tool }),
      setPrimary: (primary) => set({ primary }),
      setSecondary: (secondary) => set({ secondary }),
      swapColors: () => set((s) => ({ primary: s.secondary, secondary: s.primary })),
      pushRecent: (hex) => set((s) => ({ recent: [hex, ...s.recent.filter((c) => c !== hex)].slice(0, 16) })),
      activePreset: (tool) => {
        const s = get();
        return s.presets.find((p) => p.id === s.active[tool]) ?? s.presets.find((p) => p.tool === tool) ?? BUILTIN_BRUSHES[0];
      },
      selectPreset: (tool, id) => set((s) => ({ active: { ...s.active, [tool]: id } })),
      updatePreset: (id, patch) =>
        set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, ...patch } } : p)) })),
      renamePreset: (id, name) => set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, name: name.slice(0, 60) } : p)) })),
      duplicatePreset: (id, name) => {
        const src = get().presets.find((p) => p.id === id);
        if (!src) return id;
        const copy: BrushPreset = { ...src, id: uid('br'), name, builtin: false, settings: { ...src.settings } };
        set((s) => {
          const i = s.presets.findIndex((p) => p.id === id);
          const presets = [...s.presets];
          presets.splice(i + 1, 0, copy);
          return { presets, active: { ...s.active, [copy.tool]: copy.id } };
        });
        return copy.id;
      },
      createPreset: (tool, name) => {
        const base = get().activePreset(tool);
        const p: BrushPreset = { id: uid('br'), name, tool, builtin: false, settings: { ...base.settings } };
        set((s) => ({ presets: [...s.presets, p], active: { ...s.active, [tool]: p.id } }));
        return p.id;
      },
      deletePreset: (id) =>
        set((s) => {
          const p = s.presets.find((x) => x.id === id);
          if (!p || p.builtin) return {};
          const presets = s.presets.filter((x) => x.id !== id);
          const active = { ...s.active };
          if (active[p.tool] === id) active[p.tool] = presets.find((x) => x.tool === p.tool)?.id ?? active[p.tool];
          return { presets, active };
        }),
      resetPreset: (id) =>
        set((s) => {
          const b = BUILTIN_BRUSHES.find((x) => x.id === id);
          if (!b) return {};
          return { presets: s.presets.map((p) => (p.id === id ? { ...b, settings: { ...b.settings } } : p)) };
        }),
      importPresets: (list) => {
        const existing = new Set(get().presets.map((p) => p.id));
        const add = list.map(sanitizeBrush).filter((p): p is BrushPreset => !!p && !existing.has(p.id));
        if (add.length) set((s) => ({ presets: [...s.presets, ...add] }));
        return add.length;
      },
      setEraser: (patch) => set((s) => ({ eraser: { ...s.eraser, ...patch } })),
      setShape: (patch) => set((s) => ({ shape: { ...s.shape, ...patch } })),
      setFill: (patch) => set((s) => ({ fill: { ...s.fill, ...patch } })),
      setSelect: (patch) => set((s) => ({ select: { ...s.select, ...patch } })),
      setTransform: (patch) => set((s) => ({ transform: { ...s.transform, ...patch } })),
      setText: (patch) => set((s) => ({ text: { ...s.text, ...patch } })),
      set: (patch) => set(patch),
      addPalette: (name, colors = []) => {
        const id = uid('pal');
        set((s) => ({ palettes: [...s.palettes, { id, name, colors }], activePalette: id }));
        return id;
      },
      updatePalette: (id, patch) => set((s) => ({ palettes: s.palettes.map((p) => (p.id === id ? { ...p, ...patch, id } : p)) })),
      deletePalette: (id) =>
        set((s) => {
          const palettes = s.palettes.filter((p) => p.id !== id);
          return { palettes, activePalette: s.activePalette === id ? (palettes[0]?.id ?? '') : s.activePalette };
        }),
    }),
    {
      name: 'frameloom.tools',
      storage: safeJSONStorage,
      version: 1,
      partialize: (s) => {
        const { referenceId: _r, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as Partial<ToolState>;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ToolState>;
        // New built-in presets added in later versions are appended.
        const presets = p.presets ?? current.presets;
        for (const b of BUILTIN_BRUSHES) if (!presets.some((x) => x.id === b.id)) presets.push({ ...b, settings: { ...b.settings } });
        return { ...current, ...p, presets, tool: p.tool === 'reference' ? 'brush' : (p.tool ?? current.tool) };
      },
    },
  ),
);

export const tools = () => useTools.getState();

/** Custom (user-made) presets, embedded in saved projects. */
export function customPresets(): BrushPreset[] {
  return tools().presets.filter((p) => !p.builtin);
}
