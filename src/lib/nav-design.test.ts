import { describe, expect, it, vi } from 'vitest';

// A house with a website (so Posts shows) — set before nav.ts reads store-config.
vi.stubEnv('NEXT_PUBLIC_STORE_WEBSITE_URL', 'https://example.test');
const { ALL_ENTRIES, NAV, forRole, locate, paletteFor } = await import('./nav');
const { scorePlace } = await import('./palette-match');

describe('Design is a tab of Posts (docs/features/design.md)', () => {
  const posts = (who: 'owner' | 'staff' | 'marketing') => forRole(NAV.find(e => e.id === 'posts')!, who)!;
  it('Posts is Hub · Design · Investments, for staff too', () => {
    expect(posts('owner').tabs?.map(t => t.label)).toEqual(['Hub', 'Design', 'Investments']);
    expect(posts('staff').tabs?.map(t => t.label)).toEqual(['Hub', 'Design', 'Investments']);
    expect(posts('marketing').tabs?.map(t => t.href)).toContain('/design');
  });
  it('Ads has Plan in place of the Studio; the moved addresses are not offered twice', () => {
    const ads = forRole(NAV.find(e => e.id === 'ads')!, 'owner')!;
    expect(ads.tabs?.map(t => t.label)).toEqual(['Campaigns', 'Plan', 'New ad', 'Setup']);
    // Its Overview is Analytics › Ads (2026-10-23).
    expect(NAV.find(e => e.id === 'analytics')!.tabs?.some(t => t.href === '/ads' && t.section === 'Ads')).toBe(true);
    const hrefs = paletteFor(false).map(d => d.href);
    expect(hrefs).toContain('/design');
    expect(hrefs).toContain('/ads/plan');
    expect(hrefs).not.toContain('/ads/studio');
    expect(hrefs).not.toContain('/website/post');
  });
  it('the palette finds Design for Studio, Post a piece, Canva and Design', () => {
    for (const word of ['studio', 'post a piece', 'canva', 'design']) {
      const best = paletteFor(false)
        .map(d => ({ d, score: scorePlace(d.label, d.keywords.map(k => k.toLowerCase()), word) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      expect(best?.d.href, word).toBe('/design');
    }
  });
  it('the old addresses still light the Design tab\'s row', () => {
    const entries = ALL_ENTRIES.map(e => forRole(e, false)).filter((e): e is NonNullable<typeof e> => !!e);
    expect(locate('/design', entries)?.tab?.href).toBe('/design');
    expect(locate('/design/classic/post', entries)?.tab?.href).toBe('/design');
    expect(locate('/ads/plan', entries)?.tab?.href).toBe('/ads/plan');
  });
});
