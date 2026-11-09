import { describe, expect, it } from 'vitest';
import { drawShippingSlipPdf, shippingSlipFileName } from './shipping-slip-pdf';

const BOOKING = {
  cn: '779412345678', bookedAt: '2026-11-09T10:00:00Z', by: 'x@y.z', codAmount: 12500, destinationCity: 'Lahore', weight: 0.5, pieces: 1,
  reference: '#1460', consignee: { name: 'Ayesha Khan', address: 'House 12, Street 4, DHA Phase 5', mobile: '03001234567' }, originCity: 'Karachi',
};

describe('shipping slip', () => {
  it('draws a one-page 4 × 6 label', () => {
    const pdf = drawShippingSlipPdf(BOOKING, { name: 'HOUSE OF MINA', address: '272-B, Shabbirabad, Karachi', phone: '0300 0000000' });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(Math.round(pdf.internal.pageSize.getWidth())).toBe(102);
    expect(Math.round(pdf.internal.pageSize.getHeight())).toBe(152);
    const text = String(pdf.output());
    expect(text).toContain('779412345678');
    expect(text).toContain('PKR 12,500');
    expect(text).toContain('LAHORE');
  });
  it('a paid parcel says so', () => {
    expect(String(drawShippingSlipPdf({ ...BOOKING, codAmount: 0 }, { name: 'X' }).output())).toContain('Nothing to collect');
  });
  it('is named by its number', () => expect(shippingSlipFileName(BOOKING)).toBe('TCS-779412345678.pdf'));
});
