/**
 * Viewing the app as a shop-floor account without owning one.
 *
 * `?as=staff` on any page makes an owner's own session behave as staff: the
 * sidebar narrows, the store switches to the server read path, and writes go
 * through /api/staff/write. Real data, real filtering, real endpoints — the
 * only thing pretended is who you are.
 *
 * Development only, twice over. The check reads NODE_ENV, which Next compiles
 * to the literal "production" in a deployed build so the branch is dropped
 * entirely; and the server half additionally refuses unless the caller already
 * holds an owner token. Neither is load-bearing on its own.
 *
 * `?as=owner` clears it. The choice is kept in sessionStorage so it survives
 * navigation within the tab and dies with the tab.
 */

const KEY = 'gemstrack:dev-role';

export type DevRole = 'staff' | null;

const isDev = () => process.env.NODE_ENV !== 'production';

/** Read `?as=` and remember it. Call once, high in the tree. */
export function captureDevRole(): void {
  if (!isDev() || typeof window === 'undefined') return;
  const asked = new URLSearchParams(window.location.search).get('as');
  if (!asked) return;
  try {
    if (asked === 'staff') sessionStorage.setItem(KEY, 'staff');
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode; the override simply will not stick */ }
}

export function devRole(): DevRole {
  if (!isDev() || typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(KEY) === 'staff' ? 'staff' : null;
  } catch {
    return null;
  }
}

/** Sent with staff API calls so the server applies the same pretence. */
export const DEV_ROLE_HEADER = 'x-dev-role';
