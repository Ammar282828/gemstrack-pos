import { describe, expect, it } from 'vitest';
import { detectDuplicates, nameSimilarity, normalizeName, normalizePhone } from './customer-duplicates';

// All names and numbers made up.
const person = (id: string, name: string, phone?: string) => ({ id, name, phone });

describe('reading a name and a number', () => {
  it('compares names without case or extra spaces, and numbers by their digits without leading zeros', () => {
    expect(normalizeName('  Demo   Customer ')).toBe('demo customer');
    expect(normalizePhone('0300-1234567')).toBe('3001234567');
    expect(normalizePhone('+92 300 1234567')).toBe('923001234567');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('how alike two names are', () => {
  it('is 1 for the same name, 0.9 for one inside the other, else the share of words they have in common', () => {
    expect(nameSimilarity('Demo Customer', 'demo  CUSTOMER')).toBe(1);
    expect(nameSimilarity('Demo Customer', 'Demo Customer Two')).toBe(0.9);
    expect(nameSimilarity('Demo Alpha Customer', 'Demo Beta Customer')).toBeCloseTo(2 / 3, 10);
    expect(nameSimilarity('Alpha', 'Beta')).toBe(0);
  });

  it('is 0 when either name is blank, where the page found a blank inside every name', () => {
    expect(nameSimilarity('', 'Demo Customer')).toBe(0);
    expect(nameSimilarity('Demo Customer', '   ')).toBe(0);
    expect(nameSimilarity(null, undefined)).toBe(0);
    expect(nameSimilarity('', '')).toBe(0);
  });
});

describe('duplicate pairs', () => {
  it('pairs two customers who share a number, however it is written', () => {
    const pairs = detectDuplicates([person('c1', 'Demo One', '0300 1112223'), person('c2', 'Someone Else', '03001112223'), person('c3', 'Third Person', '0311 9998887')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ reason: 'Same phone number', score: 1 });
    expect([pairs[0].a.id, pairs[0].b.id]).toEqual(['c1', 'c2']);
  });

  it('pairs names that are 85% alike, with the percentage in the reason, best first', () => {
    const pairs = detectDuplicates([
      person('c1', 'Demo Customer Two'),
      person('c2', 'Demo Customer'),
      person('c3', 'demo customer two'),
      person('c4', 'Quite Different'),
    ]);
    expect(pairs.map((p) => [p.a.id, p.b.id, p.reason])).toEqual([
      ['c1', 'c3', 'Similar name (100% match)'],
      ['c1', 'c2', 'Similar name (90% match)'],
      ['c2', 'c3', 'Similar name (90% match)'],
    ]);
  });

  it('offers a pair once, by its number if it shares one, and not at all when nothing is alike', () => {
    const same = detectDuplicates([person('c1', 'Demo Customer', '0300 1112223'), person('c2', 'Demo Customer', '0300 1112223')]);
    expect(same).toHaveLength(1);
    expect(same[0].reason).toBe('Same phone number');
    expect(detectDuplicates([person('c1', 'Alpha Person', '0300 1112223'), person('c2', 'Beta Human', '0300 4445556')])).toEqual([]);
    expect(detectDuplicates([])).toEqual([]);
  });

  it('does not pair an unnamed record with everyone', () => {
    expect(detectDuplicates([person('c1', ''), person('c2', 'Demo Customer'), person('c3', 'Another Person')])).toEqual([]);
  });

  it('keeps the people it was given', () => {
    const list = [{ id: 'c1', name: 'Demo Customer', phone: '', city: 'Demo City' }, { id: 'c2', name: 'Demo Customer', phone: undefined, city: 'Other City' }];
    const [pair] = detectDuplicates(list);
    expect(pair.a.city).toBe('Demo City');
    expect(pair.b.city).toBe('Other City');
  });
});
