/**
 * Run non-urgent work when the browser has nothing better to do (after the first paint, between
 * frames), so it never competes with a tap. `requestIdleCallback` where it exists; Safari has none,
 * so a short timeout stands in. Returns a cancel. `timeout` is the longest it may wait.
 */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
