import { describe, it, expect } from 'vitest';
import { adLibraryUrl, bestAndWorst, cleanUsername, engagementRate, jsonIn, splitWinners, type OwnAd, type RivalPost } from './rivals';

describe('cleanUsername', () => {
  it('reads what people type and what search finds', () => {
    expect(cleanUsername('@Some.Jeweller')).toBe('some.jeweller');
    expect(cleanUsername('https://www.instagram.com/some_jeweller/?hl=en')).toBe('some_jeweller');
    expect(cleanUsername('instagram.com/abc')).toBe('abc');
  });
  it('refuses what cannot be a username', () => {
    expect(cleanUsername('https://www.instagram.com/p/C123/')).toBe('');
    expect(cleanUsername('two words')).toBe('');
    expect(cleanUsername('.dot')).toBe('');
    expect(cleanUsername('a..b')).toBe('');
    expect(cleanUsername('')).toBe('');
  });
});

describe('jsonIn', () => {
  it('finds the object in a fenced or chatty answer', () => {
    expect(jsonIn<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(jsonIn<{ a: string }>('Found these {"a": "x } y"} and more')).toEqual({ a: 'x } y' });
  });
  it('gives null for nothing usable', () => {
    expect(jsonIn('no json here')).toBeNull();
    expect(jsonIn('{"a": ')).toBeNull();
  });
});

const post = (id: string, likes: number | null, comments = 0, image: string | null = 'x'): RivalPost =>
  ({ id, caption: '', type: 'IMAGE', image, permalink: null, at: null, likes, comments });

describe('rival posts', () => {
  it('ranks by engagement, comments weighing more', () => {
    const { best, worst } = bestAndWorst([post('a', 100), post('b', 10, 40), post('c', 5), post('d', 50), post('e', 1)], 2, 2);
    expect(best.map(p => p.id)).toEqual(['b', 'a']);
    expect(worst.map(p => p.id)).toEqual(['c', 'e']);
  });
  it('without likes (hidden), shows the newest with pictures', () => {
    const { best, worst } = bestAndWorst([post('a', null), post('b', null, 0, null), post('c', null)], 6, 3);
    expect(best.map(p => p.id)).toEqual(['a', 'c']);
    expect(worst).toEqual([]);
  });
  it('rates per thousand followers', () => {
    expect(engagementRate(post('a', 90, 10), 10000)).toBe(12);
    expect(engagementRate(post('a', null), 10000)).toBeNull();
  });
  it('links the Ad Library in Pakistan', () => {
    expect(adLibraryUrl('A & B')).toContain('country=PK');
    expect(adLibraryUrl('A & B')).toContain('q=A%20%26%20B');
  });
});

const ad = (id: string, spend: number, results: number, image: string | null = 'x'): OwnAd =>
  ({ id, name: id, image, spend, results, resultLabel: 'Chats started', ctr: 1, body: null });

describe('splitWinners', () => {
  it('cheapest results win; dear and empty ones lose', () => {
    const r = splitWinners([ad('a', 5000, 50), ad('b', 5000, 10), ad('c', 4000, 0), ad('d', 6000, 60), ad('e', 3000, 5), ad('f', 2000, 40)]);
    expect(r.enough).toBe(true);
    expect(r.winners.map(a => a.id)).toEqual(['f', 'a']);
    expect(r.losers.map(a => a.id)).toEqual(['c', 'e']);
  });
  it('ignores ads that barely spent or have no picture', () => {
    const r = splitWinners([ad('a', 10000, 10), ad('tiny', 300, 30), ad('noimg', 8000, 80, null)]);
    expect(r.considered).toBe(1);
    expect(r.enough).toBe(false);
  });
});
