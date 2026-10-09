/**
 * The customer clean-up operations of the app's write route: a customer removed (hidden, with their
 * history left where it is), and a duplicate merged into the customer who stays (the Customers page's
 * Remove and "Merge duplicates", native on the phone). Each runs lib/writes/customer-admin.ts, the copy
 * of the store's deleteCustomer and mergeCustomers, on the Admin SDK.
 *
 * Owners only: in the browser these are direct Firestore writes, and the shop floor has no Firestore access.
 *
 * Both ask for the delete code, as the store's own actions do (decision "Delete code"): it comes with the
 * request and is checked here, with the same tries and logging as /api/auth/delete-code, before anything is
 * touched. A customer who is not there, or is removed already, is said before the code is asked for, so no
 * try is spent on it.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { CustomerRefusal, mergeCustomers, planCustomerMerge, removeCustomer } from '@/lib/writes/customer-admin';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const CUSTOMER_OPS: OpRoles = {
  removeCustomer: ['owner'],
  mergeCustomers: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The shared write's words for a customer who is not there, or two who are not a merge: a refusal, not a crash. */
const refusal = (e: unknown) => (e instanceof CustomerRefusal ? bad(e.message, 409) : null);

export const runCustomerOp: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };

  switch (op) {
    case 'removeCustomer': {
      const id = idOf(body.customerId);
      if (!id) return bad('A customer is needed.');
      const c = await adminPort.get<{ name?: string; deletedAt?: unknown }>('customers', id);
      if (!c) return bad('No such customer.', 409);
      const name = c.name || id;
      if (c.deletedAt) return bad(`${name} has already been removed.`, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete customer ${name}`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const removed = await removeCustomer(adminPort, id, fx);
        return NextResponse.json({ ok: true, ...removed, followUps: ctx.followUps });
      } catch (e) {
        const refused = refusal(e);
        if (refused) return refused;
        throw e;
      }
    }

    case 'mergeCustomers': {
      const keepId = idOf(body.keepId);
      const deleteId = idOf(body.deleteId);
      if (!keepId || !deleteId) return bad('Choose the customer to keep and the duplicate.');
      if (keepId === deleteId) return bad('Choose two different customers.');
      let duplicate: string;
      try {
        duplicate = (await planCustomerMerge(adminPort, keepId, deleteId)).duplicate.name;
      } catch (e) {
        const refused = refusal(e);
        if (refused) return refused;
        throw e;
      }
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Merge, and delete customer ${duplicate}`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const merged = await mergeCustomers(adminPort, keepId, deleteId, fx);
        return NextResponse.json({ ok: true, ...merged, followUps: ctx.followUps });
      } catch (e) {
        const refused = refusal(e);
        if (refused) return refused;
        throw e;
      }
    }
  }
  return null;
};
