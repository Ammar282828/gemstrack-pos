/**
 * Bringing the old Taheri software's book into this one.
 *
 * A one-off. The shop kept its customers in a separate SQLite app before this; that book
 * has been extracted to taheri-book.json and this works out what importing it WOULD do.
 *
 * Nothing is written by the plan. The same principle the contact import already follows:
 * only records where the name and the number both already match are treated as settled,
 * and anything half-matching is a question for the shop rather than a guess. This runs
 * against the live book, so a silent merge here is somebody's account joined to a
 * stranger's.
 */

import type { Customer, Karigar } from '@/lib/store';
import { nameKey, phoneKey } from '@/lib/contacts/vcard';

/** A customer as the old app kept them, already mapped onto this app's field names. */
export type IncomingCustomer = Partial<Omit<Customer, 'id'>> & { name: string };
export type IncomingKarigar = Partial<Omit<Karigar, 'id'>> & { name: string };

export interface TaheriBook {
  source: string;
  customers: IncomingCustomer[];
  karigars: IncomingKarigar[];
}

export interface Existing {
  id: string;
  name: string;
  phones: (string | undefined)[];
}

export type Verdict = 'new' | 'settled' | 'same_name' | 'same_phone';

export interface Planned<T> {
  id: string;
  incoming: T;
  verdict: Verdict;
  /** The rows already in the book that this collided with. */
  matches: Existing[];
}

export interface BookPlan {
  customers: Planned<IncomingCustomer>[];
  karigars: Planned<IncomingKarigar>[];
  counts: {
    customersNew: number; customersSettled: number; customersConflict: number;
    karigarsNew: number; karigarsSettled: number; karigarsConflict: number;
  };
}

function index(rows: Existing[]) {
  const byName = new Map<string, Existing[]>();
  const byPhone = new Map<string, Existing[]>();
  for (const r of rows) {
    const nk = nameKey(r.name);
    if (nk) (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(r);
    for (const p of r.phones) {
      const k = phoneKey(p);
      if (!k) continue;
      (byPhone.get(k) ?? byPhone.set(k, []).get(k)!).push(r);
    }
  }
  return { byName, byPhone };
}

function classifyOne<T extends { name: string }>(
  incoming: T,
  phones: (string | undefined)[],
  idx: ReturnType<typeof index>,
  id: string,
): Planned<T> {
  const nameHits = idx.byName.get(nameKey(incoming.name)) ?? [];
  const phoneHits = [...new Set(
    phones.map(phoneKey).filter(Boolean).flatMap((k) => idx.byPhone.get(k as string) ?? []),
  )];

  // Same person, same number, already here — nothing to decide.
  const both = nameHits.filter((r) => phoneHits.includes(r));
  if (both.length) return { id, incoming, verdict: 'settled', matches: [both[0]] };
  if (nameHits.length) return { id, incoming, verdict: 'same_name', matches: nameHits };
  if (phoneHits.length) return { id, incoming, verdict: 'same_phone', matches: phoneHits };
  return { id, incoming, verdict: 'new', matches: [] };
}

export function planBookImport(
  book: TaheriBook,
  customers: Customer[],
  karigars: Karigar[],
): BookPlan {
  const custIdx = index(customers.map((c) => ({
    id: c.id, name: c.name, phones: [c.phone, c.altPhone],
  })));
  const karIdx = index(karigars.map((k) => ({
    id: k.id, name: k.name, phones: [k.contact, k.altPhone],
  })));

  const plannedCustomers = book.customers.map((c, i) =>
    classifyOne(c, [c.phone, c.altPhone], custIdx, `c${i}`));
  const plannedKarigars = book.karigars.map((k, i) =>
    classifyOne(k, [k.contact, k.altPhone], karIdx, `k${i}`));

  const tally = <T>(rows: Planned<T>[], v: Verdict | 'conflict') =>
    rows.filter((r) => (v === 'conflict' ? r.verdict === 'same_name' || r.verdict === 'same_phone' : r.verdict === v)).length;

  return {
    customers: plannedCustomers,
    karigars: plannedKarigars,
    counts: {
      customersNew: tally(plannedCustomers, 'new'),
      customersSettled: tally(plannedCustomers, 'settled'),
      customersConflict: tally(plannedCustomers, 'conflict'),
      karigarsNew: tally(plannedKarigars, 'new'),
      karigarsSettled: tally(plannedKarigars, 'settled'),
      karigarsConflict: tally(plannedKarigars, 'conflict'),
    },
  };
}
