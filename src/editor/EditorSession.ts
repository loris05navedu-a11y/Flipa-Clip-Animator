import { History, CompositeCommand, type Command } from '../core/history/History';
import * as ops from '../core/model/ops';
import { newLayer, ProjectFormatError, validateSavedProject } from '../core/model/project';
import { BLEND_TO_COMPOSITE, FORMAT_ID, FORMAT_VERSION, type FrameDef, type LayerDef, type ProjectData, type SavedProject, type ViewSettings, type ReferenceDef } from '../core/model/types';
import { durationSeconds } from '../core/model/timing';
import { uid } from '../core/util/id';
import { Emitter } from '../core/util/emitter';
import { SerialQueue, nextTick } from '../core/util/async';
import { clamp, type Rect } from '../core/util/math';
import type { ProjectRepository } from '../storage/ProjectRepository';
import { CelStore } from '../engine/CelStore';
import { PixelCommand, type CelLink, type PixelHost, type PixelPatch } from '../engine/commands';
import { canvasToBlob, cloneCanvas, copyRegion, createCanvas, ctx2d, blobToBitmap } from '../engine/canvas';
import { composeFrame, ensureFrameLoaded, type ReferenceImages } from '../engine/render';
import { Selection } from '../engine/Selection';
import { drawFloating, floatingPixelRect, stampFloating, type Floating } from '../engine/Floating';
import { DocCommand, type DocPatch, type NavState } from './DocCommand';

export type ChangeKind = 'doc' | 'nav' | 'pixels' | 'selection' | 'history' | 'save' | 'view' | 'floating';

export interface SessionOptions {
  historySteps: number;
  historyBytes: number;
  memoryBudget: number;
  keepVersions: number;
  /** Returns the custom brush presets to embed in the project file. */
  brushes: () => unknown[];
  /** Localised default layer name prefix. */
  layerName: string;
  copySuffix: string;
}

const DEFAULT_OPTIONS: SessionOptions = {
  historySteps: 100,
  historyBytes: 256 * 1024 * 1024,
  memoryBudget: 384 * 1024 * 1024,
  keepVersions: 10,
  brushes: () => [],
  layerName: 'Calque',
  copySuffix: ' copie',
};

export function allCelIds(frames: readonly FrameDef[]): string[] {
  const out: string[] = [];
  for (const f of frames) for (const c of Object.values(f.cels)) out.push(c);
  return out;
}

/**
 * The open project: document, pixels, history, navigation and persistence.
 * UI components subscribe to `changed` and read state directly.
 */
export class EditorSession implements PixelHost, ReferenceImages {
  doc: ProjectData;
  readonly cels: CelStore;
  readonly history: History;
  rev: number;
  frameIndex = 0;
  layerId: string;
  /** Frames selected in the timeline (multi-selection). */
  frameSelection = new Set<string>();
  selection: Selection | null = null;
  floating: Floating | null = null;
  /** Incremented on every change (cheap React subscription key). */
  version = 0;
  /** Incremented when the composite of the current view may have changed. */
  renderVersion = 0;
  readonly changed = new Emitter<ChangeKind>();
  opts: SessionOptions;
  /** True while the user is drawing (autosave waits). */
  interacting = false;
  closed = false;

  private changeCounter = 0;
  private savedCounter = 0;
  private autosavedCounter = 0;
  private saveQueue = new SerialQueue();
  private refBitmaps = new Map<string, ImageBitmap | 'loading' | 'error'>();

  constructor(
    readonly repo: ProjectRepository,
    saved: SavedProject,
    rev: number,
    opts: Partial<SessionOptions> = {},
    dirty = false,
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    const { cels, format: _f, formatVersion: _v, ...data } = saved;
    this.doc = data;
    this.rev = rev;
    const projectId = saved.id;
    this.cels = new CelStore(
      saved.width,
      saved.height,
      {
        getAsset: (k) => repo.getAsset(projectId, k),
        putAsset: (k, b) => repo.putAsset(projectId, k, b),
      },
      this.opts.memoryBudget,
    );
    for (const [id, rec] of Object.entries(cels)) this.cels.addRecord(id, rec);
    this.history = new History({ maxSteps: this.opts.historySteps, maxBytes: this.opts.historyBytes });
    this.history.changed.on(() => this.emit('history'));
    this.layerId = this.doc.layers[this.doc.layers.length - 1].id;
    if (dirty) this.changeCounter = 1;
    this.preload();
  }

