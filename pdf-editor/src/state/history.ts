export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Key of the last committed change; consecutive changes with the same key are merged. */
  lastKey: string | null;
}

export const MAX_HISTORY = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

/**
 * Records a new state. When `coalesceKey` matches the previous change (e.g.
 * successive pointer moves of one drag gesture), the change replaces the
 * present instead of creating a new undo step.
 */
export function commit<T>(h: History<T>, next: T, coalesceKey: string | null = null): History<T> {
  if (next === h.present) return h;
  if (coalesceKey !== null && coalesceKey === h.lastKey) {
    return { ...h, present: next, future: [] };
  }
  const past = [...h.past, h.present];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [], lastKey: coalesceKey };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastKey: null };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null };
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
