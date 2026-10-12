import { describe, expect, it } from 'vitest';
import type { SavedAd } from '@/lib/ads/studio/saved';
import type { DesignRecord } from './model';
import { fromSaved, legacyKeyOf, mergeDesigns } from './saved-compat';

const saved = (id: string, updated: string, over: Partial<SavedAd> = {}): SavedAd => ({
  id, folder: 'eid', name: 'Ruby ring', format: 'portrait', template: 'band',
  fields: { headline: 'Ruby', kicker: 'For him' }, price: 'Rs 14,000', text: 'Natural ruby.', headline: 'DM to order', goal: 'messages', link: 'https://x',
  asset: { id: 'site:ruby', name: 'Ruby' }, thumb: 'data:image/jpeg;base64,AAAA', parts: { image: 2, doc: 1 }, at: '2026-10-01T00:00:00Z', updated, by: 'a@b.c', ...over,
});

describe('a saved ad read as a design', () => {
  it('maps to one ads-scope page', () => {
    const d = fromSaved(saved('abc', '2026-10-02T00:00:00Z'));
    expect(d).toMatchObject({
      id: 'saved:abc', kind: 'ad', scope: 'ads', folder: 'eid', name: 'Ruby ring', master: 'main', source: { assetId: 'site:ruby' },
      copy: { price: 'Rs 14,000', adText: 'Natural ruby.', adHeadline: 'DM to order', goal: 'messages', link: 'https://x' },
      legacy: { savedAdId: 'abc' }, thumb: 'data:image/jpeg;base64,AAAA', published: [], rev: 0,
    });
    expect(d.fields).toEqual({ kicker: 'For him', headline: 'Ruby', weight: '', details: '' });
    expect(d.pages).toEqual([{ id: 'main', label: '4:5', format: 'portrait', frame: { w: 1080, h: 1350 }, origin: 'master', rev: 0 }]);
    expect(d.files).toEqual({ 'image:main': 2, 'doc:main': 1 });
  });
  it('answers design file keys with its saved-ad files', () => {
    expect(legacyKeyOf('image:main')).toBe('image');
    expect(legacyKeyOf('doc:main')).toBe('doc');
    expect(legacyKeyOf('photo:main')).toBe('photo');
    expect(legacyKeyOf('image:other')).toBeNull();
  });
});

describe('designs and saved ads together', () => {
  const design = (id: string, updated: string, savedAdId?: string): DesignRecord => ({ ...fromSaved(saved('x', updated)), id, scope: 'shop', legacy: savedAdId ? { savedAdId } : undefined });
  it('hides a saved ad a design has superseded, and sorts newest first', () => {
    const out = mergeDesigns(
      [design('d1', '2026-10-05T00:00:00Z', 'a'), design('d2', '2026-10-01T00:00:00Z')],
      [saved('a', '2026-10-02T00:00:00Z'), saved('b', '2026-10-03T00:00:00Z')],
    );
    expect(out.map(d => d.id)).toEqual(['d1', 'saved:b', 'd2']);
  });
  it('is just the designs when there are no saved ads (staff)', () => {
    expect(mergeDesigns([design('d1', '2026-10-05T00:00:00Z')], []).map(d => d.id)).toEqual(['d1']);
  });
});