  /* ------------------------------------------------------------------ */
  /*  Change notification                                                */
  /* ------------------------------------------------------------------ */

  emit(kind: ChangeKind): void {
    this.version++;
    if (kind !== 'history' && kind !== 'save' && kind !== 'selection' && kind !== 'nav') this.renderVersion++;
    if (kind === 'nav' || kind === 'floating' || kind === 'view') this.renderVersion++;
    this.changed.emit(kind);
  }

  subscribe = (fn: () => void): (() => void) => this.changed.on(fn);
  getVersion = (): number => this.version;

  private markDirty(): void {
    this.changeCounter++;
  }

  get dirty(): boolean {
    return this.changeCounter !== this.savedCounter;
  }

  get needsAutosave(): boolean {
    return this.changeCounter !== this.autosavedCounter && this.dirty;
  }

  /* ------------------------------------------------------------------ */
  /*  Navigation                                                         */
  /* ------------------------------------------------------------------ */

  get frame(): FrameDef {
    return this.doc.frames[clamp(this.frameIndex, 0, this.doc.frames.length - 1)];
  }

  get layer(): LayerDef {
    return this.doc.layers.find((l) => l.id === this.layerId) ?? this.doc.layers[this.doc.layers.length - 1];
  }

  get layerIndex(): number {
    return this.doc.layers.findIndex((l) => l.id === this.layerId);
  }

  nav(): NavState {
    return { frameIndex: this.frameIndex, layerId: this.layerId };
  }

  setFrame(index: number): void {
    const i = clamp(index, 0, this.doc.frames.length - 1);
    if (i === this.frameIndex) return;
    this.frameIndex = i;
    this.preload();
    this.emit('nav');
  }

  setLayer(id: string): void {
    if (id === this.layerId || !this.doc.layers.some((l) => l.id === id)) return;
    this.layerId = id;
    this.emit('nav');
  }

  /** Decode cels around the current frame and pin them in memory. */
  preload(): void {
    const { frames, view } = this.doc;
    const i = this.frameIndex;
    const radius = Math.max(2, view.onion.before, view.onion.after);
    const pinned = new Set<string>();
    for (let k = i - radius; k <= i + radius; k++) {
      const f = frames[(k + frames.length) % frames.length];
      if (!f) continue;
      for (const c of Object.values(f.cels)) {
        if (Math.abs(k - i) <= Math.max(view.onion.before, view.onion.after, 1)) pinned.add(c);
      }
      ensureFrameLoaded(this.doc, f, this.cels, false).then(() => {
        if (!this.closed) this.emit('pixels');
      });
    }
    this.cels.pinned = pinned;
  }

  /* ------------------------------------------------------------------ */
  /*  Structural changes (undoable)                                      */
  /* ------------------------------------------------------------------ */

  applyPatch(patch: DocPatch, nav: NavState | null): void {
    this.doc = { ...this.doc, ...patch };
    if (nav) {
      this.frameIndex = nav.frameIndex;
      this.layerId = nav.layerId;
    }
    this.frameIndex = clamp(this.frameIndex, 0, this.doc.frames.length - 1);
    if (!this.doc.layers.some((l) => l.id === this.layerId)) this.layerId = this.doc.layers[this.doc.layers.length - 1].id;
    const ids = new Set(this.doc.frames.map((f) => f.id));
    for (const id of [...this.frameSelection]) if (!ids.has(id)) this.frameSelection.delete(id);
    this.markDirty();
    this.preload();
    this.emit('doc');
  }

  /** Apply a structural change and record it in the history. */
  change(label: string, patch: DocPatch, nav?: Partial<NavState>, mergeKey?: string): void {
    const before: DocPatch = {};
    for (const k of Object.keys(patch) as (keyof DocPatch)[]) (before as Record<string, unknown>)[k] = this.doc[k];
    const navBefore = this.nav();
    const navAfter: NavState = { ...navBefore, ...nav };
    this.applyPatch(patch, navAfter);
    this.history.push(new DocCommand(label, this, before, patch, navBefore, this.nav(), mergeKey));
  }

