/**
 * POST { op, … }: the native iPhone app's writes (apps/iphone, CONVENTIONS.md rule 1).
 *
 * Each operation runs the same shared write the browser runs (lib/writes/*), on the Admin SDK, for
 * whoever the browser lets do it: an owner, or staff where the shop floor may (as /api/staff/write).
 * The app never writes a document itself, so the takings cannot disagree with themselves depending
 * on which screen took them.
 *
 * The answer names its follow-ups: the WhatsApp alert the browser would raise and any Shopify sync
 * it would send, as calls the app posts after the write has landed, without waiting on them. They
 * are decided here, and a PDF that takes a minute to build never holds a sale up.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { normalizePhoneNumber } from '@/lib/utils';
import { recordInvoicePayment } from '@/lib/writes/invoice-payment';
import { recordOrderAdvance } from '@/lib/writes/order-advance';
import { alertsOnStatus, ORDER_STATUSES, setOrderPieceDone, setOrderStatus, type SettableStatus } from '@/lib/writes/order-status';

export const dynamic = 'force-dynamic';

type Body = { op?: string } & Record<string, unknown>;
type FollowUp = { path: string; body: Record<string, unknown> };

/** Who may run each operation: as the browser allows it today. */
const OPS: Record<string, ('owner' | 'staff')[]> = {
  recordPayment: ['owner', 'staff'],
  setOrderStatus: ['owner', 'staff'],
  addCustomer: ['owner', 'staff'],
  recordOrderAdvance: ['owner'],
  setPieceDone: ['owner'],
};

const text = (v: unknown) => String(v ?? '').trim();

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const op = String(body.op || '');
  const allowed = OPS[op];
  if (!allowed) return NextResponse.json({ error: 'Unknown operation', op }, { status: 400 });
  if (!(allowed as string[]).includes(role)) return NextResponse.json({ error: 'Not yours to change.' }, { status: 403 });

  // The owner's lock holds here as it does in the browser and on the shop floor's path.
  const settings = await adminDb.collection('app_settings').doc('global').get();
  if (settings.exists && settings.data()?.databaseLocked) {
    return NextResponse.json({ error: 'The database is locked. Unlock it in Settings first.' }, { status: 423 });
  }

  const log = async (action: string, title: string, detail: string, ref?: string) => {
    try {
      await adminDb.collection('activity_log').add({
        action, title, detail, relatedId: ref || null, by: email, at: new Date().toISOString(), via: 'iphone-app',
      });
    } catch (e) { console.error('[/api/app/write] activity log', e); }
  };

  const followUps: FollowUp[] = [];
  const alert = (b: Record<string, unknown>) => followUps.push({ path: '/api/notifications/alert', body: b });

  try {
    switch (op) {
      case 'recordPayment': {
        const invoiceId = text(body.invoiceId);
        const amount = Number(body.amount);
        const date = text(body.date) || new Date().toISOString();
        if (!invoiceId || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
        const invoice = await recordInvoicePayment(adminPort,
          { invoiceId, amount, date, method: text(body.method) || undefined, reference: text(body.reference) || undefined },
          { log, notify: id => alert({ event: 'payment', id, payment: { amount, date } }) });
        return NextResponse.json({ ok: true, invoice, followUps });
      }

      case 'recordOrderAdvance': {
        const orderId = text(body.orderId);
        const amount = Number(body.amount);
        if (!orderId || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
        const order = await recordOrderAdvance(adminPort,
          { orderId, amount, notes: text(body.notes) || undefined, method: text(body.method) || undefined }, { log });
        return NextResponse.json({ ok: true, order, followUps });
      }

      case 'setOrderStatus': {
        const orderId = text(body.orderId);
        const status = text(body.status) as SettableStatus;
        if (!orderId || !(ORDER_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        // A refund is "Refund order" (the invoice undone, stock back, the delete code), never a relabel.
        if (status === 'Refunded') return NextResponse.json({ error: 'Refund an order from its page (Refund order).' }, { status: 400 });
        const out = await setOrderStatus(adminPort, { orderId, status }, { log, notify: id => alert({ event: 'order-status', id, status }) });
        // Cancelled drops the order's Shopify draft, as the browser does.
        if (status === 'Cancelled') followUps.push({ path: '/api/shopify/sync/order', body: { orderId, action: 'cancel' } });
        return NextResponse.json({ ok: true, ...out, alerted: alertsOnStatus(status), followUps });
      }

      case 'setPieceDone': {
        const orderId = text(body.orderId);
        const index = Number(body.index);
        if (!orderId || !Number.isInteger(index)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        const out = await setOrderPieceDone(adminPort, { orderId, index, done: body.done === true },
          { log, notify: id => alert({ event: 'order-status', id, status: 'Completed' }) });
        return NextResponse.json({ ok: true, ...out, followUps });
      }

      case 'addCustomer': {
        const name = text(body.name);
        if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
        // The browser's shape (store.ts addCustomer), and only these fields, whatever else was posted.
        const id = `cust-${Date.now()}`;
        const customer = {
          id, name,
          phone: normalizePhoneNumber(text(body.phone)) || '',
          email: text(body.email),
          address: text(body.address),
          ...(text(body.source) && { source: text(body.source) }),
        };
        await adminDb.collection('customers').doc(id).set(customer);
        await log('customer.create', `Created customer: ${name}`, `ID: ${id}`, id);
        return NextResponse.json({ ok: true, customer, followUps });
      }
    }
    return NextResponse.json({ error: 'Unknown operation', op }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Not saved.';
    console.error('[/api/app/write]', op, message);
    return NextResponse.json({ error: message }, { status: /not found|no such|invoiced|not on this order/i.test(message) ? 409 : 500 });
  }
}
