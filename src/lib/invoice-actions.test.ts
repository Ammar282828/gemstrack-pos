import { describe, expect, it } from 'vitest';
import { discountProblem, invoiceLines, piecesBackInStock, refundEntry, withDiscount, withoutPayment, withRefund } from './invoice-actions';

// Ported case for case to the iPhone app (apps/iphone/Packages/ERPCore/Tests/ERPCoreTests/InvoiceActionsTests.swift).
// All figures made up.

describe('changing the discount', () => {
  it('refuses what the invoice page refuses, in its words', () => {
    expect(discountProblem(100_000, 5_000)).toBeNull();
    expect(discountProblem(100_000, 100_000)).toBeNull();
    expect(discountProblem(100_000, 0)).toBeNull();
    expect(discountProblem(100_000, -1)).toBe('Discount cannot be negative.');
    expect(discountProblem(100_000, 100_001)).toBe('Discount cannot exceed subtotal.');
    expect(discountProblem(100_000, Number.NaN)).toBe('Enter the discount.');
    expect(discountProblem(undefined, 1)).toBe('Discount cannot exceed subtotal.');
    expect(discountProblem(null, 0)).toBeNull();
  });

  it('takes the discount and the exchange off the lines, and owes on what was paid', () => {
    expect(withDiscount({ subtotal: 250_000, exchangeAmount1: 40_000, exchangeAmount2: 5_000, amountPaid: 100_000 }, 15_000))
      .toEqual({ discountAmount: 15_000, grandTotal: 190_000, balanceDue: 90_000 });
  });

  it('a bigger discount than what is left owing puts the invoice in credit', () => {
    expect(withDiscount({ subtotal: 50_000, amountPaid: 48_000 }, 5_000)).toEqual({ discountAmount: 5_000, grandTotal: 45_000, balanceDue: -3_000 });
  });

  it('a figure missing from an old invoice is nothing', () => {
    expect(withDiscount({}, 0)).toEqual({ discountAmount: 0, grandTotal: 0, balanceDue: 0 });
    expect(withDiscount({ subtotal: 10_000, exchangeAmount1: null, amountPaid: Number.NaN }, 1_000)).toEqual({ discountAmount: 1_000, grandTotal: 9_000, balanceDue: 9_000 });
  });

  it('sums in the order the store does', () => {
    expect(withDiscount({ subtotal: 1000.1, exchangeAmount1: 0.2, exchangeAmount2: 0.3, amountPaid: 0.7 }, 0.05))
      .toEqual({ discountAmount: 0.05, grandTotal: 999.5500000000001, balanceDue: 998.85 });
  });
});

describe('a partial refund', () => {
  it('is money out on the history, with the reason in its note', () => {
    expect(refundEntry(1_500, '2026-10-09T10:00:00.000Z', 'damaged item')).toEqual({ amount: -1_500, date: '2026-10-09T10:00:00.000Z', notes: 'Refund: damaged item' });
    expect(refundEntry(-1_500, 'd')).toEqual({ amount: -1_500, date: 'd', notes: 'Refund' });
    expect(refundEntry(1_500, 'd', '')).toEqual({ amount: -1_500, date: 'd', notes: 'Refund' });
  });

  it('recomputes what is paid from the whole history, and owes the rest', () => {
    const out = withRefund({ grandTotal: 120_000, paymentHistory: [{ amount: 50_000 }, { amount: 70_000 }] }, 20_000, 'd', 'size');
    expect(out.amountPaid).toBe(100_000);
    expect(out.balanceDue).toBe(20_000);
    expect(out.paymentHistory).toEqual([{ amount: 50_000 }, { amount: 70_000 }, { amount: -20_000, date: 'd', notes: 'Refund: size' }]);
  });

  it('reads the history, not the stored total', () => {
    expect(withRefund({ grandTotal: 1_000, amountPaid: 999, paymentHistory: [{ amount: 1_000 }] }, 100, 'd')).toMatchObject({ amountPaid: 900, balanceDue: 100 });
  });

  it('with nothing paid it goes below nothing, as the store records it', () => {
    expect(withRefund({ grandTotal: 5_000 }, 500, 'd')).toMatchObject({ amountPaid: -500, balanceDue: 5_500 });
  });

  it('a payment with no amount counts as nothing', () => {
    expect(withRefund({ grandTotal: 1_000, paymentHistory: [{ amount: null }, { amount: 300 }] }, 100, 'd')).toMatchObject({ amountPaid: 200, balanceDue: 800 });
  });

  it('sums in the order the store does', () => {
    expect(withRefund({ grandTotal: 0.3, paymentHistory: [{ amount: 0.1 }, { amount: 0.2 }] }, 0.05, 'd'))
      .toMatchObject({ amountPaid: 0.25000000000000006, balanceDue: 0.04999999999999993 });
  });
});

