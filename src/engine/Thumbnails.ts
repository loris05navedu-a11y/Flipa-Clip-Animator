import { idle } from '../core/util/async';
import { Emitter } from '../core/util/emitter';
import type { EditorSession } from '../editor/EditorSession';
import { createCanvas, ctx2d } from './canvas';
import { composeFrame, ensureFrameLoaded, frameKey } from './render';

/**
 * Low-resolution frame thumbnails for the timeline. Generated lazily in idle
 * time (never blocking drawing), cached with a LRU bound and invalidated by
 * the frame's content key.
 */
export class Thumbnails {
  private cache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
  private queue: string[] = [];
  private wanted = new Set<string>();
  private running = false;
  readonly ready = new Emitter<string>();
  height = 72;
  max = 600;

  constructor(private session: EditorSession) {}

  private key(frameId: string): string | null {
    const s = this.session;
    const f = s.frameOf(frameId);
    return f ? frameKey(s.doc, f, s.cels, `${this.height}`) : null;
  }

  /** Up-to-date thumbnail, or null (a job is queued). */
  get(frameId: string): HTMLCanvasElement | null {
    const k = this.key(frameId);
    if (!k) return null;
    const hit = this.cache.get(frameId);
    if (hit && hit.key === k) {
      this.cache.delete(frameId);
      this.cache.set(frameId, hit);
      return hit.canvas;
    }
    if (!this.wanted.has(frameId)) {
      this.wanted.add(frameId);
      this.queue.push(frameId);
      void this.pump();
    }
    return null;
  }

  /** Last thumbnail even if outdated (avoids flicker while regenerating). */
  stale(frameId: string): HTMLCanvasElement | null {
    return this.cache.get(frameId)?.canvas ?? null;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.session.closed) {
        // Newest requests first (what the user is looking at).
        const id = this.queue.pop()!;
        this.wanted.delete(id);
        if (this.session.interacting) {
          await new Promise((r) => setTimeout(r, 150));
        }
        await idle(300);
        await this.render(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async render(frameId: string): Promise<void> {
    const s = this.session;
    const f = s.frameOf(frameId);
    if (!f) return;
    await ensureFrameLoaded(s.doc, f, s.cels);
    const k = this.key(frameId);
    if (!k || this.cache.get(frameId)?.key === k) return;
    const { width, height } = s.doc;
    const h = this.height;
    const w = Math.max(8, Math.round((width / height) * h));
    const c = createCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(w / width, h / height);
    composeFrame(ctx, s.doc, f, s.cels, null, { background: true, references: 'none' });
    this.cache.delete(frameId);
    this.cache.set(frameId, { key: k, canvas: c });
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value as string);
    this.ready.emit(frameId);
  }

  clear(): void {
    this.cache.clear();
    this.queue = [];
    this.wanted.clear();
  }
}
