import { describe, it, expect, vi } from 'vitest';

// The pure half needs none of these; the module imports them for the writing half.
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/lib/db-admin-port', () => ({ adminPort: {} }));
vi.mock('@/lib/writes/create-order', () => ({ createOrder: vi.fn() }));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: vi.fn() }));

import { buildWebsiteOrder, CheckoutRejected, skuFor } from './checkout';
import { DEFAULT_WEBSITE_CONFIG, type WebsiteConfig } from './types';

const rates = {
  goldRatePerGram24k: 30000, goldRatePerGram22k: 27500, goldRatePerGram21k: 26250, goldRatePerGram18k: 22500,
  palladiumRatePerGram: 9000, platinumRatePerGram: 10000, silverRatePerGram: 300,
};
const config: WebsiteConfig = {
  ...DEFAULT_WEBSITE_CONFIG, enabled: true, posCategoryId: 'cat001',
  defaultPricing: { karat: '21k', wastagePercentage: 10, makingChargesPerGram: 1500, stoneChargesDefault: 4000 },
  deliveryCharge: 500,
};
const bank = { bankName: 'Meezan Bank', accountTitle: 'Taheri Jewellers', accountNumber: '', iban: 'PK00MEZN0000000000000000' };
const catalog = {
  'Rings & Bands/Rings/Ring 1.webp': { metal: 'Yellow Gold', stone: 'None', cut: 'None', style: 'Traditional', weightGrams: 4 },
  'Earrings/Jhumki/Jhumki 2.webp':  { metal: 'Yellow Gold', stone: 'Ruby', cut: 'Oval', style: 'Traditional', weightGrams: 2 },
  'Rings & Bands/Diamond Rings/D 1.webp': { metal: 'White Gold', stone: 'Diamond', cut: 'Round', style: 'Contemporary', weightGrams: 3 },
};
const ctx = { config, rates, catalog, origin: 'https://taheri.shop', bank, now: new Date('2026-09-18T10:00:00Z'), token: 'tok' };
const good = {
  customer: { name: 'Ayesha Khan', phone: '0300 1234567', email: '' },
  delivery: { address: 'House 12, Street 4, DHA Phase 6', city: 'Karachi', notes: '' },
  pieces: ['/catalog-thumb/Rings%20%26%20Bands/Rings/Ring%201.webp', 'Earrings/Jhumki/Jhumki 2.webp'],
  expectedTotal: 121500 + 60500 + 500,   // ring 121,500; jhumki 2g: 52,500 + 5,250 + 3,000 + 4,000 = 64,750? see test
  bagId: 'bag_0123456789',
};

describe('buildWebsiteOrder', () => {
  it('re-quotes every piece and refuses a total the customer did not see', () => {
    expect(() => buildWebsiteOrder({ ...good, expectedTotal: 1 }, ctx)).toThrowError(CheckoutRejected);
    try { buildWebsiteOrder({ ...good, expectedTotal: 1 }, ctx); } catch (e) {
      const r = e as CheckoutRejected;
      expect(r.code).toBe('price_changed');
      expect((r.detail as { grandTotal: number }).grandTotal).toBe(121500 + 64750 + 500);
    }
  });

  it('builds the products and the order from the quotes, not from the request', () => {
    const built = buildWebsiteOrder({ ...good, expectedTotal: 121500 + 64750 + 500 }, ctx);
    expect(built.grandTotal).toBe(186750);
    expect(built.products).toHaveLength(2);
    expect(built.products[0]).toMatchObject({ sku: skuFor('Rings & Bands/Rings/Ring 1.webp'), metalType: 'gold', karat: '21k', metalWeightG: 4, makingCharges: 6000, source: 'website', categoryId: 'cat001' });
    expect(built.products[0].name).toBe('Yellow Gold Ring — Ring 1');
    expect(built.products[1].name).toBe('Yellow Gold Jhumki with Ruby — Jhumki 2');
    expect(built.order).toMatchObject({
      status: 'Pending', source: 'website', customerName: 'Ayesha Khan', customerContact: '+923001234567',
      subtotal: 186250, grandTotal: 186750, advancePayment: 0,
      delivery: { required: true, city: 'Karachi', charge: 500 },
      website: { paymentMethod: 'bank_transfer', paymentStatus: 'awaiting_transfer', token: 'tok', bagId: 'bag_0123456789', deliveryCharge: 500 },
    });
    const items = built.order.items as { totalEstimate: number; referenceSku: string; estimatedWeightG: number }[];
    expect(items.map(i => i.totalEstimate)).toEqual([121500, 64750]);
    expect(items[0].referenceSku).toBe(built.products[0].sku);
    expect(items[0].estimatedWeightG).toBe(4);
  });

  it('refuses a bag holding a piece that can only be enquired about', () => {
    try {
      buildWebsiteOrder({ ...good, pieces: ['Rings & Bands/Diamond Rings/D 1.webp'], expectedTotal: 0 }, ctx);
      throw new Error('should have thrown');
    } catch (e) {
      const r = e as CheckoutRejected;
      expect(r.code).toBe('unpriceable');
      expect(r.detail).toEqual([{ key: 'Rings & Bands/Diamond Rings/D 1.webp', reason: 'diamond_enquire' }]);
    }
  });

  it('refuses when the shop has not finished setting up', () => {
    const half = { ...ctx, bank: { ...bank, iban: '', accountNumber: '' } };
    try { buildWebsiteOrder(good, half); throw new Error('should have thrown'); }
    catch (e) { expect((e as CheckoutRejected).code).toBe('not_selling'); }
  });

  it('rejects the honeypot and malformed input without pricing anything', () => {
    try { buildWebsiteOrder({ ...good, website: 'http://spam' }, ctx); throw new Error('x'); }
    catch (e) { expect((e as CheckoutRejected).code).toBe('rejected'); }
    try { buildWebsiteOrder({ ...good, customer: { name: 'A', phone: '1' } }, ctx); throw new Error('x'); }
    catch (e) { expect((e as CheckoutRejected).code).toBe('invalid'); }
  });

  it('dedupes a piece sent twice and normalises every key shape to the manifest\'s', () => {
    const built = buildWebsiteOrder({ ...good, pieces: ['Rings & Bands/Rings/Ring 1.webp', '/catalog-full/Rings%20&%20Bands/Rings/Ring%201.webp'], expectedTotal: 121500 + 500 }, ctx);
    expect(built.products).toHaveLength(1);
  });
});

describe('skuFor', () => {
  it('is stable and safe as a document id', () => {
    expect(skuFor('a/b/c.webp')).toBe(skuFor('a/b/c.webp'));
    expect(skuFor('a/b/c.webp')).toMatch(/^WEB-[A-Z0-9]{8}$/);
  });
});
