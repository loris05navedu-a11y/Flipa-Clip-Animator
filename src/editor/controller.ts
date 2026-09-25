import { create } from 'zustand';
import type { EditorSession } from './EditorSession';
import type { Viewport } from '../engine/Viewport';
import { Player } from '../engine/Player';
import { AudioEngine } from '../engine/audio/AudioEngine';
import { tools } from './toolStore';
import { settings, useSettings } from '../storage/settings';
import * as sel from './selectionOps';
import { copyFrames, pasteFrames } from './frameClipboard';
import { toast } from '../ui/components/toast';
import { showError } from '../app/store';
import type { ToolId } from '../engine/tools/Tool';
import { ValueCommand } from '../core/history/History';

/** UI state of the editor that is not part of the document. */
export interface EditorUi {
  panelTab: 'layers' | 'colors' | 'tool' | 'view' | 'refs';
  dialog: null | 'export' | 'projectSettings' | 'preview' | 'versions' | 'videoImport' | 'resize' | 'audioClip';
  dialogArg: unknown;
  fullscreen: boolean;
  playing: boolean;
  timelineLayers: boolean;
  multiSelect: boolean;
  zoom: number;
  rotation: number;
  busy: string | null;
  progress: number | null;
  /** Side panel shown over the canvas (narrow screens). */
  panelOverlay: boolean;
}

export const useEditorUi = create<EditorUi>(() => ({
  panelTab: 'layers',
  dialog: null,
  dialogArg: null,
  fullscreen: false,
  playing: false,
  timelineLayers: false,
  multiSelect: false,
  zoom: 1,
  rotation: 0,
  busy: null,
  progress: null,
  panelOverlay: false,
}));

export const ui = () => useEditorUi.getState();
export const setUi = (p: Partial<EditorUi>) => useEditorUi.setState(p);

/** Show a side-panel tab (opens the panel, docked or floating). */
export function showPanel(tab: EditorUi['panelTab']): void {
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
  if (narrow) setUi({ panelTab: tab, panelOverlay: true });
  else {
    setUi({ panelTab: tab });
    useSettings.getState().set({ sidePanelOpen: true });
  }
}

/**
 * Glue between the session, the viewport, the player and the UI. Every user
 * action (button, shortcut, gesture) goes through here.
 */
export class EditorController {
  viewport: Viewport | null = null;
  readonly audio: AudioEngine;
  readonly player: Player;
  private toolListeners = new Set<(t: ToolId) => void>();

  constructor(readonly session: EditorSession) {
    this.audio = new AudioEngine({ getAsset: (k) => session.repo.getAsset(session.doc.id, k) });
    this.player = new Player(session, this.audio);
    this.player.loop = settings().loopPlayback;
    this.player.changed.on(({ playing, frame }) => {
      if (this.viewport) {
        this.viewport.playbackImage = playing ? this.player.canvas : null;
        this.viewport.requestRender();
      }
      if (!playing && ui().playing) this.session.setFrame(frame);
      if (playing && frame !== this.session.frameIndex) {
        this.session.frameIndex = frame;
        this.session.emit('nav');
      }
      if (ui().playing !== playing) setUi({ playing });
    });
  }

  dispose(): void {
    this.player.dispose();
    this.audio.dispose();
  }

  /* ------------------------------- Tools -------------------------------- */

  onToolChange(fn: (t: ToolId) => void): () => void {
    this.toolListeners.add(fn);
    return () => this.toolListeners.delete(fn);
  }

  setTool(id: ToolId): void {
    if (tools().tool === id) return;
    tools().setTool(id);
    this.toolListeners.forEach((f) => f(id));
  }

  /* ------------------------------ History ------------------------------- */

  async undo(): Promise<void> {
    this.stopPlayback();
    await this.session.undo();
  }

  async redo(): Promise<void> {
    this.stopPlayback();
    await this.session.redo();
  }

  async save(): Promise<void> {
    try {
      await this.session.save();
      toast('toast.saved', 'success');
    } catch (e) {
      await showError(e, 'error.saveFailed');
    }
  }

  /* ------------------------------ Playback ------------------------------ */

  togglePlay(fromStart = false): void {
    if (this.player.playing) this.player.pause();
    else {
      void this.session.commitFloating();
      this.player.range = null;
      void this.player.play(fromStart ? 0 : undefined);
    }
  }

  stopPlayback(): void {
    if (this.player.playing) this.player.pause();
  }

  /** Stop and go back to the first frame. */
  stop(): void {
    this.player.pause();
    this.session.setFrame(0);
  }

  goFrame(index: number): void {
    this.stopPlayback();
    void this.session.commitFloating().then(() => this.session.setFrame(index));
  }

  step(delta: number): void {
    const n = this.session.doc.frames.length;
    let i = this.session.frameIndex + delta;
    if (i < 0) i = n - 1;
    if (i >= n) i = 0;
    this.goFrame(i);
  }

  /* --------------------------- Clipboard (smart) ------------------------- */

  /** Copy the selection if any, otherwise the selected frames. */
  async copy(): Promise<void> {
    const s = this.session;
    if (s.selection || s.floating) {
      if (await sel.copySelection(s)) toast('toast.copied');
      return;
    }
    const n = await copyFrames(s, s.targetFrameIds());
    toast('timeline.copied', 'info', { n });
  }

