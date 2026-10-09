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
      + '\n*Total Balance Due:* PKR 45,500.00\n\n'
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
      + '*Amount Due:* PKR 1,234.50\n\n'
      + 'Thank you for your business.',
    );
  });
});
