/**
 * "Settle" on the server (decision "Round-off"): the payment or advance and the discount raised by the
 * remainder, in ONE write (lib/writes/settle.ts), plus the order's discount alone. Owners only: giving a
 * discount is the owner's (updateInvoiceDiscount is too), so a staff account is refused the lot rather than
 * left with a payment taken and no discount. `extra` is what is ADDED to the discount on file.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { raiseOrderDiscount, SettleRefusal, settleInvoicePayment, settleOrderAdvance } from '@/lib/writes/settle';
import type { OpHandler, OpRoles } from './op-context';

export const SETTLE_OPS: OpRoles = {
  settleInvoicePayment: ['owner'],
  settleOrderAdvance: ['owner'],
  raiseOrderDiscount: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};
const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e12 ? v : null);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : undefined);

export const runSettleOp: OpHandler = async (op, body, ctx) => {
  if (!(op in SETTLE_OPS)) return null;
  const extra = money(body.extra);
  if (extra === null) return bad('Enter the amount to take off.');
  try {
    if (op === 'settleInvoicePayment') {
      const invoiceId = idOf(body.invoiceId);
      const amount = money(body.amount);
      if (!invoiceId) return bad('An invoice is needed.');
      if (amount === null) return bad('A positive amount is required.');
      const date = text(body.date) || new Date().toISOString();
      const invoice = await settleInvoicePayment(adminPort,
        { invoiceId, amount, date, method: text(body.method), reference: text(body.reference), extra },
        { log: ctx.log, notify: id => ctx.alert({ event: 'payment', id, payment: { amount, date } }) });
      return NextResponse.json({ ok: true, invoice, followUps: ctx.followUps });
    }
    const orderId = idOf(body.orderId);
    if (!orderId) return bad('Which order?');
    if (op === 'settleOrderAdvance') {
      const amount = money(body.amount);
      if (amount === null) return bad('A positive amount is required.');
      const order = await settleOrderAdvance(adminPort, { orderId, amount, extra, notes: text(body.notes), method: text(body.method) }, { log: ctx.log });
      return NextResponse.json({ ok: true, order, followUps: ctx.followUps });
    }
    const order = await raiseOrderDiscount(adminPort, { orderId, extra }, { log: ctx.log });
    return NextResponse.json({ ok: true, order, followUps: ctx.followUps });
  } catch (e) {
    if (e instanceof SettleRefusal) return bad(e.message, /not found|invoiced/i.test(e.message) ? 409 : 400);
    throw e;
  }
};
