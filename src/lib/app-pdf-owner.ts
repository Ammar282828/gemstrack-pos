/**
 * The owners' papers, drawn on the server for the iPhone app: the Expenses page's report and the
 * Hisaab page's Summary and Ledger Statement. The same drawers the pages print with
 * (expense-report-pdf.ts, hisaab-pdf.ts), fed by the same sums (expense-report.ts, hisaab-report.ts),
 * read off the books here and on Karachi's calendar (wall-clock.ts), as a phone in the shop sees them.
 *
 * Owners only: expenses and the hisaab are never shown to staff (nav.ts; staff's shelves arrive
 * without them).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { isDocId, type ServerPdf } from '@/lib/app-pdf';
import { expenseReport, type ExpenseFilters } from '@/lib/expense-report';
import { drawExpenseReportPdf, expenseReportFileName } from '@/lib/expense-report-pdf';
import { hisaabAccounts, hisaabLedger, searchAccounts } from '@/lib/hisaab-report';
import { drawHisaabLedgerPdf, drawHisaabSummaryPdf, hisaabLedgerFileName, hisaabSummaryFileName } from '@/lib/hisaab-pdf';
import { karachiWall } from '@/lib/wall-clock';
import { WALK_IN_ENTITY, WALK_IN_NAME } from '@/lib/walk-in';
import type { Expense, HisaabEntry } from '@/lib/store';

/** The signed-in owner, or the refusal. */
export async function pdfOwner(req: NextRequest, what: string): Promise<{ email: string } | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: `${what} is the owners’.` }, { status: 403 });
  return { email };
}

type Doc = Record<string, unknown>;

/** A whole collection as the browser's store holds it ({ ...data, id }). */
async function all<T>(collection: string): Promise<T[]> {
  const snap = await adminDb.collection(collection).get();
  return snap.docs.map((d) => ({ ...(d.data() as Doc), id: d.id }) as T);
}

const bytes = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => new Uint8Array(doc.output('arraybuffer'));

/** The Expenses page's report for these filters, as its Report button saves it. */
export async function expenseReportPdf(f: ExpenseFilters, now: Date = new Date()): Promise<ServerPdf> {
  const [expenses, karigars] = await Promise.all([
    all<Expense>('expenses'),
    // The karigar's name is searched only when there is a search; removed karigars are not in the
    // page's list (the store's splitRemoved), so not here either.
    f.search.trim() ? all<{ id: string; name?: string; deletedAt?: string }>('karigars') : Promise.resolve([]),
  ]);
  const names = new Map(karigars.filter((k) => !k.deletedAt).map((k) => [k.id, k.name || '']));
  const r = expenseReport(expenses, f, { karigarName: (id) => names.get(id) || '', now, wall: karachiWall });
  const doc = drawExpenseReportPdf({ groups: r.groups, total: r.total, filterLine: r.filterLine, asOf: r.now, wall: karachiWall });
  return { bytes: bytes(doc), fileName: expenseReportFileName(r.now) };
}

/** The Hisaab page's Summary: everyone outstanding whose name holds `q`. */
export async function hisaabSummaryPdf(q: string, now: Date = new Date()): Promise<ServerPdf> {
  const { accounts } = hisaabAccounts(await all<HisaabEntry>('hisaab'));
  const asOf = karachiWall(now);
  const doc = drawHisaabSummaryPdf(searchAccounts(accounts, q), asOf);
  return { bytes: bytes(doc), fileName: hisaabSummaryFileName(asOf) };
}

/**
 * One person's Ledger Statement; null when they have neither a record nor a row. The name is their
 * record's, as the page prints it; a walk-in's, or a record since deleted, falls back to what the
 * rows were written under.
 */
export async function hisaabLedgerPdf(id: string, type: 'customer' | 'karigar' | null, now: Date = new Date()): Promise<ServerPdf | null> {
  if (!isDocId(id)) return null;
  const snap = await adminDb.collection('hisaab').where('entityId', '==', id).get();
  const entries = snap.docs.map((d) => ({ ...(d.data() as Doc), id: d.id }) as HisaabEntry);
  const entityType: 'customer' | 'karigar' = type ?? entries[0]?.entityType ?? 'customer';
  let name = '';
  if (id === WALK_IN_ENTITY) {
    name = WALK_IN_NAME;
  } else {
    const rec = await adminDb.collection(entityType === 'customer' ? 'customers' : 'karigars').doc(id).get();
    name = String((rec.exists ? rec.data()?.name : '') || entries[0]?.entityName || '').trim();
  }
  if (!name && entries.length === 0) return null;
  const { lines, finalCashBalance, finalGoldBalance } = hisaabLedger(entries, id);
  const asOf = karachiWall(now);
  const doc = drawHisaabLedgerPdf({ name, entityType, lines, finalCashBalance, finalGoldBalance, asOf, wall: karachiWall });
  return { bytes: bytes(doc), fileName: hisaabLedgerFileName(name, asOf) };
}
