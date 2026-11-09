import { describe, expect, it } from 'vitest';
import { describeLines, isShopifyBillMail, parseShopifyBill } from './shopify-bills';

const D = '2026-03-02T08:00:00Z';

describe('isShopifyBillMail', () => {
  it('accepts bills, invoices and receipts from Shopify', () => {
    expect(isShopifyBillMail({ from: 'Shopify <billing@shopify.com>', subject: 'Your Shopify bill for March 2026' })).toBe(true);
    expect(isShopifyBillMail({ from: 'Shopify Billing <no-reply@mail.shopify.com>', subject: 'Receipt for your app charge' })).toBe(true);
    expect(isShopifyBillMail({ from: 'notifications@shopify.com', subject: 'Invoice #123456 is ready' })).toBe(true);
  });
  it('rejects orders, payouts, marketing and other senders', () => {
    expect(isShopifyBillMail({ from: 'Shopify <mailers@shopify.com>', subject: '[House of Mina] Order #1042 placed' })).toBe(false);
    expect(isShopifyBillMail({ from: 'billing@shopify.com', subject: 'Your payout of $120 is on its way' })).toBe(false);
    expect(isShopifyBillMail({ from: 'news@shopify.com', subject: 'Grow your sales: 5 tips' })).toBe(false);
    expect(isShopifyBillMail({ from: 'billing@shopify.com', subject: 'Payment failed for your invoice' })).toBe(false);
    expect(isShopifyBillMail({ from: 'someone@gmail.com', subject: 'Invoice' })).toBe(false);
  });
});

describe('parseShopifyBill', () => {
  it('reads a subscription bill', () => {
    const b = parseShopifyBill({
      subject: 'Your Shopify bill #123456 for House of Mina', date: D,
      text: `Bill #123456\nBilling period: Feb 1, 2026 - Feb 28, 2026\n\nBasic plan subscription   $39.00\nTotal   $39.00 USD\n`,
    })!;
    expect(b.billNo).toBe('123456');
    expect(b.total).toBe(39);
    expect(b.currency).toBe('USD');
    expect(b.periodFrom).toBe('2026-02-01');
    expect(b.periodTo).toBe('2026-02-28');
    expect(b.lines).toEqual([{ label: 'Basic plan subscription', amount: 39 }]);
  });
  it('reads an app charge receipt (currency after the number)', () => {
    const b = parseShopifyBill({ subject: 'Receipt for your app charge', date: D, text: 'Thanks!\nKlaviyo app charge\n10.00 USD\nAmount due: 10.00 USD' })!;
    expect(b.total).toBe(10);
    expect(b.currency).toBe('USD');
    expect(b.lines[0]).toEqual({ label: 'Klaviyo app charge', amount: 10 });
  });
  it('reads transaction fees and tax, taking the Total line over the largest', () => {
    const b = parseShopifyBill({
      subject: 'Shopify invoice #A-9981', date: D,
      text: `Subscription: $39.00\nApps: $10.00\nTransaction fees: $3.25\nShipping labels: $4.50\nTax: $5.00\nSubtotal $61.75\nTotal charged: $61.75 USD`,
    })!;
    expect(b.billNo).toBe('A-9981');
    expect(b.total).toBe(61.75);
    expect(b.lines.map(l => l.label)).toEqual(['Subscription', 'Apps', 'Transaction fees', 'Shipping labels', 'Tax']);
    expect(describeLines(b.lines)).toBe('subscription 39, apps 10, tax 5, shipping labels 4.5, transaction fees 3.25');
  });
  it('reads rupee amounts with thousands separators', () => {
    expect(parseShopifyBill({ subject: 'Your Shopify bill', date: D, text: 'Plan  Rs 8,100\nTotal Rs 8,100' })).toMatchObject({ total: 8100, currency: 'PKR' });
    expect(parseShopifyBill({ subject: 'Receipt', date: D, text: 'Total: PKR 8,100.50' })).toMatchObject({ total: 8100.5, currency: 'PKR' });
  });
  it('falls back to the largest amount', () => {
    expect(parseShopifyBill({ subject: 'Your bill', date: D, text: 'Apps $5.00\nPlan $29.00' })!.total).toBe(29);
  });
  it('gives nothing for a mail without an amount', () => {
    expect(parseShopifyBill({ subject: 'Your Shopify account', date: D, text: 'Hello, welcome. Store #1234 is live. 2026' })).toBeNull();
  });
});
