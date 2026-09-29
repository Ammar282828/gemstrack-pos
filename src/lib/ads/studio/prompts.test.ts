import { describe, it, expect } from 'vitest';
import { breaksHouseRule, figuresIn, inventedFigures } from './prompts';

describe('breaksHouseRule', () => {
  it('lets prices, specs and direct calls to action through (the owner, 2026-09-29)', () => {
    expect(breaksHouseRule('21K yellow gold, 45.350 g — Rs 612,000. Shop now or call 0326 2275554.')).toBe(false);
    expect(breaksHouseRule('Only two left — message us today.')).toBe(false);
    expect(breaksHouseRule('VS1 diamonds, GIA certified, 1.2 ct.')).toBe(false);
  });
  it('still stops sale and discount language, and hashtags', () => {
    expect(breaksHouseRule('Eid sale on now')).toBe(true);
    expect(breaksHouseRule('20% off every bangle')).toBe(true);
    expect(breaksHouseRule('Discounted this week')).toBe(true);
    expect(breaksHouseRule('Heirloom gold #taheri')).toBe(true);
  });
  it('does not trip on words that only contain them', () => {
    expect(breaksHouseRule('Wholesale-free, made by hand')).toBe(false);
  });
});

describe('figures', () => {
  it('reads karats, weights, carats and rupees', () => {
    expect(figuresIn('21K gold, 45.35 gm, 1.2 carats, Rs. 612,000')).toEqual(['21k', '45.35gm', '1.2carats', 'rs.612,000']);
  });
  it('a figure the facts hold is not invented, however it is written', () => {
    expect(inventedFigures('A 45.35 g bangle in 21 karat gold', '21K Yellow Gold · Ruby · 45.350g')).toEqual([]);
  });
  it('a figure the facts do not hold is', () => {
    expect(inventedFigures('A 48 g bangle in 22K gold for Rs 600,000', '21K Yellow Gold · 45.350g')).toEqual(['48g', '22k', 'rs600,000']);
  });
  it('with no facts, every figure is invented', () => {
    expect(inventedFigures('Only 18k here', '')).toEqual(['18k']);
  });
});
