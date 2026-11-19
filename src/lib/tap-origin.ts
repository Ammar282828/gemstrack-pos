/**
 * Origin awareness (2026-11-19, the owner's motion list: "things grow out of where the finger is tapped, not from an
 * arbitrary center point"). The page remembers where the last press landed; a dialog opening within a moment of it
 * grows from that point instead of from its own centre. Without a fresh press (a keyboard shortcut, a dialog opened
 * by code) it grows from its centre as before.
 */

let last: { x: number; y: number; t: number } | null = null;
let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pointerdown', e => { last = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
}
listen();

/** The transform-origin, in the element's own pixels, that points at the last press — or null if there was none just now. */
export function originFromTap(rect: { left: number; top: number; width: number; height: number }, now = performance.now()): string | null {
  if (!last || now - last.t > 800 || rect.width <= 0 || rect.height <= 0) return null;
  // Clamp to the box's edges: a tap far to one side grows the dialog from that side, not from outside it.
  const x = Math.min(Math.max(last.x - rect.left, 0), rect.width);
  const y = Math.min(Math.max(last.y - rect.top, 0), rect.height);
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

/** For tests. */
export function setLastTap(p: { x: number; y: number; t: number } | null) { last = p; }
