import type { Command } from '../core/history/History';
import type { ProjectData } from '../core/model/types';

export type DocPatch = Partial<Pick<ProjectData, 'frames' | 'layers' | 'audio' | 'references' | 'fps' | 'name' | 'background' | 'palettes'>>;

export interface NavState {
  frameIndex: number;
  layerId: string;
}

export interface DocHost {
  applyPatch(patch: DocPatch, nav: NavState | null): void;
}

/**
 * Structural undo step: swaps top-level document fields between two
 * immutable snapshots (the arrays are never mutated in place).
 */
export class DocCommand implements Command {
  bytes: number;
  constructor(
    public label: string,
    private host: DocHost,
    private before: DocPatch,
    private after: DocPatch,
    private navBefore: NavState | null,
    private navAfter: NavState | null,
    public mergeKey?: string,
  ) {
    this.bytes = 512 + ((before.frames?.length ?? 0) + (after.frames?.length ?? 0)) * 96;
  }
  undo(): void {
    this.host.applyPatch(this.before, this.navBefore);
  }
  redo(): void {
    this.host.applyPatch(this.after, this.navAfter);
  }
  merge(next: Command): boolean {
    if (!(next instanceof DocCommand)) return false;
    this.after = { ...this.after, ...next.after };
    this.navAfter = next.navAfter;
    return true;
  }
  /** Cels referenced by the snapshots (kept alive for undo). */
  celIds(): string[] {
    const out: string[] = [];
    for (const p of [this.before, this.after]) for (const f of p.frames ?? []) out.push(...Object.values(f.cels));
    return out;
  }
}
