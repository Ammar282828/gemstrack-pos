/**
 * Settings → Integrations → "Selling on the website": the shop's side of the website checkout, one
 * document (`app_settings/website`, WebsiteConfig in lib/website/types.ts). The one check and the one write,
 * for the browser (components/settings/website-settings.tsx) and the iPhone app (/api/app/write
 * `saveWebsiteConfig`, ops-settings3.ts), both through the server.
 *
 * The whole document is written each time, as the page's form has always saved it: what the form shows is
 * what the site prices from. Every field is checked, because a price on the site is a promise: a wastage of
 * 500 % or a negative making charge typed by mistake would be quoted to a customer at checkout.
 * The bank account is never here (types.ts WebsiteBankDetails: the server's environment only).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { DEFAULT_WEBSITE_CONFIG, WEBSITE_CONFIG_DOC, type WebsiteCategoryPricing, type WebsiteConfig } from '@/lib/website/types';

const SETTINGS = 'app_settings';

/** The karats the form offers for a piece's gold (website-settings.tsx KARATS). */
export const WEBSITE_KARATS = ['18k', '21k', '22k', '24k'] as const;
export const WEBSITE_PALLADIUM_KARATS = ['18k', '12k'] as const;
export const WEBSITE_DIAMOND_POLICIES = ['enquire', 'gold_only'] as const;

/** Beyond any real charge: a figure past these is a typing slip, refused rather than quoted. */
const MAX_RUPEES = 100_000_000;
const MAX_PER_GRAM = 1_000_000;
const MAX_WASTAGE = 100;
/** A month: a rate older than that is never a price. */
const MAX_RATE_AGE_HOURS = 24 * 30;
const MAX_COLLECTIONS = 200;
const MAX_NAME = 100;

export type CleanedWebsiteConfig = { ok: true; config: WebsiteConfig } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const unset = (v: unknown) => v === undefined || v === null || v === '';
/** A number from 0 to `max`, or null when it is not one. */
const amount = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

const PRICING_RULES: { key: keyof Omit<WebsiteCategoryPricing, 'karat'>; max: number; what: string }[] = [
  { key: 'wastagePercentage', max: MAX_WASTAGE, what: 'Wastage is a percentage from 0 to 100.' },
  { key: 'makingChargesPerGram', max: MAX_PER_GRAM, what: 'Making is rupees per gram, 0 or more.' },
  { key: 'stoneChargesDefault', max: MAX_RUPEES, what: 'Stones are rupees per piece, 0 or more.' },
];

/** A collection's own pricing: only the fields it sets, each checked. `whole` asks for every field (the default row). */
function cleanPricing(input: unknown, whole: boolean, where: string): { ok: true; pricing: Partial<WebsiteCategoryPricing> } | { ok: false; error: string } {
  if (!isObject(input)) return fail(`${where}: pricing is a karat and three charges.`);
  const out: Partial<WebsiteCategoryPricing> = {};
  if (!unset(input.karat)) {
    if (!(WEBSITE_KARATS as readonly unknown[]).includes(input.karat)) return fail(`${where}: the karat is 18k, 21k, 22k or 24k.`);
    out.karat = input.karat as WebsiteCategoryPricing['karat'];
  } else if (whole) return fail(`${where}: choose a karat.`);
  for (const r of PRICING_RULES) {
    const v = input[r.key];
    if (unset(v)) {
      if (whole) return fail(`${where}: ${r.what}`);
      continue;
    }
    const n = amount(v, r.max);
    if (n === null) return fail(`${where}: ${r.what}`);
    out[r.key] = n;
  }
  return { ok: true, pricing: out };
}

