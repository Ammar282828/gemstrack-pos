/**
 * What the invoice page does to a saved invoice besides taking a payment (components/invoice/invoice-viewer.tsx),
 * native on the phone: change the discount, delete one payment, a partial refund, and delete the invoice, which
 * is also the page's full refund. Each runs the shared write the browser's store runs (lib/writes/
 * invoice-discount.ts, invoice-payment.ts `removeInvoicePayment`, invoice-refund.ts, invoice-delete.ts) on the
 * Admin SDK.
 *
 * Owners only: in the browser each is the store's own Firestore write, which the shop floor cannot make
 * (roles.ts); staff see the buttons there, and are refused.
 *
 * A delete and a refund ask for the delete code, as the store asks for it before each (decision "Delete code"):
 * it comes with the request and is checked here, with the same tries and logging as /api/auth/delete-code,
 * in the store's own words, before anything is touched. An invoice that is not on file, or a payment that is
 * not where the page showed it, is said first, so no try is spent on it. The discount asks no code, as on the
 * web.
 *
 * `seen` ({ grandTotal, amountPaid }, optional): the figures the phone's confirmation was worked out from. When
 * the invoice has moved since (a payment taken on another screen), nothing is written and the phone is asked to
 * look again, so what was confirmed is what happens.
 *
 * Shopify is told after, as the browser tells it: a partial refund for the same amount, a deleted invoice's
 * order cancelled. Those go back as follow-ups the phone posts once the write has landed.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { discountProblem } from '@/lib/invoice-actions';
import { updateInvoiceDiscount } from '@/lib/writes/invoice-discount';
import { removeInvoicePayment } from '@/lib/writes/invoice-payment';
import { refundInvoicePartial } from '@/lib/writes/invoice-refund';
import { deleteInvoice, deleteInvoiceWhat } from '@/lib/writes/invoice-delete';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const INVOICE_ACTION_OPS: OpRoles = {
  updateInvoiceDiscount: ['owner'],
  deleteInvoicePayment: ['owner'],
  refundInvoicePartial: ['owner'],
  deleteInvoice: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

const figure = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12 ? v : null);

type OnFile = {
  grandTotal?: number; amountPaid?: number; subtotal?: number; status?: string;
  paymentHistory?: { amount?: number; date?: string }[];
};

const NOT_FOUND = (id: string) => `Invoice ${id} not found.`;
const MOVED = 'This invoice has changed since it was opened. Look at it again and try once more.';
/** removeInvoicePayment's own refusal, when the payment is no longer where the page showed it. */
const PAYMENTS_CHANGED = 'The payments on this invoice changed. Open it again and try once more.';

/** The figures the phone confirmed against: absent is fine, malformed is refused, different is "look again". */
function seenProblem(seen: unknown, inv: OnFile): NextResponse | null {
  if (seen === undefined) return null;
  if (!seen || typeof seen !== 'object' || Array.isArray(seen)) return bad('What was seen is a total and what was paid.');
  const s = seen as Record<string, unknown>;
  const total = figure(s.grandTotal);
  const paid = figure(s.amountPaid);
  if (total === null || paid === null) return bad('What was seen is a total and what was paid.');
  const moved = Math.abs(total - (Number(inv.grandTotal) || 0)) > 0.005 || Math.abs(paid - (Number(inv.amountPaid) || 0)) > 0.005;
  return moved ? bad(MOVED, 409) : null;
}

/** The store's own words, so the log of who tried the code reads as the browser's does. */
const amountWords = (n: number) => n.toLocaleString();

