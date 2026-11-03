/**
 * A promise that rejects with nobody listening used to vanish: the browser logged it to a console
 * nobody had open, and the button that started it just did nothing. `installUnhandledRejectionToast`
 * listens for them on `window`, always logs them (with the reason) and tells the person once, in one
 * line, that something did not finish.
 *
 * What it does not tell: a cancelled request or share sheet (AbortError), anything while the phone is
 * offline (the banner already says so), and the same message again within 15 seconds. It never throws.
 */

export interface RejectionNotice { title: string; description: string }

const QUIET_MS = 15_000;

/** The words to show for a rejection reason, or null when it is not worth interrupting anyone for. */
export function describeRejection(reason: unknown, online = true): RejectionNotice | null {
  const name = typeof reason === 'object' && reason !== null && 'name' in reason ? String((reason as { name: unknown }).name) : '';
  if (name === 'AbortError') return null;
  if (!online) return null;
  let message = '';
  if (reason instanceof Error) message = reason.message;
  else if (typeof reason === 'string') message = reason;
  else if (typeof reason === 'object' && reason !== null && 'message' in reason) message = String((reason as { message: unknown }).message);
  message = message.replace(/\s+/g, ' ').trim();
  // A ResizeObserver note or an extension's noise is not the shop's problem.
  if (/ResizeObserver loop/i.test(message)) return null;
  return {
    title: 'Something didn’t finish',
    description: message ? message.slice(0, 140) : 'Try that again. If it keeps happening, reload the app.',
  };
}

export function installUnhandledRejectionToast(notify: (n: RejectionNotice) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let last = { text: '', at: 0 };
  const onRejection = (e: PromiseRejectionEvent) => {
    try {
      console.error('[GemsTrack] unhandled promise rejection', e.reason);
      const n = describeRejection(e.reason, typeof navigator === 'undefined' ? true : navigator.onLine !== false);
      if (!n) return;
      const now = Date.now();
      if (n.description === last.text && now - last.at < QUIET_MS) return;
      last = { text: n.description, at: now };
      notify(n);
    } catch { /* this runs because something else already failed */ }
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => window.removeEventListener('unhandledrejection', onRejection);
}