  /** View settings are saved with the project but are not undoable. */
  updateView(patch: Partial<ViewSettings>): void {
    this.doc = { ...this.doc, view: { ...this.doc.view, ...patch } };
    this.markDirty();
    if ('onion' in patch) this.preload();
    this.emit('view');
  }

  /* ------------------------------- Frames ------------------------------ */

  addFrame(where: 'after' | 'before' = 'after'): void {
    const idx = where === 'after' ? this.frameIndex + 1 : this.frameIndex;
    const { frames } = ops.insertEmptyFrame(this.doc.frames, idx);
    this.change('history.addFrame', { frames }, { frameIndex: idx });
  }

  /** Target frames: the timeline multi-selection, or the current frame. */
  targetFrameIds(): string[] {
    if (this.frameSelection.size) return this.doc.frames.filter((f) => this.frameSelection.has(f.id)).map((f) => f.id);
    return [this.frame.id];
  }

  duplicateFrames(ids = this.targetFrameIds()): void {
    const { frames, created } = ops.duplicateFrames(this.doc.frames, ids, (c) => this.cels.clone(c));
    if (!created.length) return;
    const idx = frames.indexOf(created[0]);
    this.frameSelection = new Set(ids.length > 1 ? created.map((f) => f.id) : []);
    this.change('history.duplicateFrame', { frames }, { frameIndex: idx });
  }

  deleteFrames(ids = this.targetFrameIds()): void {
    const first = this.doc.frames.findIndex((f) => ids.includes(f.id));
    const frames = ops.removeFrames(this.doc.frames, ids);
    this.frameSelection.clear();
    this.change('history.deleteFrame', { frames }, { frameIndex: clamp(first, 0, frames.length - 1) });
  }

  moveFrames(ids: string[], target: number): void {
    const frames = ops.moveFrames(this.doc.frames, ids, target);
    const cur = this.frame.id;
    const idx = frames.findIndex((f) => f.id === cur);
    if (frames.every((f, i) => f === this.doc.frames[i])) return;
    this.change('history.moveFrame', { frames }, { frameIndex: idx });
  }

  /** Move the target frames one step left (-1) or right (+1). */
  shiftFrames(delta: -1 | 1, ids = this.targetFrameIds()): void {
    const idx = ids.map((id) => this.doc.frames.findIndex((f) => f.id === id)).sort((a, b) => a - b);
    if (!idx.length) return;
    if (delta < 0 && idx[0] === 0) return;
    if (delta > 0 && idx[idx.length - 1] === this.doc.frames.length - 1) return;
    const target = delta < 0 ? idx[0] - 1 : idx[idx.length - 1] + 2;
    this.moveFrames(ids, target);
  }

  setHold(hold: number, ids = this.targetFrameIds()): void {
    const frames = ops.setHold(this.doc.frames, ids, hold);
    this.change('history.frameDuration', { frames }, undefined, 'hold:' + ids.join(','));
  }

  reverseFrames(ids = this.targetFrameIds()): void {
    if (ids.length < 2) return;
    this.change('history.reverseFrames', { frames: ops.reverseFrames(this.doc.frames, ids) });
  }

  /** Remove the content of the active layer in the current frame. */
  clearCel(): void {
    const f = this.frame;
    if (!f.cels[this.layerId]) return;
    this.change('history.clearCel', { frames: ops.setCel(this.doc.frames, f.id, this.layerId, null) });
  }

  selectFrame(id: string, mode: 'single' | 'toggle' | 'range'): void {
    const idx = this.doc.frames.findIndex((f) => f.id === id);
    if (idx < 0) return;
    if (mode === 'single') this.frameSelection.clear();
    else if (mode === 'toggle') {
      if (this.frameSelection.size === 0) this.frameSelection.add(this.frame.id);
      if (this.frameSelection.has(id)) this.frameSelection.delete(id);
      else this.frameSelection.add(id);
    } else {
      const a = Math.min(idx, this.frameIndex),
        b = Math.max(idx, this.frameIndex);
      for (let i = a; i <= b; i++) this.frameSelection.add(this.doc.frames[i].id);
    }
    this.frameIndex = idx;
    this.preload();
    this.emit('nav');
  }

