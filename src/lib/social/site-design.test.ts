import { describe, expect, it } from 'vitest';
import { showsWeight, siteDetailsLine, siteLayouts, siteStartLayout } from './site-design';

const ids = (xs: { id: string }[]) => xs.map(x => x.id);

describe('the layouts a website photo offers', () => {
  it('gives each house its own marks, and starts with nothing added', () => {
    expect(ids(siteLayouts('taheri', true))).toEqual(['clean', 'weight', 'catalogue-top', 'catalogue', 'catalogue-t', 'name']);
    expect(ids(siteLayouts('mina', false))).toEqual(['clean', 'mark', 'catalogue-top', 'weight', 'name']);
  });

  it('offers the t only where the house has one', () => {
    expect(ids(siteLayouts('taheri', false))).not.toContain('catalogue-t');
    expect(ids(siteLayouts('mina', true))).not.toContain('catalogue-t');
  });
});

describe('where a design starts', () => {
  const taheri = { photoSource: null, sourceMarked: false };
  const catalogue = { photoSource: 'https://cdn.shopify.com/s/files/ring.jpg', sourceMarked: false };

  it('leaves taheri.shop’s photo as it is, or keeps the weight the page was stamping', () => {
    expect(siteStartLayout('taheri', taheri)).toBe('clean');
    expect(siteStartLayout('taheri', taheri, true)).toBe('weight');
  });

  it('puts the MINA mark back on the catalogue’s unmarked photo', () => {
    expect(siteStartLayout('mina', catalogue)).toBe('mark');
    expect(siteStartLayout('mina', catalogue, true)).toBe('catalogue-top');
  });

  it('adds no second mark to a photo that has one', () => {
    expect(siteStartLayout('mina', { ...catalogue, sourceMarked: true })).toBe('clean');
    expect(siteStartLayout('mina', { photoSource: null, sourceMarked: false })).toBe('clean');
  });
});

describe('the weight and the line under the name', () => {
  it('knows which layouts show the weight', () => {
    expect(showsWeight('clean')).toBe(false);
    expect(showsWeight('mark')).toBe(false);
    expect(showsWeight('weight')).toBe(true);
    expect(showsWeight('name')).toBe(true);
  });

  it('writes the metal and the weight, and no metal for The Maisons', () => {
    expect(siteDetailsLine('Rings', '21K Yellow Gold', '12.4g')).toBe('21K Yellow Gold | 12.4g');
    expect(siteDetailsLine('Rings', '21K Yellow Gold', '')).toBe('21K Yellow Gold');
    expect(siteDetailsLine('The Maisons', '21K Yellow Gold', '40.1g')).toBe('40.1g');
  });
});
