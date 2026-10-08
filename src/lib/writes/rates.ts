/**
 * Setting the day's rates: what is written and what the activity log says, for the browser's rate
 * sheet (store.ts updateSettings / confirmRates) and the iPhone app (/api/app/write setRates).
 *
 * A rate that moves is stamped with when and who; a rate saved unchanged is still stamped, because
 * the website sells only at a rate set in the last 36 hours (lib/website/config.ts ratesFresh) and
 * the shop confirms an unchanged rate every morning.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { changedRates, RATE_KEYS, type RateKey, type Rates } from '@/lib/rates';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';

export const RATE_LABEL: Record<RateKey, string> = {
  goldRatePerGram24k: '24K', goldRatePerGram22k: '22K', goldRatePerGram21k: '21K', goldRatePerGram18k: '18K',
  palladiumRatePerGram: 'Palladium', palladiumRatePerGram18k: 'Palladium 18K', palladiumRatePerGram12k: 'Palladium 12K',
  platinumRatePerGram: 'Platinum', silverRatePerGram: 'Silver',
};

const pkr = (n: unknown) => (typeof n === 'number' ? Math.round(n).toLocaleString('en-PK') : '—');

/** The log line for rates that moved: the house's main rate old → new, then any others. */
export function rateChangeLog(moved: RateKey[], before: Rates, after: Rates & { ratesUpdatedBy?: string }, mainKey: RateKey, source?: string) {
  const line = (k: RateKey) => `${RATE_LABEL[k]} ${pkr(before[k])} → ${pkr(after[k] ?? before[k])}`;
  const others = moved.filter(k => k !== mainKey);
  return {
    title: moved.includes(mainKey) ? `Rate set: ${line(mainKey)}` : `Rates set: ${others.map(k => RATE_LABEL[k]).join(', ')}`,
    detail: [`By ${after.ratesUpdatedBy || 'unknown'}`, source && `from ${source}`, others.length ? others.map(line).join(' · ') : ''].filter(Boolean).join(' · '),
  };
}

/** The log line for a rate confirmed unchanged. */
export const rateConfirmLog = (before: Rates, mainKey: RateKey, by: string) => ({
  title: `Rate confirmed: ${RATE_LABEL[mainKey]} ${pkr(before[mainKey])}, unchanged`,
  detail: `By ${by}`,
});

/** Only real rates, by the settings' own names. */
export function cleanRates(input: Record<string, unknown>): Rates {
  const out: Rates = {};
  for (const k of RATE_KEYS) {
    const v = Number(input[k]);
    if (input[k] !== undefined && input[k] !== null && input[k] !== '' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

export async function setRates(
  db: DbPort,
  input: { rates: Rates; by: string; mainKey: RateKey; source?: string; now?: Date },
  fx: SideEffects = {},
): Promise<{ moved: RateKey[]; ratesUpdatedAt: string; ratesUpdatedBy: string }> {
  const current = (await db.get<Rates & { databaseLocked?: boolean }>(SETTINGS, GLOBAL)) ?? ({} as Rates & { databaseLocked?: boolean });
  if (current.databaseLocked) throw new Error('The database is locked. Unlock it in Settings first.');
  const moved = changedRates(input.rates as never, current as never);
  const stamp = { ratesUpdatedAt: (input.now ?? new Date()).toISOString(), ratesUpdatedBy: input.by };
  // Only the delta and the stamp: a stale figure in the request can never overwrite one it did not move.
  const patch: Record<string, unknown> = { ...stamp };
  for (const k of moved) patch[k] = input.rates[k];
  const b = db.batch();
  b.set(SETTINGS, GLOBAL, patch, true);
  await b.commit();
  const log = moved.length
    ? rateChangeLog(moved, current, { ...current, ...input.rates, ...stamp }, input.mainKey, input.source)
    : rateConfirmLog(current, input.mainKey, input.by);
  void Promise.resolve(fx.log?.('rates.update', log.title, log.detail, 'rates')).catch(() => undefined);
  return { moved, ...stamp };
}
