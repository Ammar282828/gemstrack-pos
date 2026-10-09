/**
 * The invoice operations of the app's write route: who a saved sale was for, named or changed on the invoice
 * (the invoice page's "Name them / Change", native on the phone). It runs lib/writes/invoice-customer.ts, the
 * copy the browser's store runs too, on the Admin SDK.
 *
 * Owners only: in the browser this is a Firestore transaction of the store's own (the invoice, the customer,
 * the hisaab rows), and the shop floor has no Firestore access (roles.ts). Staff see the dialog there, and it
 * is refused.
 *
 * The body is checked as the dialog checks it (cleanInvoiceCustomer): a name that is a person's, the picked
 * customer's id, the number; anything else posted is dropped.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { cleanInvoiceCustomer, NAME_NEEDED, setInvoiceCustomer } from '@/lib/writes/invoice-customer';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const INVOICE_OPS: OpRoles = {
  setInvoiceCustomer: ['owner'],
};

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

export const runInvoiceOp: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'setInvoiceCustomer': {
      const invoiceId = idOf(body.invoiceId);
      if (!invoiceId) return bad('An invoice is needed.');
      const cleaned = cleanInvoiceCustomer(body);
      if (!cleaned.ok) return bad(cleaned.error);
      try {
        const invoice = await setInvoiceCustomer(adminPort, invoiceId, cleaned.who, { log: ctx.log });
        return NextResponse.json({ ok: true, invoice, followUps: ctx.followUps });
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message === NAME_NEEDED) return bad(message);
        // Refunded in full, which removes it, or never there: a refusal, not a crash.
        if (/^Invoice .* not found\.$/.test(message)) return NextResponse.json({ error: message }, { status: 409 });
        throw e;
      }
    }
  }
  return null;
};
