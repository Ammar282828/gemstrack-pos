/**
 * POST { kind, … }: what an import WOULD do, for the iPhone app's Settings → Import contacts and Import hisaab.
 * Nothing is written here: the phone shows the answer, the shop decides, and the import itself is
 * /api/app/write (`importContacts`, `importHisaab`, ops-settings2.ts), which reads the file again.
 *
 * - `{ kind: 'contacts', vcf }`: the plan of lib/contacts/triage.ts against the book as it is now (who is
 *   new, who is already saved, who half-matches whom), with its fingerprint, which the import must send back.
 * - `{ kind: 'hisaab', csv }`: the rows as lib/import/hisaab-csv.ts reads them, each with whether it is fine,
 *   and the page's refusal when one is not; a file that does not read at all is refused in the page's words.
 *
 * Owners only, as the pages are. Read-only, so it answers while the database is locked too.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { defaultChoice, planImport, toExistingRows } from '@/lib/contacts/triage';
import { planFingerprint } from '@/lib/contacts/import-run';
import { hisaabCsvRefusal, parseHisaabCsv } from '@/lib/import/hisaab-csv';
import { MAX_HISAAB_ROWS, MAX_IMPORT_TEXT, readPeople } from '../write/ops-settings2';

export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return bad('Sign in again.', 401);
  if (roleForEmail(email) !== 'owner') return bad('Settings are the owners’.', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Bad request'); }

  if (body.kind === 'contacts') {
    const vcf = typeof body.vcf === 'string' ? body.vcf : '';
    if (vcf.length > MAX_IMPORT_TEXT) return bad('That file is too big to be one address book.');
    if (!vcf.includes('BEGIN:VCARD')) return bad('That does not look like a contacts file. Export a .vcf from your phone.');
    const people = await readPeople();
    const plan = planImport(vcf, toExistingRows(people.customers, people.karigars));
    // The answers the page starts each half-match on, so the phone starts on the same ones.
    const defaults = Object.fromEntries(plan.conflicts.map((c) => [c.id, defaultChoice(c.reason)]));
    return NextResponse.json({ plan, defaults, fingerprint: planFingerprint(plan) });
  }

  if (body.kind === 'hisaab') {
    const csv = typeof body.csv === 'string' ? body.csv : '';
    if (!csv.trim()) return bad('Could not read that file.');
    if (csv.length > MAX_IMPORT_TEXT) return bad('That file is too big to be one ledger.');
    const read = parseHisaabCsv(csv);
    if (!read.ok) return bad(read.error);
    if (read.rows.length > MAX_HISAAB_ROWS) return bad(`A file of up to ${MAX_HISAAB_ROWS.toLocaleString()} rows. Split a longer ledger.`);
    return NextResponse.json({ rows: read.rows, refusal: hisaabCsvRefusal(read.rows) });
  }

  return bad('Which import?');
}
