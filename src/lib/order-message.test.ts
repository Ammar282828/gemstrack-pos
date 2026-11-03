import { describe, expect, it } from 'vitest';
import { orderCustomerMessage } from './order-message';

// A made-up order and shop. The Swift port (apps/iphone OrderActionsLogic.customerMessage) is held to these words.
const order = {
  id: 'ORD-000123',
  customerName: 'Test Customer',
  grandTotal: 45_500,
  items: [
    { description: 'Ring with a small stone', estimatedWeightG: 4.25, karat: '21k' },
    { description: 'Plain band', estimatedWeightG: 3, karat: '' },
    { description: 'Pendant at a fixed price', isManualPrice: true, estimatedWeightG: 0 },
  ],
};

describe('the order message', () => {
  it('summary: each piece, its weight unless priced by hand, and the balance', () => {
    expect(orderCustomerMessage(order, 'summary', 'TEST SHOP')).toBe(
      'Dear Test Customer,\n\n'
      + 'Here is a summary of your custom order *#ORD-000123* from TEST SHOP.\n\n'
      + '*Item 1:* Ring with a small stone\n'
      + '  - Est. Weight: 4.25g (21k)\n'
      + '*Item 2:* Plain band\n'
      + '  - Est. Weight: 3g \n'
      + '*Item 3:* Pendant at a fixed price\n'
      + '\n*Total:* PKR 45,500\n\n'
      + 'We are working on your order and will notify you of any updates.\n\n'
      + 'Thank you for your business.',
    );
  });

  it('the two status updates, and a nameless order', () => {
    expect(orderCustomerMessage({ ...order, customerName: '' }, 'inProgress', 'TEST SHOP')).toBe(
      'Dear Customer,\n\n'
      + 'This is an update regarding your order *#ORD-000123* from TEST SHOP.\n\n'
      + 'We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n'
      + 'Thank you for your business.',
    );
    expect(orderCustomerMessage({ ...order, grandTotal: 1_234.5 }, 'completed', 'TEST SHOP')).toBe(
      'Dear Test Customer,\n\n'
      + 'This is an update regarding your order *#ORD-000123* from TEST SHOP.\n\n'
      + 'Your custom order is now *Completed* and ready for collection.\n\n'
      + '*Total:* PKR 1,235\n\n'
      + 'Thank you for your business.',
    );
  });

  it('leads with the full amount and names the advance on its own line, never subtracting it from the headline', () => {
    const withAdvance = { ...order, subtotal: 100_000, discountAmount: 5_000, advancePayment: 40_000, advanceInExchangeValue: 5_000, grandTotal: 50_000 };
    const text = orderCustomerMessage(withAdvance, 'summary', 'TEST SHOP');
    expect(text).toContain('\n*Total:* PKR 95,000\n*Advance paid:* PKR 45,000\n*Balance due:* PKR 50,000\n\n');
    expect(orderCustomerMessage(withAdvance, 'completed', 'TEST SHOP')).toContain('*Total:* PKR 95,000\n*Advance paid:* PKR 45,000\n*Balance due:* PKR 50,000');
    // Without a subtotal the full amount is the balance with the advance put back.
    expect(orderCustomerMessage({ ...order, advancePayment: 10_000, grandTotal: 35_500 }, 'summary', 'S')).toContain('*Total:* PKR 45,500\n*Advance paid:* PKR 10,000\n*Balance due:* PKR 35,500');
  });
});