  selectAllFrames(): void {
    this.frameSelection = new Set(this.doc.frames.map((f) => f.id));
    this.emit('nav');
  }

  clearFrameSelection(): void {
    if (!this.frameSelection.size) return;
    this.frameSelection.clear();
    this.emit('nav');
  }

  /* ------------------------------- Layers ------------------------------ */

  addLayer(name?: string): LayerDef {
    const layer = newLayer(name ?? ops.uniqueLayerName(this.doc.layers, this.opts.layerName));
    const layers = ops.addLayer(this.doc.layers, this.layerIndex + 1, layer);
    this.change('history.addLayer', { layers }, { layerId: layer.id });
    return layer;
  }

  deleteLayer(id = this.layerId): boolean {
    const idx = this.doc.layers.findIndex((l) => l.id === id);
    const r = ops.removeLayer(this.doc.layers, this.doc.frames, id);
    if (!r) return false;
    const next = r.layers[clamp(idx - 1, 0, r.layers.length - 1)];
    this.change('history.deleteLayer', { layers: r.layers, frames: r.frames }, { layerId: next.id });
    return true;
  }

  duplicateLayer(id = this.layerId): void {
    const r = ops.duplicateLayer(this.doc.layers, this.doc.frames, id, (c) => this.cels.clone(c), this.opts.copySuffix);
    if (r) this.change('history.duplicateLayer', { layers: r.layers, frames: r.frames }, { layerId: r.layer.id });
  }

  moveLayer(id: string, to: number): void {
    const from = this.doc.layers.findIndex((l) => l.id === id);
    if (from < 0 || from === to) return;
    this.change('history.moveLayer', { layers: ops.moveLayer(this.doc.layers, from, to) });
  }

  updateLayer(id: string, patch: Partial<LayerDef>, mergeKey?: string): void {
    const label = 'opacity' in patch ? 'history.layerOpacity' : 'name' in patch ? 'history.renameLayer' : 'history.layerProps';
    this.change(label, { layers: ops.updateLayer(this.doc.layers, id, patch) }, undefined, mergeKey ? `${mergeKey}:${id}` : undefined);
  }

  /** Merge a layer into the one below it, in every frame. */
  async mergeDown(id = this.layerId, onProgress?: (p: number) => void): Promise<boolean> {
    const idx = this.doc.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return false;
    const upper = this.doc.layers[idx];
    const lower = this.doc.layers[idx - 1];
    const frames: FrameDef[] = [];
    let n = 0;
    for (const f of this.doc.frames) {
      onProgress?.(n++ / this.doc.frames.length);
      const up = f.cels[upper.id];
      const low = f.cels[lower.id];
      const cels = { ...f.cels };
      delete cels[upper.id];
      if (up && !this.cels.isEmpty(up)) {
        await this.cels.ensureLoaded(up);
        if (low) await this.cels.ensureLoaded(low);
        const c = createCanvas(this.doc.width, this.doc.height);
        const ctx = ctx2d(c);
        if (low) {
          ctx.globalAlpha = lower.opacity;
          this.cels.draw(ctx, low);
        }
        ctx.globalAlpha = upper.opacity;
        ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[upper.blendMode];
        this.cels.draw(ctx, up);
        cels[lower.id] = this.cels.createFrom(c);
      } else if (low && lower.opacity < 1) {
        // Bake the lower opacity so the merged layer (opacity 1) looks the same.
        await this.cels.ensureLoaded(low);
        const c = createCanvas(this.doc.width, this.doc.height);
        const ctx = ctx2d(c);
        ctx.globalAlpha = lower.opacity;
        this.cels.draw(ctx, low);
        cels[lower.id] = this.cels.createFrom(c);
      }
      frames.push({ ...f, cels });
      if (n % 20 === 0) await nextTick();
    }
    const layers = this.doc.layers.filter((l) => l.id !== upper.id).map((l) => (l.id === lower.id ? { ...l, opacity: 1 } : l));
    this.change('history.mergeLayer', { layers, frames }, { layerId: lower.id });
    return true;
  }

  /* ------------------------------ Project ------------------------------ */

