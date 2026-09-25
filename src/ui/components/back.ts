/**
 * Stack of "back" handlers (Android back button / Escape). The most recent
 * handler wins; dialogs and menus register one while they are open.
 */
type Handler = () => boolean | void;
const stack: Handler[] = [];

export function pushBack(h: Handler): () => void {
  stack.push(h);
  return () => {
    const i = stack.lastIndexOf(h);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Run the top handler. Returns false when nothing handled it. */
export function runBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true;
  }
  return false;
}

export function backDepth(): number {
  return stack.length;
}

/** True when `h` is the most recently registered handler. */
export function isTopBack(h: Handler): boolean {
  return stack[stack.length - 1] === h;
}
