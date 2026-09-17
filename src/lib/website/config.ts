/**
 * Reading the shop's website settings and today's rates, server-side.
 *
 * Both live in app_settings: the rates in `global` (what every invoice is
 * priced from) and the website's own choices in `website`. Read together so a
 * quote is struck against one consistent moment.
 */

import { adminDb } from '@/lib/firebase-admin';
import { DEFAULT_WEBSITE_CONFIG, WEBSITE_CONFIG_DOC, type WebsiteBankDetails, type WebsiteConfig } from './types';
import type { QuoteRates } from './pricing';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';

export async function loadWebsiteConfig(): Promise<WebsiteConfig> {
  const snap = await adminDb.collection(SETTINGS).doc(WEBSITE_CONFIG_DOC).get();
  const stored = (snap.exists ? snap.data() : {}) as Partial<WebsiteConfig>;
  return {
    ...DEFAULT_WEBSITE_CONFIG,
    ...stored,
    defaultPricing: { ...DEFAULT_WEBSITE_CONFIG.defaultPricing, ...(stored.defaultPricing || {}) },
    categoryPricing: stored.categoryPricing || {},
  };
}

export async function loadRates(): Promise<QuoteRates> {
  const snap = await adminDb.collection(SETTINGS).doc(GLOBAL).get();
  const s = (snap.exists ? snap.data() : {}) as Partial<QuoteRates>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    goldRatePerGram24k: n(s.goldRatePerGram24k), goldRatePerGram22k: n(s.goldRatePerGram22k),
    goldRatePerGram21k: n(s.goldRatePerGram21k), goldRatePerGram18k: n(s.goldRatePerGram18k),
    palladiumRatePerGram: n(s.palladiumRatePerGram), palladiumRatePerGram18k: n(s.palladiumRatePerGram18k), palladiumRatePerGram12k: n(s.palladiumRatePerGram12k),
    platinumRatePerGram: n(s.platinumRatePerGram), silverRatePerGram: n(s.silverRatePerGram),
  };
}

/** A shop that has not set a 21k rate cannot sell anything; say so rather than quote zero. */
export function ratesUsable(r: QuoteRates): boolean {
  return r.goldRatePerGram21k > 0 && r.goldRatePerGram22k > 0 && r.goldRatePerGram18k > 0;
}

/**
 * The account the customer pays into. Environment only — see types.ts. The
 * bank line is "Bank — Account title"; the IBAN carries the rest.
 */
export function bankDetails(env: NodeJS.ProcessEnv = process.env): WebsiteBankDetails {
  const line = (env.NEXT_PUBLIC_STORE_BANK_LINE || '').trim();
  const [bankName = '', accountTitle = ''] = line.split(/\s+[—–-]\s+/, 2);
  return {
    bankName: bankName.trim(),
    accountTitle: (accountTitle || bankName).trim(),
    accountNumber: (env.WEBSITE_BANK_ACCOUNT || '').trim(),
    iban: (env.NEXT_PUBLIC_STORE_IBAN || '').trim(),
    instructions: (env.WEBSITE_BANK_NOTE || '').trim() || undefined,
  };
}

/** Whether the shop has filled in enough to sell. Surfaced to the settings screen and the quote route. */
export function configReadiness(c: WebsiteConfig, bank: WebsiteBankDetails = bankDetails()): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!c.enabled) missing.push('enabled');
  if (!c.posCategoryId) missing.push('posCategoryId');
  if (!(c.defaultPricing.makingChargesPerGram > 0)) missing.push('defaultPricing.makingChargesPerGram');
  if (!bank.bankName || !(bank.iban || bank.accountNumber)) missing.push('bank (NEXT_PUBLIC_STORE_BANK_LINE + NEXT_PUBLIC_STORE_IBAN)');
  return { ready: missing.length === 0, missing };
}
