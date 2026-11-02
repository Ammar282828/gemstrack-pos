import { describe, it, expect } from 'vitest';
import { splitInvoicePerPiece } from '@/lib/invoice-pdf';
import type { Invoice } from '@/lib/store';

const item = (n: number, total: number) => ({ sku: `S${n}`, name: `Piece ${n}`, quantity: 1, unitPrice: total, itemTotal: total }) as any;

const bill = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'INV-1', createdAt: '2026-11-02T00:00:00Z',
  items: [item(1, 100_000), item(2, 50_000), item(3, 30_000)],
  subtotal: 180_000, discountAmount: 9_000, grandTotal: 171_000, amountPaid: 70_000, balanceDue: 101_000,
  paymentHistory: [{ date: '2026-11-01T00:00:00Z', amount: 70_000, method: 'cash' }],
  ...over,
} as any);

describe('splitInvoicePerPiece: the advance is cut once, from the final total', () => {
  it('shows no payment on any piece, and the bill on the last page only', () => {
    const pieces = splitInvoicePerPiece(bill());
    expect(pieces).toHaveLength(3);
    for (const p of pieces) {
      expect(p.amountPaid).toBe(0);
      expect(p.balanceDue).toBe(p.grandTotal);
    }
    expect(pieces.slice(0, 2).every(p => !p.bill && p.paymentHistory!.length === 0)).toBe(true);
    const last = pieces[2];
    expect(last.paymentHistory).toHaveLength(1);
    const total = pieces.reduce((a, p) => a + p.grandTotal, 0);
    expect(last.bill!.total).toBeCloseTo(total, 2);
    expect(last.bill!.paid).toBe(70_000);
    expect(last.bill!.balance).toBeCloseTo(total - 70_000, 2);
    expect(last.bill!.total).toBeCloseTo(171_000, 2);
    expect(last.bill!.balance).toBeCloseTo(101_000, 2);
  });

  it('leaves a one-piece invoice as itself', () => {
    const one = bill({ items: [item(1, 180_000)] as any });
    expect(splitInvoicePerPiece(one)).toEqual([one]);
  });
});
