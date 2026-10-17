/**
 * Settings → Import the Taheri Software book, the part after the plan (lib/import/taheri-book.ts): what Import
 * adds, the half-matches as the page lists them, and the writes. The one copy of the page's `wanted`,
 * `ledgerCount` and `run` (src/app/settings/import-taheri), for the iPhone app too (/api/app/write
 * `importTaheriBook`, ops-settings4.ts).
 *
 * Half-matches are opt-in, as on the page: left alone unless the shop says to add them as separate records.
 * A row is added as the store adds one (new-customer.ts, people.ts `addKarigar`), so what the store drops is
 * dropped here too: a customer keeps only the name and the number, a karigar everything the old app kept.
 *
 * The phone reads the plan first and then asks for the import; the server plans again from the same book and
 * the books as they are then. `bookPlanFingerprint` is how it knows the two are the same plan: somebody added
 * or renamed meanwhile changes it, and the import is refused rather than run against a preview of something else.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Karigar } from '@/lib/store';
import { addKarigar } from '@/lib/writes/people';
import { addCustomerDoc } from '@/lib/writes/new-customer';
import { fnv } from '@/lib/contacts/import-run';
import type { BookPlan, Planned, Verdict } from '@/lib/import/taheri-book';

/** The rows Import adds: the new ones, and the half-matches too when the shop asked for them. */
export function bookImportRows<T>(rows: Planned<T>[], takeConflicts: boolean): Planned<T>[] {
  return rows.filter((r) => r.verdict === 'new' || (takeConflicts && r.verdict !== 'settled'));
}

export function bookWillAdd(plan: BookPlan, takeConflicts: boolean): number {
  return bookImportRows(plan.customers, takeConflicts).length + bookImportRows(plan.karigars, takeConflicts).length;
}

/**
 * How much ledger already hangs off each record, from the hisaab entries' `entityId`s. This is the number that
 * decides a half-match: a second copy of a karigar splits his gold and labour history across two names.
 */
export function ledgerCounts(entityIds: Iterable<string | null | undefined>): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of entityIds) if (id) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export interface BookHalfMatch {
  id: string;
  kind: 'customer' | 'karigar';
  name: string;
  verdict: Extract<Verdict, 'same_name' | 'same_phone'>;
  /** The names already in the book it collided with. */
  matches: string[];
  /** The ledger entries those carry, together. */
  carried: number;
}

/** The half-matches, customers first, as the page lists them. */
export function bookHalfMatches(plan: BookPlan, ledger: Map<string, number>): BookHalfMatch[] {
  const rows = (list: Planned<{ name: string }>[], kind: BookHalfMatch['kind']) => list
    .filter((r): r is Planned<{ name: string }> & { verdict: BookHalfMatch['verdict'] } => r.verdict === 'same_name' || r.verdict === 'same_phone')
    .map((r) => ({
      id: r.id,
      kind,
      name: r.incoming.name,
      verdict: r.verdict,
      matches: r.matches.map((m) => m.name),
      carried: r.matches.reduce((n, m) => n + (ledger.get(m.id) ?? 0), 0),
    }));
  return [...rows(plan.customers, 'customer'), ...rows(plan.karigars, 'karigar')];
}

/** The plan as the shop saw it: each row's verdict and whom it matched. */
export function bookPlanFingerprint(plan: BookPlan): string {
  const line = (r: Planned<{ name: string }>) => [r.id, r.verdict, r.incoming.name, r.matches.map((m) => m.id).join(',')].join('|');
  return fnv([...plan.customers.map(line), ...plan.karigars.map(line)].join('\n'));
}

export type BookImportResult = { customers: number; karigars: number };

/**
 * The rows written, each as the store writes it. `newCustomerId` names each new customer (customerIdMaker);
 * `db` may be a gathered port (gathered.ts), which sends them all in a few batches.
 */
export async function runBookImport(
  db: DbPort,
  plan: BookPlan,
  takeConflicts: boolean,
  opts: { newCustomerId: () => string },
  fx: SideEffects = {},
): Promise<BookImportResult> {
  let customers = 0;
  let karigars = 0;
  for (const row of bookImportRows(plan.customers, takeConflicts)) {
    // The country, the tags and a spare number go to the store's addCustomer too, which keeps none of them.
    await addCustomerDoc(db, { name: row.incoming.name, phone: row.incoming.phone }, opts.newCustomerId(), fx);
    customers++;
  }
  for (const row of bookImportRows(plan.karigars, takeConflicts)) {
    await addKarigar(db, row.incoming as Omit<Karigar, 'id'>, fx);
    karigars++;
  }
  return { customers, karigars };
}
