import { describe, expect, it } from 'vitest';
import { eventCounts, firedRecently, hasLoader, pixelIdsIn, salesReadiness } from './pixel-read';

describe('pixels a page carries', () => {
  it('reads the classic snippet', () => {
    expect(pixelIdsIn(`<script>fbq('init', '123456789012345');fbq('track','PageView')</script>`)).toEqual(['123456789012345']);
  });
  it('reads Shopify’s web-pixel settings, escaped inside the page’s JSON', () => {
    // As houseofmina.store served it on 2026-09-29 (Shopify's Facebook & Instagram app).
    const html = String.raw`webPixelsConfigList":[{"id":"1560707352","configuration":"{\"pixel_id\":\"1429906491670575\",\"pixel_type\":\"facebook_pixel\"}","eventPayloadVersion":"v1"}]`;
    expect(pixelIdsIn(html)).toEqual(['1429906491670575']);
  });
  it('ignores the web-pixel records’ own ids and other tags', () => {
    expect(pixelIdsIn(String.raw`{"id":"2965471512","configuration":"{\"endpoint\":\"https://x\"}"} gtag('config','G-X5Y0LCK19G')`)).toEqual([]);
  });
  it('knows this ERP’s loader', () => {
    expect(hasLoader('<script src="https://pos.taheri.shop/api/public/pixel"></script>')).toBe(true);
    expect(hasLoader('<html></html>')).toBe(false);
  });
});

describe('what the pixel received', () => {
  it('sums Meta’s hourly buckets per event', () => {
    expect(eventCounts([
      { data: [{ value: 'PageView', count: 40 }, { value: 'Purchase', count: 1 }] },
      { data: [{ value: 'PageView', count: 2 }, { value: 'AddToCart', count: 3 }] },
      {},
    ])).toEqual({ PageView: 42, Purchase: 1, AddToCart: 3 });
  });
  it('says whether Online orders has purchases to learn from', () => {
    expect(salesReadiness(null)).toEqual({ purchases: null, level: 'unknown' });
    expect(salesReadiness({ PageView: 900 })).toEqual({ purchases: 0, level: 'none' });
    expect(salesReadiness({ Purchase: 12 })).toEqual({ purchases: 12, level: 'few' });
    expect(salesReadiness({ Purchase: 60 })).toEqual({ purchases: 60, level: 'enough' });
  });
  it('fired this week', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(firedRecently('2026-09-28T12:00:00+0000', now)).toBe(true);
    expect(firedRecently('2026-09-01T12:00:00+0000', now)).toBe(false);
    expect(firedRecently(null, now)).toBe(false);
  });
});
