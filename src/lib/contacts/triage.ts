/**
 * Working out what an import WOULD do, before it does any of it.
 *
 * Nothing is written by the scan. It reads the file, compares it against the book, and
 * hands back a plan — because an import that silently merges two customers is far worse
 * than one that asks. Only entries where the name and the number both already match are
 * treated as settled; anything half-matching is a question for the shop, not a guess for
 * the computer.
 */

import type { Customer, Karigar } from '@/lib/store';
import { extractContacts, nameKey, phoneKey, type Contact, type ContactKind } from './vcard';

export interface ExistingRow {
  id: string;
  kind: ContactKind;
  name: string;
  phone?: string;
  altPhone?: string;
}

export interface PendingContact {
  id: string;
  kind: ContactKind;
  name: string;
  rawName: string;
  tags: string[];
  phone: string | null;
  extraPhones: string[];
}

export type ConflictReason = 'same_name' | 'same_phone';

export interface Conflict extends PendingContact {
  reason: ConflictReason;
  matches: ExistingRow[];
}

export interface Settled {
  name: string;
  kind: ContactKind;
  matched: ExistingRow;
}

export interface ImportPlan {
  summary: {
    cardsInFile: number;
    ignoredUntagged: number;
    mergedDuplicates: number;
    tagged: number;
    customers: number;
    karigars: number;
    fresh: number;
    settled: number;
    conflicts: number;
  };
  fresh: PendingContact[];
  settled: Settled[];
  conflicts: Conflict[];
}

export function toExistingRows(customers: Customer[], karigars: Karigar[]): ExistingRow[] {
  return [
    ...customers.map((c): ExistingRow => ({
      id: c.id, kind: 'customer', name: c.name, phone: c.phone, altPhone: c.altPhone,
    })),
    ...karigars.map((k): ExistingRow => ({
      id: k.id, kind: 'karigar', name: k.name, phone: k.contact, altPhone: k.altPhone,
    })),
  ];
}

function buildIndex(rows: ExistingRow[]) {
  const byName = new Map<string, ExistingRow[]>();
  const byPhone = new Map<string, ExistingRow[]>();
  for (const r of rows) {
    const nk = nameKey(r.name);
    if (nk) {
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk)!.push(r);
    }
    for (const p of [r.phone, r.altPhone]) {
      const k = phoneKey(p);
      if (!k) continue;
      if (!byPhone.has(k)) byPhone.set(k, []);
      byPhone.get(k)!.push(r);
    }
  }
  return { byName, byPhone };
}

export function planImport(text: string, existing: ExistingRow[]): ImportPlan {
  const { contacts, skippedUntagged, parsed, mergedDuplicates } = extractContacts(text);
  const { byName, byPhone } = buildIndex(existing);

  const fresh: PendingContact[] = [];
  const settled: Settled[] = [];
  const conflicts: Conflict[] = [];

  contacts.forEach((c: Contact, i: number) => {
    const nameHits = byName.get(nameKey(c.name)) ?? [];
    const phoneHits = [...new Set(c.phoneKeys.flatMap((k) => byPhone.get(k) ?? []))];

    // Same person, same number, already in the book — nothing to decide.
    const both = nameHits.filter((r) => phoneHits.includes(r));
    if (both.length) {
      settled.push({ name: c.name, kind: c.kind, matched: both[0] });
      return;
    }

    const item: PendingContact = {
      id: `v${i}`,
      kind: c.kind,
      name: c.name,
      rawName: c.rawName,
      tags: c.tags,
      phone: c.phones[0] ?? null,
      extraPhones: c.phones.slice(1),
    };

    if (nameHits.length) {
      conflicts.push({ ...item, reason: 'same_name', matches: nameHits });
    } else if (phoneHits.length) {
      conflicts.push({ ...item, reason: 'same_phone', matches: phoneHits });
    } else {
      fresh.push(item);
    }
  });

  return {
    summary: {
      cardsInFile: parsed,
      ignoredUntagged: skippedUntagged,
      mergedDuplicates,
      tagged: contacts.length,
      customers: contacts.filter((c) => c.kind === 'customer').length,
      karigars: contacts.filter((c) => c.kind === 'karigar').length,
      fresh: fresh.length,
      settled: settled.length,
      conflicts: conflicts.length,
    },
    fresh,
    settled,
    conflicts,
  };
}

/**
 * What the shop chose to do about one half-match.
 *
 * 'add_phone' is the answer to "same name, different number": one person with a second
 * phone, so the new number goes into the spare slot and never overwrites the one already
 * there. 'adopt_name' answers "same number, different name": the same person written more
 * fully — Khozema Lakra in the book, Khozema Lakrawala on the phone.
 */
export type ConflictChoice = 'add_phone' | 'adopt_name' | 'add_separately' | 'skip';

export function defaultChoice(reason: ConflictReason): ConflictChoice {
  return reason === 'same_name' ? 'add_phone' : 'adopt_name';
}
