import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJSONStorage } from './safeStorage';

export type Language = 'auto' | 'fr' | 'en';
export type Theme = 'system' | 'light' | 'dark';
export type UiSize = 'compact' | 'normal' | 'large';
export type GestureAction = 'undo' | 'redo' | 'none' | 'toggleUi' | 'fit';

export interface AppSettings {
  language: Language;
  theme: Theme;
  /** Seconds; 0 = disabled */
  autosaveInterval: number;
  startup: 'home' | 'lastProject';
  lastProjectId: string | null;
  // Drawing
  defaultBrushSize: number;
  /** Global multiplier applied to brush smoothing (0..2). */
  smoothing: number;
  /** Extra stabilisation added to every brush (0..1). */
  stabilization: number;
  pressure: boolean;
  /** Only a stylus draws; fingers pan / zoom. */
  stylusOnly: boolean;
  /** Record colour / size changes in the undo history. */
  recordToolChanges: boolean;
  historySteps: number;
  // Animation
  defaultFps: number;
  onionDefault: boolean;
  onionBefore: number;
  onionAfter: number;
  autoPlayPreview: boolean;
  loopPlayback: boolean;
  // Interface
  uiSize: UiSize;
  handedness: 'right' | 'left';
  timelineVisible: boolean;
  compact: boolean;
  timelineHeight: number;
  sidePanelWidth: number;
  sidePanelOpen: boolean;
  tooltips: boolean;
  reduceMotion: boolean;
  twoFingerTap: GestureAction;
  threeFingerTap: GestureAction;
  gestureRotate: boolean;
  // Export
  exportQuality: 'low' | 'medium' | 'high';
  exportScale: number;
  // Storage
  keepVersions: number;
  cacheBudgetMB: number;
  /** Custom keyboard shortcuts: action -> key combos */
  shortcuts: Record<string, string[]>;
  firstRun: boolean;
}

export function defaultCacheBudget(): number {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.max(128, Math.min(768, Math.round(mem * 64)));
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'auto',
  theme: 'system',
  autosaveInterval: 30,
  startup: 'home',
  lastProjectId: null,
  defaultBrushSize: 12,
  smoothing: 1,
  stabilization: 0,
  pressure: true,
  stylusOnly: false,
  recordToolChanges: true,
  historySteps: 100,
  defaultFps: 12,
  onionDefault: true,
  onionBefore: 1,
  onionAfter: 0,
  autoPlayPreview: true,
  loopPlayback: true,
  uiSize: 'normal',
  handedness: 'right',
  timelineVisible: true,
  compact: false,
  timelineHeight: 176,
  sidePanelWidth: 300,
  sidePanelOpen: true,
  tooltips: true,
  reduceMotion: false,
  twoFingerTap: 'undo',
  threeFingerTap: 'redo',
  gestureRotate: true,
  exportQuality: 'high',
  exportScale: 1,
  keepVersions: 10,
  cacheBudgetMB: 384,
  shortcuts: {},
  firstRun: true,
};

interface SettingsStore extends AppSettings {
  set(patch: Partial<AppSettings>): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      cacheBudgetMB: defaultCacheBudget(),
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SETTINGS, cacheBudgetMB: defaultCacheBudget(), firstRun: false }),
    }),
    { name: 'frameloom.settings', storage: safeJSONStorage, version: 1 },
  ),
);

export const settings = (): AppSettings => useSettings.getState();
