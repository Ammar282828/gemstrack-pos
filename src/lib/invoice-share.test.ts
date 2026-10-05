import { describe, expect, it } from 'vitest';
import { invoiceFileName, invoiceTitle, invoiceWhatsAppCaption } from './invoice-share';

describe('what the customer sees of an invoice', () => {
  it('names the file after the customer, never the number', () => {
    expect(invoiceFileName({ customerName: 'Fatima Hussain', createdAt: '2026-10-05T10:00:00Z' })).toBe('Invoice - Fatima Hussain.pdf');
    expect(invoiceFileName({ customerName: '  Ali   Raza ' }, { perPiece: true })).toBe('Invoice - Ali Raza (per piece).pdf');
  });

  it('keeps a name that a phone or computer would refuse out of the file name', () => {
    expect(invoiceTitle({ customerName: 'A/B: "C"' })).toBe('Invoice - A B C');
  });

  it('gives a walk-in its day instead of a name', () => {
    expect(invoiceTitle({ customerName: 'Walk-in Customer', createdAt: '2026-10-05T10:00:00Z' })).toBe('Invoice - 5 Oct 2026');
    expect(invoiceTitle({ customerName: '', createdAt: undefined })).toBe('Invoice');
  });

  it('writes what is owed under the PDF, with no number and no link', () => {
    const c = invoiceWhatsAppCaption({ customerName: 'Fatima', grandTotal: 250000, amountPaid: 100000, balanceDue: 150000 }, 'Taheri');
    expect(c).toContain('Dear Fatima,');
    expect(c).toContain('Your invoice from Taheri is attached.');
    expect(c).toContain('*Balance due:* PKR 150,000');
    expect(c).not.toMatch(/INV|http/);
    expect(invoiceWhatsAppCaption({ customerName: 'Walk-in Customer', grandTotal: 5000 }, 'Taheri')).not.toContain('Paid');
  });
});