  updateProject(patch: Pick<DocPatch, 'name' | 'fps' | 'background'>, mergeKey?: string): void {
    this.change('history.projectSettings', patch, undefined, mergeKey);
  }

  /**
   * Change the canvas size. Content is either scaled or kept at its size and
   * placed according to an anchor. Not undoable (the history is cleared).
   */
  async resizeCanvas(width: number, height: number, mode: 'scale' | 'anchor', anchor: { x: number; y: number }, onProgress?: (p: number) => void): Promise<void> {
    await this.commitFloating();
    const oldW = this.doc.width,
      oldH = this.doc.height;
    const dx = (width - oldW) * anchor.x,
      dy = (height - oldH) * anchor.y;
    const frames: FrameDef[] = [];
    const newCels: { id: string; canvas: HTMLCanvasElement }[] = [];
    let n = 0;
    for (const f of this.doc.frames) {
      onProgress?.(n++ / this.doc.frames.length);
      const cels: Record<string, string> = {};
      for (const [layerId, celId] of Object.entries(f.cels)) {
        if (this.cels.isEmpty(celId)) continue;
        await this.cels.ensureLoaded(celId);
        const c = createCanvas(width, height);
        const ctx = ctx2d(c);
        ctx.imageSmoothingQuality = 'high';
        if (mode === 'scale') ctx.scale(width / oldW, height / oldH);
        else ctx.translate(dx, dy);
        this.cels.draw(ctx, celId);
        const id = uid('c');
        newCels.push({ id, canvas: c });
        cels[layerId] = id;
      }
      frames.push({ ...f, cels });
      if (n % 10 === 0) await nextTick();
    }
    // Swap the store dimensions and register the new cels.
    this.cels.dispose();
    this.cels.width = width;
    this.cels.height = height;
    for (const nc of newCels) {
      const id = this.cels.createFrom(nc.canvas);
      for (const f of frames) for (const [l, c] of Object.entries(f.cels)) if (c === nc.id) f.cels[l] = id;
    }
    const sx = mode === 'scale' ? width / oldW : 1,
      sy = mode === 'scale' ? height / oldH : 1;
    const references = this.doc.references.map((r) =>
      mode === 'scale' ? { ...r, x: r.x * sx, y: r.y * sy, scale: r.scale * Math.min(sx, sy) } : { ...r, x: r.x + dx, y: r.y + dy },
    );
    const view: ViewSettings = {
      ...this.doc.view,
      guides: this.doc.view.guides.map((g) => ({ ...g, pos: mode === 'scale' ? g.pos * (g.axis === 'x' ? sx : sy) : g.pos + (g.axis === 'x' ? dx : dy) })),
      symmetry: { ...this.doc.view.symmetry, cx: width / 2, cy: height / 2 },
    };
    this.doc = { ...this.doc, width, height, frames, references, view };
    this.selection = null;
    this.history.clear();
    this.markDirty();
    this.preload();
    this.emit('doc');
  }

  /* ------------------------------ Pixels ------------------------------- */

  /** Reason why the active layer cannot be edited, or null. */
  editBlocker(): 'locked' | 'hidden' | null {
    const l = this.layer;
    if (l.locked) return 'locked';
    if (!l.visible) return 'hidden';
    return null;
  }

  /**
   * Editable canvas of the active cel, creating the cel if the slot is empty.
   * Returns null if the cel is still being decoded.
   */
  activeCanvasSync(): { celId: string; canvas: HTMLCanvasElement; link: CelLink | null } | null {
    const f = this.frame;
    let celId = f.cels[this.layerId];
    let link: CelLink | null = null;
    if (!celId) {
      celId = this.cels.create();
      link = { frameId: f.id, layerId: this.layerId, celId };
    }
    const canvas = this.cels.editableSync(celId);
    if (!canvas) {
      this.cels.ensureLoaded(celId).then(() => this.emit('pixels'));
      return null;
    }
    return { celId, canvas, link };
  }

  async activeCanvas(): Promise<{ celId: string; canvas: HTMLCanvasElement; link: CelLink | null }> {
    const f = this.frame;
    const existing = f.cels[this.layerId];
    if (existing) await this.cels.ensureLoaded(existing);
    return this.activeCanvasSync()!;
  }

