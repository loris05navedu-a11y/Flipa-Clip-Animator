import { uid } from '../core/util/id';
import { intersectRect, unionRect, type Rect } from '../core/util/math';
import type { CelRecord } from '../core/model/types';
import { alphaBounds } from '../core/raster/fill';
import { blobToBitmap, canvasToBlob, copyRegion, createCanvas, ctx2d } from './canvas';

export interface AssetSource {
  getAsset(key: string): Promise<Blob | null>;
  putAsset(key: string, blob: Blob): Promise<void>;
}

interface CelEntry {
  id: string;
  /** Persisted image (clean when !dirty). */
  record: CelRecord | null;
  /** Full-size editable canvas (created on first edit). */
  canvas: HTMLCanvasElement | null;
  /** Decoded persisted image, cropped to record bounds (read-only). */
  bitmap: ImageBitmap | null;
  dirty: boolean;
  version: number;
  /** Conservative bounds of the content of `canvas`. */
  bounds: Rect | null;
  lastUsed: number;
  loading: Promise<void> | null;
  failed: boolean;
}

export interface EncodedCels {
  records: Record<string, CelRecord>;
  written: number;
}

/**
 * Owns the pixels of every cel of the open project.
 *
 * Memory strategy (see docs/ARCHITECTURE.md):
 *  - cels start as lightweight records pointing to immutable PNG assets;
 *  - they are decoded on demand into cropped ImageBitmaps for display;
 *  - a full-size canvas is created only when a cel is edited;
 *  - a LRU keeps decoded data under a byte budget; dirty canvases are
 *    encoded to assets before being evicted, so nothing is ever lost.
 */
export class CelStore {
  private entries = new Map<string, CelEntry>();
  private clock = 0;
  /** Cels that must not be evicted (current frame, onion skins...). */
  pinned = new Set<string>();
  budgetBytes: number;
  private evicting = false;

