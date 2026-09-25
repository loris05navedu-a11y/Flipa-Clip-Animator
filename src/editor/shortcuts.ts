import { settings } from '../storage/settings';

/** Default keyboard shortcuts. Combos are lower-case: "ctrl+shift+z", "space", "arrowleft". */
export const DEFAULT_SHORTCUTS: Record<string, string[]> = {
  undo: ['ctrl+z'],
  redo: ['ctrl+y', 'ctrl+shift+z'],
  copy: ['ctrl+c'],
  paste: ['ctrl+v'],
  cut: ['ctrl+x'],
  save: ['ctrl+s'],
  playPause: ['space'],
  prevFrame: ['arrowleft', ','],
  nextFrame: ['arrowright', '.'],
  firstFrame: ['home'],
  lastFrame: ['end'],
  newFrame: ['shift+n', 'insert'],
  duplicateFrame: ['shift+d'],
  deleteFrame: ['shift+delete'],
  newLayer: ['ctrl+shift+n'],
  selectAll: ['ctrl+a'],
  deselect: ['ctrl+shift+a', 'ctrl+d'],
  delete: ['delete', 'backspace'],
  duplicate: ['ctrl+j'],
  toggleOnion: ['o'],
  toggleGrid: ["ctrl+'", 'shift+g'],
  fit: ['ctrl+0'],
  actualSize: ['ctrl+1'],
  zoomIn: ['ctrl+=', 'ctrl++', '+'],
  zoomOut: ['ctrl+-', '-'],
  swapColors: ['x'],
  brushBigger: [']'],
  brushSmaller: ['['],
  preview: ['f5'],
  export: ['ctrl+e'],
  fullscreen: ['tab'],
  escape: ['escape'],
  apply: ['enter'],
  'tool.brush': ['b'],
  'tool.pencil': ['p'],
  'tool.pen': ['n'],
  'tool.eraser': ['e'],
  'tool.shape': ['u'],
  'tool.fill': ['g'],
  'tool.eyedropper': ['i'],
  'tool.select': ['m'],
  'tool.transform': ['v'],
  'tool.text': ['t'],
  'tool.hand': ['h'],
};

export const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS);

export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null;
  const k = key === ' ' ? 'space' : key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  // Shift is implicit in characters like "+" or "?" but explicit for letters and named keys.
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k))) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

export function shortcutMap(): Record<string, string[]> {
  return { ...DEFAULT_SHORTCUTS, ...settings().shortcuts };
}

/** Action bound to a combo, if any. */
export function actionFor(combo: string): string | null {
  const map = shortcutMap();
  for (const [action, combos] of Object.entries(map)) if (combos.includes(combo)) return action;
  return null;
}

export function formatCombo(c: string): string {
  return c
    .split('+')
    .map((p) => (p === 'ctrl' ? 'Ctrl' : p === 'shift' ? 'Maj' : p === 'alt' ? 'Alt' : p === 'space' ? 'Espace' : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+');
}
