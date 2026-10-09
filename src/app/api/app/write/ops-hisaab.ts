/**
 * The hisaab operations of the app's write route: a row written by hand in a person's ledger ("You gave",
 * "You got") and a row deleted (the ledger page, src/app/hisaab/[entityId], native on the phone). Each runs
 * lib/writes/hisaab-entries.ts, the copy of the store's addHisaabEntry and deleteHisaabEntry, on the Admin SDK.
 *
 * Owners only: the hisaab is the owners' book, and the browser writes it straight to Firestore, which the
 * shop floor cannot reach.
 *
 * A row is written only for a customer or a karigar who is on file and not removed, named as they are on file,
 * as the page does it: the page says "Entity not found" for anyone else (a walk-in's balance has no page to
 * write on). A delete asks for the delete code, as the store's does (decision "Delete code"): it comes with
 * the request and is checked here, with the same tries and logging as /api/auth/delete-code, before anything
 * is touched. A row that is already gone is said first, so no try is spent on it.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { STORE_METAL_WORD } from '@/lib/store-config';
import { addHisaabEntry, cleanHisaabEntry, deleteHisaabEntry, HisaabRefusal } from '@/lib/writes/hisaab-entries';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const HISAAB_OPS: OpRoles = {
  addHisaabEntry: ['owner'],
  deleteHisaabEntry: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runHisaabOp: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'addHisaabEntry': {
      const cleaned = cleanHisaabEntry(body, { metalWord: STORE_METAL_WORD });
      if (!cleaned.ok) return bad(cleaned.error);
      const form = cleaned.data;
      const person = await adminPort.get<{ name?: string; deletedAt?: unknown }>(form.entityType === 'customer' ? 'customers' : 'karigars', form.entityId);
      // The page's own words; a removed person is gone from its lists, so it does not find them either.
      if (!person || person.deletedAt) return bad('Entity not found. It may have been deleted.', 409);
      const entry = await addHisaabEntry(adminPort, form, person.name ?? '');
      return NextResponse.json({ ok: true, entry, followUps: ctx.followUps });
    }

    case 'deleteHisaabEntry': {
      const entryId = typeof body.entryId === 'string' ? body.entryId.trim() : '';
      if (!entryId || entryId.length > 200 || entryId.includes('/')) return bad('Which entry?');
      if (!(await adminPort.get('hisaab', entryId))) return bad('No such ledger entry.', 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, 'Delete this ledger entry');
      if (!code.ok) return bad(code.error, code.status);
      try {
        const deleted = await deleteHisaabEntry(adminPort, entryId);
        return NextResponse.json({ ok: true, ...deleted, followUps: ctx.followUps });
      } catch (e) {
        if (e instanceof HisaabRefusal) return bad(e.message, 409);
        throw e;
      }
    }
  }
  return null;
};
