export type Listener<T> = (value: T) => void;

/** Minimal typed event emitter used by engine objects to notify the UI. */
export class Emitter<T = void> {
  private listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    for (const fn of [...this.listeners]) fn(value);
  }
  get size(): number {
    return this.listeners.size;
  }
}
