/**
 * The shop's live rates: which one is "the" rate, when it was set and by whom, and what a
 * sale may write back to it.
 *
 * The rates in app_settings/global are what every new sale starts from and what the website
 * quotes and takes orders at (lib/website/config.ts). Until 2026-10-01 the cart wrote its rates
 * back after every save, new or edited — and editing an old invoice first loads that invoice's
 * own rates, and a scanned bill sets the paper's — so re-saving a July invoice made July's rate
 * today's (the audit of 1 Oct). Now only a new invoice writes back, and only the rates typed by
 * hand in that cart (`ratesToKeep`).
 */

import type { Settings } from '@/lib/store';

/** Every rate the settings document holds, PKR per gram. */
export const RATE_KEYS = [
  'goldRatePerGram24k', 'goldRatePerGram22k', 'goldRatePerGram21k', 'goldRatePerGram18k',
  'palladiumRatePerGram', 'palladiumRatePerGram18k', 'palladiumRatePerGram12k',
  'platinumRatePerGram', 'silverRatePerGram',
] as const;
export type RateKey = typeof RATE_KEYS[number];
export type Rates = Partial<Record<RateKey, number>>;

/** The cart's rate boxes, by the names it uses. */
export const INPUT_TO_RATE = {
  gold24k: 'goldRatePerGram24k', gold22k: 'goldRatePerGram22k', gold21k: 'goldRatePerGram21k', gold18k: 'goldRatePerGram18k',
  palladium: 'palladiumRatePerGram', palladium18k: 'palladiumRatePerGram18k', palladium12k: 'palladiumRatePerGram12k',
  platinum: 'platinumRatePerGram', silver: 'silverRatePerGram',
} as const satisfies Record<string, RateKey>;
export type RateInputKey = keyof typeof INPUT_TO_RATE;

/** The metal each rate prices. */
export const RATE_METAL: Record<RateKey, 'gold' | 'palladium' | 'platinum' | 'silver'> = {
  goldRatePerGram24k: 'gold', goldRatePerGram22k: 'gold', goldRatePerGram21k: 'gold', goldRatePerGram18k: 'gold',
  palladiumRatePerGram: 'palladium', palladiumRatePerGram18k: 'palladium', palladiumRatePerGram12k: 'palladium',
  platinumRatePerGram: 'platinum', silverRatePerGram: 'silver',
};

/** The one rate a house watches: 21K for a gold house, silver for a silver one. */
export function mainRate(defaultMetal: 'gold' | 'silver'): { key: RateKey; label: string } {
  return defaultMetal === 'silver'
    ? { key: 'silverRatePerGram', label: 'Silver' }
    : { key: 'goldRatePerGram21k', label: '21K' };
}

/**
 * What a saved invoice may write back to the shop's rates: nothing for an edit, and for a new
 * invoice only the boxes typed by hand in this cart, for a metal the sale carries, when the
 * figure is a real rate and differs from the one stored. A rate loaded from an invoice or read
 * off a scanned bill is never "typed" (the cart forgets a box when either sets it).
 */
export function ratesToKeep(o: {
  isNew: boolean;
  typed: ReadonlySet<RateInputKey>;
  inputs: Partial<Record<RateInputKey, string>>;
  metals: ReadonlySet<string>;
  current: Rates;
}): Rates | null {
  if (!o.isNew) return null;
  const out: Rates = {};
  for (const input of o.typed) {
    const key = INPUT_TO_RATE[input];
    if (!key || !o.metals.has(RATE_METAL[key])) continue;
    const v = parseFloat(o.inputs[input] ?? '');
    if (!Number.isFinite(v) || v <= 0) continue;
    if (Math.abs(v - (o.current[key] ?? 0)) < 0.005) continue;
    out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The rate keys in a settings change whose value actually moves. */
export function changedRates(patch: Partial<Settings>, current: Partial<Settings>): RateKey[] {
  return RATE_KEYS.filter(k => {
    const v = patch[k];
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v - ((current[k] as number | undefined) ?? 0)) >= 0.005;
  });
}

/** Karachi's calendar date, yyyy-mm-dd. */
export const karachiDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);

/** Whether the rates were set on Karachi's today. An unknown time is never today. */
export function ratesSetToday(updatedAt: string | undefined | null, now = new Date()): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt);
  return !Number.isNaN(t.getTime()) && karachiDay(t) === karachiDay(now);
}

/** "9:40" today, "Tue 9:40" this week, "28 Sep" before — Karachi time. */
export function whenSet(updatedAt: string | undefined | null, now = new Date()): string {
  if (!updatedAt) return 'not dated';
  const t = new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return 'not dated';
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', hour12: false }).format(t);
  if (karachiDay(t) === karachiDay(now)) return time;
  const days = (now.getTime() - t.getTime()) / 86_400_000;
  if (days < 6) return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short' }).format(t)} ${time}`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' }).format(t);
}
