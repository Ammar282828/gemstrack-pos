import { describe, expect, it } from 'vitest';
import { detailsTarget, withItemDetails } from './workshop-details';
import type { InvoiceItem } from './store';

describe('detailsTarget', () => {
  it('sends a sold piece to its invoice, never to karigar_jobs', () => {
    expect(detailsTarget({ id: 'invoice:INV-7:1', source: 'invoice', invoiceId: 'INV-7', itemIndex: 1 }))
      .toEqual({ kind: 'invoice', invoiceId: 'INV-7', itemIndex: 1 });
  });
  it('sends an order piece to its order', () => {
    expect(detailsTarget({ id: 'order:ORD-2:0', source: 'order', orderId: 'ORD-2', itemIndex: 0 }))
      .toEqual({ kind: 'order', orderId: 'ORD-2', itemIndex: 0 });
  });
  it('sends a hand-made job to its own document, without the board prefix', () => {
    expect(detailsTarget({ id: 'job:abc123', source: 'manual' })).toEqual({ kind: 'manual', jobId: 'abc123' });
  });
  it('refuses anything it cannot place rather than inventing a document', () => {
    expect(detailsTarget({ id: 'invoice:INV-7:1', source: 'invoice', invoiceId: 'INV-7' })).toBeNull();
    expect(detailsTarget({ id: 'invoice:INV-7:1', source: 'manual' })).toBeNull();
    expect(detailsTarget({ id: 'order:ORD-2:0', source: 'order', itemIndex: 0 })).toBeNull();
  });
});

describe('withItemDetails', () => {
  const items = [
    { name: 'Ring', size: '12', metalWeightG: 4.2, itemTotal: 90_000, stoneDetails: 'ruby', adminNote: 'old' },
    { name: 'Chain', metalWeightG: 10, itemTotal: 200_000 },
  ] as unknown as InvoiceItem[];

  it('changes the one piece and leaves its price, weight and the other pieces alone', () => {
    const out = withItemDetails(items, 0, { name: ' Ring, resized ', size: '13', adminNote: 'ruby\nresize to 13', stoneDetails: '', diamondDetails: '' });
    expect(out[0]).toEqual({ name: 'Ring, resized', size: '13', metalWeightG: 4.2, itemTotal: 90_000, adminNote: 'ruby\nresize to 13' });
    expect(out[1]).toBe(items[1]);
    expect(items[0].name).toBe('Ring'); // the store's copy is not changed in place
  });
  it('never clears the name, which prints on the bill', () => {
    expect(withItemDetails(items, 1, { name: '   ' })[1].name).toBe('Chain');
  });
  it('removes a blank size or note instead of storing an empty one', () => {
    const out = withItemDetails(items, 0, { size: ' ', adminNote: '' });
    expect('size' in out[0]).toBe(false);
    expect('adminNote' in out[0]).toBe(false);
  });
  it('refuses a piece the invoice does not have', () => {
    expect(() => withItemDetails(items, 5, { size: '1' })).toThrow('Item not found');
  });
});