/** The form's document, checked field by field; anything else posted is dropped. */
export function cleanWebsiteConfig(input: unknown): CleanedWebsiteConfig {
  if (!isObject(input)) return fail('Nothing to save.');
  if (typeof input.enabled !== 'boolean') return fail('Selling is on or off.');

  const def = cleanPricing(input.defaultPricing, true, 'Default pricing');
  if (!def.ok) return def;

  const categoryPricing: Record<string, Partial<WebsiteCategoryPricing>> = {};
  if (!unset(input.categoryPricing)) {
    if (!isObject(input.categoryPricing)) return fail('Per-collection pricing is a list of collections.');
    const entries = Object.entries(input.categoryPricing);
    if (entries.length > MAX_COLLECTIONS) return fail(`Up to ${MAX_COLLECTIONS} collections.`);
    for (const [rawName, row] of entries) {
      const name = rawName.trim();
      // A Firestore field name: no dots or slashes would be safe anywhere it is read back by path.
      if (!name || name.length > MAX_NAME || /[./]/.test(name) || /^__.*__$/.test(name)) return fail(`"${rawName}" is not a collection's name.`);
      if (name in categoryPricing) return fail(`${name} is listed twice.`);
      const p = cleanPricing(row, false, name);
      if (!p.ok) return p;
      categoryPricing[name] = p.pricing;
    }
  }

  if (!(WEBSITE_DIAMOND_POLICIES as readonly unknown[]).includes(input.diamondPolicy)) return fail('Diamond-set pieces are priced on request or by their gold.');
  const diamondChargesDefault = unset(input.diamondChargesDefault) ? 0 : amount(input.diamondChargesDefault, MAX_RUPEES);
  if (diamondChargesDefault === null) return fail('The diamond charge is rupees, 0 or more.');

  if (!(WEBSITE_PALLADIUM_KARATS as readonly unknown[]).includes(input.palladiumKarat)) return fail('Palladium is sold at 18k or 12k.');

  const deliveryCharge = unset(input.deliveryCharge) ? 0 : amount(input.deliveryCharge, MAX_RUPEES);
  if (deliveryCharge === null) return fail('The delivery charge is rupees, 0 or more.');

  // Optional: none (or 0, the form's empty box) leaves it out, as the page does.
  let freeDeliveryOver: number | undefined;
  if (!unset(input.freeDeliveryOver) && input.freeDeliveryOver !== 0) {
    const n = amount(input.freeDeliveryOver, MAX_RUPEES);
    if (n === null) return fail('Free delivery over is rupees, 0 or more.');
    freeDeliveryOver = n;
  }

  let maxRateAgeHours: number | undefined;
  if (!unset(input.maxRateAgeHours) && input.maxRateAgeHours !== 0) {
    const n = amount(input.maxRateAgeHours, MAX_RATE_AGE_HOURS);
    if (n === null || n < 1) return fail(`The rate is fresh for 1 to ${MAX_RATE_AGE_HOURS} hours.`);
    maxRateAgeHours = n;
  }

  const posCategoryId = unset(input.posCategoryId) ? '' : input.posCategoryId;
  if (typeof posCategoryId !== 'string' || posCategoryId.length > MAX_NAME || posCategoryId.includes('/')) return fail('The ERP category is one of the stock categories.');

  const config: WebsiteConfig = {
    enabled: input.enabled,
    currency: DEFAULT_WEBSITE_CONFIG.currency,
    defaultPricing: def.pricing as WebsiteCategoryPricing,
    categoryPricing,
    diamondPolicy: input.diamondPolicy as WebsiteConfig['diamondPolicy'],
    diamondChargesDefault,
    palladiumKarat: input.palladiumKarat as WebsiteConfig['palladiumKarat'],
    deliveryCharge,
    ...(freeDeliveryOver !== undefined && { freeDeliveryOver }),
    ...(maxRateAgeHours !== undefined && { maxRateAgeHours }),
    posCategoryId: posCategoryId.trim(),
  };
  return { ok: true, config };
}

/** The top-level settings that differ, for the log: names only, as Settings changed says them. */
export function websiteConfigChanges(before: Partial<WebsiteConfig> | null, after: WebsiteConfig): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)].filter((k) => k !== 'updatedAt' && k !== 'id'));
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  return [...keys].filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null)).sort();
}

/** Writes the whole document, stamped, and logs what moved (the switch by name: it starts or stops selling). */
export async function setWebsiteConfig(
  db: DbPort,
  config: WebsiteConfig,
  opts: { by: string; now?: Date },
  fx: SideEffects = {},
): Promise<{ config: WebsiteConfig; changed: string[] }> {
  const before = await db.get<Partial<WebsiteConfig>>(SETTINGS, WEBSITE_CONFIG_DOC);
  const saved: WebsiteConfig = { ...config, updatedAt: (opts.now ?? new Date()).toISOString() };
  const b = db.batch();
  b.set(SETTINGS, WEBSITE_CONFIG_DOC, saved as unknown as Record<string, unknown>, false);
  await b.commit();
  const changed = websiteConfigChanges(before, config);
  const switched = !!before?.enabled !== config.enabled;
  const title = switched ? (config.enabled ? 'Website selling turned on' : 'Website selling turned off') : 'Website settings saved';
  const detail = [changed.length ? changed.join(', ') : 'nothing changed', `by ${opts.by}`].join(' · ');
  void Promise.resolve(fx.log?.('settings.website', title, detail, WEBSITE_CONFIG_DOC)).catch(() => undefined);
  return { config: saved, changed };
}
