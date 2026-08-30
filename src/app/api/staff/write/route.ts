/**
 * The shop floor's write path.
 *
 * Staff have no Firestore access at all, and the client's own write paths read
 * before they write — 22 transaction reads across the store — so they cannot
 * simply be granted narrow write rules. Every change they make comes through
 * here instead, named as an operation rather than as a document patch: a
 * generic "write this document" endpoint would hand back everything the rules
 * are keeping away from them.
 *
 * Only operations listed here exist. Anything else is a 403, including a
 * perfectly well-formed request for a collection they can read.
 */

import { NextRequest, NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { adminPort } from '@/lib/db-admin-port';
import { recordInvoicePayment } from '@/lib/writes/invoice-payment';

export const dynamic = 'force-dynamic';

const ORDER_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Refunded'];

type Body = { op?: string; [k: string]: unknown };

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = roleForEmail(email);
  if (role !== 'staff' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }

  // The lock is an owner's deliberate switch. It has to be honoured here as
  // well as in the client, or it would stop owners and not the shop floor.
  const settings = await adminDb.collection('app_settings').doc('global').get();
  if (settings.exists && settings.data()?.databaseLocked) {
    return NextResponse.json({ error: 'The database is locked.' }, { status: 423 });
  }

  const log = async (action: string, title: string, detail: string, ref?: string) => {
    try {
      await adminDb.collection('activity_log').add({
        action, title, detail, relatedId: ref || null,
        by: email, at: new Date().toISOString(),
        // Marked so an owner reading the log can tell the counter from the office.
        via: 'staff-api',
      });
    } catch (e) { console.error('[/api/staff/write] activity log', e); }
  };

  try {
    switch (body.op) {
      // ── order status ──────────────────────────────────────────────────────
      case 'updateOrderStatus': {
        const orderId = String(body.orderId || '');
        const status = String(body.status || '');
        if (!orderId || !ORDER_STATUSES.includes(status)) {
          return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        }

        const ref = adminDb.collection('orders').doc(orderId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: 'No such order' }, { status: 404 });

        // Completing an order completes every piece in it — the same rule the
        // client applies, so an order finished at the counter does not linger
        // on the Workshop board with unticked items.
        const items = Array.isArray(snap.data()?.items) ? snap.data()!.items : [];
        const needsTicking = status === 'Completed' && items.some((i: { isCompleted?: boolean }) => !i.isCompleted);
        const payload: Record<string, unknown> = { status };
        if (needsTicking) {
          payload.items = items.map((i: Record<string, unknown>) => ({ ...i, isCompleted: true }));
        }

        await ref.set(payload, { merge: true });
        await log('order.update', `Order ${orderId} status changed`, `New status: ${status}`, orderId);
        return NextResponse.json({ ok: true, orderId, status });
      }

      // ── customers ─────────────────────────────────────────────────────────
      case 'addCustomer': {
        const name = String((body.name as string) || '').trim();
        if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

        // Only these fields, whatever else was posted. A customer document is
        // also where a balance would live if one were ever added to it.
        const doc = {
          name,
          phone: String((body.phone as string) || '').trim() || null,
          email: String((body.email as string) || '').trim() || null,
          address: String((body.address as string) || '').trim() || null,
          source: String((body.source as string) || '').trim() || null,
          createdAt: new Date().toISOString(),
          createdBy: email,
        };
        const ref = await adminDb.collection('customers').add(doc);
        await log('customer.create', `Customer ${name} added`, 'Added from the shop floor', ref.id);
        return NextResponse.json({ ok: true, id: ref.id, customer: { id: ref.id, ...doc } });
      }

      // ── payment ───────────────────────────────────────────────────────────
      // Not reimplemented here: this calls the same recordInvoicePayment the
      // browser calls, driven by the Admin SDK instead of the client one. One
      // copy of the till, two ways in.
      case 'recordPayment': {
        const invoiceId = String(body.invoiceId || '');
        const amount = Number(body.amount);
        const date = String(body.date || '') || new Date().toISOString();
        if (!invoiceId || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
        }

        const invoice = await recordInvoicePayment(
          adminPort,
          {
            invoiceId, amount, date,
            method: body.method ? String(body.method) : undefined,
            reference: body.reference ? String(body.reference) : undefined,
          },
          { log: (action, title, detail, ref) => log(action, title, detail, ref) },
        );
        return NextResponse.json({ ok: true, invoice });
      }

      default:
        return NextResponse.json(
          { error: 'Unknown operation', op: body.op ?? null },
          { status: 403 },
        );
    }
  } catch (e) {
    console.error('[/api/staff/write]', body.op, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Write failed' },
      { status: 500 },
    );
  }
}
