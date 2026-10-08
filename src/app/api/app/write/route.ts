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
import { alertsOnStatus, ORDER_STATUSES, setOrderPieceDone, setOrderPieceGiven, setOrderPieceKarigar, setOrderStatus, type SettableStatus } from '@/lib/writes/order-status';
import { cleanRates, setRates } from '@/lib/writes/rates';
import { cleanObject, createInvoice, type SaleInput, type SaleLine } from '@/lib/writes/create-invoice';
import { createOrder } from '@/lib/writes/create-order';
import { addRepair, recordRepairPayment, setRepairStatus, type NewRepair } from '@/lib/writes/repairs';
import { REPAIR_STATUSES, type RepairStatus } from '@/lib/repairs';
import { addExpense } from '@/lib/writes/expenses';
import { addGivenItem, markGivenItemReturned } from '@/lib/writes/given';
import { mainRate } from '@/lib/rates';
import { personFor } from '@/lib/people';
import { STORE_CONFIG } from '@/lib/store-config';

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
  setPieceKarigar: ['owner'],
  setPieceGiven: ['owner'],
  setRates: ['owner'],
  createInvoice: ['owner'],
  createOrder: ['owner', 'staff'],
  addRepair: ['owner'],
  setRepairStatus: ['owner'],
  recordRepairPayment: ['owner'],
  addExpense: ['owner'],
  addGivenItem: ['owner'],
  markGivenReturned: ['owner'],
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

      case 'createInvoice': {
        // A new sale (editing one stays the ERP's page for now). The pieces are the phone's copies of
        // the stock, perhaps re-priced by hand, as the browser's cart holds them.
        if (body.existingInvoiceId) return NextResponse.json({ error: 'Edit a sale from its page in the ERP.' }, { status: 400 });
        const cart = Array.isArray(body.cart) ? (body.cart as SaleLine[]).filter((l) => l && typeof l.sku === 'string' && l.sku) : [];
        if (!cart.length) return NextResponse.json({ error: 'The sale has no pieces.' }, { status: 400 });
        // A phone's stock can be seconds old: a piece sold meanwhile is refused, never sold twice.
        const stock = await Promise.all(cart.map((l) => adminDb.collection('products').doc(l.sku).get()));
        const gone = cart.filter((_, i) => !stock[i].exists).map((l) => l.sku);
        if (gone.length) return NextResponse.json({ error: `No longer in stock: ${gone.join(', ')}.` }, { status: 409 });
        const customer = (body.customer || {}) as SaleInput['customer'];
        const invoice = await createInvoice(adminPort, {
          cart,
          customer: { ...(text(customer.id) && { id: text(customer.id) }), name: text(customer.name) || 'Walk-in Customer', ...(text(customer.phone) && { phone: text(customer.phone) }) },
          rates: (body.rates || {}) as SaleInput['rates'],
          discountAmount: Number(body.discountAmount) || 0,
          exchanges: Array.isArray(body.exchanges) ? (body.exchanges as SaleInput['exchanges']) : [],
          delivery: body.delivery as SaleInput['delivery'],
          takenBy: text(body.takenBy) || undefined,
          hideRates: body.hideRates === true,
          internalNote: text(body.internalNote) || undefined,
          payments: Array.isArray(body.payments) ? (body.payments as SaleInput['payments']) : [],
          costRate24k: Number(body.costRate24k) || undefined,
        }, { log, notify: (id) => alert({ event: 'sale', id }) });
        return NextResponse.json({ ok: true, invoice, followUps });
      }

      case 'createOrder': {
        // The same createOrder the browser and the shop floor run: one numbering, one rate snapshot.
        const order = body.order as Record<string, unknown> | undefined;
        if (!order || !Array.isArray(order.items) || order.items.length === 0) {
          return NextResponse.json({ error: 'An order needs at least one piece.' }, { status: 400 });
        }
        const created = await createOrder(adminPort, order as never, {
          // A new customer as the browser makes one (store.ts addCustomer).
          createCustomer: async (c) => {
            const id = `cust-${Date.now()}`;
            await adminDb.collection('customers').doc(id).set({ id, name: c.name, phone: normalizePhoneNumber(c.phone) || '', email: '', address: '' });
            await log('customer.create', `Created customer: ${c.name}`, `ID: ${id}`, id);
            return { id, name: c.name };
          },
          normalizePhone: (v) => normalizePhoneNumber(v),
          clean: cleanObject,
        }, { log, notify: (id) => alert({ event: 'order', id }) });
        return NextResponse.json({ ok: true, order: created, followUps });
      }

      case 'addRepair': {
        const r = (body.repair || {}) as NewRepair;
        const pieces = Array.isArray(r.pieces) ? r.pieces.filter((p) => p && text(p.item)) : [];
        if (!pieces.length) return NextResponse.json({ error: 'A repair needs at least one piece.' }, { status: 400 });
        const repair = await addRepair(adminPort, {
          ...r, pieces,
          customerName: text(r.customerName) || 'Walk-in Customer',
          advance: Number(r.advance) > 0 ? Number(r.advance) : undefined,
        }, {}, { log });
        return NextResponse.json({ ok: true, repair, followUps });
      }

      case 'setRepairStatus': {
        const id = text(body.repairId);
        const status = text(body.status) as RepairStatus;
        if (!id || !(REPAIR_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        await setRepairStatus(adminPort, id, status, {}, { log });
        return NextResponse.json({ ok: true, repairId: id, status, followUps });
      }

      case 'recordRepairPayment': {
        const id = text(body.repairId);
        const amount = Number(body.amount);
        if (!id || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
        await recordRepairPayment(adminPort, id, {
          amount, date: text(body.date) || new Date().toISOString(),
          ...(text(body.method) && { method: text(body.method) as never }),
          ...(text(body.note) && { note: text(body.note) }),
        }, { log });
        return NextResponse.json({ ok: true, repairId: id, followUps });
      }

      case 'addExpense': {
        const amount = Number(body.amount);
        const description = text(body.description);
        if (!description || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'A description and a positive amount are needed.' }, { status: 400 });
        const paidBy = text(body.paidBy);
        const expense = await addExpense(adminPort, {
          date: text(body.date) || new Date().toISOString(),
          category: text(body.category) || 'Other',
          description, amount,
          ...(paidBy === 'ammar' || paidBy === 'mina' || paidBy === 'business' ? { paidBy } : {}),
          ...(text(body.karigarId) && { karigarId: text(body.karigarId) }),
        }, { log });
        return NextResponse.json({ ok: true, expense, followUps });
      }

      case 'addGivenItem': {
        const description = text(body.description);
        const recipientName = text(body.recipientName);
        const recipientType = text(body.recipientType);
        if (!description || !recipientName || !['karigar', 'customer', 'other'].includes(recipientType)) {
          return NextResponse.json({ error: 'What was given, and to whom, are needed.' }, { status: 400 });
        }
        const item = await addGivenItem(adminPort, {
          date: text(body.date) || new Date().toISOString(),
          description, recipientName, recipientType: recipientType as never,
          ...(text(body.recipientId) && { recipientId: text(body.recipientId) }),
          ...(text(body.notes) && { notes: text(body.notes) }),
          status: 'out',
        } as never, { log });
        return NextResponse.json({ ok: true, item, followUps });
      }

      case 'markGivenReturned': {
        const id = text(body.id);
        if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        const snap = await adminDb.collection('given_items').doc(id).get();
        if (!snap.exists) return NextResponse.json({ error: 'No such item' }, { status: 404 });
        await markGivenItemReturned(adminPort, id, text(body.returnedDate) || new Date().toISOString(), snap.data() as never, { log });
        return NextResponse.json({ ok: true, id, followUps });
      }

      case 'setRates': {
        // Unchanged figures still stamp the day: the website sells only at a rate set in the last 36 hours.
        const out = await setRates(adminPort, {
          rates: cleanRates((body.rates as Record<string, unknown>) || {}),
          by: personFor(email) || email,
          mainKey: mainRate(STORE_CONFIG.defaultMetal).key,
          source: 'the iPhone app',
        }, { log });
        return NextResponse.json({ ok: true, ...out, followUps });
      }

      case 'setPieceKarigar': {
        const orderId = text(body.orderId);
        const index = Number(body.index);
        if (!orderId || !Number.isInteger(index)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        const karigarId = text(body.karigarId) || null;
        const karigar = karigarId && karigarId !== 'none' ? await adminDb.collection('karigars').doc(karigarId).get() : null;
        const out = await setOrderPieceKarigar(adminPort, { orderId, index, karigarId, karigarName: karigar?.data()?.name }, { log });
        return NextResponse.json({ ok: true, ...out, followUps });
      }

      case 'setPieceGiven': {
        const orderId = text(body.orderId);
        const index = Number(body.index);
        if (!orderId || !Number.isInteger(index)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
        const givenAt = body.given === true ? (text(body.givenAt) || new Date().toISOString()) : null;
        const out = await setOrderPieceGiven(adminPort, { orderId, index, givenAt });
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
    return NextResponse.json({ error: message }, { status: /not found|no such|invoiced|not on this order|already exists|more than the invoice/i.test(message) ? 409 : 500 });
  }
}
