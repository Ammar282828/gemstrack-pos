/**
 * The monthly overhead benchmark.
 *
 * What the shop has to cover every month before anything is profit: salaries,
 * ad spend, rent, utilities. It exists to answer one question — how much do we
 * have to sell this month to stand still.
 *
 * Deliberately NOT expenses. Nothing here is written to the expenses
 * collection, counted in profit, or reflected in the hisaab. The real payments
 * are recorded separately as they happen; this is the target they are measured
 * against. Keeping the two apart is the whole point: if the benchmark were also
 * an expense, every month would be double-counted.
 */

export interface OverheadItem {
  /** Stable across edits so a row can be changed without being replaced. */
  id: string;
  label: string;
  /** PKR per month. */
  amount: number;
}

/**
 * The starting sheet. Seeded only when nothing has been saved yet — once the
 * shop edits it, this is never consulted again, so changing these numbers
 * later will not overwrite anyone's work.
 */
export const DEFAULT_OVERHEADS: OverheadItem[] = [
  { id: 'new-hire',   label: 'New hire',            amount: 60_000 },
  { id: 'marketing',  label: 'Marketing',           amount: 40_000 },
  { id: 'ali',        label: 'Ali Kurshid',         amount: 85_000 },
  { id: 'models',     label: 'Models',              amount: 15_000 },
  { id: 'ads',        label: 'Ad spend',            amount: 50_000 },
  { id: 'utilities',  label: 'Utilities',           amount: 15_000 },
  { id: 'rent',       label: 'Rent',                amount: 20_000 },
  { id: 'misc',       label: 'Misc daily expenses', amount: 20_000 },
];

export const overheadTotal = (items: OverheadItem[]): number =>
  items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

/** An id that will not collide with the seeded ones or with a sibling row. */
export const newOverheadId = (existing: OverheadItem[]): string => {
  let n = existing.length + 1;
  const taken = new Set(existing.map(i => i.id));
  while (taken.has(`item-${n}`)) n += 1;
  return `item-${n}`;
};

export interface OverheadProgress {
  target: number;
  earned: number;
  /** Negative once the target is passed — what is still needed. */
  shortfall: number;
  /** 0–100, clamped, for a bar. */
  percent: number;
  /** Days left in the month, today included. */
  daysLeft: number;
  /** What the remaining days have to average to get there. 0 once covered. */
  perDayNeeded: number;
}

/**
 * `now` is injected rather than read from the clock so this is testable and so
 * a whole screen agrees on one instant.
 */
export function overheadProgress(target: number, earned: number, now: Date): OverheadProgress {
  const shortfall = Math.max(0, target - earned);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
  return {
    target,
    earned,
    shortfall,
    percent: target > 0 ? Math.min(100, Math.max(0, (earned / target) * 100)) : 0,
    daysLeft,
    perDayNeeded: shortfall > 0 ? shortfall / daysLeft : 0,
  };
}
