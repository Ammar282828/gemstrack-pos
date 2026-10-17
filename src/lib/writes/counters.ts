/**
 * Settings → Shop → Document numbering: the last invoice, order and repair numbers, from which the next
 * INV-, ORD- and REP- number continues (create-invoice.ts, create-order.ts, repairs.ts).
 *
 * Kept apart from `updateSettings` (lib/writes/settings.ts leaves the counters out on purpose): moving a
 * counter back gives the next sale a number already printed on another bill, so it is its own change, asked
 * with the delete code by the iPhone app (/api/app/write `setCounters`, ops-settings3.ts), and logged with
 * each number old → new. Done in a transaction, so a sale numbered meanwhile is read before it is written over.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';

export const COUNTER_KEYS = ['lastInvoiceNumber', 'lastOrderNumber', 'lastRepairNumber'] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];
export type Counters = Partial<Record<CounterKey, number>>;

export const COUNTER_LABEL: Record<CounterKey, string> = {
  lastInvoiceNumber: 'Invoice', lastOrderNumber: 'Order', lastRepairNumber: 'Repair',
};

/** Far past six digits, still an exact integer anywhere it is read. */
export const MAX_COUNTER = 999_999_999;

export type CleanedCounters = { ok: true; counters: Counters } | { ok: false; error: string };

/** Only the three counters, each a whole number of 0 or more. */
export function cleanCounters(input: unknown): CleanedCounters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Nothing to save.' };
  const src = input as Record<string, unknown>;
  const out: Counters = {};
  for (const k of COUNTER_KEYS) {
    if (!(k in src) || src[k] === undefined || src[k] === null) continue;
    const v = src[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_COUNTER) {
      return { ok: false, error: `The last ${COUNTER_LABEL[k].toLowerCase()} number must be a whole number, 0 or more.` };
    }
    out[k] = v;
  }
  return Object.keys(out).length ? { ok: true, counters: out } : { ok: false, error: 'Nothing to save.' };
}

const stored = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The counters that would move, against what the settings hold. */
export function countersMoving(current: Record<string, unknown> | null, next: Counters): CounterKey[] {
  return COUNTER_KEYS.filter((k) => next[k] !== undefined && next[k] !== stored(current?.[k]));
}

/** "Invoice 120 → 200 · Order 45 → 50". */
export const countersLog = (moved: CounterKey[], before: Record<string, unknown> | null, after: Counters) =>
  moved.map((k) => `${COUNTER_LABEL[k]} ${stored(before?.[k])} → ${after[k]}`).join(' · ');

export async function setCounters(
  db: DbPort,
  counters: Counters,
  opts: { by: string },
  fx: SideEffects = {},
): Promise<{ moved: CounterKey[]; before: Counters; after: Counters }> {
  const out = await db.runTransaction(async (tx) => {
    const current = await tx.get<Record<string, unknown>>(SETTINGS, GLOBAL);
    if (current?.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
    const moved = countersMoving(current, counters);
    const before: Counters = {};
    const after: Counters = {};
    for (const k of moved) {
      before[k] = stored(current?.[k]);
      after[k] = counters[k];
    }
    if (moved.length) tx.set(SETTINGS, GLOBAL, after as Record<string, unknown>, true);
    return { moved, before, after, line: countersLog(moved, current, counters) };
  });
  if (out.moved.length) {
    void Promise.resolve(fx.log?.('settings.counters', 'Document numbering changed', `${out.line} · by ${opts.by}`, 'counters')).catch(() => undefined);
  }
  return { moved: out.moved, before: out.before, after: out.after };
}
