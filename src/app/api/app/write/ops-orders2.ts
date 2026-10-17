/**
 * The order page's two trash buttons, native on the phone: take a piece off an order still being made, and
 * delete one of its advances. Each runs lib/writes/order-pieces.ts, the copy the store's removeItemFromOrder
 * and deleteOrderAdvance run, on the Admin SDK.
 *
 * Owners only: in the browser both are the store's own Firestore write, which the shop floor cannot make
 * (roles.ts).
 *
 * Both ask for the delete code, as the store asks it (decision "Delete code"), in the store's words, checked
 * here before anything is touched. What would be refused anyway is said first, so no try is spent on it: an
 * order not on file or invoiced, a piece or an advance not where the phone showed it, the last piece.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { orderAdvancePayments } from '@/lib/order-payment';
import type { Order } from '@/lib/store';
import {
  CHANGED_ADVANCES, deleteAdvanceWhat, deleteOrderAdvance, OrderPieceRefusal, orderWithoutPiece, removeOrderPiece, removePieceWhat,
} from '@/lib/writes/order-pieces';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const ORDERS2_OPS: OpRoles = {
  removeOrderPiece: ['owner'],
  deleteOrderAdvance: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

const indexOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000 ? v : null);

export const runOrders2Op: OpHandler = async (op, body, ctx) => {
  if (!(op in ORDERS2_OPS)) return null;
  const orderId = idOf(body.orderId);
  if (!orderId) return bad('Which order?');
  const order = await adminPort.get<Order>('orders', orderId);
  if (!order) return bad('No such order.', 409);

  // The shared write says why it will not, in the page's words: a refusal, not a crash.
  const attempt = async (run: () => Promise<Record<string, unknown>>) => {
    try {
      return NextResponse.json({ ok: true, ...(await run()), followUps: ctx.followUps });
    } catch (e) {
      if (e instanceof OrderPieceRefusal) return bad(e.message, 409);
      throw e;
    }
  };

  switch (op) {
    case 'removeOrderPiece': {
      const index = indexOf(body.index);
      if (index === null) return bad('Which piece?');
      if (body.description !== undefined && typeof body.description !== 'string') return bad('Which piece?');
      const description = typeof body.description === 'string' ? body.description : undefined;
      // Said before the code is asked for: an invoiced order, a piece that moved, the last one.
      try { orderWithoutPiece(order, index, description); } catch (e) {
        if (e instanceof OrderPieceRefusal) return bad(e.message, 409);
        throw e;
      }
      const code = await passDeleteCode(ctx.email, body.deleteCode, removePieceWhat(orderId, index));
      if (!code.ok) return bad(code.error, code.status);
      return attempt(async () => ({ order: await removeOrderPiece(adminPort, { orderId, index, description }, { log: ctx.log }) }));
    }

    case 'deleteOrderAdvance': {
      const lineIndex = indexOf(body.lineIndex);
      const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? body.amount : null;
      if (lineIndex === null || amount === null) return bad('Which advance?');
      if (order.invoiceId) return bad(`${orderId} is invoiced: delete the payment on ${order.invoiceId} instead.`, 409);
      const line = orderAdvancePayments({ ...order, id: orderId }, '')[lineIndex];
      if (!line || Math.abs(line.amount - amount) >= 1) return bad(CHANGED_ADVANCES, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, deleteAdvanceWhat(orderId, amount));
      if (!code.ok) return bad(code.error, code.status);
      return attempt(async () => ({
        order: await deleteOrderAdvance(adminPort, { orderId, lineIndex, amount }, { deleteField: () => FieldValue.delete() }, { log: ctx.log }),
      }));
    }
  }
  return null;
};