  /** Attach a newly created cel to its frame slot without history (used while drawing). */
  linkCel(frameId: string, layerId: string, celId: string | null): void {
    this.doc = { ...this.doc, frames: ops.setCel(this.doc.frames, frameId, layerId, celId) };
    this.markDirty();
    this.emit('doc');
  }

  pixelsChanged(_celIds: string[]): void {
    this.markDirty();
    this.emit('pixels');
  }

  /** Record a pixel edit (already applied) as an undo step. */
  commitPixels(label: string, patches: PixelPatch[], links: CelLink[] = []): void {
    for (const l of links) if (this.frameOf(l.frameId)?.cels[l.layerId] !== l.celId) this.linkCel(l.frameId, l.layerId, l.celId);
    for (const p of patches) this.cels.markChanged(p.celId, p.rect);
    this.history.push(new PixelCommand(label, this, patches, links));
    this.pixelsChanged(patches.map((p) => p.celId));
  }

  /** Apply `draw` to the active cel inside `rect` and record it. */
  async editActive(label: string, rect: Rect, draw: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void, shrink?: boolean): Promise<void> {
    const t = await this.activeCanvas();
    const before = copyRegion(t.canvas, rect);
    const ctx = ctx2d(t.canvas);
    ctx.save();
    draw(ctx, t.canvas);
    ctx.restore();
    const after = copyRegion(t.canvas, rect);
    this.commitPixels(label, [{ celId: t.celId, rect, before, after }], t.link ? [t.link] : []);
    if (shrink) this.cels.markChanged(t.celId, null, this.cels.bounds(t.celId));
  }

  frameOf(id: string): FrameDef | undefined {
    return this.doc.frames.find((f) => f.id === id);
  }

  /* ------------------------------ History ------------------------------ */

  async undo(): Promise<void> {
    if (this.floating) {
      this.cancelFloating();
      return;
    }
    await this.history.undo();
  }

  async redo(): Promise<void> {
    if (this.floating) return;
    await this.history.redo();
  }

  push(cmd: Command): void {
    this.history.push(cmd);
  }

  group(label: string, cmds: Command[]): void {
    this.history.push(new CompositeCommand(label, cmds));
  }

  /* --------------------------- Floating content ------------------------- */

  setFloating(f: Floating | null): void {
    this.floating = f;
    this.emit('floating');
  }

