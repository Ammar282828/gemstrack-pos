import { describe, expect, it } from 'vitest';
import { headlineOf, siteFrom, sitePhotoQuery } from './site-photo';

const taheri = { id: 'Sets/Stone Sets/DSC09295.webp', name: 'Emerald Drop Set', url: 'https://taheri.shop/stone-sets/dsc09295', photoSource: null, sourceMarked: false };
const mina = { id: 'mina/piece/aqua-bloom-set', name: 'Aqua Bloom Set', url: 'https://catalogue.houseofmina.store/piece/aqua-bloom-set', photoSource: 'https://cdn.shopify.com/s/files/1/aqua.jpg', sourceMarked: false };

describe('a website photo for Post a Piece', () => {
  it('taheri.shop: the photo as the site shows it, full size — and it carries the marks', () => {
    expect(sitePhotoQuery(taheri)).toBe('id=Sets%2FStone+Sets%2FDSC09295.webp&size=3000');
    expect(siteFrom(taheri).marked).toBe(true);
  });
  it('the catalogue: the unmarked original, so the post puts the MINA mark on once', () => {
    expect(sitePhotoQuery(mina)).toContain('original=1');
    expect(siteFrom(mina).marked).toBe(false);
    expect(siteFrom({ ...mina, sourceMarked: true }).marked).toBe(true);
  });
  it('keeps the page for the caption', () => {
    expect(siteFrom(mina).url).toBe('https://catalogue.houseofmina.store/piece/aqua-bloom-set');
  });
  it('a camera file name is no headline; a real name is', () => {
    expect(headlineOf('DSC09213')).toBe('');
    expect(headlineOf('IMG_4410')).toBe('');
    expect(headlineOf('WhatsApp Image 2026-09-28')).toBe('');
    expect(headlineOf('0042')).toBe('');
    expect(headlineOf(' Emerald Drop Set ')).toBe('Emerald Drop Set');
    expect(headlineOf('Pavé Wave Set')).toBe('Pavé Wave Set');
  });
});
