import { describe, expect, it } from 'vitest';
import { renderAlertPdf, PAGE_H, PAGE_W } from './doc-pdf';
import { saleDoc } from './alerts';
import { weeklyDoc } from './report-docs';

const now = new Date('2026-10-01T16:00:00Z');

describe('renderAlertPdf', () => {
  it('draws a phone-shaped page with the record on it', () => {
    const pdf = renderAlertPdf(saleDoc({
      id: 'INV-000083', customerName: 'Rashida Modi', createdAt: now.toISOString(), subtotal: 321700, discountAmount: 0, grandTotal: 321700, amountPaid: 321700, balanceDue: 0,
      items: [{ name: 'Bridal ring', karat: '21k', metalWeightG: 9.46, itemTotal: 321700 }], paymentHistory: [{ amount: 321700, date: now.toISOString(), method: 'Cash' }],
    } as never, now), null);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(PAGE_W, 0);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(PAGE_H, 0);
    const raw = pdf.output();
    expect(raw).toContain('INV-000083');
    expect(raw).toContain('Bridal ring');
    expect(raw).toContain('321,700');
  });
  it('runs a long report onto more pages, numbered', () => {
    const invoices = Array.from({ length: 60 }, (_, i) => ({ id: `INV-${i}`, createdAt: '2026-09-29T10:00:00Z', customerName: `Customer ${i}`, subtotal: 1000, grandTotal: 1000, amountPaid: 1000, balanceDue: 0, items: [], paymentHistory: [] }));
    const pdf = renderAlertPdf(weeklyDoc({ invoices, orders: [], expenses: [] }, now), null);
    const pages = pdf.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(pdf.output()).toContain(`${pages} / ${pages}`);
  });
});
