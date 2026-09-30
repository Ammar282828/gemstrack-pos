import { describe, expect, it } from 'vitest';
import { changedRates, mainRate, ratesSetToday, ratesToKeep, whenSet, type RateInputKey } from './rates';

const current = { goldRatePerGram21k: 26_000, goldRatePerGram18k: 22_000, silverRatePerGram: 250 };
const keep = (o: Partial<Parameters<typeof ratesToKeep>[0]>) => ratesToKeep({
  isNew: true, typed: new Set<RateInputKey>(), inputs: {}, metals: new Set(['gold']), current, ...o,
});

describe('what a saved invoice writes back to the shop\'s rates', () => {
  it('an edited invoice writes nothing — it carries its own old rates', () => {
    expect(keep({ isNew: false, typed: new Set(['gold21k']), inputs: { gold21k: '24000' } })).toBeNull();
  });
  it('a new invoice writes only the boxes typed by hand', () => {
    expect(keep({ typed: new Set(['gold21k']), inputs: { gold21k: '26250.00', gold18k: '21000' } }))
      .toEqual({ goldRatePerGram21k: 26_250 });
  });
  it('nothing typed (rates as loaded, or read off a scanned bill) writes nothing', () => {
    expect(keep({ inputs: { gold21k: '24000' } })).toBeNull();
  });
  it('skips a metal the sale does not carry, a blank or zero box, and an unchanged figure', () => {
    expect(keep({ typed: new Set(['silver']), inputs: { silver: '260' } })).toBeNull();
    expect(keep({ typed: new Set(['gold21k']), inputs: { gold21k: '' } })).toBeNull();
    expect(keep({ typed: new Set(['gold21k']), inputs: { gold21k: '0' } })).toBeNull();
    expect(keep({ typed: new Set(['gold21k']), inputs: { gold21k: '26000.00' } })).toBeNull();
  });
});

describe('the rate a house watches', () => {
  it('is 21K for gold and silver for silver', () => {
    expect(mainRate('gold')).toEqual({ key: 'goldRatePerGram21k', label: '21K' });
    expect(mainRate('silver')).toEqual({ key: 'silverRatePerGram', label: 'Silver' });
  });
  it('a change counts only the rates that move', () => {
    expect(changedRates({ goldRatePerGram21k: 26_000, goldRatePerGram18k: 21_500, shopName: 'x' }, current)).toEqual(['goldRatePerGram18k']);
    expect(changedRates({ shopName: 'x' }, current)).toEqual([]);
  });
});

describe('when the rate was set, in Karachi', () => {
  const now = new Date('2026-10-01T10:00:00Z'); // 15:00 in Karachi
  it('today is Karachi\'s today, not UTC\'s', () => {
    expect(ratesSetToday('2026-09-30T19:30:00Z', now)).toBe(true); // 00:30 on the 1st in Karachi
    expect(ratesSetToday('2026-09-30T18:30:00Z', now)).toBe(false); // 23:30 on the 30th
    expect(ratesSetToday(undefined, now)).toBe(false);
    expect(ratesSetToday('nonsense', now)).toBe(false);
  });
  it('reads as a time today, a weekday this week, a date before', () => {
    expect(whenSet('2026-10-01T04:40:00Z', now)).toBe('9:40'); // as the owner wrote it: 21K 26,250 · 9:40 Ammar
    expect(whenSet('2026-09-29T04:40:00Z', now)).toBe('Tue 9:40');
    expect(whenSet('2026-09-20T04:40:00Z', now)).toMatch(/^20 Sep/); // ICU: Sep or Sept
    expect(whenSet(undefined, now)).toBe('not dated');
  });
});
