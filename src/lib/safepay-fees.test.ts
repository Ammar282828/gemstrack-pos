import { afterEach, describe, expect, it, vi } from 'vitest';
import { chargeOf, feeExpense, feesByMonth, isSafepaySecret, openSecret, sealSecret } from './safepay-fees';

// A real charge's shape (House of Mina, 9 Nov 2026), in paisa.
const record = (tracker: string, seconds: number, gross: number, fees: number, tax: number, wh = 0) => ({ data: { charge: {
  tracker, created_at: { seconds }, amount: { currency: 'PKR', amount: gross }, fees: { currency: 'PKR', amount: fees }, tax: { currency: 'PKR', amount: tax },
  net: { currency: 'PKR', amount: gross - fees - wh },
  withholding_tax: { sales_tax_withholding: { amount: 0 }, income_tax_withholding: { amount: wh }, digital_presence_tax: { amount: 0 } },
} } });

describe('Safepay fees as expenses', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads a charge in rupees', () => {
    expect(chargeOf(record('track_a', 1794217766, 515000, 20625, 2690))).toMatchObject({ tracker: 'track_a', gross: 5150, fees: 206.25, taxOnFee: 26.9, net: 4943.75, incomeTaxWithheld: 0 });
    expect(chargeOf({ data: {} })).toBeNull();
  });

  it('a month to one expense: the fee with its tax, and any withholding, whole rupees, its id the month', () => {
    const charges = [
      chargeOf(record('track_a', 1794217766, 515000, 20625, 2690))!,          // 9 Nov 2026
      chargeOf(record('track_b', 1794202632, 1800000, 63480, 8280, 10000))!,   // 9 Nov 2026, with 100 withheld
      chargeOf(record('track_c', 1793000000, 635000, 24627, 3212))!,           // Oct 2026
    ];
    const months = feesByMonth(charges);
    expect(months.map(m => m.month)).toEqual(['2026-10', '2026-11']);
    const nov = months[1];
    expect(nov).toMatchObject({ payments: 2, gross: 23150, fees: 841.05, taxOnFee: 109.7, withheld: 100 });
    const e = feeExpense(nov, new Date('2026-11-10T00:00:00Z'));
    expect(e).toMatchObject({ id: 'safepay-fees-2026-11', category: 'Payment Fees', amount: 941, date: '2026-11-10T00:00:00.000Z' });
    expect(e.description).toMatch(/^Safepay, November 2026: 2 card payments of PKR 23,150; fees 841.05 \(tax on the fee 109.7\); tax withheld 100$/);
    expect(feeExpense(months[0], new Date('2026-11-10T00:00:00Z')).date).toBe('2026-10-31T12:00:00.000Z');
  });

  it('keeps the secret sealed with the server\'s own key', () => {
    vi.stubEnv('CRON_SECRET', 'server-only');
    const key = 'ca'.padEnd(64, '0');
    expect(isSafepaySecret(key)).toBe(true);
    expect(isSafepaySecret('sec_0050837b')).toBe(false);
    const sealed = sealSecret(key);
    expect(sealed).not.toContain(key);
    expect(openSecret(sealed)).toBe(key);
    vi.stubEnv('CRON_SECRET', 'another-server');
    expect(openSecret(sealed)).toBeNull();
  });
});