describe('deleting one payment', () => {
  it('takes it off and owes it again', () => {
    const out = withoutPayment({ grandTotal: 288_250, paymentHistory: [{ amount: 30_000 }, { amount: 258_250 }] }, 0);
    expect(out).toEqual({ paymentHistory: [{ amount: 258_250 }], amountPaid: 258_250, balanceDue: 30_000 });
  });

  it('deleting a refund puts the money back as paid', () => {
    expect(withoutPayment({ grandTotal: 10_000, paymentHistory: [{ amount: 10_000 }, { amount: -2_000 }] }, 1)).toMatchObject({ amountPaid: 10_000, balanceDue: 0 });
  });

  it('there is nothing to delete outside the history', () => {
    const inv = { grandTotal: 1_000, paymentHistory: [{ amount: 500 }, { amount: 500 }] };
    expect(withoutPayment(inv, 2)).toBeNull();
    expect(withoutPayment(inv, -1)).toBeNull();
    expect(withoutPayment(inv, 0.5)).toBeNull();
    expect(withoutPayment({ grandTotal: 1_000 }, 0)).toBeNull();
  });

  it('sums in the order the store does', () => {
    expect(withoutPayment({ grandTotal: 1, paymentHistory: [{ amount: 0.1 }, { amount: 0.2 }, { amount: 0.4 }] }, 0))
      .toMatchObject({ amountPaid: 0.6000000000000001, balanceDue: 0.3999999999999999 });
  });
});

describe('the pieces a deleted invoice puts back in stock', () => {
  it('each once, never an order\'s piece, never one another invoice also sold', () => {
    const invoice = { id: 'INV-2', items: [{ sku: 'RNG-001' }, { sku: 'ORD-000003-1' }, { sku: 'NEW-ABC' }, { sku: 'BNG-002' }, { sku: '' }, { sku: 'RNG-001' }] };
    const others = [
      { id: 'INV-2', items: [{ sku: 'RNG-001' }] },          // itself: no reason to keep a piece sold
      { id: 'INV-1', items: { 0: { sku: 'BNG-002' } } },    // an old invoice keeping its lines as a map
      { id: 'INV-3', items: null },
    ];
    expect(piecesBackInStock(invoice, others).map(i => i.sku)).toEqual(['RNG-001', 'NEW-ABC']);
  });

  it('reads an invoice kept as a map, and one with no lines', () => {
    expect(piecesBackInStock({ id: 'INV-4', items: { 0: { sku: 'A-1' }, 1: { sku: 'B-2' } } }, []).map(i => i.sku)).toEqual(['A-1', 'B-2']);
    expect(piecesBackInStock({ id: 'INV-5' }, [])).toEqual([]);
  });

  it('lines come either way', () => {
    expect(invoiceLines([{ sku: 'A' }])).toEqual([{ sku: 'A' }]);
    expect(invoiceLines({ 0: { sku: 'A' }, 1: { sku: 'B' } })).toEqual([{ sku: 'A' }, { sku: 'B' }]);
    expect(invoiceLines(null)).toEqual([]);
  });
});
