import { describe, expect, it } from 'vitest';
import { buildFacets, catalogueMatches, idList, matchesFacets, pieceStones, pieceType } from './catalogue-facets';

const piece = (collection: string, name: string, words: Record<string, unknown> = {}) =>
  ({ collection, id: `Group/${collection}/${name}.webp`, name, words: { name, ...words } as never });

describe('pieceType', () => {
  it('reads the collection first', () => {
    expect(pieceType(piece('Diamond Rings', 'Piece 12'))).toBe('ring');
    expect(pieceType(piece('Bangles', 'Piece 3'))).toBe('bangle');
    expect(pieceType(piece('Bracelets', 'Tennis'))).toBe('bracelet');
    expect(pieceType(piece('Pendants', 'Heart'))).toBe('pendant');
    expect(pieceType(piece('Necklaces', 'Choker'))).toBe('necklace');
    expect(pieceType(piece('Chains', 'Rope'))).toBe('chain');
    expect(pieceType(piece('Nose Pins', 'Dot'))).toBe('nosepin');
  });
  it('ear rings and studs are earrings, not rings; a set is a set', () => {
    expect(pieceType(piece('Collection', 'Ruby ear rings'))).toBe('earrings');
    expect(pieceType(piece('Collection', 'Pearl studs'))).toBe('earrings');
    expect(pieceType(piece('Bridal Sets', 'Ruby ring and earrings set'))).toBe('set');
    expect(pieceType(piece('Collection', 'Locket'))).toBe('pendant');
  });
  it('"set with" is a setting, not a set', () => {
    expect(pieceType(piece('Collection', 'Ring set with ruby'))).toBe('ring');
  });
  it('falls back to the name, then the site words, then other', () => {
    expect(pieceType(piece('New in', 'Emerald pendant'))).toBe('pendant');
    expect(pieceType(piece('New in', 'Piece 4', { facts: ['Kada pair'] }))).toBe('bangle');
    expect(pieceType(piece('New in', 'Piece 5'))).toBe('other');
  });
});

describe('pieceStones', () => {
  it('finds stones in the title, collection and words, folding plurals and spellings', () => {
    expect(pieceStones(piece('Rings', 'Ruby ring'))).toEqual(['ruby']);
    expect(pieceStones(piece('Ruby Rings', 'Piece 1'))).toEqual(['ruby']);
    expect(pieceStones(piece('Rings', 'Piece 1', { stone: 'Rubies and diamonds' }))).toEqual(['diamond', 'ruby']);
    expect(pieceStones(piece('Rings', 'Feroza ring'))).toEqual(['turquoise']);
    expect(pieceStones(piece('Rings', 'Panna and moti set'))).toEqual(['emerald', 'pearl']);
    expect(pieceStones(piece('Rings', 'Polki kundan haar'))).toEqual(['polki', 'kundan']);
    expect(pieceStones(piece('Rings', 'Moissanite solitaire'))).toEqual(['diamond', 'moissanite']);
  });
  it('American diamond is zircon, not diamond; mother of pearl is not pearl', () => {
    expect(pieceStones(piece('Rings', 'American diamond ring'))).toEqual(['zircon']);
    expect(pieceStones(piece('Rings', 'Cubic Zirconia ring'))).toEqual(['zircon']);
    expect(pieceStones(piece('Rings', 'Mother of pearl pendant'))).toEqual(['mother-of-pearl']);
  });
  it('plain pieces have none', () => {
    expect(pieceStones(piece('Bangles', 'Plain kara'))).toEqual([]);
  });
});

const set = [
  piece('Rings', 'Ruby diamond ring'),
  piece('Rings', 'Emerald ring'),
  piece('Bangles', 'Ruby bangle'),
  piece('Pendants', 'Pearl pendant'),
  piece('Bangles', 'Plain kara'),
];

describe('matchesFacets', () => {
  it('a piece must be one of the types and have every stone', () => {
    const pick = (types: string[], stones: string[]) => set.filter(p => matchesFacets(p, types, stones)).map(p => p.name);
    expect(pick([], [])).toHaveLength(5);
    expect(pick(['ring'], [])).toEqual(['Ruby diamond ring', 'Emerald ring']);
    expect(pick(['ring', 'bangle'], ['ruby'])).toEqual(['Ruby diamond ring', 'Ruby bangle']);
    expect(pick([], ['ruby', 'diamond'])).toEqual(['Ruby diamond ring']);
    expect(pick(['pendant'], ['ruby'])).toEqual([]);
  });
});

describe('catalogueMatches', () => {
  it('every word must match the title, collection, words, stones or type', () => {
    expect(catalogueMatches(set[0], 'ruby ring')).toBe(true);
    expect(catalogueMatches(set[0], 'ruby pendant')).toBe(false);
    expect(catalogueMatches(set[2], 'ruby bangles')).toBe(true);
    expect(catalogueMatches(set[0], '')).toBe(true);
  });
  it('finds a stone by its folded name though the title never says it', () => {
    const p = piece('Rings', 'Piece 9', { stone: 'Manik' });
    expect(catalogueMatches(p, 'rubies')).toBe(true);
    expect(catalogueMatches(p, 'emeralds')).toBe(false);
  });
  it('searches the site words and the key', () => {
    expect(catalogueMatches(piece('Rings', 'Piece 9', { style: 'Solitaire' }), 'solitaire')).toBe(true);
    expect(catalogueMatches(piece('Rings', 'Piece 9'), 'piece 9')).toBe(true);
  });
});

describe('buildFacets', () => {
  it('counts types and stones, most first, other last', () => {
    const f = buildFacets([...set, piece('New', 'Piece 7')]);
    expect(f.types).toEqual([
      { id: 'bangle', label: 'Bangle', count: 2 }, { id: 'ring', label: 'Ring', count: 2 }, { id: 'pendant', label: 'Pendant', count: 1 }, { id: 'other', label: 'Other', count: 1 },
    ]);
    expect(f.stones).toEqual([
      { id: 'ruby', label: 'Ruby', count: 2 }, { id: 'diamond', label: 'Diamond', count: 1 }, { id: 'emerald', label: 'Emerald', count: 1 }, { id: 'pearl', label: 'Pearl', count: 1 },
    ]);
  });
});

describe('idList', () => {
  it('splits, trims, lowercases and drops repeats', () => {
    expect(idList(' Ring,bangle,,RING ')).toEqual(['ring', 'bangle']);
    expect(idList(null)).toEqual([]);
    expect(idList(['A', 'b'])).toEqual(['a', 'b']);
  });
});
