/**
 * The order page's undoing moves, native on the phone: Undo invoice (the invoiced banner's Cancel invoice,
 * and Unlock & edit, which is the same write before the edit form), Refund order and Delete order. Each
 * runs lib/writes/order-undo.ts, the copy the store's revertOrderFromInvoice, refundOrder and deleteOrder
 * are written to, on the Admin SDK.
 *
 * Owners only: in the browser these write Firestore from the store, which the shop floor cannot (roles.ts),
 * and each moves money or takes a sale off the books.
 *
 * Every one asks for the delete code, as the store asks it (decision "Delete code"), in the store's words: it
 * comes with the request and is checked here (passDeleteCode, the same tries and logging as
 * /api/auth/delete-code) before anything is touched. What would be refused anyway is said first, so no try is
 * spent on it: an order not on file, an undo of an order with no invoice (or a different one from the one the
 * phone showed), a refund of an order already cancelled or refunded, a delete of an invoiced order.
 *
 * Shopify is told after the write, as the follow-ups the phone posts (the invoice's order refunded, the
 * order's draft dropped), the way the store fires them without waiting.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import {
  deleteOrder, deleteWhat, invoicedRefusal, OrderUndoRefusal, refundOrder, refundWhat, undoOrderInvoice, undoWhat,
  type OrderDoc, type OrderUndoDeps, type OrderUndoEffects,
} from '@/lib/writes/order-undo';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const ORDER_OPS: OpRoles = {
  undoOrderInvoice: ['owner'],
  refundOrder: ['owner'],
  deleteOrder: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The server's answers for the shared write: Firestore's field removal, and every invoice's pieces. */
const deps: OrderUndoDeps = {
  deleteField: () => FieldValue.delete(),
  invoices: async () => {
    const snap = await adminDb.collection('invoices').select('items').get();
    return snap.docs.map(d => ({ id: d.id, items: d.data()?.items }));
  },
};

export const runOrderOp: OpHandler = async (op, body, ctx) => {
  const fx: OrderUndoEffects = { log: ctx.log, shopify: call => ctx.followUps.push(call) };
  const orderId = idOf(body.orderId);
  if (!(op in ORDER_OPS)) return null;
  if (!orderId) return bad('Which order?');
  const order = await adminPort.get<OrderDoc>('orders', orderId);
  if (!order) return bad('No such order.', 409);

  // The shared write says why it will not, in the page's words: a refusal, not a crash.
  const attempt = async (run: () => Promise<Record<string, unknown>>) => {
    try {
      return NextResponse.json({ ok: true, ...(await run()), followUps: ctx.followUps });
    } catch (e) {
      if (e instanceof OrderUndoRefusal) return bad(e.message, 409);
      throw e;
    }
  };

  switch (op) {
    case 'undoOrderInvoice': {
      const invoiceId = order.invoiceId || '';
      if (!invoiceId) return bad(`${orderId} has no invoice to undo.`, 409);
      const shown = idOf(body.invoiceId);
      if (shown && shown !== invoiceId) return bad(`${orderId} is invoiced as ${invoiceId} now, not ${shown}. Check it before undoing it.`, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, undoWhat(orderId, invoiceId));
      if (!code.ok) return bad(code.error, code.status);
      return attempt(() => undoOrderInvoice(adminPort, { orderId, invoiceId }, deps, fx));
    }

    case 'refundOrder': {
      if (order.status === 'Refunded') return bad(`${orderId} is already refunded.`, 409);
      if (order.status === 'Cancelled') return bad(`${orderId} is cancelled: there is nothing to refund.`, 409);
      // The phone says which invoice goes with it; one invoiced or undone since is checked again first.
      if ('invoiceId' in body && (idOf(body.invoiceId) || '') !== (order.invoiceId || '')) {
        return bad(`${orderId} has changed since: check it before refunding it.`, 409);
      }
      const code = await passDeleteCode(ctx.email, body.deleteCode, refundWhat(orderId));
      if (!code.ok) return bad(code.error, code.status);
      return attempt(() => refundOrder(adminPort, { orderId }, deps, fx));
    }

    case 'deleteOrder': {
      if (order.invoiceId) return bad(invoicedRefusal(orderId, order.invoiceId), 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, deleteWhat(orderId));
      if (!code.ok) return bad(code.error, code.status);
      return attempt(() => deleteOrder(adminPort, { orderId }, fx));
    }
  }
  return null;
};
