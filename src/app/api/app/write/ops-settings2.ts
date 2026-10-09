/**
 * The rest of Settings, native on the phone: Voice (a learned name forgotten), Labels (the tag's layout
 * saved), Backups (a sold piece put back in stock, the latest pieces deleted) and the two imports (contacts
 * from a phone's .vcf, one person's hisaab from a CSV). Each runs its shared write (lib/writes/voice-aliases.ts,
 * label-layout.ts, stock-recovery.ts, lib/contacts/import-run.ts, lib/import/hisaab-csv.ts) on the Admin SDK.
 *
 * Owners only: these are the owners' settings pages, written by the browser to Firestore directly, which the
 * shop floor cannot do (roles.ts).
 *
 * - Deleting the latest pieces is a delete of stock and asks for the delete code, checked here before anything
 *   is touched, in the store's words ("Delete the latest 3 products"). Forgetting a name is a settings list and
 *   does not (decision "Delete code").
 * - The imports send their file again with the import, and it is read again here against the books as they are
 *   now: the contacts' plan must be the one the phone showed (its fingerprint), and the hisaab's rows must all
 *   be right, as the page refuses a file with a bad row. Each import is a few batches, not a write per row, so it
 *   ends inside the server's minute. A ledger row's id comes from the person and the file, so the same file
 *   imported again for the same person (a retry after a dropped line) writes over its own rows, never a second
 *   copy of the ledger.
 */

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { personFor } from '@/lib/people';
import type { Customer, Karigar } from '@/lib/store';
import { forgetVoiceAlias } from '@/lib/writes/voice-aliases';
import { cleanLabelLayout, saveLabelLayout } from '@/lib/writes/label-layout';
import { deleteProducts, latestProductSkus, reAddSoldProduct } from '@/lib/writes/stock-recovery';
import { customerIdMaker } from '@/lib/writes/new-customer';
import { gather } from '@/lib/writes/gathered';
import { planImport, toExistingRows } from '@/lib/contacts/triage';
import { checkChoices, contactImportSteps, planFingerprint, runContactImport } from '@/lib/contacts/import-run';
import { hisaabCsvRefusal, hisaabImportEntries, parseHisaabCsv } from '@/lib/import/hisaab-csv';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const SETTINGS2_OPS: OpRoles = {
  forgetVoiceAlias: ['owner'],
  saveLabelLayout: ['owner'],
  reAddSoldProduct: ['owner'],
  deleteLatestProducts: ['owner'],
  importContacts: ['owner'],
  importHisaab: ['owner'],
};

/** A whole address book is a few megabytes once its photos are left behind; anything bigger is not one. */
export const MAX_IMPORT_TEXT = 8 * 1024 * 1024;
/** More rows than any one person's ledger; a file this long is the wrong file. */
export const MAX_HISAAB_ROWS = 5000;
const CHUNK = 400;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The shared write says "No such …" for a record that is not on file: a refusal, not a crash. */
const missing = (e: unknown) => (e instanceof Error && /^No such /.test(e.message) ? bad(e.message, 409) : null);

/** An import's file: text, not empty, not absurd. */
const fileText = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.length <= MAX_IMPORT_TEXT ? v : null);

/** Every customer and karigar on file, the removed ones apart, as the store holds them (splitRemoved). */
export async function readPeople(): Promise<{ customers: Customer[]; karigars: Karigar[]; customerIds: string[] }> {
  const [c, k] = await Promise.all([adminDb.collection('customers').get(), adminDb.collection('karigars').get()]);
  const all = c.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer);
  return {
    customers: all.filter((x) => !x.deletedAt),
    karigars: k.docs.map((d) => ({ ...d.data(), id: d.id }) as Karigar).filter((x) => !x.deletedAt),
    customerIds: all.map((x) => x.id),
  };
}

