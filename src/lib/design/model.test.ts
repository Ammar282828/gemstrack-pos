import { describe, expect, it } from 'vitest';
import { AD_FORMATS, MORE_FORMAT_ORDER } from '@/lib/ads/studio/templates';
import { designInput } from './model';
import { SIZE_GROUPS, SIZE_PRESETS, presetsIn, sizeForDestination, sizePreset } from './sizes';
import type { DestinationId } from './model';

describe('the size table', () => {
  it('covers every ad format, with its own frame', () => {
    for (const [key, info] of Object.entries(AD_FORMATS)) {
      const p = sizePreset(key);
      expect(p, key).toBeDefined();
      expect(p!.frame).toEqual(info.frame);
      expect(p!.ratio).toBe(info.short);
    }
  });
  it('has no id twice, and every chip group resolves', () => {
    expect(new Set(SIZE_PRESETS.map(p => p.id)).size).toBe(SIZE_PRESETS.length);
    for (const g of Object.keys(SIZE_GROUPS) as (keyof typeof SIZE_GROUPS)[]) expect(presetsIn(g)).toHaveLength(SIZE_GROUPS[g].length);
    expect(presetsIn('more').map(p => p.id)).toEqual([...MORE_FORMAT_ORDER]);
  });
  it('gives WhatsApp and the website 1:1, and the story 9:16', () => {
    expect(sizeForDestination('whatsapp').ratio).toBe('1:1');
    expect(sizeForDestination('channel').ratio).toBe('1:1');
    expect(sizeForDestination('website').ratio).toBe('1:1');
    expect(sizeForDestination('website').px).toBe(3000);
    expect(sizeForDestination('instagram-story').ratio).toBe('9:16');
  });
  it('answers every destination', () => {
    const all: DestinationId[] = ['website', 'featured', 'whatsapp', 'channel', 'instagram-story', 'instagram-post', 'meta-ad', 'site-replace'];
    for (const d of all) expect(sizeForDestination(d), d).toBeDefined();
  });
});

describe('what a save may carry', () => {
  const page = { id: 'p1', label: '4:5', format: 'portrait', frame: { w: 1080, h: 1350 }, origin: 'master', rev: 2 };
  it('keeps the words and pages, cleaned', () => {
    const d = designInput({
      name: '  Ruby ring  ', folder: 'f1', kind: 'piece', fields: { headline: 'Ruby', kicker: 'For him', extra: 'x' },
      copy: { price: 'Rs 14,000', wa: 'hello', goal: 'messages', junk: 1 }, pages: [page], master: 'p1', source: { siteId: 's1', bad: 'x' },
      thumb: 'data:image/jpeg;base64,AAAA',
    })!;
    expect(d).toMatchObject({ name: 'Ruby ring', folder: 'f1', kind: 'piece', scope: 'shop', master: 'p1', source: { siteId: 's1' }, thumb: 'data:image/jpeg;base64,AAAA' });
    expect(d.fields).toEqual({ kicker: 'For him', headline: 'Ruby', weight: '', details: '' });
    expect(d.copy).toEqual({ price: 'Rs 14,000', wa: 'hello', goal: 'messages' });
    expect(d.pages[0]).toMatchObject({ id: 'p1', rev: 2, frame: { w: 1080, h: 1350 } });
  });
  it('refuses what isn’t a design', () => {
    expect(designInput(null)).toBeNull();
    expect(designInput({ kind: 'piece', pages: [], master: 'p1' })).toBeNull();
    expect(designInput({ kind: 'poster', pages: [page], master: 'p1' })).toBeNull();
    expect(designInput({ kind: 'piece', pages: [page], master: 'nope' })).toBeNull();
    expect(designInput({ kind: 'piece', pages: [{ ...page, frame: { w: NaN, h: 10 } }], master: 'p1' })).toBeNull();
    expect(designInput({ kind: 'piece', pages: [page, page], master: 'p1' })).toBeNull();
  });
  it('never trusts a folder or picture it can’t read, and keeps an ad the ads’', () => {
    const d = designInput({ kind: 'ad', scope: 'shop', folder: '../x', pages: [page], master: 'p1', thumb: 'javascript:alert(1)' })!;
    expect(d).toMatchObject({ folder: null, thumb: '', scope: 'ads', name: 'Untitled design' });
  });
});