  async cut(): Promise<void> {
    const s = this.session;
    if (s.selection || s.floating) {
      await sel.cutSelection(s);
      return;
    }
    const ids = s.targetFrameIds();
    await copyFrames(s, ids);
    s.deleteFrames(ids);
  }

  async paste(): Promise<void> {
    const s = this.session;
    const { clipboard } = await import('../engine/Clipboard');
    // Pixels take priority when both exist and a pixel tool context is active.
    if (clipboard.pixels && (!clipboard.frames || s.selection || ['select', 'transform'].includes(tools().tool))) {
      if (await sel.pasteClipboard(s)) this.setTool('transform');
      return;
    }
    if (clipboard.frames) {
      const n = await pasteFrames(s);
      toast('timeline.pasted', 'info', { n });
      return;
    }
    if (clipboard.pixels) {
      if (await sel.pasteClipboard(s)) this.setTool('transform');
      return;
    }
    toast('toast.nothingToPaste');
  }

  /* ------------------------------- Colours ------------------------------- */

  /** Colour change with optional history recording. */
  setColor(hex: string, which: 'primary' | 'secondary' = 'primary', record = true): void {
    const st = tools();
    const before = which === 'primary' ? st.primary : st.secondary;
    if (before === hex) return;
    const apply = (v: string) => (which === 'primary' ? tools().setPrimary(v) : tools().setSecondary(v));
    apply(hex);
    if (record && settings().recordToolChanges) this.session.push(new ValueCommand('history.color', before, hex, apply, `color:${which}`, 64));
  }

  /** Brush size change (active brush tool) with optional history recording. */
  setBrushSize(size: number, record = true): void {
    const st = tools();
    const tool = st.tool;
    const s = Math.max(1, Math.min(1000, Math.round(size * 10) / 10));
    let before: number;
    let apply: (v: number) => void;
    if (tool === 'eraser') {
      before = st.eraser.size;
      apply = (v) => tools().setEraser({ size: v });
    } else if (tool === 'brush' || tool === 'pencil' || tool === 'pen') {
      const p = st.activePreset(tool);
      before = p.settings.size;
      apply = (v) => tools().updatePreset(p.id, { size: v });
    } else if (tool === 'shape') {
      before = st.shape.width;
      apply = (v) => tools().setShape({ width: v });
    } else return;
    if (before === s) return;
    apply(s);
    if (record && settings().recordToolChanges) this.session.push(new ValueCommand('history.size', before, s, apply, `size:${tool}`, 64));
  }

  currentBrushSize(): number | null {
    const st = tools();
    if (st.tool === 'eraser') return st.eraser.size;
    if (st.tool === 'brush' || st.tool === 'pencil' || st.tool === 'pen') return st.activePreset(st.tool).settings.size;
    if (st.tool === 'shape') return st.shape.width;
    return null;
  }

  /* -------------------------------- View -------------------------------- */

  fit(): void {
    this.viewport?.view.fit();
    this.syncView();
  }

  zoomBy(f: number): void {
    const vp = this.viewport;
    if (!vp) return;
    vp.view.zoomAt(f, { x: vp.view.viewW / 2, y: vp.view.viewH / 2 });
    this.syncView();
  }

  setZoom(z: number): void {
    const vp = this.viewport;
    if (!vp) return;
    vp.view.zoomAt(z / vp.view.zoom, { x: vp.view.viewW / 2, y: vp.view.viewH / 2 });
    this.syncView();
  }

  resetRotation(): void {
    const vp = this.viewport;
    if (!vp) return;
    vp.view.rotateAt(-vp.view.rotation, { x: vp.view.viewW / 2, y: vp.view.viewH / 2 });
    this.syncView();
  }

  syncView(): void {
    const vp = this.viewport;
    if (!vp) return;
    vp.requestRender();
    setUi({ zoom: vp.view.zoom, rotation: vp.view.rotation });
  }

  toggleFullscreen(): void {
    const next = !ui().fullscreen;
    setUi({ fullscreen: next });
    void import('../platform/lifecycle').then((m) => m.setStatusBarHidden(next));
    try {
      if (next && !document.fullscreenElement && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
      if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      /* in-app fullscreen still works */
    }
  }

  toggleOnion(): void {
    const o = this.session.doc.view.onion;
    this.session.updateView({ onion: { ...o, enabled: !o.enabled } });
  }

  toggleGrid(): void {
    const g = this.session.doc.view.grid;
    this.session.updateView({ grid: { ...g, enabled: !g.enabled } });
  }

  /* ------------------------------ Gestures ------------------------------- */

  gesture(action: string): void {
    switch (action) {
      case 'undo':
        void this.undo();
        break;
      case 'redo':
        void this.redo();
        break;
      case 'toggleUi':
        this.toggleFullscreen();
        break;
      case 'fit':
        this.fit();
        break;
    }
  }
}

export function useSettingsValue<K extends keyof ReturnType<typeof settings>>(k: K) {
  return useSettings((s) => s[k]);
}
