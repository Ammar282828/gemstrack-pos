import { describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { cleanWebsiteConfig, setWebsiteConfig, websiteConfigChanges } from './website-config';

// All figures made up.
const form = {
  enabled: true,
  currency: 'PKR',
  defaultPricing: { karat: '21k', wastagePercentage: 8, makingChargesPerGram: 1500, stoneChargesDefault: 0 },
  categoryPricing: { Bangles: { wastagePercentage: 10 }, 'Diamond Rings': {} },
  diamondPolicy: 'enquire',
  diamondChargesDefault: 0,
  palladiumKarat: '18k',
  deliveryCharge: 500,
  freeDeliveryOver: 200000,
  maxRateAgeHours: 24,
  posCategoryId: 'cat-web',
};

describe('cleanWebsiteConfig', () => {
  it('keeps every field the form has, and drops the rest', () => {
    const r = cleanWebsiteConfig({ ...form, updatedAt: 'x', bank: 'elsewhere', categoryPricing: { ...form.categoryPricing, Rings: { karat: '18k', colour: 'red' } } });
    expect(r).toEqual({ ok: true, config: { ...form, categoryPricing: { ...form.categoryPricing, Rings: { karat: '18k' } } } });
  });

  it('leaves out the optional figures when they are empty, as the page does', () => {
    const r = cleanWebsiteConfig({ ...form, freeDeliveryOver: 0, maxRateAgeHours: null, deliveryCharge: '', posCategoryId: undefined });
    expect(r.ok && r.config).toEqual({ ...form, freeDeliveryOver: undefined, maxRateAgeHours: undefined, deliveryCharge: 0, posCategoryId: '' });
    expect(r.ok && 'freeDeliveryOver' in r.config).toBe(false);
  });

  it('refuses a figure that would be quoted wrong', () => {
    const wrong: Record<string, unknown>[] = [
      { enabled: 'yes' },
      { defaultPricing: { ...form.defaultPricing, karat: '9k' } },
      { defaultPricing: { ...form.defaultPricing, wastagePercentage: 150 } },
      { defaultPricing: { ...form.defaultPricing, makingChargesPerGram: -1 } },
      { defaultPricing: { karat: '21k', wastagePercentage: 8, makingChargesPerGram: 1500 } },
      { categoryPricing: { Bangles: { stoneChargesDefault: '500' } } },
      { categoryPricing: { 'a.b': {} } },
      { categoryPricing: [] },
      { diamondPolicy: 'always' },
      { diamondChargesDefault: -5 },
      { palladiumKarat: '22k' },
      { deliveryCharge: Number.NaN },
      { freeDeliveryOver: -1 },
      { maxRateAgeHours: 0.5 },
      { maxRateAgeHours: 10_000 },
      { posCategoryId: 'a/b' },
    ];
    for (const patch of wrong) expect(cleanWebsiteConfig({ ...form, ...patch }).ok, JSON.stringify(patch)).toBe(false);
    expect(cleanWebsiteConfig(null).ok).toBe(false);
  });
});

describe('setWebsiteConfig', () => {
  it('writes the whole document, stamped, and logs the switch by name', async () => {
    const writes: unknown[][] = [];
    const logs: string[][] = [];
    const db = {
      get: async () => ({ ...form, enabled: false, deliveryCharge: 400, id: 'website' }),
      batch: () => ({ set: (...a: unknown[]) => writes.push(a), update() {}, delete() {}, commit: async () => undefined }),
    } as unknown as DbPort;
    const cleaned = cleanWebsiteConfig(form);
    if (!cleaned.ok) throw new Error(cleaned.error);
    const now = new Date('2026-10-10T10:00:00.000Z');
    const out = await setWebsiteConfig(db, cleaned.config, { by: 'Demo Owner', now }, { log: (a, t, d, r) => { logs.push([a, t, d, r ?? '']); } });
    expect(writes).toEqual([['app_settings', 'website', { ...form, updatedAt: now.toISOString() }, false]]);
    expect(out.changed).toEqual(['deliveryCharge', 'enabled']);
    expect(logs).toEqual([['settings.website', 'Website selling turned on', 'deliveryCharge, enabled · by Demo Owner', 'website']]);
  });

  it('names what changed against no document at all', () => {
    expect(websiteConfigChanges(null, { ...form, enabled: false } as never)).toContain('posCategoryId');
  });
});