export const runInvoiceActionOp: OpHandler = async (op, body, ctx) => {
  if (!(op in INVOICE_ACTION_OPS)) return null;
  const invoiceId = idOf(body.invoiceId);
  if (!invoiceId) return bad('An invoice is needed.');
  // Read once, before anything: a gone invoice is said without asking the code.
  const onFile = await adminPort.get<OnFile>('invoices', invoiceId);
  if (!onFile) return bad(NOT_FOUND(invoiceId), 409);

  switch (op) {
    case 'updateInvoiceDiscount': {
      const discountAmount = figure(body.discountAmount);
      if (discountAmount === null) return bad('Enter the discount.');
      const problem = discountProblem(onFile.subtotal, discountAmount);
      if (problem) return bad(problem);
      const moved = seenProblem(body.seen, onFile);
      if (moved) return moved;
      try {
        const invoice = await updateInvoiceDiscount(adminPort, { invoiceId, discountAmount }, { log: ctx.log });
        return NextResponse.json({ ok: true, invoice, followUps: ctx.followUps });
      } catch (e) {
        // Refused against the invoice as it is now, inside the write.
        const message = e instanceof Error ? e.message : '';
        if (/^Discount cannot/.test(message)) return bad(message);
        throw e;
      }
    }

    case 'deleteInvoicePayment': {
      const index = body.index;
      const amount = figure(body.amount);
      // `paymentDate`, not `date`: the phone leaves `date` out of a change's name (ERPAPI requestId), and two
      // payments of the same amount deleted one after the other from the same place are two changes.
      const date = typeof body.paymentDate === 'string' ? body.paymentDate : '';
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || amount === null || !date || date.length > 64) {
        return bad('Which payment?');
      }
      const shown = (onFile.paymentHistory || [])[index];
      if (!shown || Math.abs((Number(shown.amount) || 0) - amount) > 0.005 || shown.date !== date) return bad(PAYMENTS_CHANGED, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete the payment of PKR ${amountWords(amount)} on ${invoiceId}`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const out = await removeInvoicePayment(adminPort, { invoiceId, index, amount, date }, { log: ctx.log });
        const { removed, ...invoice } = out;
        return NextResponse.json({ ok: true, invoice, removed, followUps: ctx.followUps });
      } catch (e) {
        if (e instanceof Error && e.message === PAYMENTS_CHANGED) return bad(e.message, 409);
        throw e;
      }
    }

    case 'refundInvoicePartial': {
      const amount = figure(body.amount);
      if (amount === null || !(amount > 0)) return bad('Enter a refund amount greater than 0.');
      if (body.reason !== undefined && typeof body.reason !== 'string') return bad('The reason is text.');
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
      // The page offers no refund on a refunded invoice.
      if (onFile.status === 'Refunded') return bad('This invoice is refunded already.', 409);
      const moved = seenProblem(body.seen, onFile);
      if (moved) return moved;
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Refund PKR ${amountWords(amount)} on ${invoiceId}`);
      if (!code.ok) return bad(code.error, code.status);
      const invoice = await refundInvoicePartial(adminPort, { invoiceId, amount, ...(reason && { reason }) }, {
        log: ctx.log,
        refundOnShopify: (id, amt, why) => ctx.followUps.push({
          path: '/api/shopify/sync/invoice',
          body: { invoiceId: id, action: 'refund', amount: amt, ...(why && { reason: why }) },
        }),
      });
      return NextResponse.json({ ok: true, invoice, followUps: ctx.followUps });
    }

    case 'deleteInvoice': {
      // The page's Delete, and its Refund → Full refund: the same store call, asked in the same words.
      const code = await passDeleteCode(ctx.email, body.deleteCode, deleteInvoiceWhat(invoiceId));
      if (!code.ok) return bad(code.error, code.status);
      const out = await deleteInvoice(adminPort, { invoiceId }, {
        deleteField: () => FieldValue.delete(),
        // The browser asks its live list of invoices; here they are read, their pieces only.
        invoices: async () => {
          const snap = await adminDb.collection('invoices').select('items').get();
          return snap.docs.map((d) => ({ id: d.id, items: d.data()?.items }));
        },
      }, {
        log: ctx.log,
        shopify: (call) => ctx.followUps.push({ path: call.path, body: call.body }),
      });
      if (!out.deleted) return bad(NOT_FOUND(invoiceId), 409);
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }
  }
  return null;
};
