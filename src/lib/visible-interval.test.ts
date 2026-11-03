import { describe, expect, it } from 'vitest';
import { visibleInterval, type VisibilityDoc } from './visible-interval';

/** A clock and a document we control. */
function rig(initial: 'visible' | 'hidden' = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as string,
    addEventListener: (_: 'visibilitychange', cb: () => void) => { listeners.add(cb); },
    removeEventListener: (_: 'visibilitychange', cb: () => void) => { listeners.delete(cb); },
  } satisfies VisibilityDoc;
  const timers = new Map<number, () => void>();
  let next = 1;
  const setTimer = (cb: () => void) => { const id = next++; timers.set(id, cb); return id; };
  const clearTimer = (id: unknown) => { timers.delete(id as number); };
  const tick = () => [...timers.values()].forEach(cb => cb());
  const setVisibility = (s: 'visible' | 'hidden') => { doc.visibilityState = s; listeners.forEach(l => l()); };
  return { doc, timers, setTimer, clearTimer, tick, setVisibility, listeners };
}

describe('visibleInterval', () => {
  it('runs while visible', () => {
    const r = rig(); let n = 0;
    visibleInterval(() => n++, 1000, r);
    r.tick(); r.tick();
    expect(n).toBe(2);
  });

  it('drops its timer while hidden and catches up once on return', () => {
    const r = rig(); let n = 0;
    visibleInterval(() => n++, 1000, r);
    r.setVisibility('hidden');
    expect(r.timers.size).toBe(0);
    r.tick(); // nothing scheduled, nothing runs
    expect(n).toBe(0);
    r.setVisibility('visible');
    expect(n).toBe(1);        // the catch-up
    expect(r.timers.size).toBe(1);
    r.tick();
    expect(n).toBe(2);
  });

  it('does not catch up when asked not to (a clock just repaints)', () => {
    const r = rig(); let n = 0;
    visibleInterval(() => n++, 1000, { ...r, catchUp: false });
    r.setVisibility('hidden'); r.setVisibility('visible');
    expect(n).toBe(0);
  });

  it('starts asleep when the page opens hidden, and wakes on visible', () => {
    const r = rig('hidden'); let n = 0;
    visibleInterval(() => n++, 1000, r);
    expect(r.timers.size).toBe(0);
    r.setVisibility('visible');
    expect(n).toBe(1);
  });

  it('cleans up timer and listener', () => {
    const r = rig(); let n = 0;
    const stop = visibleInterval(() => n++, 1000, r);
    stop();
    expect(r.timers.size).toBe(0);
    expect(r.listeners.size).toBe(0);
    r.setVisibility('hidden'); r.setVisibility('visible');
    expect(n).toBe(0);
  });
});
