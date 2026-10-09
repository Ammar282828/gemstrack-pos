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
import { cleanSettingsPatch } from '@/lib/writes/settings';
import { cleanObject, createInvoice, type SaleInput, type SaleLine } from '@/lib/writes/create-invoice';
import { createOrder } from '@/lib/writes/create-order';
import { addRepair, recordRepairPayment, setRepairStatus, type NewRepair } from '@/lib/writes/repairs';
import { REPAIR_STATUSES, type RepairStatus } from '@/lib/repairs';
import { addExpense } from '@/lib/writes/expenses';
import { isOneOffSku } from '@/lib/sku';
import { planHisaabSync } from '@/lib/writes/hisaab-sync';
import { SHAREHOLDERS } from '@/lib/shareholders';
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
  // The web's Hisaab page puts the book right on every visit (lib/writes/hisaab-sync.ts).
  syncHisaab: ['owner'],
  // Sizes from an order, offered to the customer's profile (decision "Sizes to the profile").
  setCustomerSizes: ['owner', 'staff'],
  // Settings → Shop, Alerts, Bank accounts, Data: only the fields lib/writes/settings.ts names.
  updateSettings: ['owner'],
};

/** The last hisaab sync on this server: one every two minutes is plenty, and each reads every invoice. */
let lastHisaabSync = 0;

const SIZE_FIELDS = new Set(['ringSize', 'bangleSize', 'braceletSize']);

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

  // The same change sent twice (a double tap, a retry after a dropped line, a second sheet over a
  // balance not yet refreshed) is recorded once: the phone names each change, and the name is claimed
  // here before anything is written. A refusal or a failure gives the claim back, so a corrected retry
  // goes through.
  const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId) ? body.requestId : null;
  const claim = requestId ? adminDb.collection('app_requests').doc(requestId) : null;
  if (claim) {
    try {
      await claim.create({ op, by: email, at: new Date().toISOString(), expireAt: new Date(Date.now() + 7 * 864e5) });
    } catch (e) {
      if ((e as { code?: number }).code === 6) {
        return NextResponse.json({ error: 'This was already sent and recorded. Check it before entering it again.', duplicate: true }, { status: 409 });
      }
      throw e;
    }
  }

  const perform = async (): Promise<NextResponse> => {
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
          // A piece described at the counter for this bill (NEW-…, lib/sku.ts) was never stock; it is
          // refused only once sold, so a save sent again after a dropped line is not a second sale.
          const stock = await Promise.all(cart.map((l) => adminDb.collection(isOneOffSku(l.sku) ? 'sold_products' : 'products').doc(l.sku).get()));
          const gone = cart.filter((l, i) => isOneOffSku(l.sku) ? stock[i].exists : !stock[i].exists)
            .map((l) => isOneOffSku(l.sku) ? `${l.name || 'a new piece'} (already sold)` : l.sku);
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
          // The highest number on file is a floor for the counter, as the browser's addRepair has it, so a
          // settings document from before repairs existed cannot reissue a number.
          const held = await adminDb.collection('repairs').select().get();
          const floor = held.docs.reduce((m, d) => {
            const n = Number(String(d.id).replace(/^REP-/, ''));
            return Number.isFinite(n) && n > m ? n : m;
          }, 0);
          const repair = await addRepair(adminPort, {
            ...r, pieces,
            // Blank stays blank, as the browser saves it: the walk-in wording is the screens' to say.
            customerName: text(r.customerName),
            advance: Number(r.advance) > 0 ? Number(r.advance) : undefined,
          }, { floor }, { log });
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
            // The karigar's hisaab it is filed under, as the expense form's "Hisaab" field.
            ...(text(body.karigarId) && text(body.batchId) && { batchId: text(body.batchId) }),
            // A partner's salary names the partner, as the Shareholders page files it (lib/shareholders.ts).
            ...(text(body.category) === 'Partner Salary' && SHAREHOLDERS.some((p) => p.id === text(body.shareholderId)) && { shareholderId: text(body.shareholderId) }),
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
            // gold.pk when the rates were filled from it (the rate sheet's button), else the app itself.
            source: text(body.source) === 'gold.pk' ? 'gold.pk' : 'the iPhone app',
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

        case 'syncHisaab': {
          if (Date.now() - lastHisaabSync < 120_000) return NextResponse.json({ ok: true, skipped: true, followUps });
          lastHisaabSync = Date.now();
          const [inv, hs, cs] = await Promise.all(['invoices', 'hisaab', 'customers'].map((c) => adminDb.collection(c).get()));
          const all = (snap: typeof inv) => snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
          const plan = planHisaabSync(all(inv), all(hs), all(cs));
          const writes: ((b: ReturnType<typeof adminPort.batch>) => void)[] = [
            ...plan.deletes.map((id) => (b: ReturnType<typeof adminPort.batch>) => b.delete('hisaab', id)),
            ...plan.updates.map((u) => (b: ReturnType<typeof adminPort.batch>) => b.update('hisaab', u.id, u.patch)),
            ...plan.creates.map((r) => (b: ReturnType<typeof adminPort.batch>) => b.set('hisaab', adminPort.newId('hisaab'), r as unknown as Record<string, unknown>)),
          ];
          for (let i = 0; i < writes.length; i += 450) {
            const b = adminPort.batch();
            writes.slice(i, i + 450).forEach((w) => w(b));
            await b.commit();
          }
          return NextResponse.json({ ok: true, deleted: plan.deletes.length, updated: plan.updates.length, created: plan.creates.length, followUps });
        }

        case 'setCustomerSizes': {
          const customerId = text(body.customerId);
          const sizes = Object.fromEntries(Object.entries((body.sizes || {}) as Record<string, unknown>)
            .filter(([k, v]) => SIZE_FIELDS.has(k) && text(v)).map(([k, v]) => [k, text(v)]));
          if (!customerId || !Object.keys(sizes).length) return NextResponse.json({ error: 'A customer and a size are needed.' }, { status: 400 });
          const ref = adminDb.collection('customers').doc(customerId);
          if (!(await ref.get()).exists) return NextResponse.json({ error: 'No such customer.' }, { status: 409 });
          await ref.set(sizes, { merge: true });
          await log('customer.update', 'Sizes saved to the profile', Object.entries(sizes).map(([k, v]) => `${k}: ${v}`).join(', '), customerId);
          return NextResponse.json({ ok: true, sizes, followUps });
        }

        case 'updateSettings': {
          // A list of what may change, not of what may not: the rates, the lock, the counters and every
          // key are never here (setRates and the ERP's own screens keep them).
          const cleaned = cleanSettingsPatch(body.patch);
          if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });
          // Only the delta, merged: a field the phone did not send is never put back to an old value.
          await adminDb.collection('app_settings').doc('global').set(cleaned.patch, { merge: true });
          // The names of what changed, never the values (bank numbers, phones).
          await log('settings.update', 'Settings changed', `${Object.keys(cleaned.patch).join(', ')} · by ${personFor(email) || email}`);
          return NextResponse.json({ ok: true, changed: Object.keys(cleaned.patch), followUps });
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
  };

  const res = await perform();
  if (claim && res.status >= 300) await claim.delete().catch(() => undefined);
  return res;
}
