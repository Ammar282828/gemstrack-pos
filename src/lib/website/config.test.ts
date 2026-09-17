import { describe, it, expect } from 'vitest';
import { bankDetails, configReadiness } from './config';
import { DEFAULT_WEBSITE_CONFIG } from './types';

describe('bankDetails', () => {
  it('reads the bank line and IBAN from the environment, splitting bank from title', () => {
    const b = bankDetails({ NEXT_PUBLIC_STORE_BANK_LINE: 'Meezan Bank — Taheri Jewellers', NEXT_PUBLIC_STORE_IBAN: 'PK00MEZN0000000000000000' } as unknown as NodeJS.ProcessEnv);
    expect(b).toMatchObject({ bankName: 'Meezan Bank', accountTitle: 'Taheri Jewellers', iban: 'PK00MEZN0000000000000000' });
  });
  it('is empty, not undefined, when nothing is set — so readiness can say what is missing', () => {
    expect(bankDetails({} as unknown as NodeJS.ProcessEnv)).toMatchObject({ bankName: '', iban: '' });
    const r = configReadiness({ ...DEFAULT_WEBSITE_CONFIG, enabled: true, posCategoryId: 'x', defaultPricing: { ...DEFAULT_WEBSITE_CONFIG.defaultPricing, makingChargesPerGram: 1 } }, bankDetails({} as unknown as NodeJS.ProcessEnv));
    expect(r.ready).toBe(false);
    expect(r.missing.join()).toContain('bank');
  });
});
