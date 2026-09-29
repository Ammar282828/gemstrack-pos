import { describe, it, expect } from 'vitest';
import { pickShowcase, type ShowcasePiece } from './showcase';

const piece = (id: string, collection: string, extra: Partial<ShowcasePiece> = {}): ShowcasePiece => ({
  id, name: `Piece ${id}`, url: `https://site/p/${id}`, thumb: `https://site/t/${id}.webp`, collection, newArrival: true, ...extra,
});

describe('pickShowcase', () => {
  it('goes round the collections, newest of each first', () => {
    const list = [piece('s1', 'Sets'), piece('s2', 'Sets'), piece('s3', 'Sets'), piece('r1', 'Rings'), piece('b1', 'Bangles'), piece('r2', 'Rings')];
    expect(pickShowcase(list, 5).map(p => p.id)).toEqual(['s1', 'r1', 'b1', 's2', 'r2']);
  });
  it('one collection only: simply the newest', () => {
    const list = Array.from({ length: 10 }, (_, i) => piece(`s${i}`, 'Stone Sets'));
    expect(pickShowcase(list, 8).map(p => p.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
  });
  it('never a piece without a page, a picture or a real name', () => {
    const list = [
      piece('a', 'Sets', { url: '' }),
      piece('b', 'Sets', { thumb: '' }),
      piece('c', 'Sets', { name: 'DSC09342' }),
      piece('d', 'Sets', { name: '  ' }),
      piece('e', 'Sets'),
    ];
    expect(pickShowcase(list, 8).map(p => p.id)).toEqual(['e']);
  });
  it('a file name is not a piece name', () => {
    const names = ['Untitled design', 'Untitled design (3)', 'IMG_2041', 'Screenshot 2026-09-28 at 14.02', 'WhatsApp Image 2026-09-28', 'DSC09342'];
    const list = [...names.map((name, i) => piece(`f${i}`, 'Sets', { name })), piece('ok', 'Sets', { name: 'Untitled Muse Ring' })];
    expect(pickShowcase(list, 8).map(p => p.id)).toEqual(['ok']);
    expect(pickShowcase([piece('r', 'Rings', { name: 'Star Sapphire Baguette Ring' })], 8).map(p => p.id)).toEqual(['r']);
  });
  it('too few new arrivals: the newest pieces stand in', () => {
    const list = [piece('n1', 'Rings'), piece('o1', 'Rings', { newArrival: false }), piece('o2', 'Sets', { newArrival: false })];
    expect(pickShowcase(list, 3).map(p => p.id)).toEqual(['n1', 'o2', 'o1']);
  });
  it('enough new arrivals: older pieces are left out', () => {
    const list = [piece('n1', 'Rings'), piece('n2', 'Sets'), piece('old', 'Bangles', { newArrival: false })];
    expect(pickShowcase(list, 2).map(p => p.id)).toEqual(['n1', 'n2']);
  });
  it('nothing to show is an empty list', () => {
    expect(pickShowcase([], 8)).toEqual([]);
  });
});
