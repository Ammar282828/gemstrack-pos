import { describe, expect, it } from 'vitest';
import { profileSizesOf, sameSize, sizeSuggestions } from './customer-sizes';

describe('a piece’s size, for the customer’s profile', () => {
  it('reads rings, bangles and bracelets by category, and sets by their parts', () => {
    expect(profileSizesOf('cat001', '12')).toEqual({ ringSize: '12' });
    expect(profileSizesOf('cat009', '20.5')).toEqual({ ringSize: '20.5' });
    expect(profileSizesOf('cat007', '2.4')).toEqual({ bangleSize: '2.4' });
    expect(profileSizesOf('cat005', '2.6')).toEqual({ braceletSize: '2.6' });
    expect(profileSizesOf('cat011', 'Ring: 10 · Bangle: 2.4')).toEqual({ ringSize: '10', bangleSize: '2.4' });
    expect(profileSizesOf('cat006', '2.2')).toEqual({ braceletSize: '2.2' }); // a size from before the set had two parts
  });

  it('ignores what is not a ring, bangle or bracelet', () => {
    expect(profileSizesOf('cat012', '18"')).toEqual({});
    expect(profileSizesOf('cat002', '12')).toEqual({});
    expect(profileSizesOf('cat001', '')).toEqual({});
  });

  it('compares sizes the way the counter writes them', () => {
    expect(sameSize('12', ' 12.0 ')).toBe(true);
    expect(sameSize('US 6', 'us  6')).toBe(true);
    expect(sameSize('12', '12.5')).toBe(false);
  });

  it('asks only for what the profile does not hold, once', () => {
    const items = [{ itemCategory: 'cat001', size: '12' }, { itemCategory: 'cat007', size: '2.4' }];
    expect(sizeSuggestions('c1', { ringSize: '12' }, items).map(s => s.field)).toEqual(['bangleSize']);
    expect(sizeSuggestions('c1', { ringSize: '12', bangleSize: '2.4' }, items)).toEqual([]);
    const changed = sizeSuggestions('c1', { ringSize: '11' }, items);
    expect(changed.find(s => s.field === 'ringSize')).toMatchObject({ value: '12', current: '11' });
    const decided = new Set(changed.map(s => s.key));
    expect(sizeSuggestions('c1', { ringSize: '11' }, items, decided)).toEqual([]);
    expect(sizeSuggestions('c2', { ringSize: '11' }, items, decided)).toHaveLength(2); // another customer is asked again
  });
});