  /** Stamp the floating content into its cel and record one undo step. */
  async commitFloating(): Promise<void> {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    const canvas = await this.cels.editable(f.celId);
    stampFloating(canvas, f);
    const dest = floatingPixelRect(f, this.doc.width, this.doc.height);
    const rect = unionRects(dest, f.liftRect);
    if (rect) {
      const before = copyRegion(f.base, rect);
      const after = copyRegion(canvas, rect);
      const links = f.created ? [{ frameId: f.frameId, layerId: f.layerId, celId: f.celId }] : [];
      this.commitPixels(f.kind === 'text' ? 'history.text' : 'history.transform', [{ celId: f.celId, rect, before, after }], links);
    }
    // After a move the selection follows the content.
    if (this.selection && dest && f.kind === 'selection') {
      const moved = new Selection(this.doc.width, this.doc.height);
      const mctx = ctx2d(moved.mask);
      const tmp = createCanvas(f.canvas.width, f.canvas.height);
      const tctx = ctx2d(tmp);
      tctx.drawImage(f.canvas, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = '#000';
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      drawFloating(mctx, { ...f, canvas: tmp });
      moved.recomputeBounds();
      this.selection = moved.isEmpty ? null : moved;
    }
    this.emit('floating');
    this.emit('selection');
  }

  /** Drop the floating content and restore the cel as it was. */
  cancelFloating(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    if (f.liftRect) {
      const canvas = this.cels.editableSync(f.celId);
      if (canvas) {
        const ctx = ctx2d(canvas);
        const r = f.liftRect;
        ctx.clearRect(r.x, r.y, r.w, r.h);
        ctx.drawImage(f.base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        this.cels.markChanged(f.celId, r);
      }
    }
    if (f.created && this.frameOf(f.frameId)?.cels[f.layerId] === f.celId && this.cels.isEmpty(f.celId)) this.linkCel(f.frameId, f.layerId, null);
    this.emit('floating');
    this.emit('pixels');
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel && !sel.isEmpty ? sel : null;
    this.emit('selection');
  }

  /* ----------------------------- References ----------------------------- */

  get(ref: ReferenceDef): CanvasImageSource | null {
    const hit = this.refBitmaps.get(ref.assetKey);
    if (hit instanceof ImageBitmap) return hit;
    if (!hit) {
      this.refBitmaps.set(ref.assetKey, 'loading');
      this.repo
        .getAsset(this.doc.id, ref.assetKey)
        .then((b) => (b ? blobToBitmap(b) : Promise.reject(new Error('missing'))))
        .then((bmp) => {
          this.refBitmaps.set(ref.assetKey, bmp);
          this.emit('view');
        })
        .catch(() => this.refBitmaps.set(ref.assetKey, 'error'));
    }
    return null;
  }

  async addReference(blob: Blob, name: string): Promise<ReferenceDef> {
    const bmp = await blobToBitmap(blob);
    const key = uid('a');
    await this.repo.putAsset(this.doc.id, key, blob);
    this.refBitmaps.set(key, bmp);
    const scale = Math.min(1, this.doc.width / bmp.width, this.doc.height / bmp.height);
    const ref: ReferenceDef = {
      id: uid('r'),
      name: name.slice(0, 120),
      assetKey: key,
      mime: blob.type || 'image/png',
      naturalWidth: bmp.width,
      naturalHeight: bmp.height,
      x: this.doc.width / 2,
      y: this.doc.height / 2,
      scale,
      rotation: 0,
      opacity: 0.5,
      visible: true,
      locked: false,
      placement: 'below',
      exportable: false,
    };
    this.change('history.addReference', { references: [...this.doc.references, ref] });
    return ref;
  }

  updateReference(id: string, patch: Partial<ReferenceDef>, mergeKey?: string): void {
    const references = this.doc.references.map((r) => (r.id === id ? { ...r, ...patch, id } : r));
    this.change('history.reference', { references }, undefined, mergeKey ? `ref:${mergeKey}:${id}` : undefined);
  }

  removeReference(id: string): void {
    this.change('history.removeReference', { references: this.doc.references.filter((r) => r.id !== id) });
  }

  /* ------------------------------ Rendering ----------------------------- */

  /** Render a frame to a new canvas at a given scale (thumbnails, export). */
  async renderFrame(index: number, scale = 1, opts: { background?: boolean; references?: 'none' | 'exportable' | 'visible' } = {}): Promise<HTMLCanvasElement> {
    const f = this.doc.frames[index];
    await ensureFrameLoaded(this.doc, f, this.cels);
    const c = createCanvas(Math.max(1, Math.round(this.doc.width * scale)), Math.max(1, Math.round(this.doc.height * scale)));
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(c.width / this.doc.width, c.height / this.doc.height);
    composeFrame(ctx, this.doc, f, this.cels, this, { background: opts.background ?? true, references: opts.references ?? 'exportable' });
    return c;
  }

  /* ----------------------------- Persistence ---------------------------- */

  /** Serialisable copy of the working document (pixels encoded to assets, nothing committed). */
  buildSnapshot(): Promise<SavedProject> {
    return this.saveQueue.run(() => this.snapshot());
  }

  /** Encode pixels and build the serialisable document. */
  private async snapshot(): Promise<SavedProject> {
    const doc = this.doc;
    const ids = allCelIds(doc.frames);
    const { records } = await this.cels.encode(ids, () => nextTick());
    return {
      ...doc,
      format: FORMAT_ID,
      formatVersion: FORMAT_VERSION,
      cels: records,
      brushes: this.opts.brushes(),
      modifiedAt: Date.now(),
    };
  }

  private async makeThumbnail(): Promise<string | null> {
    try {
      const idx = this.doc.frames.findIndex((f) => Object.values(f.cels).some((c) => !this.cels.isEmpty(c)));
      const scale = Math.min(1, 360 / Math.max(this.doc.width, this.doc.height));
      const c = await this.renderFrame(Math.max(0, idx), scale, { references: 'none' });
      const blob = await canvasToBlob(c, 'image/png');
      const key = uid('t');
      await this.repo.putAsset(this.doc.id, key, blob);
      return key;
    } catch {
      return null;
    }
  }

  /** Manual save: a new revision of the project. */
  save(): Promise<void> {
    return this.saveQueue.run(async () => {
      if (this.floating) await this.commitFloating();
      const counter = this.changeCounter;
      const saved = await this.snapshot();
      const thumb = await this.makeThumbnail();
      this.rev = await this.repo.commit(saved, thumb, this.opts.keepVersions);
      this.doc = { ...this.doc, modifiedAt: saved.modifiedAt };
      this.savedCounter = counter;
      this.autosavedCounter = counter;
      this.emit('save');
      this.collectGarbage();
    });
  }

  /** Autosave: writes a recovery copy, never the project itself. */
  autosave(): Promise<boolean> {
    return this.saveQueue.run(async () => {
      if (!this.needsAutosave || this.floating || this.interacting || this.closed) return false;
      const counter = this.changeCounter;
      const saved = await this.snapshot();
      await this.repo.saveRecovery(saved, this.rev);
      this.autosavedCounter = counter;
      this.emit('save');
      return true;
    });
  }

  /** Close without saving: drop the recovery copy. */
  async discard(): Promise<void> {
    await this.saveQueue.run(async () => undefined);
    await this.repo.deleteRecovery(this.doc.id);
  }

  close(): void {
    this.closed = true;
    this.cels.dispose();
    this.history.clear();
    for (const b of this.refBitmaps.values()) if (b instanceof ImageBitmap) b.close();
    this.refBitmaps.clear();
  }

  /** Drop cels unreachable from the document and the history; delete orphan assets. */
  collectGarbage(): void {
    const live = new Set(allCelIds(this.doc.frames));
    this.history.forEach((cmd) => {
      const c = cmd as unknown as { celIds?: () => string[] };
      if (typeof c.celIds === 'function') for (const id of c.celIds()) live.add(id);
      const inner = (cmd as unknown as { cmds?: Command[] }).cmds;
      if (inner) for (const sub of inner) for (const id of (sub as unknown as { celIds?: () => string[] }).celIds?.() ?? []) live.add(id);
    });
    if (this.floating) live.add(this.floating.celId);
    this.cels.retain(live);
    const keep = new Set<string>();
    for (const id of live) {
      const r = this.cels.recordsFor([id])[id];
      if (r?.key) keep.add(r.key);
    }
    for (const r of this.doc.references) keep.add(r.assetKey);
    for (const t of this.doc.audio) for (const c of t.clips) keep.add(c.assetKey);
    this.repo.gc(this.doc.id, keep).catch(() => undefined);
  }

  stats(): { frames: number; layers: number; duration: number; memory: number; history: number } {
    return {
      frames: this.doc.frames.length,
      layers: this.doc.layers.length,
      duration: durationSeconds(this.doc.frames, this.doc.fps),
      memory: this.cels.memoryBytes(),
      history: this.history.totalBytes(),
    };
  }

  /* ------------------------------ Factory ------------------------------- */

  static async create(repo: ProjectRepository, data: ProjectData, opts?: Partial<SessionOptions>): Promise<EditorSession> {
    const saved: SavedProject = { ...data, format: FORMAT_ID, formatVersion: FORMAT_VERSION, cels: {} };
    const rev = await repo.commit(saved, null, opts?.keepVersions ?? 10);
    return new EditorSession(repo, saved, rev, opts);
  }

  static async open(repo: ProjectRepository, id: string, from: 'saved' | 'recovery' | number = 'saved', opts?: Partial<SessionOptions>): Promise<EditorSession> {
    if (from === 'recovery') {
      const rec = await repo.getRecovery(id);
      if (!rec) throw new ProjectFormatError('no-recovery');
      return new EditorSession(repo, validateSavedProject(rec.doc), rec.baseRev, opts, true);
    }
    const { doc, rev } = await repo.load(id, typeof from === 'number' ? from : undefined);
    // Opening an older version makes it the working copy (saved as a new revision on save).
    const meta = await repo.getMeta(id);
    return new EditorSession(repo, doc, meta?.rev ?? rev, opts, typeof from === 'number');
  }

  cloneCanvas = cloneCanvas;
}

function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
