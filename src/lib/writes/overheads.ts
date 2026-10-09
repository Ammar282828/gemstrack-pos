/**
 * Saving the overhead sheet (src/app/overheads/page.tsx "Save from <month>"): the one copy of what the
 * page's save does, for the iPhone app (/api/app/write saveOverheadPlan) and for the page when it takes
 * it up.
 *
 * The sheet is a benchmark, not a ledger (lib/overheads.ts): nothing here touches expenses, profit or
 * the hisaab. A change takes effect from THIS month forward; months already scored keep the plan they
 * were scored against, so a raise today cannot turn last month from met into missed. "This month" is
 * Karachi's, as the page reads it off the shop's own devices: the server's clock is UTC.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { BENCHMARK_START, DEFAULT_OVERHEADS, monthLabel, overheadTotal, type OverheadItem, type OverheadPlan } from '@/lib/overheads';
import { karachiDay } from '@/lib/rates';
import { cleanObject } from './create-invoice';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';

type SettingsLike = { overheadPlans?: unknown; monthlyOverheads?: unknown } | null | undefined;

/** The plans the page works from: the saved ones, else the first-shape list, else the seed. */
export function overheadPlansFrom(settings: SettingsLike): OverheadPlan[] {
  const plans = settings?.overheadPlans;
  if (Array.isArray(plans) && plans.length) return plans as OverheadPlan[];
  const first = settings?.monthlyOverheads;
  if (Array.isArray(first) && first.length) return [{ from: BENCHMARK_START, items: first as OverheadItem[] }];
  return [{ from: BENCHMARK_START, items: DEFAULT_OVERHEADS }];
}

/**
 * Blank rows are dropped: an unnamed zero is someone having second thoughts about adding a line, not
 * a line.
 */
export function cleanOverheadItems(items: OverheadItem[]): OverheadItem[] {
  return items
    .map(i => ({ ...i, label: i.label.trim(), amount: Number(i.amount) || 0 }))
    .filter(i => i.label || i.amount > 0);
}

/** The plans after saving `clean` in `thisMonth` ('YYYY-MM'): the page's own lines. */
export function plansAfterSave(plans: OverheadPlan[], thisMonth: string, clean: OverheadItem[]): { from: string; next: OverheadPlan[] } {
  const others = plans.filter(p => p.from !== thisMonth);
  const from = thisMonth < BENCHMARK_START ? BENCHMARK_START : thisMonth;
  const next = [...others.filter(p => p.from !== from), { from, items: clean }]
    .sort((a, b) => a.from.localeCompare(b.from));
  return { from, next };
}

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

/** Saves the sheet from this month on, read and written in one transaction, and answers with what is on file. */
export async function saveOverheadPlan(
  db: DbPort, input: { items: OverheadItem[]; now?: Date }, fx: SideEffects = {},
): Promise<{ from: string; items: OverheadItem[]; plans: OverheadPlan[] }> {
  const thisMonth = karachiDay(input.now ?? new Date()).slice(0, 7);
  const clean = cleanOverheadItems(input.items);
  const out = await db.runTransaction(async tx => {
    const settings = await tx.get<SettingsLike & object>(SETTINGS, GLOBAL);
    const { from, next } = plansAfterSave(overheadPlansFrom(settings), thisMonth, clean);
    // Only the one field, merged, as the store's updateSettings writes a delta.
    tx.set(SETTINGS, GLOBAL, cleanObject({ overheadPlans: next }) as Record<string, unknown>, true);
    return { from, items: clean, plans: next };
  });
  void Promise.resolve(fx.log?.('settings.update', 'Overheads benchmark saved',
    `${PKR(overheadTotal(clean))} a month, from ${monthLabel(out.from)}`)).catch(() => undefined);
  return out;
}
