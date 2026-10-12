import { describe, expect, it } from 'vitest';
import type { DesignPage } from './model';
import { destinationRows, matchesRatio, needsFor, outputPx, pageFor, type DestinationFacts } from './destinations';

const taheri: DestinationFacts = {
  mayAds: true, metaAds: true, website: { on: true, configured: true }, featured: true, siteEdit: true,
  whatsapp: { community: true, groups: [{ key: 'announcements', label: 'Announcements' }, { key: 'diamonds', label: 'Diamonds' }], channel: true },
  instagram: { configured: true, connected: true, username: 'collectionstaheri' },
};
const mina: DestinationFacts = {
  ...taheri, featured: false,
  whatsapp: { community: true, groups: [{ key: 'announcements', label: 'Announcements' }], channel: false },
  instagram: { configured: false, connected: false, username: null },
};
const staff = (f: DestinationFacts): DestinationFacts => ({ ...f, mayAds: false });
const by = (rows: ReturnType<typeof destinationRows>) => Object.fromEntries(rows.map(r => [r.id, r]));
const page = (id: string, w: number, h: number): DesignPage => ({ id, label: id, format: 'square', frame: { w, h }, origin: 'master', rev: 0 });

describe('destinationRows', () => {
  it('Taheri owner: everything, Instagram by the connection', () => {
    const r = by(destinationRows(taheri, { fromSite: true }));
    for (const id of ['website', 'featured', 'whatsapp', 'channel', 'instagram-story', 'instagram-post', 'meta-ad', 'site-replace']) expect(r[id].available, id).toBe(true);
    expect(r['instagram-story'].mode).toBe('api');
    expect(r['instagram-post'].mode).toBe('api');
    expect(r.whatsapp.targets?.map(t => t.key)).toEqual(['announcements', 'diamonds']);
  });
  it('Mina: no channel, no set of the day, Instagram through the share sheet', () => {
    const r = by(destinationRows(mina));
    expect(r.channel.available).toBe(false);
    expect(r.channel.reason).toMatch(/channel/);
    expect(r.featured.available).toBe(false);
    expect(r['instagram-story'].mode).toBe('share');
    expect(r['instagram-post'].mode).toBe('share');
    expect(r['instagram-post'].available).toBe(true);
    expect(r.whatsapp.available).toBe(true);
  });
  it('staff get no Meta ad row, with the reason', () => {
    const r = by(destinationRows(staff(taheri)));
    expect(r['meta-ad'].available).toBe(false);
    expect(r['meta-ad'].reason).toMatch(/owner and marketing/);
  });
  it('a house without the Meta account says so, not "owner only"', () => {
    expect(by(destinationRows({ ...taheri, metaAds: false }))['meta-ad'].reason).toMatch(/no Meta ad account/);
  });
  it('replacing a site photo needs a design from a site piece', () => {
    expect(by(destinationRows(taheri))['site-replace'].available).toBe(false);
    expect(by(destinationRows(taheri, { fromSite: true }))['site-replace'].available).toBe(true);
    expect(by(destinationRows({ ...taheri, siteEdit: false }, { fromSite: true }))['site-replace'].available).toBe(false);
  });
  it('no website, or no upload secret, closes the website and the set of the day', () => {
    for (const website of [{ on: false, configured: true }, { on: true, configured: false }]) {
      const r = by(destinationRows({ ...taheri, website }));
      expect(r.website.available).toBe(false);
      expect(r.featured.available).toBe(false);
    }
  });
  it('no community closes WhatsApp and the channel', () => {
    const r = by(destinationRows({ ...taheri, whatsapp: { community: false, groups: [], channel: true } }));
    expect(r.whatsapp.available).toBe(false);
    expect(r.channel.available).toBe(false);
  });
  it('an unconnected Instagram is a share sheet with its reason', () => {
    const r = by(destinationRows({ ...taheri, instagram: { configured: true, connected: false, username: 'x' } }));
    expect(r['instagram-story'].mode).toBe('share');
    expect(r['instagram-story'].reason).toMatch(/not connected/);
  });
});

describe('needs and pages', () => {
  it('WhatsApp and the website only ever get 1:1; a story is 9:16', () => {
    for (const id of ['website', 'featured', 'whatsapp', 'channel', 'instagram-post'] as const) expect(needsFor(id).ratio, id).toBe('1:1');
    expect(needsFor('instagram-story').ratio).toBe('9:16');
    expect(needsFor('meta-ad').ratio).toBe('any');
    expect(needsFor('whatsapp').caption).toBe('wa');
    expect(needsFor('instagram-post').caption).toBe('ig');
  });
  it('matches a page by shape', () => {
    expect(matchesRatio(page('a', 1080, 1080), '1:1')).toBe(true);
    expect(matchesRatio(page('a', 1080, 1350), '1:1')).toBe(false);
    expect(matchesRatio(page('a', 1080, 1920), '9:16')).toBe(true);
    expect(matchesRatio(page('a', 1080, 1350), 'any')).toBe(true);
  });
  it('takes the master when it fits, else the first that does', () => {
    const pages = [page('m', 1080, 1350), page('sq1', 1080, 1080), page('sq2', 1080, 1080), page('st', 1080, 1920)];
    expect(pageFor(pages, 'm', 'whatsapp')).toMatchObject({ page: { id: 'sq1' } });
    expect(pageFor(pages, 'sq2', 'website')).toMatchObject({ page: { id: 'sq2' } });
    expect(pageFor(pages, 'm', 'instagram-story')).toMatchObject({ page: { id: 'st' } });
    expect(pageFor(pages, 'm', 'meta-ad')).toMatchObject({ page: { id: 'm' } });
  });
  it('a 1:1-only place with only a 9:16 page offers to make 1:1', () => {
    const only = [page('st', 1080, 1920)];
    for (const id of ['whatsapp', 'channel', 'website', 'featured', 'instagram-post'] as const) {
      const p = pageFor(only, 'st', id);
      expect(p, id).toHaveProperty('missing');
      if ('missing' in p) expect(p.ratio).toBe('1:1');
    }
    const p = pageFor([page('sq', 1080, 1080)], 'sq', 'instagram-story');
    expect('missing' in p && p.missing.id).toBe('story');
    expect('missing' in p && p.ratio).toBe('9:16');
  });
  it('draws at each place’s own width; any shape at the format’s size', () => {
    expect(outputPx('whatsapp', { format: 'square' })).toBe(1600);
    expect(outputPx('website', { format: 'square' })).toBe(3000);
    expect(outputPx('instagram-story', { format: 'story' })).toBe(1080);
    expect(outputPx('meta-ad', { format: 'portrait' })).toBe(1080);
    expect(outputPx('meta-ad', { format: 'r21x9' })).toBe(2160);
  });
});
