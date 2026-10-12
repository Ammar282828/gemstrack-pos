/** Pure logic behind the ledger components, kept apart so it is tested without a DOM. */
import { isWalkInName } from '@/lib/walk-in';

/** "Ayesha Khan" -> "AK"; one word -> one letter; nothing -> "?". */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

export function isWalkIn(name: string | null | undefined): boolean {
  return isWalkInName(name);
}

export type SplitState = 'due' | 'credit' | 'nil';

/** What is left of a bill: owed, in credit (overpaid), or nothing. Rupees are whole; under 0.5 is nil. */
export function moneySplit(total: number, paid: number, due?: number) {
  const t = Number(total) || 0;
  const p = Number(paid) || 0;
  const d = due === undefined ? t - p : Number(due) || 0;
  const state: SplitState = Math.round(d) > 0 ? 'due' : Math.round(d) < 0 ? 'credit' : 'nil';
  const fraction = t > 0 ? Math.min(1, Math.max(0, p / t)) : state === 'nil' ? 1 : 0;
  return { due: d, state, amount: Math.abs(d), fraction, paidInFull: state !== 'due' && t > 0 };
}

export const STAGES = ['Booked', 'Making', 'Ready', 'Invoiced'] as const;
export type Stage = 0 | 1 | 2 | 3 | (typeof STAGES)[number];

/** Index of a stage given by number or name; unknown -> 0. */
export function stageIndex(stage: Stage | number | string, labels: readonly string[] = STAGES): number {
  if (typeof stage === 'number') return Math.min(labels.length - 1, Math.max(0, Math.trunc(stage)));
  const i = labels.findIndex((l) => l.toLowerCase() === String(stage).toLowerCase());
  return i < 0 ? 0 : i;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The three lines of a date leaf, in local time. Invalid date -> null. */
export function dateLeafParts(date: Date | string | number) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return { weekday: WEEKDAYS[d.getDay()], day: String(d.getDate()), month: MONTHS[d.getMonth()] };
}

/** Swipe geometry. Positive offset = row moved left (trailing actions showing); negative = leading. */
export const ACTION_WIDTH = 76;
export const SWIPE_SLOP = 8;
export const SWIPE_FLICK = 0.45;

export function clampSwipe(off: number, leadingW: number, trailingW: number): number {
  if (off > trailingW) return trailingW + Math.min(24, (off - trailingW) * 0.3);
  if (off < -leadingW) return -leadingW - Math.min(24, (-leadingW - off) * 0.3);
  return off;
}

/**
 * Where a released swipe settles: 0, trailingW or -leadingW. `velocity` is px/ms, leftwards positive.
 * Never fires an action (allowsFullSwipe: false).
 */
export function settleSwipe(off: number, velocity: number, leadingW: number, trailingW: number): number {
  if (velocity > SWIPE_FLICK) return off <= 0 ? 0 : trailingW;
  if (velocity < -SWIPE_FLICK) return off >= 0 ? 0 : -leadingW;
  if (off > 0 && trailingW && off > trailingW / 2) return trailingW;
  if (off < 0 && leadingW && -off > leadingW / 2) return -leadingW;
  return 0;
}
