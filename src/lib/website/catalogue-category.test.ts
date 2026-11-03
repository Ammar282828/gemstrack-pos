import { describe, expect, it } from 'vitest';
import { catalogueImageUrl } from './catalogue-image';
import { pieceInCategory, pieceMatches, resolveCategoryId } from './catalogue-category';

const piece = (collection: string, name = 'Piece 1') => ({ collection, id: `Group/${collection}/${name}.webp`, name });

describe('resolveCategoryId', () => {
  it('reads an id (cat001), a title or a singular; unknown and empty are undefined', () => {
    expect(resolveCategoryId('cat001')).toBe('cat001');
    expect(resolveCategoryId('Rings')).toBe('cat001');
    expect(resolveCategoryId('bangle')).toBe('cat007');
    expect(resolveCategoryId('nonsense')).toBeUndefined();
    expect(resolveCategoryId('')).toBeUndefined();
  });
});

describe('pieceInCategory', () => {
  it('maps ERP category ids to the site collections', () => {
    expect(pieceInCategory(piece('Rings'), 'cat001')).toBe(true);
    expect(pieceInCategory(piece('Diamond Rings'), 'cat001')).toBe(true);
    expect(pieceInCategory(piece('Bangles'), 'cat001')).toBe(false);
    expect(pieceInCategory(piece('Bangles'), 'cat007')).toBe(true);
    expect(pieceInCategory(piece('Bracelets'), 'cat005')).toBe(true);
    expect(pieceInCategory(piece('Bands'), 'cat009')).toBe(true);
    expect(pieceInCategory(piece('Chains'), 'cat008')).toBe(true);
  });
  it("keeps a gents ring out of Rings and in Men's Rings", () => {
    expect(pieceInCategory(piece('Gents Ruby Rings'), 'cat001')).toBe(false);
    expect(pieceInCategory(piece('Gents Ruby Rings'), 'cat018')).toBe(true);
  });
  it('returns every piece when the category is empty or unknown', () => {
    expect(pieceInCategory(piece('Chains'), '')).toBe(true);
    expect(pieceInCategory(piece('Chains'), undefined)).toBe(true);
    expect(pieceInCategory(piece('Chains'), 'zzz')).toBe(true);
  });
});

describe('pieceMatches', () => {
  it('needs every typed word in the title, collection or key', () => {
    expect(pieceMatches(piece('Rings', 'Ring 12'), 'ring 12')).toBe(true);
    expect(pieceMatches(piece('Rings', 'Ring 12'), 'group 12')).toBe(true);
    expect(pieceMatches(piece('Rings', 'Ring 12'), 'bangle')).toBe(false);
    expect(pieceMatches(piece('Rings'), '  ')).toBe(true);
  });
});

describe('catalogueImageUrl', () => {
  const site = 'https://shop.example.com';
  it('allows the site\'s own pictures only', () => {
    expect(catalogueImageUrl('https://shop.example.com/catalog-full/Rings/Ring%201.webp', site)).not.toBeNull();
    expect(catalogueImageUrl('https://evil.example.org/a.webp', site)).toBeNull();
    expect(catalogueImageUrl('http://shop.example.com/a.webp', site)).toBeNull();
    expect(catalogueImageUrl('https://shop.example.com:8443/a.webp', site)).toBeNull();
    expect(catalogueImageUrl('https://user@shop.example.com/a.webp', site)).toBeNull();
    expect(catalogueImageUrl('https://shop.example.com/page.html', site)).toBeNull();
    expect(catalogueImageUrl('not a url', site)).toBeNull();
    expect(catalogueImageUrl('https://shop.example.com/a.webp', '')).toBeNull();
  });
});
