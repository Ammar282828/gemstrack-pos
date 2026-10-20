/**
 * Settings → Data → Import the Taheri Software book, native on the phone: the one-off migration from the shop's
 * previous app (lib/import/taheri-book.ts plans it, lib/writes/taheri-book-import.ts writes it), on the Admin SDK.
 *
 * Owners only: it is an owners' settings page (roles.ts).
 *
 * - The book is the extracted file the ERP ships (taheri-book.json), as the page reads it: there is nothing to
 *   pick. `preview: true` answers what Import WOULD do against the books as they are now (the tallies, each
 *   half-match with the ledger its namesake carries) and writes nothing.
 * - Import plans again and must find the plan the phone showed (its fingerprint), so a customer added meanwhile is
 *   never decided on a preview that did not show them. Half-matches are added only with `takeConflicts: true`.
 *   Hundreds of rows go as a few batches (gathered.ts), so it ends inside the server's minute; run again, it adds
 *   nobody, as they all count as already here.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { planBookImport, type TaheriBook } from '@/lib/import/taheri-book';
import { loadTaheriBook } from '@/lib/import/taheri-book-server';
import { customerIdMaker } from '@/lib/writes/new-customer';
import { gather } from '@/lib/writes/gathered';
import { bookHalfMatches, bookPlanFingerprint, bookWillAdd, ledgerCounts, runBookImport } from '@/lib/writes/taheri-book-import';
import { readPeople } from './ops-settings2';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const SETTINGS4_OPS: OpRoles = {
  importTaheriBook: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const runSettings4Op: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'importTaheriBook': {
      const book: TaheriBook | null = await loadTaheriBook();
      if (!book) return bad('No book', 404);
      const people = await readPeople();
      const plan = planBookImport(book, people.customers, people.karigars);
      const takeConflicts = body.takeConflicts === true;

      if (body.preview === true) {
        const held = await adminDb.collection('hisaab').select('entityId').get();
        const ledger = ledgerCounts(held.docs.map((d) => {
          const id = d.get('entityId');
          return typeof id === 'string' ? id : undefined;
        }));
        return NextResponse.json({
          ok: true,
          preview: true,
          source: book.source,
          inFile: { customers: book.customers.length, karigars: book.karigars.length },
          counts: plan.counts,
          halfMatches: bookHalfMatches(plan, ledger),
          willAdd: { only: bookWillAdd(plan, false), withHalfMatches: bookWillAdd(plan, true) },
          fingerprint: bookPlanFingerprint(plan),
          followUps: ctx.followUps,
        });
      }

      if (body.fingerprint !== bookPlanFingerprint(plan)) {
        return bad('The book has changed since this was read. Look again before importing.', 409);
      }
      if (!bookWillAdd(plan, takeConflicts)) return bad('Nothing to add: everyone in the file is already here.');

      const held = gather(adminPort, ctx.log);
      const out = await runBookImport(held.port, plan, takeConflicts, { newCustomerId: customerIdMaker(people.customerIds) }, held.fx);
      await held.commit();
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }
  }
  return null;
};
