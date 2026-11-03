/**
 * An interval that sleeps while nobody is looking.
 *
 * A phone keeps a tab alive in the background for minutes (a home-screen app sits behind the lock screen
 * all day) and every poll that keeps running there spends battery and the server's time on a screen
 * nobody sees. `visibleInterval` runs `fn` every `ms` only while the page is visible; the moment it
 * becomes visible again it catches up at once (`catchUp`, default on) when a tick was missed, then
 * carries on from there. Cleanup clears both the timer and the listener.
 *
 * Use it for every poll, clock and refresh. A tick that must run while hidden (a save, a heartbeat the
 * server needs) is not a poll and keeps its own timer.
 */

/** The slice of `document` this needs, so a test can hand in a fake. */
export interface VisibilityDoc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

export interface VisibleIntervalOptions {
  /** Run `fn` as soon as the page becomes visible again if a tick was missed while it was hidden. Default true. */
  catchUp?: boolean;
  /** Test seams. */
  doc?: VisibilityDoc;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function visibleInterval(fn: () => void, ms: number, opts: VisibleIntervalOptions = {}): () => void {
  const doc: VisibilityDoc | undefined = opts.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const setT = opts.setTimer ?? ((cb, t) => setInterval(cb, t));
  const clearT = opts.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  const catchUp = opts.catchUp ?? true;
  const visible = () => !doc || doc.visibilityState !== 'hidden';

  let timer: unknown = null;
  let missed = false;

  const start = () => { if (timer === null) timer = setT(() => { if (visible()) fn(); else missed = true; }, ms); };
  const stop = () => { if (timer !== null) { clearT(timer); timer = null; } };

  const onChange = () => {
    if (visible()) {
      start();
      if (missed && catchUp) { missed = false; fn(); }
      missed = false;
    } else {
      // Hidden: the timer is dropped entirely, so the page schedules no wake-ups at all.
      stop();
      missed = true;
    }
  };

  if (visible()) start(); else missed = true;
  doc?.addEventListener('visibilitychange', onChange);
  return () => { stop(); doc?.removeEventListener('visibilitychange', onChange); };
}
