/** Yield to the event loop so long jobs never freeze the UI. */
export const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export const nextFrame = (): Promise<void> =>
  new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

export function idle(timeout = 200): Promise<void> {
  return new Promise((r) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(() => r(), { timeout });
    else setTimeout(r, 1);
  });
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export interface CancelToken {
  cancelled: boolean;
}

export function throwIfCancelled(token?: CancelToken): void {
  if (token?.cancelled) throw new CancelledError();
}

/** Run an async queue one job at a time. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(job: () => Promise<T>): Promise<T> {
    const p = this.tail.then(job, job);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
