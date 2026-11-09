import { describe, expect, it } from 'vitest';
import { reconcileOrderMoney } from './update-order';
import { orderWithoutPiece } from './order-pieces';

describe('an order\'s delivery survives the edits', () => {
  it('the form sends the pieces\' sum; the delivery is added back, and the balance follows', () => {
    const existing = { subtotal: 8350, deliveryCharge: 350, discountAmount: 0, advancePayment: 2000 };
    expect(reconcileOrderMoney(existing as never, { subtotal: 9000 })).toMatchObject({ subtotal: 9350, grandTotal: 7350 });
    expect(reconcileOrderMoney({ subtotal: 8000, advancePayment: 0 } as never, { subtotal: 9000 })).toMatchObject({ subtotal: 9000, grandTotal: 9000 });
  });

  it('removing a piece keeps the delivery in the subtotal', () => {
    const order = { items: [{ description: 'A', totalEstimate: 4000 }, { description: 'B', totalEstimate: 4000 }], subtotal: 8350, deliveryCharge: 350, advancePayment: 8350 };
    expect(orderWithoutPiece(order as never, 1)).toMatchObject({ subtotal: 4350, grandTotal: -4000 });
  });
});