  constructor(
    public width: number,
    public height: number,
    private assets: AssetSource,
    budgetBytes = 384 * 1024 * 1024,
  ) {
    this.budgetBytes = budgetBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  private touch(e: CelEntry): void {
    e.lastUsed = ++this.clock;
  }

  private entry(id: string): CelEntry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown-cel:${id}`);
    return e;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  version(id: string): number {
    return this.entries.get(id)?.version ?? -1;
  }

  /** Register a persisted cel (from a loaded document). */
  addRecord(id: string, record: CelRecord): void {
    this.entries.set(id, {
      id,
      record: { ...record },
      canvas: null,
      bitmap: null,
      dirty: false,
      version: 0,
      bounds: record.key ? { x: record.x, y: record.y, w: record.w, h: record.h } : null,
      lastUsed: 0,
      loading: null,
      failed: false,
    });
  }

  /** Create a new empty, editable cel. */
  create(): string {
    const id = uid('c');
    this.entries.set(id, {
      id,
      record: { key: null, x: 0, y: 0, w: 0, h: 0 },
      canvas: null,
      bitmap: null,
      dirty: false,
      version: 0,
      bounds: null,
      lastUsed: ++this.clock,
      loading: null,
      failed: false,
    });
    return id;
  }

  /** Create a cel from an image (import). The image is drawn at (x, y) with an optional size. */
  createFrom(src: CanvasImageSource, x = 0, y = 0, w?: number, h?: number): string {
    const id = this.create();
    const c = this.editableSync(id)!;
    const ctx = ctx2d(c);
    if (w !== undefined && h !== undefined) ctx.drawImage(src, x, y, w, h);
    else ctx.drawImage(src, x, y);
    this.markChanged(id, { x: 0, y: 0, w: this.width, h: this.height });
    return id;
  }

  /** Copy a cel. Clean cels share their immutable asset; dirty ones copy pixels. */
  clone(id: string): string {
    const src = this.entry(id);
    const nid = uid('c');
    const e: CelEntry = {
      id: nid,
      record: src.record ? { ...src.record } : null,
      canvas: null,
      bitmap: src.dirty ? null : src.bitmap,
      dirty: false,
      version: 0,
      bounds: src.bounds ? { ...src.bounds } : null,
      lastUsed: ++this.clock,
      loading: null,
      failed: src.failed,
    };
    if (src.dirty && src.canvas) {
      e.canvas = createCanvas(this.width, this.height);
      ctx2d(e.canvas).drawImage(src.canvas, 0, 0);
      e.dirty = true;
      e.record = null;
    }
    this.entries.set(nid, e);
    return nid;
  }

  isEmpty(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return true;
    if (e.dirty || e.canvas) return !e.bounds;
    return !e.record?.key;
  }

  /** True when the cel can be drawn synchronously right now. */
  isReady(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return true;
    return !!e.canvas || !!e.bitmap || !e.record?.key || e.failed;
  }

  /** Decode the cel for display. */
  ensureLoaded(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e || this.isReady(id)) return Promise.resolve();
    if (e.loading) return e.loading;
    const key = e.record!.key!;
    e.loading = (async () => {
      try {
        const blob = await this.assets.getAsset(key);
        if (!blob) throw new Error('missing-asset');
        const bmp = await blobToBitmap(blob);
        // The cel may have been edited meanwhile.
        if (!e.canvas && e.record?.key === key) e.bitmap = bmp;
        else bmp.close();
      } catch (err) {
        console.warn('Cel decode failed', id, err);
        e.failed = true;
      } finally {
        e.loading = null;
        this.touch(e);
      }
    })();
    return e.loading.then(() => this.scheduleEvict());
  }

  /** Get a full-size editable canvas for the cel (decoding it first if needed). */
  async editable(id: string): Promise<HTMLCanvasElement> {
    await this.ensureLoaded(id);
    return this.editableSync(id)!;
  }

  /** Editable canvas if it can be produced synchronously (cel already decoded or empty). */
  editableSync(id: string): HTMLCanvasElement | null {
    const e = this.entry(id);
    this.touch(e);
    if (e.canvas) return e.canvas;
    if (!this.isReady(id)) return null;
    const c = createCanvas(this.width, this.height);
    if (e.bitmap && e.record) ctx2d(c).drawImage(e.bitmap, e.record.x, e.record.y);
    e.canvas = c;
    e.bitmap?.close();
    e.bitmap = null;
    this.scheduleEvict();
    return c;
  }

  /** Draw the cel at its place (ctx in project space). Returns false if not decoded yet. */
  draw(ctx: CanvasRenderingContext2D, id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return true;
    this.touch(e);
    if (e.canvas) {
      if (e.bounds) {
        const b = e.bounds;
        ctx.drawImage(e.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
      }
      return true;
    }
    if (e.bitmap && e.record) {
      ctx.drawImage(e.bitmap, e.record.x, e.record.y);
      return true;
    }
    return !e.record?.key || e.failed;
  }

  /** Content bounds (conservative). */
  bounds(id: string): Rect | null {
    return this.entries.get(id)?.bounds ?? null;
  }

  /** Must be called after pixels of an editable cel changed within `rect`. */
  markChanged(id: string, rect: Rect | null, shrinkTo?: Rect | null): void {
    const e = this.entry(id);
    e.dirty = true;
    e.version++;
    const full = { x: 0, y: 0, w: this.width, h: this.height };
    if (shrinkTo !== undefined) e.bounds = shrinkTo ? intersectRect(shrinkTo, full) : null;
    else if (rect) {
      const r = intersectRect(rect, full);
      e.bounds = unionRect(e.bounds, r);
    }
    this.touch(e);
  }

  /** Recompute exact content bounds by scanning pixels (expensive; used before encoding). */
  private tightBounds(e: CelEntry): Rect | null {
    if (!e.canvas || !e.bounds) return null;
    const b = intersectRect(e.bounds, { x: 0, y: 0, w: this.width, h: this.height });
    if (!b) return null;
    const data = ctx2d(e.canvas).getImageData(b.x, b.y, b.w, b.h);
    const t = alphaBounds(data);
    return t ? { x: b.x + t.x, y: b.y + t.y, w: t.w, h: t.h } : null;
  }

  /**
   * Encode every dirty cel among `ids` to a PNG asset. The pixels are copied
   * synchronously, so drawing can continue while the encoder runs.
   */
  async encode(ids: Iterable<string>, yieldFn?: () => Promise<void>): Promise<EncodedCels> {
    const records: Record<string, CelRecord> = {};
    let written = 0;
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e) continue;
      if (!e.dirty) {
        if (e.record) records[id] = { ...e.record };
        continue;
      }
      const version = e.version;
      const bounds = this.tightBounds(e);
      let record: CelRecord;
      if (!bounds) {
        record = { key: null, x: 0, y: 0, w: 0, h: 0 };
      } else {
        const copy = copyRegion(e.canvas!, bounds);
        const blob = await canvasToBlob(copy);
        const key = uid('a');
        await this.assets.putAsset(key, blob);
        written++;
        record = { key, ...bounds };
      }
      records[id] = record;
      if (e.version === version) {
        e.record = record;
        e.dirty = false;
        e.bounds = bounds;
      }
      if (yieldFn) await yieldFn();
    }
    return { records, written };
  }

  /** Encode (if needed) and release the decoded pixels of a cel (bulk imports). */
  async spill(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e || this.pinned.has(id)) return;
    if (e.dirty) await this.encode([id]);
    if (e.dirty) return;
    e.canvas = null;
    e.bitmap?.close();
    e.bitmap = null;
  }

  dirtyIds(): string[] {
    return [...this.entries.values()].filter((e) => e.dirty).map((e) => e.id);
  }

  /** Bytes currently held by decoded pixels. */
  memoryBytes(): number {
    let b = 0;
    for (const e of this.entries.values()) {
      if (e.canvas) b += this.width * this.height * 4;
      else if (e.bitmap) b += e.bitmap.width * e.bitmap.height * 4;
    }
    return b;
  }

  private scheduleEvict(): void {
    if (this.evicting || this.memoryBytes() <= this.budgetBytes) return;
    this.evicting = true;
    setTimeout(() => {
      this.evict()
        .catch((err) => console.warn('evict failed', err))
        .finally(() => (this.evicting = false));
    }, 50);
  }

  /** Free decoded pixels of least recently used cels until under budget. */
  async evict(): Promise<void> {
    const candidates = [...this.entries.values()]
      .filter((e) => (e.canvas || e.bitmap) && !this.pinned.has(e.id))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of candidates) {
      if (this.memoryBytes() <= this.budgetBytes * 0.8) break;
      if (e.dirty) await this.encode([e.id]);
      if (e.dirty || this.pinned.has(e.id)) continue; // edited meanwhile
      e.canvas = null;
      e.bitmap?.close();
      e.bitmap = null;
    }
  }

  /** Drop cels that are no longer referenced by the document nor the history. */
  retain(live: Set<string>): number {
    let n = 0;
    for (const [id, e] of this.entries) {
      if (!live.has(id)) {
        e.bitmap?.close();
        this.entries.delete(id);
        n++;
      }
    }
    return n;
  }

  /** Release everything (project closed). */
  dispose(): void {
    for (const e of this.entries.values()) e.bitmap?.close();
    this.entries.clear();
  }

  /** Records of all cels for serialisation (clean cels only; call encode() first). */
  recordsFor(ids: Iterable<string>): Record<string, CelRecord> {
    const out: Record<string, CelRecord> = {};
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e?.record && !e.dirty) out[id] = { ...e.record };
    }
    return out;
  }
}
