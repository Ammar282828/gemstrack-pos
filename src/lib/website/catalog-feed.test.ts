import { describe, it, expect } from 'vitest';
import { catalogFeedCsv, feedId } from './catalog-feed';

const piece = (over: Record<string, unknown> = {}) => ({
  id: 'Wristwear/Bangle/DSC1.jpg', name: 'Bangle, "gold"', url: 'https://taheri.shop/bangle/dsc1', image: 'https://taheri.shop/a.webp', thumb: '',
  collection: 'Bangle', weightGrams: 14.4, facts: ['Meena Kari'], about: 'A bangle.', photos: [], ...over,
}) as never;

describe('catalogFeedCsv', () => {
  it('lists each shown piece at price 0, quoting commas and quotes', () => {
    const lines = catalogFeedCsv([piece(), piece({ id: 'x', hidden: true })], 'Taheri').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`${feedId('Wristwear/Bangle/DSC1.jpg')},"Bangle, ""gold""",A bangle. 14.4 g · Meena Kari. Message us for today's price.,in stock,new,0.00 PKR,`);
  });
  it('gives a stable id of 24 characters', () => {
    expect(feedId('a')).toBe(feedId('a'));
    expect(feedId('a')).toHaveLength(24);
  });
});
