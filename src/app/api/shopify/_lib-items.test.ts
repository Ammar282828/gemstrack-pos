import { describe, expect, it } from 'vitest';
import { lineItemNotes, mapInvoiceItem } from './_lib';

describe("a Shopify line's own choices on the ERP's invoice", () => {
  it('names the cut a Birthstone Stack band was ordered in', () => {
    const line = { id: 1, name: 'Birthstone Stack - January, Garnet / 7 / 24k Gold Vermeil', price: '4000.00', quantity: 1, properties: [{ name: 'Cut', value: 'Oval' }] };
    expect(mapInvoiceItem(line).name).toBe('Birthstone Stack - January, Garnet / 7 / 24k Gold Vermeil · Cut: Oval');
  });
  it('leaves a line without properties as it was, and private or empty ones out', () => {
    expect(mapInvoiceItem({ id: 2, name: 'Pearl Studs', price: '5000', quantity: 1 }).name).toBe('Pearl Studs');
    expect(lineItemNotes({ properties: [{ name: '_bs', value: 'x' }, { name: 'Note', value: ' ' }, { name: 'Size', value: 'US 4' }] })).toEqual(['Size: US 4']);
  });
});
