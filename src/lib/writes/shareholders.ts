/**
 * The Shareholders page's writes (src/app/shareholders/page.tsx, lib/shareholders.ts and the working-capital
 * floor, lib/partnership-settings.ts): the one copy of what they do, for the iPhone app (/api/app/write) and
 * for the page when it takes them up. A partner's salary is not here: it is only an expense, and goes
 * through addExpense (lib/writes/expenses.ts) with the partner named, as the page files it.
 *
 * On drawings: a withdrawal is two rows, the ledger's draw and the "Partner Drawings" expense that shows
 * the cash leaving the till, each pointing at the other. The page wrote them in three trips (the expense,
 * the entry, then the link); here both go in one commit with their ids drawn first, so a dropped line
 * cannot leave half a draw. The expense is the business's (`paidBy: 'business'`) on purpose: marked as
 * the partner's, addExpense would log a matching loan back onto their ledger and cancel the draw out.
 *
 * Deleting asks for the delete code; the caller checks it before any of these run (lib/delete-code-gate.ts).
 */

import type { BatchCtx, DbPort, SideEffects } from '@/lib/db-port';
import { PARTNER_DRAWINGS, PARTNER_SALARY, type LedgerCategory } from '@/lib/partnership';
import { DEFAULT_WORKING_CAPITAL_FLOOR, type FloorHistoryEntry, type PartnershipSettings } from '@/lib/partnership-settings';
import { SHAREHOLDERS, type ShareholderId } from '@/lib/shareholders';

const EXPENSES = 'expenses';
const SETTINGS = 'app_settings';
const PARTNERSHIP = 'partnership';

