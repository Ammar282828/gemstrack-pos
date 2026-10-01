/**
 * Voice handing a half-made record to its real form (owner, 2026-10-01: "voice should be able to
 * do absolutely anything").
 *
 * An order, a sale and a new piece are priced by their forms (rates, wastage, making, stones), so
 * voice does not price them itself: it fills the form in and opens it, the same way the slip and
 * bill scanners do, and the shop presses Create. The payload rides in sessionStorage for the one
 * page load that takes it; the address carries `?voice=1` so the page knows to look.
 */

const KEY = (kind: HandoffKind) => `voice-handoff:${kind}`;

export type HandoffKind = 'order' | 'sale' | 'piece';

export function handOff(kind: HandoffKind, payload: unknown): void {
  try { sessionStorage.setItem(KEY(kind), JSON.stringify({ at: Date.now(), payload })); } catch { /* private mode: the form opens empty */ }
}

/** The payload for this page, once; anything older than five minutes is stale and dropped. */
export function takeHandoff<T>(kind: HandoffKind): T | null {
  try {
    const raw = sessionStorage.getItem(KEY(kind));
    if (!raw) return null;
    sessionStorage.removeItem(KEY(kind));
    const { at, payload } = JSON.parse(raw) as { at: number; payload: T };
    return Date.now() - at < 5 * 60_000 ? payload : null;
  } catch {
    return null;
  }
}
