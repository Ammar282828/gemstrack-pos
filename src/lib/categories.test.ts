import { describe, expect, it } from 'vitest';
import { guessCategory, lineCategory } from './categories';

describe('lineCategory', () => {
  it('takes the line\'s own, then the order\'s, then the name', () => {
    expect(lineCategory({ categoryId: 'cat001', itemCategory: 'cat007', name: 'Bangle' })).toBe('cat001');
    expect(lineCategory({ categoryId: '', itemCategory: 'cat007', name: 'Ring' })).toBe('cat007');
    expect(lineCategory({ categoryId: '', name: 'Cat’s eye ring' })).toBe('cat001');
    expect(lineCategory({ name: 'Custom from sample' })).toBeUndefined();
  });
});

describe('guessCategory', () => {
  const cases: [string, string | undefined][] = [
    ['Necklace', 'cat013'], ['Jhumki', 'cat002'], ['2 Pairs Custom Earrings', 'cat002'], ['String Set', 'cat012'],
    ['Multi Colour Bangle & Ring', 'cat006'], ['CNC bangles', 'cat007'], ['6 bangle stack', 'cat007'], ['CNC band', 'cat009'],
    ['ruby lari bracelet', 'cat005'], ['Plain Gold Loose Bracelet', 'cat019'], ['Plain Gold ‘H’ Locket', 'cat004'],
    ['Pink Ruby Ring', 'cat001'], ["Men's Ring", 'cat018'], ['ARY 1g', 'cat017'], ['Multi Stone Thakti', 'cat004'],
    ['Earrings and Necklace NN', 'cat013'], ['Plain Gold', undefined], ['Use onyx', undefined],
  ];
  for (const [name, want] of cases) it(name, () => expect(guessCategory(name)).toBe(want));
});