export const runSettings2Op: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'forgetVoiceAlias': {
      const id = idOf(body.aliasId);
      if (!id) return bad('Which name?');
      try {
        const gone = await forgetVoiceAlias(adminPort, id);
        return NextResponse.json({ ok: true, ...gone, followUps: ctx.followUps });
      } catch (e) {
        const refused = missing(e);
        if (refused) return refused;
        throw e;
      }
    }

    case 'saveLabelLayout': {
      const cleaned = cleanLabelLayout(body.layout);
      if (!cleaned.ok) return bad(cleaned.error);
      const layout = await saveLabelLayout(adminPort, cleaned.layout, {
        log: (a, t, d, r) => ctx.log(a, t, `${d} · by ${personFor(ctx.email) || ctx.email}`, r),
      });
      return NextResponse.json({ ok: true, layout, followUps: ctx.followUps });
    }

    case 'reAddSoldProduct': {
      const sku = idOf(body.sku);
      if (!sku) return bad('Which sold piece?');
      // The SKUs in stock, as the browser holds them, for the next number under the category's prefix.
      const held = await adminDb.collection('products').select().get();
      try {
        const product = await reAddSoldProduct(adminPort, sku, { skus: held.docs.map((d) => d.id) }, { log: ctx.log });
        return NextResponse.json({ ok: true, product, followUps: ctx.followUps });
      } catch (e) {
        const refused = missing(e);
        if (refused) return refused;
        throw e;
      }
    }

    case 'deleteLatestProducts': {
      const count = body.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || count > 10_000) return bad('Please enter a positive number.');
      const held = await adminDb.collection('products').select('name').get();
      const names = new Map(held.docs.map((d): [string, unknown] => [d.id, (d.data() as { name?: unknown }).name]));
      const skus = latestProductSkus(names.keys(), count);
      // Nothing to delete is said before the code is asked for, so no try is spent on it.
      if (!skus.length) return NextResponse.json({ ok: true, deleted: 0, followUps: ctx.followUps });
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete the latest ${count} products`);
      if (!code.ok) return bad(code.error, code.status);
      const deleted = await deleteProducts(adminPort, skus.map((sku) => {
        const name = names.get(sku);
        return { sku, name: typeof name === 'string' ? name : undefined };
      }), { log: ctx.log });
      return NextResponse.json({ ok: true, deleted, followUps: ctx.followUps });
    }

    case 'importContacts': {
      const vcf = fileText(body.vcf);
      if (!vcf || !vcf.includes('BEGIN:VCARD')) return bad('That does not look like a contacts file. Export a .vcf from your phone.');
      const people = await readPeople();
      const plan = planImport(vcf, toExistingRows(people.customers, people.karigars));
      if (body.fingerprint !== planFingerprint(plan)) {
        return bad('The book has changed since this file was read. Read it again and check the answers.', 409);
      }
      const dropped = Array.isArray(body.dropped) ? body.dropped.filter((d): d is string => typeof d === 'string') : [];
      const answered = checkChoices(plan, body.choices);
      if (!answered.ok) return bad(answered.error);
      const steps = contactImportSteps(plan, dropped, answered.choices);
      if (!steps.length) return bad('Nothing to add or resolve.');

      const held = gather(adminPort, ctx.log);
      const out = await runContactImport(held.port, steps, { newCustomerId: customerIdMaker(people.customerIds) }, held.fx);
      await held.commit();
      return NextResponse.json({ ok: true, ...out, settled: plan.settled.length, followUps: ctx.followUps });
    }

    case 'importHisaab': {
      const csv = fileText(body.csv);
      if (!csv) return bad('Please upload a valid file and select a person.');
      const entityId = idOf(body.entityId);
      const entityType = body.entityType;
      if (!entityId || (entityType !== 'customer' && entityType !== 'karigar')) return bad('Please upload a valid file and select a person.');
      const person = await adminPort.get<{ name?: unknown; deletedAt?: unknown }>(entityType === 'customer' ? 'customers' : 'karigars', entityId);
      if (!person || person.deletedAt) return bad('The selected person could not be found.', 409);

      const read = parseHisaabCsv(csv);
      if (!read.ok) return bad(read.error);
      if (!read.rows.length) return bad('Please upload a valid file and select a person.');
      if (read.rows.length > MAX_HISAAB_ROWS) return bad(`A file of up to ${MAX_HISAAB_ROWS.toLocaleString()} rows. Split a longer ledger.`);
      const refusal = hisaabCsvRefusal(read.rows);
      if (refusal) return bad(refusal);

      const name = typeof person.name === 'string' ? person.name : '';
      const entries = hisaabImportEntries(read.rows, { id: entityId, type: entityType, name });
      const stem = createHash('sha256').update(`${entityType}:${entityId}\n${csv}`).digest('hex').slice(0, 20);
      for (let i = 0; i < entries.length; i += CHUNK) {
        const b = adminPort.batch();
        entries.slice(i, i + CHUNK).forEach((e, j) => {
          b.set('hisaab', `import-${stem}-${String(i + j).padStart(4, '0')}`, e as unknown as Record<string, unknown>);
        });
        await b.commit();
      }
      await ctx.log('hisaab.import', `Imported hisaab for ${name || entityId}`, `${entries.length} transaction(s) from a CSV · by ${personFor(ctx.email) || ctx.email}`, entityId);
      return NextResponse.json({ ok: true, imported: entries.length, name, followUps: ctx.followUps });
    }
  }
  return null;
};
