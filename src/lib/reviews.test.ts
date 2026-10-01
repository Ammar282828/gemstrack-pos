import { describe, expect, it } from 'vitest';
import { cidOf, fromJudgeme, fromPlaces, mapsUrl, pickQuotes, ratingLabel, tidy, type ReviewQuote } from './reviews';

const q = (author: string, stars: number, text: string, about?: string): ReviewQuote =>
  ({ author, stars, text, ...(about ? { about: { name: about, url: `/products/${about}` } } : {}) });

describe('pickQuotes', () => {
  it('takes five-star reviews with something to say, the fullest first', () => {
    const out = pickQuotes([
      q('A', 5, 'nice'),
      q('B', 5, 'Had an amazing experience shopping for jewelry — they recreated a design to perfection.'),
      q('C', 4, 'the clasp takes getting used to, very small, but the pendant is super cute'),
      q('D', 5, 'Products and services are excellent, highly recommended.'),
      q('E', 5, 'Always a best choice for jewellery, their collections appeal to me.'),
    ]);
    expect(out.map((x) => x.author)).toEqual(['B', 'E', 'D']);
  });

  it('falls back to four stars only when there are too few fives', () => {
    const out = pickQuotes([q('A', 5, 'wore it for eid and everyone asked where i got it'), q('B', 4, 'chain could be a little longer but it is pretty')]);
    expect(out.map((x) => x.author)).toEqual(['A', 'B']);
  });

  it('never shows three or fewer stars', () => {
    expect(pickQuotes([q('A', 3, 'it was fine but the delivery took a long while')])).toEqual([]);
  });

  it('one quote per reviewer and per piece', () => {
    const out = pickQuotes([
      q('Zoya', 5, 'not as heavy as they look, which is great — love house of mina', 'Amara Teardrop Earrings'),
      q('Laiba', 5, 'beautiful earrings, wore them for eid and everyone asked about them', 'Amara Teardrop Earrings'),
      q('Zoya', 5, 'looks amazing stacked with my other gold bangles, so nice', 'Raya Bangle'),
      q('Amna', 5, 'wore it to my best friend’s dholki and it matched my outfit perfectly', 'Audry Choker'),
      q('Amna', 5, 'simple and classy, I wear it every day', 'Atlas Ring'),
    ], 4);
    // Laiba's is the fuller of the two earrings reviews; Zoya still speaks, for the bangle; Amna once.
    expect(out.map((x) => `${x.author}/${x.about?.name}`)).toEqual(['Amna/Audry Choker', 'Laiba/Amara Teardrop Earrings', 'Zoya/Raya Bangle']);
  });

  it('tidies the words and raises only the first letter', () => {
    expect(tidy('  i never take it off  it survives showers <b>lotion</b> everything ')).toBe('I never take it off it survives showers lotion everything');
  });
});

describe('the listing', () => {
  it('reads the cid out of a Maps feature id', () => {
    expect(cidOf('0x3eb33f9193805f97:0x3d557f1ff0eae5aa')).toBe('4419578384496649642');
    expect(mapsUrl('0x3eb33f9193805f97:0x3d557f1ff0eae5aa')).toBe('https://www.google.com/maps/place/data=!4m2!3m1!1s0x3eb33f9193805f97:0x3d557f1ff0eae5aa');
    expect(mapsUrl('4419578384496649642')).toBe('https://maps.google.com/?cid=4419578384496649642');
    expect(cidOf('nonsense')).toBeNull();
  });
  it('labels a rating to one place', () => {
    expect(ratingLabel(4.81)).toBe('4.8');
    expect(ratingLabel(5)).toBe('5.0');
  });
});

describe('fromPlaces', () => {
  const at = '2026-10-01T10:00:00Z';
  it('reads Google’s rating, count and reviews', () => {
    const s = fromPlaces({
      id: 'ChIJ123', displayName: { text: 'Taheri Collections' }, rating: 4.9, userRatingCount: 17,
      googleMapsUri: 'https://maps.google.com/?cid=4419578384496649642',
      reviews: [{ rating: 5, text: { text: 'Translated' }, originalText: { text: 'Products and services is excellent, would highly recommend.' }, authorAttribution: { displayName: 'Munira' }, publishTime: '2026-08-01T00:00:00Z' }],
    }, { place: '0x1:0x2', writeUrl: 'https://g.page/r/x/review', at });
    expect(s).toMatchObject({ source: 'google', name: 'Taheri Collections', rating: 4.9, count: 17, placeId: 'ChIJ123', writeUrl: 'https://g.page/r/x/review' });
    expect(s?.quotes[0]).toMatchObject({ author: 'Munira', stars: 5, text: 'Products and services is excellent, would highly recommend.' });
  });
  it('refuses a listing with no rating rather than show 0 stars', () => {
    expect(fromPlaces({ displayName: { text: 'X' } }, { place: '', at })).toBeNull();
    expect(fromPlaces({ rating: 0, userRatingCount: 0 }, { place: '', at })).toBeNull();
  });
});

describe('fromJudgeme', () => {
  const at = '2026-10-01T10:00:00Z';
  const grid = JSON.stringify({
    number_of_reviews: 138, average_rating: '4.81',
    all_reviews: { reviews: [
      { rating: 5, body: 'wore it to my best friends dholki and it matched perfectly with my outfit', reviewer_name: 'Amna', product_title: 'Audry Choker', product_url: '/products/audry-choker', created_at: '2026-02-03' },
      { rating: 4, body: 'the clasp takes getting used to very small. pendant is super cute', reviewer_name: 'Maham', product_title: 'Amour Pendant', product_url: '/products/amour' },
    ] },
  });
  it('takes the shop’s rating and count, and links each quote to its piece', () => {
    const s = fromJudgeme({ rating: '4.81', count: '138', grid }, { shopUrl: 'https://houseofmina.store/', name: 'House of Mina', at });
    expect(s).toMatchObject({ source: 'judgeme', rating: 4.81, count: 138, readUrl: 'https://houseofmina.store' });
    expect(s?.quotes[0]).toMatchObject({ author: 'Amna', text: 'Wore it to my best friends dholki and it matched perfectly with my outfit', about: { name: 'Audry Choker', url: 'https://houseofmina.store/products/audry-choker' } });
  });
  it('falls back to the grid’s own figures, and refuses none at all', () => {
    expect(fromJudgeme({ grid }, { shopUrl: 'https://x.store', name: 'X', at })?.count).toBe(138);
    expect(fromJudgeme({ grid: 'not json' }, { shopUrl: 'https://x.store', name: 'X', at })).toBeNull();
  });
});
