import type { Command } from '../core/history/History';
import type { Rect } from '../core/util/math';
import { ctx2d, putRegion } from './canvas';
import type { CelStore } from './CelStore';

export interface PixelPatch {
  celId: string;
  rect: Rect;
  before: HTMLCanvasElement;
  after: HTMLCanvasElement;
}

/** A cel that was created by the command and attached to a frame/layer slot. */
export interface CelLink {
  frameId: string;
  layerId: string;
  celId: string;
}

export interface PixelHost {
  cels: CelStore;
  linkCel(frameId: string, layerId: string, celId: string | null): void;
  pixelsChanged(celIds: string[]): void;
}

/** Undo step for pixel edits: stores only the changed rectangles. */
export class PixelCommand implements Command {
  bytes: number;
  constructor(
    public label: string,
    private host: PixelHost,
    private patches: PixelPatch[],
    private links: CelLink[] = [],
  ) {
    this.bytes = patches.reduce((s, p) => s + p.rect.w * p.rect.h * 8, 0) + 256;
  }

  private async put(which: 'before' | 'after'): Promise<void> {
    for (const p of this.patches) {
      const canvas = await this.host.cels.editable(p.celId);
      putRegion(canvas, p[which], p.rect);
      this.host.cels.markChanged(p.celId, p.rect);
    }
    this.host.pixelsChanged(this.patches.map((p) => p.celId));
  }

  async undo(): Promise<void> {
    await this.put('before');
    for (const l of this.links) this.host.linkCel(l.frameId, l.layerId, null);
  }

  async redo(): Promise<void> {
    for (const l of this.links) this.host.linkCel(l.frameId, l.layerId, l.celId);
    await this.put('after');
  }

  celIds(): string[] {
    return this.patches.map((p) => p.celId);
  }

  dispose(): void {
    // Shrink the backing stores so the GPU memory is released promptly.
    for (const p of this.patches) {
      p.before.width = p.before.height = 1;
      p.after.width = p.after.height = 1;
    }
  }
}

/** Helper to measure a patch canvas. */
export const patchBytes = (c: HTMLCanvasElement): number => c.width * c.height * 4;

export function blankPatch(r: Rect): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, r.w);
  c.height = Math.max(1, r.h);
  ctx2d(c);
  return c;
}