const log = (fx: SideEffects, a: string, t: string, d: string, id?: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

export const shareholderOf = (id: string) => SHAREHOLDERS.find(s => s.id === id);

export interface ShareholderEntryInput {
  who: ShareholderId;
  kind: 'contribution' | 'withdrawal';
  category: LedgerCategory;
  /** Trimmed and not empty. */
  description: string;
  /** More than 0. */
  amount: number;
  /** The form's day ("2026-10-09"), read as the page reads it: `new Date(date)`. */
  date: string;
}

/** Add a contribution, or record a withdrawal and its Partner Drawings expense. */
export async function addShareholderEntry(
  db: DbPort, input: ShareholderEntryInput, fx: SideEffects = {},
): Promise<{ entryId: string; expenseId?: string }> {
  const person = shareholderOf(input.who);
  if (!person) throw new Error('No such shareholder.');
  const when = new Date(input.date);
  if (Number.isNaN(when.getTime())) throw new Error('A date is needed.');
  const entryId = db.newId(person.ledger);
  const entry: Record<string, unknown> = {
    type: input.kind === 'withdrawal' ? 'withdrawal' : 'payment',
    category: input.category,
    description: input.description,
    amount: input.amount,
    date: db.timestamp(when),
    createdAt: db.serverTime(),
  };

  if (input.kind === 'contribution') {
    const b = db.batch();
    b.set(person.ledger, entryId, entry);
    await b.commit();
    return { entryId };
  }

  const expenseId = db.newId(EXPENSES);
  const expense = {
    date: when.toISOString(),
    category: PARTNER_DRAWINGS,
    description: `${person.name} — ${input.description}`,
    amount: input.amount,
    paidBy: 'business',
  };
  const b = db.batch();
  b.set(EXPENSES, expenseId, expense);
  b.set(person.ledger, entryId, { ...entry, linkedExpenseId: expenseId });
  await b.commit();
  // The expense's own line in the activity log, as addExpense writes it.
  log(fx, 'expense.create', `Added expense: ${expense.description}`, `Category: ${expense.category} | Amount: ${expense.amount.toLocaleString()}`, expenseId);
  return { entryId, expenseId };
}

type ExpenseDoc = { description?: string; category?: string; paidBy?: string; ledgerEntryId?: string };

/**
 * store.ts deleteExpense, into a batch: a partner-fronted expense takes its paired ledger row with it
 * (`skip` is that row when it is the one being deleted already). The caller logs once the batch lands.
 */
function deleteExpenseInto(b: BatchCtx, id: string, existing: ExpenseDoc | null, skip?: { ledger: string; id: string }): void {
  if (existing?.ledgerEntryId && existing.paidBy && existing.paidBy !== 'business') {
    const ledger = existing.paidBy === 'ammar' ? 'ammar_ledger' : 'mina_ledger';
    if (!(skip && skip.ledger === ledger && skip.id === existing.ledgerEntryId)) b.delete(ledger, existing.ledgerEntryId);
  }
  b.delete(EXPENSES, id);
}

/** Remove one ledger entry; a draw's expense goes with it, or the money would look spent twice. */
export async function deleteShareholderEntry(
  db: DbPort, input: { who: ShareholderId; entryId: string }, fx: SideEffects = {},
): Promise<{ entryId: string; expenseId?: string }> {
  const person = shareholderOf(input.who);
  if (!person) throw new Error('No such shareholder.');
  const entry = await db.get<{ linkedExpenseId?: unknown }>(person.ledger, input.entryId);
  if (!entry) throw new Error('No such ledger entry.');
  const linked = entry.linkedExpenseId && entry.linkedExpenseId !== 'pending' ? String(entry.linkedExpenseId) : undefined;
  const expense = linked ? await db.get<ExpenseDoc>(EXPENSES, linked) : null;
  const b = db.batch();
  b.delete(person.ledger, input.entryId);
  if (linked) deleteExpenseInto(b, linked, expense, { ledger: person.ledger, id: input.entryId });
  await b.commit();
  if (linked) log(fx, 'expense.delete', `Deleted expense: ${expense?.description || linked}`, `ID: ${linked}`, linked);
  return { entryId: input.entryId, ...(linked && { expenseId: linked }) };
}

/** Remove a salary payment: its expense (store.ts deleteExpense). Only a Partner Salary row, never another expense. */
export async function deletePartnerSalary(db: DbPort, input: { expenseId: string }, fx: SideEffects = {}): Promise<{ expenseId: string }> {
  const expense = await db.get<ExpenseDoc>(EXPENSES, input.expenseId);
  if (!expense) throw new Error('No such expense.');
  if (expense.category !== PARTNER_SALARY) throw new Error('Not a partner salary.');
  const b = db.batch();
  deleteExpenseInto(b, input.expenseId, expense);
  await b.commit();
  log(fx, 'expense.delete', `Deleted expense: ${expense.description || input.expenseId}`, `ID: ${input.expenseId}`, input.expenseId);
  return { expenseId: input.expenseId };
}

/** `app_settings/partnership` as loadPartnershipSettings reads it. */
export function partnershipSettingsFrom(data: Record<string, unknown> | null | undefined): PartnershipSettings {
  if (!data) return { workingCapitalFloor: DEFAULT_WORKING_CAPITAL_FLOOR, floorHistory: [] };
  return {
    workingCapitalFloor: Number(data.workingCapitalFloor) || DEFAULT_WORKING_CAPITAL_FLOOR,
    floorLastSetAt: (data.floorLastSetAt as string) || undefined,
    floorHistory: Array.isArray(data.floorHistory) ? (data.floorHistory as FloorHistoryEntry[]) : [],
  };
}

/**
 * saveWorkingCapitalFloor: the floor, stamped, with a line in its history unless the value is the same
 * as the last one there.
 */
export async function saveWorkingCapitalFloor(
  db: DbPort, input: { value: number; by?: string; now?: Date }, fx: SideEffects = {},
): Promise<PartnershipSettings> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const next = await db.runTransaction(async tx => {
    const current = partnershipSettingsFrom(await tx.get(SETTINGS, PARTNERSHIP));
    const newEntry: FloorHistoryEntry = { value: input.value, date: nowIso, ...(input.by && { by: input.by }) };
    // Avoid logging a duplicate if value is unchanged AND last entry is same value
    const lastEntry = current.floorHistory[current.floorHistory.length - 1];
    const isDuplicate = !!lastEntry && lastEntry.value === input.value;
    const nextHistory = isDuplicate ? current.floorHistory : [...current.floorHistory, newEntry];
    const settled: PartnershipSettings = { workingCapitalFloor: input.value, floorLastSetAt: nowIso, floorHistory: nextHistory };
    tx.set(SETTINGS, PARTNERSHIP, { ...settled, updatedAt: db.serverTime() } as unknown as Record<string, unknown>, true);
    return settled;
  });
  log(fx, 'settings.update', 'Working capital floor set', `workingCapitalFloor${input.by ? ` · by ${input.by}` : ''}`);
  return next;
}
