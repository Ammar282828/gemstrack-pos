/**
 * POST { event, id, payment?, status?, to? } → send that alert to the shop's numbers as a PDF
 * (lib/notifications/send-alert.ts). The app posts here once a sale, payment, order or status
 * change is saved; Settings' "Send test" posts { event: 'test', to }.
 *
 * Signed-in owners and staff. The request only names a record: what is sent is read from the
 * book, and only ever to the numbers saved in Settings, so this cannot be made to message
 * anyone else or to say anything the book doesn't.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { isCronAuthorized } from '@/lib/api-auth';
import { sendLiveAlert, type AlertRequest, type LiveEvent } from '@/lib/notifications/send-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EVENTS: LiveEvent[] = ['sale', 'payment', 'order', 'order-status', 'test'];

export async function POST(req: NextRequest) {
  let by = 'scheduler';
  if (!isCronAuthorized(req, { strict: true })) {
    const email = await verifyRequestEmail(req);
    const role = email ? roleForEmail(email) : null;
    if (!email || (role !== 'owner' && role !== 'staff')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    by = email;
  }
  const body = await req.json().catch(() => null) as Partial<AlertRequest> | null;
  if (!body || !EVENTS.includes(body.event as LiveEvent)) return NextResponse.json({ error: 'Unknown alert.' }, { status: 400 });
  const r: AlertRequest = {
    event: body.event as LiveEvent,
    id: body.id ? String(body.id) : undefined,
    status: body.status,
    to: body.to ? String(body.to) : undefined,
    payment: body.payment && Number.isFinite(Number(body.payment.amount)) ? { amount: Number(body.payment.amount), date: String(body.payment.date || '') } : undefined,
  };
  try {
    const result = await sendLiveAlert(r, by);
    const code = result.status === 'failed' ? 502 : 200;
    return NextResponse.json({ ok: result.status === 'sent' || result.status === 'already', ...result }, { status: code });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[/api/notifications/alert]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
