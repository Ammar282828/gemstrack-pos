/**
 * How a chart draws itself (2026-10-07): Recharts' own default is 1.5 s on its `ease`, on every load
 * and every change of range — long enough to wait for at the counter. 600 ms on an ease-out, and not
 * at all for someone who has asked their device for less motion (globals.css can't reach these:
 * Recharts animates in JavaScript).
 */
export function chartMotion() {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return { isAnimationActive: !reduce, animationDuration: 600, animationEasing: 'ease-out' as const };
}
