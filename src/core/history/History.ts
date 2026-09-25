import { Emitter } from '../util/emitter';

/**
 * An undoable action. Commands are created *after* the action has been
 * applied, so the first call the history makes is `undo()`.
 */
export interface Command {
  /** i18n key describing the action (shown in the UI). */
  label: string;
  /** Approximate memory held by the command, used for the memory budget. */
  bytes: number;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  /**
   * Commands with the same non-empty mergeKey pushed within `mergeWindowMs`
   * are coalesced (e.g. dragging an opacity slider produces one step).
   */
  mergeKey?: string;
  /** Absorb `next` into this command. Return false to refuse. */
  merge?(next: Command): boolean;
  /** Release resources (bitmaps) once the command can no longer be reached. */
  dispose?(): void;
}

export interface HistoryOptions {
  maxSteps: number;
  maxBytes: number;
  mergeWindowMs: number;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  size: number;
  bytes: number;
}

interface Entry {
  cmd: Command;
  time: number;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  readonly changed = new Emitter<HistoryState>();
  opts: HistoryOptions;
  /** Injected clock for tests. */
  now: () => number = () => Date.now();

  constructor(opts: Partial<HistoryOptions> = {}) {
    this.opts = { maxSteps: 100, maxBytes: 256 * 1024 * 1024, mergeWindowMs: 1200, ...opts };
  }

  get isBusy(): boolean {
    return this.busy;
  }

  state(): HistoryState {
    const u = this.undoStack[this.undoStack.length - 1];
    const r = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: !!u,
      canRedo: !!r,
      undoLabel: u?.cmd.label ?? null,
      redoLabel: r?.cmd.label ?? null,
      size: this.undoStack.length,
      bytes: this.totalBytes(),
    };
  }

  totalBytes(): number {
    let b = 0;
    for (const e of this.undoStack) b += e.cmd.bytes;
    for (const e of this.redoStack) b += e.cmd.bytes;
    return b;
  }

  push(cmd: Command): void {
    for (const e of this.redoStack) e.cmd.dispose?.();
    this.redoStack = [];
    const now = this.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (
      last &&
      cmd.mergeKey &&
      last.cmd.mergeKey === cmd.mergeKey &&
      now - last.time <= this.opts.mergeWindowMs &&
      last.cmd.merge?.(cmd)
    ) {
      last.time = now;
      cmd.dispose?.();
    } else {
      this.undoStack.push({ cmd, time: now });
    }
    this.trim();
    this.emit();
  }

  /** Drop the oldest steps until both budgets are respected (the newest step is always kept). */
  private trim(): void {
    while (this.undoStack.length > Math.max(1, this.opts.maxSteps)) this.undoStack.shift()?.cmd.dispose?.();
    while (this.undoStack.length > 1 && this.totalBytes() > this.opts.maxBytes) this.undoStack.shift()?.cmd.dispose?.();
  }

  setLimits(maxSteps: number, maxBytes?: number): void {
    this.opts.maxSteps = maxSteps;
    if (maxBytes) this.opts.maxBytes = maxBytes;
    this.trim();
    this.emit();
  }

  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      const e = this.undoStack.pop();
      if (!e) return false;
      try {
        await e.cmd.undo();
      } finally {
        this.redoStack.push(e);
      }
      return true;
    });
  }

  redo(): Promise<boolean> {
    return this.enqueue(async () => {
      const e = this.redoStack.pop();
      if (!e) return false;
      try {
        await e.cmd.redo();
      } finally {
        e.time = 0; // never merge into a redone step
        this.undoStack.push(e);
      }
      return true;
    });
  }

  /** Wait until pending undo/redo operations are done. */
  idle(): Promise<void> {
    return this.running;
  }

  clear(): void {
    for (const e of this.undoStack) e.cmd.dispose?.();
    for (const e of this.redoStack) e.cmd.dispose?.();
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  /** Visit every live command (used for cel garbage collection). */
  forEach(fn: (cmd: Command) => void): void {
    for (const e of this.undoStack) fn(e.cmd);
    for (const e of this.redoStack) fn(e.cmd);
  }

  private enqueue(job: () => Promise<boolean>): Promise<boolean> {
    const p = this.running.then(async () => {
      this.busy = true;
      try {
        return await job();
      } finally {
        this.busy = false;
        this.emit();
      }
    });
    this.running = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private emit(): void {
    this.changed.emit(this.state());
  }
}

/** Groups several commands into one undo step. */
export class CompositeCommand implements Command {
  bytes: number;
  constructor(
    public label: string,
    private cmds: Command[],
  ) {
    this.bytes = cmds.reduce((s, c) => s + c.bytes, 0);
  }
  async undo(): Promise<void> {
    for (let i = this.cmds.length - 1; i >= 0; i--) await this.cmds[i].undo();
  }
  async redo(): Promise<void> {
    for (const c of this.cmds) await c.redo();
  }
  dispose(): void {
    for (const c of this.cmds) c.dispose?.();
  }
}

/** A command that swaps between two immutable values through a setter. */
export class ValueCommand<T> implements Command {
  constructor(
    public label: string,
    private before: T,
    private after: T,
    private apply: (v: T) => void,
    public mergeKey?: string,
    public bytes = 256,
  ) {}
  undo(): void {
    this.apply(this.before);
  }
  redo(): void {
    this.apply(this.after);
  }
  merge(next: Command): boolean {
    if (!(next instanceof ValueCommand)) return false;
    this.after = next.after as T;
    return true;
  }
}
