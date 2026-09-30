/**
 * Who may call a route that changes the shop's data outside the ERP (Shopify): a signed-in
 * owner or staff member, the scheduler (Bearer CRON_SECRET), or anyone while
 * NEXT_PUBLIC_OPEN_ACCESS is on. The Shopify routes had no check at all (found 2026-09-30,
 * when Taheri was closed to four accounts): anyone on the internet could push orders,
 * sync invoices, re-register webhooks or delete Shopify customers by POSTing an id.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

/** null when the caller may go on; otherwise the answer to send back. */
export async function erpUserOrCron(req: NextRequest): Promise<NextResponse | null> {
  if (OPEN_ACCESS || isCronAuthorized(req, { strict: true })) return null;
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}
