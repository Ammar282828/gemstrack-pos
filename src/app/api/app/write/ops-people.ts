/**
 * The people operations of the app's write route: a customer's profile edited, a karigar added or edited
 * (the ERP's customer and karigar forms, native on the phone). Each runs lib/writes/people.ts, the copy the
 * browser's store runs too, on the Admin SDK.
 *
 * Owners only: in the browser these are direct Firestore writes, and the shop floor has no Firestore access
 * (roles.ts). Staff add customers through /api/staff/write and keep their order sizes through setCustomerSizes;
 * neither edits a profile or a karigar.
 *
 * The body is checked as the web forms check it (cleanCustomerEdit, cleanKarigarEdit): only the fields those
 * forms edit are read, text is trimmed, anything else posted is dropped, and a field not sent is not touched.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import type { Karigar } from '@/lib/store';
import { addKarigar, cleanCustomerEdit, cleanKarigarEdit, updateCustomer, updateKarigar } from '@/lib/writes/people';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const PEOPLE_OPS: OpRoles = {
  updateCustomer: ['owner'],
  addKarigar: ['owner'],
  updateKarigar: ['owner'],
};

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The shared write says "No such …" for a person who is not on file (or is removed): a refusal, not a crash. */
const missing = (e: unknown) => (e instanceof Error && /^No such /.test(e.message) ? NextResponse.json({ error: e.message }, { status: 409 }) : null);

export const runPeopleOp: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'updateCustomer': {
      const customerId = idOf(body.customerId);
      if (!customerId) return bad('A customer is needed.');
      const cleaned = cleanCustomerEdit(body.patch);
      if (!cleaned.ok) return bad(cleaned.error);
      try {
        await updateCustomer(adminPort, customerId, cleaned.patch, { log: ctx.log }, { mustExist: true });
      } catch (e) {
        const refused = missing(e);
        if (refused) return refused;
        throw e;
      }
      // What is on file now, so the phone shows what was saved and not what it sent.
      const customer = await adminPort.get('customers', customerId);
      return NextResponse.json({ ok: true, customer, followUps: ctx.followUps });
    }

    case 'addKarigar': {
      const cleaned = cleanKarigarEdit(body.karigar, 'add');
      if (!cleaned.ok) return bad(cleaned.error);
      const karigar = await addKarigar(adminPort, cleaned.patch as Omit<Karigar, 'id'>, { log: ctx.log });
      return NextResponse.json({ ok: true, karigar, followUps: ctx.followUps });
    }

    case 'updateKarigar': {
      const karigarId = idOf(body.karigarId);
      if (!karigarId) return bad('A karigar is needed.');
      const cleaned = cleanKarigarEdit(body.patch, 'update');
      if (!cleaned.ok) return bad(cleaned.error);
      try {
        await updateKarigar(adminPort, karigarId, cleaned.patch, { log: ctx.log }, { mustExist: true });
      } catch (e) {
        const refused = missing(e);
        if (refused) return refused;
        throw e;
      }
      const karigar = await adminPort.get('karigars', karigarId);
      return NextResponse.json({ ok: true, karigar, followUps: ctx.followUps });
    }
  }
  return null;
};
