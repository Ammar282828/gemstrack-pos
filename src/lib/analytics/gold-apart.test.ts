import { describe, expect, it } from 'vitest';
import { goldShare, invoiceGoldPart, orderGoldPart } from './gold-apart';

describe('gold apart from silver (House of Mina)', () => {
  it('splits a sale by its lines: the sale\'s discount and delivery fall on each metal in proportion', () => {
    expect(goldShare([{ metalType: 'gold', value: 30000 }, { metalType: 'silver', value: 10000 }])).toBe(0.75);
    // Lines 30,000 gold + 10,000 silver; the sale came to 38,000 after its discount.
    expect(invoiceGoldPart({ items: [{ metalType: 'gold', itemTotal: 30000 }, { metalType: 'silver', itemTotal: 10000 }] }, 38000)).toBe(28500);
    expect(invoiceGoldPart({ items: [{ metalType: 'silver', itemTotal: 8000 }] }, 8350)).toBe(0);
    expect(invoiceGoldPart({ items: [] }, 5000)).toBe(0);
    expect(orderGoldPart({ items: [{ metalType: 'gold', isManualPrice: true, manualPrice: 20000 }, { metalType: 'silver', totalEstimate: 0 }] }, 20000)).toBe(20000);
  });


});
