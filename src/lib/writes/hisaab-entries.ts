/**
 * A row written in a person's hisaab by hand, and a row deleted (the ledger page, src/app/hisaab/[entityId]:
 * "You Gave" and "You Got", and a transaction's Delete; store.ts `addHisaabEntry`, `deleteHisaabEntry`): the
 * one copy, for the iPhone app (/api/app/write, ops-hisaab.ts) on the Admin SDK. The caller has already
 * checked the delete code for a delete.
 *
 * - "You gave" is a debit (what they owe the shop goes up), "You got" a credit; the cash and the metal in
 *   grams each go on the same side. A customer's page leads with the cash and a karigar's with the metal,
 *   but the row is the same shape: all four amounts written, the ones not given at 0.
 * - The row is dated now, named for the person as they are on file, and has no `linkedInvoiceId`: it is
 *   typed by hand, so the sync that keeps the invoices' own rows right (hisaab-sync.ts) never touches it.
 * - The page logs nothing for either; neither does this.
 * - Deleting a row does not undo anything but the row. A row that follows an invoice's balance is put back
 *   by the next sync while the invoice still owes.
 */

import type { DbPort } from '@/lib/db-port';
import type { HisaabEntry, HisaabEntityType } from '@/lib/store';

const HISAAB = 'hisaab';
/** More than any till or any weight a person means; a paste gone wrong is not stored. */
const MAX_CASH = 1e12;
const MAX_GRAMS = 1e6;
const MAX_DESCRIPTION = 500;

/** A request the ERP refuses in words (not a crash): the caller answers it with a 409. */
export class HisaabRefusal extends Error {}

export type HisaabMode = 'gave' | 'got';

export type HisaabEntryForm = {
  entityId: string;
  entityType: HisaabEntityType;
  mode: HisaabMode;
  description: string;
  /** Cash, PKR. */
  amount: number;
  goldGrams: number;
};

export type CleanedHisaabEntry = { ok: true; data: HisaabEntryForm } | { ok: false; error: string };

const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

const figure = (v: unknown, max: number): number | null => {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
};

/**
 * The ledger dialog's checks (its zod schema `hisaabEntrySchema`, in its order and words): a description,
 * an amount and a weight that are not negative, and one of them above 0. `metalWord` is the house's own
 * word for the metal ("Gold", "Silver": STORE_METAL_WORD).
 */
export function cleanHisaabEntry(input: unknown, opts: { metalWord?: string } = {}): CleanedHisaabEntry {
  const metal = opts.metalWord || 'Gold';
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Nothing to save.' };
  const b = input as Record<string, unknown>;

  const entityId = idOf(b.entityId);
  if (!entityId) return { ok: false, error: 'Whose hisaab?' };
  if (b.entityType !== 'customer' && b.entityType !== 'karigar') return { ok: false, error: 'A customer or a karigar.' };
  if (b.mode !== 'gave' && b.mode !== 'got') return { ok: false, error: 'You gave, or you got.' };

  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) return { ok: false, error: 'Description is required' };
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: `Description is at most ${MAX_DESCRIPTION} characters.` };

  const amount = figure(b.amount, MAX_CASH);
  if (amount === null) return { ok: false, error: 'Amount must be non-negative' };
  const goldGrams = figure(b.goldGrams, MAX_GRAMS);
  if (goldGrams === null) return { ok: false, error: `${metal} must be non-negative` };
  if (amount === 0 && goldGrams === 0) return { ok: false, error: 'Enter a cash amount or gold grams — both cannot be zero.' };

  return { ok: true, data: { entityId, entityType: b.entityType, mode: b.mode, description, amount, goldGrams } };
}

/**
 * Write the row for a person who is on file (the caller read them: `entityName` is theirs). Returns the row
 * as the store returns it, with its id.
 */
export async function addHisaabEntry(
  db: DbPort, form: HisaabEntryForm, entityName: string, opts: { now?: Date } = {},
): Promise<HisaabEntry> {
  const gave = form.mode === 'gave';
  const entry: Omit<HisaabEntry, 'id'> = {
    entityId: form.entityId,
    entityType: form.entityType,
    entityName,
    date: (opts.now ?? new Date()).toISOString(),
    description: form.description,
    cashDebit: gave ? form.amount : 0,
    cashCredit: gave ? 0 : form.amount,
    goldDebitGrams: gave ? form.goldGrams : 0,
    goldCreditGrams: gave ? 0 : form.goldGrams,
  };
  const id = await db.add(HISAAB, entry as unknown as Record<string, unknown>);
  return { id, ...entry };
}

/** Delete one row of a hisaab. A row that is not there is refused, not guessed at. */
export async function deleteHisaabEntry(db: DbPort, entryId: string): Promise<{ id: string; entityId: string; description: string }> {
  const row = await db.get<{ entityId?: string; description?: string }>(HISAAB, entryId);
  if (!row) throw new HisaabRefusal('No such ledger entry.');
  const b = db.batch();
  b.delete(HISAAB, entryId);
  await b.commit();
  return { id: entryId, entityId: row.entityId || '', description: row.description || '' };
}
