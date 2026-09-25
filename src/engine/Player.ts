import { frameAtTick, frameStarts, totalTicks } from '../core/model/timing';
import type { EditorSession } from '../editor/EditorSession';
import { Emitter } from '../core/util/emitter';
import type { AudioEngine } from './audio/AudioEngine';
import { createCanvas, ctx2d } from './canvas';
import { composeFrame, ensureFrameLoaded } from './render';

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface PlayerState {
  playing: boolean;
  frame: number;
}

/**
 * Real-time playback. Frames are composited on the fly from decoded cels
 * (cheap GPU draws) into a display-resolution canvas; upcoming frames are
 * decoded ahead of time. Timing uses the audio-independent performance clock
 * and audio is (re)started in sync when playback starts or loops.
 */
export class Player {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  playing = false;
  speed = 1;
  loop = true;
  /** Range limits (inclusive frame indices); null = whole animation. */
  range: [number, number] | null = null;
  frame = 0;
  private startTick = 0;
  private t0 = 0;
  private raf = 0;
  private starts: number[] = [];
  private lastDrawn = -1;
  readonly changed = new Emitter<PlayerState>();

  constructor(
    private session: EditorSession,
    private audio: AudioEngine | null,
    maxSize = 1920,
  ) {
    const { width, height } = session.doc;
    this.maxSize = maxSize;
    const k = Math.min(1, maxSize / Math.max(width, height));
    this.canvas = createCanvas(width * k, height * k);
    this.ctx = ctx2d(this.canvas);
    this.canvasDocW = width;
    this.canvasDocH = height;
  }

  private get bounds(): [number, number] {
    const n = this.session.doc.frames.length;
    if (!this.range) return [0, n - 1];
    return [Math.max(0, Math.min(n - 1, this.range[0])), Math.max(0, Math.min(n - 1, this.range[1]))];
  }

  /** Draw a frame into the player canvas. Returns false if pixels were missing. */
  drawFrame(index: number): boolean {
    const s = this.session;
    const doc = s.doc;
    const f = doc.frames[index];
    if (!f) return true;
    const c = this.canvas;
    if (this.canvasDocW !== doc.width || this.canvasDocH !== doc.height) this.resizeFor(doc.width, doc.height);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(c.width / doc.width, 0, 0, c.height / doc.height, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const ok = composeFrame(ctx, doc, f, s.cels, s, { background: true, references: 'visible' });
    this.lastDrawn = index;
    return ok;
  }

  private canvasDocW = 0;
  private canvasDocH = 0;
  private maxSize: number;
  private resizeFor(w: number, h: number): void {
    const k = Math.min(1, this.maxSize / Math.max(w, h));
    this.canvas.width = Math.max(1, Math.round(w * k));
    this.canvas.height = Math.max(1, Math.round(h * k));
    this.canvasDocW = w;
    this.canvasDocH = h;
  }

  /** Decode the next frames so playback never waits. */
  private prefetch(from: number, count = 12): void {
    const { frames } = this.session.doc;
    for (let k = 0; k < count; k++) {
      const f = frames[(from + k) % frames.length];
      if (f) void ensureFrameLoaded(this.session.doc, f, this.session.cels);
    }
  }

  async play(from?: number): Promise<void> {
    if (this.playing) return;
    const [a, b] = this.bounds;
    let start = from ?? this.session.frameIndex;
    if (start < a || start > b) start = a;
    if (start === b && from === undefined) start = a;
    this.starts = frameStarts(this.session.doc.frames);
    // Warm up the first frames before starting the clock.
    await Promise.all(this.session.doc.frames.slice(start, start + 4).map((f) => ensureFrameLoaded(this.session.doc, f, this.session.cels)));
    this.frame = start;
    this.startTick = this.starts[start];
    this.t0 = performance.now();
    this.playing = true;
    this.lastDrawn = -1;
    void this.audio?.play(this.session.doc, this.startTick / this.session.doc.fps, this.speed);
    this.drawFrame(start);
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (!this.playing) return;
    const doc = this.session.doc;
    const [a, b] = this.bounds;
    const endTick = this.starts[b] + Math.max(1, doc.frames[b]?.hold ?? 1);
    const tick = this.startTick + ((now - this.t0) / 1000) * doc.fps * this.speed;
    if (tick >= endTick) {
      if (this.loop) {
        this.startTick = this.starts[a];
        this.t0 = now;
        void this.audio?.play(doc, this.startTick / doc.fps, this.speed);
      } else {
        this.frame = b;
        this.drawFrame(b);
        this.pause();
        return;
      }
    }
    const t = Math.max(this.startTick, Math.min(endTick - 1e-6, tick >= endTick ? this.startTick : tick));
    const idx = Math.max(a, Math.min(b, frameAtTick(this.starts, Math.floor(t))));
    if (idx !== this.lastDrawn) {
      const ready = this.session.cels && doc.frames[idx] ? this.frameReady(idx) : true;
      if (ready) {
        this.frame = idx;
        this.drawFrame(idx);
        this.emit();
      }
      this.prefetch(idx + 1);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private frameReady(idx: number): boolean {
    const f = this.session.doc.frames[idx];
    for (const l of this.session.doc.layers) {
      const c = f.cels[l.id];
      if (l.visible && c && !this.session.cels.isReady(c)) {
        void this.session.cels.ensureLoaded(c);
        return false;
      }
    }
    return true;
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio?.stop();
    this.emit();
  }

  toggle(from?: number): void {
    if (this.playing) this.pause();
    else void this.play(from);
  }

  setSpeed(speed: number): void {
    const was = this.playing;
    if (was) this.pause();
    this.speed = speed;
    if (was) void this.play(this.frame);
  }

  get durationTicks(): number {
    return totalTicks(this.session.doc.frames);
  }

  private emit(): void {
    this.changed.emit({ playing: this.playing, frame: this.frame });
  }

  dispose(): void {
    this.pause();
  }
}
