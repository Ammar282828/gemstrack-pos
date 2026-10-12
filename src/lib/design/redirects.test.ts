import { describe, expect, it } from 'vitest';
import { MOVED_PATHS, redirectFor } from './redirects';

/** Old address → where it lands (docs/features/design.md, "URLs and redirects"). */
const TABLE: [string, string, string][] = [
  // Post a piece
  ['/website/post', '', '/design?v=make'],
  ['/website/post', 'new=1', '/design?v=make&new=1'],
  ['/website/post', 'draft=abc123', '/design?v=make&draft=abc123'],
  ['/website/post', 'site=piece-9', '/design?v=make&site=piece-9'],
  ['/website/post', 'dev=1&site=a%20b', '/design?v=make&dev=1&site=a+b'],
  ['/website/post/', 'draft=x', '/design?v=make&draft=x'],
  // From the website
  ['/website/from-site', '', '/posts'],
  ['/website/from-site', 'q=ring', '/posts?q=ring'],
  // The Studio's Plan
  ['/ads/studio', '', '/ads/plan'],
  ['/ads/studio', 'v=plan', '/ads/plan'],
  ['/ads/studio', 'v=plan&s=plays', '/ads/plan?s=plays'],
  ['/ads/studio', 'v=plan&s=guide', '/ads/plan?s=guide'],
  ['/ads/studio', 'v=plan&s=rivals', '/ads/plan?s=rivals'],
  ['/ads/studio', 'v=guide', '/ads/plan?s=guide'],
  ['/ads/studio', 'v=rivals', '/ads/plan?s=rivals'],
  ['/ads/studio', 'v=nonsense', '/ads/plan'],
  // The Studio's design half
  ['/ads/studio', 'v=photos', '/design?v=photos&s=picks'],
  ['/ads/studio', 'v=photos&s=picks', '/design?v=photos&s=picks'],
  ['/ads/studio', 'v=photos&s=library', '/design?v=photos&s=library'],
  ['/ads/studio', 'v=picks', '/design?v=photos&s=picks'],
  ['/ads/studio', 'v=library', '/design?v=photos&s=library'],
  ['/ads/studio', 'v=make', '/design?v=make&kind=ad'],
  ['/ads/studio', 'v=board', '/design?v=board'],
  ['/ads/studio', 'v=saved', '/design?v=saved'],
  // Other parameters are kept
  ['/ads/studio', 'v=make&dev=1', '/design?v=make&kind=ad&dev=1'],
  ['/ads/studio', 'v=board&board=b1', '/design?v=board&board=b1'],
  ['/ads/studio', 'dev=1', '/ads/plan?dev=1'],
];

describe('old addresses land where they went', () => {
  it.each(TABLE)('%s?%s → %s', (path, query, to) => {
    expect(redirectFor(path, new URLSearchParams(query))).toBe(to);
  });

  it('reads a Next searchParams object too, repeats included', () => {
    expect(redirectFor('/website/post', { site: 'a', dev: ['1', '2'] })).toBe('/design?v=make&site=a&dev=1&dev=2');
    expect(redirectFor('/ads/studio', { v: 'make', s: undefined })).toBe('/design?v=make&kind=ad');
  });

  it('answers null for an address that did not move', () => {
    for (const p of ['/website/edit', '/website/photos', '/website/weights', '/website/investments', '/posts', '/ads/new', '/design', '/ads/plan']) {
      expect(redirectFor(p, new URLSearchParams('v=make')), p).toBeNull();
    }
  });

  it('every moved path is in the table', () => {
    for (const p of MOVED_PATHS) expect(TABLE.some(([path]) => path === p), p).toBe(true);
  });
});
