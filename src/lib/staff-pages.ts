/**
 * Addresses a staff member is sent home from, if she types them (the menu already hides them). The server is the real
 * boundary — staff read no books, and the routes behind these refuse her — but a page of empty figures is only confusing,
 * and a page of figures computed from the invoices she can read would be a leak of a different kind.
 * Docs: docs/decisions.md#staff-see-no-money.
 */

import { within } from '@/lib/nav';

/** Never for staff: the books, settings, analytics, stock and the lists of what the shop earns. */
const BLOCKED = [
  '/analytics', '/expenses', '/additional-revenue', '/overheads', '/hisaab', '/shareholders', '/settings', '/activity-log', '/today',
  '/products', '/ads/setup', '/ads/audiences', '/ads/rules', '/ads/tests',
] as const;

/** Only for marketing: reachable by a staff member listed in the marketing list too. */
const MARKETING_ONLY = ['/ads', '/insights', '/website/interest'] as const;

/** Whether a staff member must not open `pathname`. `alsoMarketing`: she is on the marketing list as well. */
export function staffBlocked(pathname: string, alsoMarketing: boolean): boolean {
  // A piece's own page is how a scanned tag is sold (the sale flow links it); the stock lists are not.
  if (/^\/products\/[^/]+$/.test(pathname) && pathname !== '/products/add' && pathname !== '/products/bulk-add') return false;
  if (BLOCKED.some(h => within(pathname, h))) return true;
  if (!alsoMarketing && MARKETING_ONLY.some(h => within(pathname, h))) return true;
  return false;
}
