import { describe, expect, it } from 'vitest';
import { staffBlocked } from './staff-pages';

describe('staffBlocked', () => {
  it('sends staff home from the books, analytics, settings and stock lists', () => {
    for (const p of ['/analytics', '/analytics/sales', '/expenses', '/hisaab/abc', '/settings/shop', '/overheads', '/products', '/products/bulk-add', '/today', '/ads/campaigns', '/insights', '/website/interest', '/ads/setup']) {
      expect(staffBlocked(p, false), p).toBe(true);
    }
  });
  it('lets staff work: sales, orders, customers, workshop, posts, a scanned piece', () => {
    for (const p of ['/', '/orders', '/orders/ORD-1', '/invoices/new', '/customers/abc', '/workshop', '/karigars/k1', '/posts', '/design', '/website/photos', '/products/RIN-000001', '/calendar', '/drafts', '/repairs']) {
      expect(staffBlocked(p, false), p).toBe(false);
    }
  });
  it('lets the staff member also on the marketing list into Ads, Insights and Visitors, never ad setup or settings', () => {
    for (const p of ['/ads/campaigns', '/ads/new', '/insights/posts', '/website/interest/live']) expect(staffBlocked(p, true), p).toBe(false);
    for (const p of ['/ads/setup', '/ads/audiences', '/ads/rules', '/ads/tests', '/settings', '/analytics']) expect(staffBlocked(p, true), p).toBe(true);
  });
});
