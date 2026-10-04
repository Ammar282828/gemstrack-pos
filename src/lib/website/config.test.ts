import { describe, it, expect } from 'vitest';
import { bankComplete, bankDetails, configReadiness, ratesFresh } from './config';
import { DEFAULT_WEBSITE_CONFIG } from './types';

describe('bankDetails', () => {
  it('reads the bank line and IBAN from the environment, splitting bank from title', () => {
    const b = bankDetails({ NEXT_PUBLIC_STORE_BANK_LINE: 'Meezan Bank — Taheri Jewellers', NEXT_PUBLIC_STORE_IBAN: 'PK00MEZN0000000000000000' } as unknown as NodeJS.ProcessEnv);
    expect(b).toMatchObject({ bankName: 'Meezan Bank', accountTitle: 'Taheri Jewellers', iban: 'PK00MEZN0000000000000000' });
  });
  it('takes a line with no bank as the title alone, and the bank from WEBSITE_BANK_NAME — never the title as the bank', () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(bankDetails(env({ NEXT_PUBLIC_STORE_BANK_LINE: 'Taheri Collections' }))).toMatchObject({ bankName: '', accountTitle: 'Taheri Collections' });
    expect(bankDetails(env({ NEXT_PUBLIC_STORE_BANK_LINE: 'Taheri Collections', WEBSITE_BANK_NAME: 'Meezan Bank' }))).toMatchObject({ bankName: 'Meezan Bank', accountTitle: 'Taheri Collections' });
  });
  it('is empty, not undefined, when nothing is set — and selling does not wait for it (the shop sends it on WhatsApp)', () => {
    const empty = bankDetails({} as unknown as NodeJS.ProcessEnv);
    expect(empty).toMatchObject({ bankName: '', iban: '' });
    expect(bankComplete(empty)).toBe(false);
    expect(bankComplete({ bankName: 'Meezan Bank', accountTitle: 'T', iban: 'PK00', accountNumber: '' })).toBe(true);
    const r = configReadiness({ ...DEFAULT_WEBSITE_CONFIG, enabled: true, posCategoryId: 'x', defaultPricing: { ...DEFAULT_WEBSITE_CONFIG.defaultPricing, makingChargesPerGram: 1 } });
    expect(r.ready).toBe(true);
  });
});

describe('ratesFresh', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  it('sells at a rate set in the last 36 hours, or the shop\'s own limit', () => {
    expect(ratesFresh('2026-10-03T13:00:00Z', {}, now)).toBe(true);
    expect(ratesFresh('2026-09-30T21:38:50Z', {}, now)).toBe(false);
    expect(ratesFresh('2026-10-03T13:00:00Z', { maxRateAgeHours: 12 }, now)).toBe(false);
    expect(ratesFresh(null, {}, now)).toBe(false);
  });
});
