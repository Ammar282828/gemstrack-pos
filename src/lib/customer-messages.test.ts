import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store-config', () => ({ STORE_CONFIG: { name: 'Taheri' } }));
const { orderMessage, invoiceMessage, repairMessage } = await import('./customer-messages');

describe('the Contact control’s pre-typed messages', () => {
  const order = { id: 'ORD-000092', customerName: 'Huzaifa Hashim', promisedDate: '2026-11-19' };

  it('a ready order: please collect, with the balance', () => {
    expect(orderMessage(order, 'ready', 192860)).toBe(
      'Assalam o Alaikum Huzaifa Hashim, your order ORD-000092 is ready at Taheri. Please collect it at your convenience. The balance is PKR 192,860. Thank you.');
  });
  it('a ready order with nothing to pay says no balance', () => {
    expect(orderMessage(order, 'ready', 0.4)).not.toMatch(/balance/i);
  });
  it('an order being made: thanks and the promised day', () => {
    expect(orderMessage(order, 'karigar', 0)).toMatch(/being made and is expected to be ready by Thursday 19 November\. We will let you know/);
  });
  it('an invoiced order still owing: a gentle reminder', () => {
    expect(orderMessage(order, 'payment', 5000)).toMatch(/gentle reminder from Taheri: PKR 5,000 is still to be paid on your order ORD-000092/);
  });
  it('a cancelled order has nothing to say', () => {
    expect(orderMessage(order, 'closed', 0)).toBe('');
  });
  it('a walk-in is greeted without a name', () => {
    expect(orderMessage({ id: 'ORD-1', customerName: 'Walk-in Customer' }, 'ready', 0)).toMatch(/^Assalam o Alaikum, your order/);
  });
  it('an invoice: reminder while owing, thanks when paid', () => {
    expect(invoiceMessage({ id: 'INV-1', customerName: 'Sana', balanceDue: 1200 })).toMatch(/PKR 1,200 is still to be paid on your invoice INV-1/);
    expect(invoiceMessage({ id: 'INV-1', customerName: 'Sana', balanceDue: 0 })).toMatch(/thank you for choosing Taheri/);
  });
  it('a repair: received, then ready with the receipt', () => {
    const r = { id: 'R-12', customerName: 'Sana', pieces: [{ item: 'Ring' }] };
    expect(repairMessage({ ...r, status: 'received' }, 0)).toMatch(/received your ring for repair at Taheri \(repair R-12\)\. We will let you know as soon as it is ready/);
    expect(repairMessage({ ...r, status: 'ready' }, 800)).toBe('Assalam o Alaikum Sana, your ring is ready for collection at Taheri (repair R-12). Balance: PKR 800. Please bring your receipt.');
  });
});
