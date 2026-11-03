/**
 * A small physical tick on success and a double one on error, where the platform has one.
 *
 * `navigator.vibrate` exists on Android Chrome/Firefox and is simply absent on iOS Safari and desktop,
 * which is fine: it is a flourish, never the only signal (a toast always shows too). Kept tasteful:
 * only success and error, a few milliseconds, off under Reduce Motion, and off when this device
 * has `localStorage['gemstrack:haptics'] = 'off'`. Browsers also refuse it before the page has had a tap.
 */

export type Haptic = 'success' | 'error' | 'tap';

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 6,
  success: 10,
  error: [18, 45, 18],
};

export function haptic(kind: Haptic): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (typeof window !== 'undefined') {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      if (window.localStorage?.getItem('gemstrack:haptics') === 'off') return;
    }
    navigator.vibrate(PATTERNS[kind]);
  } catch { /* storage blocked, or the browser refused */ }
}
