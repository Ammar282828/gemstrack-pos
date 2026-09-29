import { describe, expect, it } from 'vitest';
import { invoiceSaleValue } from './sale-value';

describe('invoiceSaleValue', () => {
  it('a sale paid wholly in old gold is worth what was sold, not nothing', () => {
    // INV-000007 as stored: 700,090 sold, 12,090 off, 688,000 in exchange → grandTotal 0.
    expect(invoiceSaleValue({ grandTotal: 0, exchangeAmount1: 688000 } as never)).toBe(688000);
  });
  it('part exchange: the cash part plus the exchange', () => {
    expect(invoiceSaleValue({ grandTotal: 25000, exchanges: [{ description: 'Old ring', value: 60000 }, { description: '', value: 15000 }] } as never)).toBe(100000);
  });
  it('the exchange list wins over the old totals it also writes', () => {
    expect(invoiceSaleValue({ grandTotal: 10, exchanges: [{ description: '', value: 5 }], exchangeAmount1: 5 } as never)).toBe(15);
  });
  it('no exchange field (older invoices kept it in a payment): the total as it is', () => {
    expect(invoiceSaleValue({ grandTotal: 991324.95 } as never)).toBe(991324.95);
    expect(invoiceSaleValue({ grandTotal: 5000, exchangeDescription: 'old chain' } as never)).toBe(5000);
    expect(invoiceSaleValue(null)).toBe(0);
  });
});
