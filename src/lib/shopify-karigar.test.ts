import { afterEach, describe, expect, it } from 'vitest';
import { matchKarigar, shopifyKarigarName } from './shopify-karigar';
import { shopifyPieces } from './writes/shopify-order';

const book = [
  { id: 'k1', name: 'Uzair' },
  { id: 'k2', name: 'Nasir Zamur' },
  { id: 'k3', name: 'Uzair Old', deletedAt: '2026-10-01' },
];

describe('the house’s Shopify karigar', () => {
  afterEach(() => { delete process.env.SHOPIFY_ORDER_KARIGAR; });

  it('finds him by name, whatever the case and spaces', () => {
    expect(matchKarigar(book, '  uzair ')?.id).toBe('k1');
  });
  it('finds a karigar by a first name only he has', () => {
    expect(matchKarigar(book, 'Nasir')?.id).toBe('k2');
  });
  it('never guesses between two of the same name, and skips removed karigars', () => {
    expect(matchKarigar([...book, { id: 'k4', name: 'Uzair' }], 'Uzair')).toBeNull();
    expect(matchKarigar(book, 'Uzair Old')).toBeNull();
    expect(matchKarigar(book, 'Nobody')).toBeNull();
  });
  it('is off when the house names nobody', () => {
    expect(shopifyKarigarName()).toBe('');
    process.env.SHOPIFY_ORDER_KARIGAR = 'none';
    expect(shopifyKarigarName()).toBe('');
    process.env.SHOPIFY_ORDER_KARIGAR = 'Uzair';
    expect(shopifyKarigarName()).toBe('Uzair');
  });
  it('puts him on every piece of a new Shopify order, and on none without him', () => {
    const order = { id: 1, order_number: 1500, line_items: [{ name: 'Ring', price: '5000', quantity: 2 }] } as never;
    expect(shopifyPieces(order, 'silver', 'k1').map(p => p.karigarId)).toEqual(['k1', 'k1']);
    expect(shopifyPieces(order, 'silver').every(p => !('karigarId' in p))).toBe(true);
  });
});
