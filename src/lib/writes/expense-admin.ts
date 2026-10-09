/**
 * Expenses and Extra revenue edited and deleted, and extra revenue added (src/app/expenses/page.tsx with
 * components/expense/expense-form.tsx, src/app/additional-revenue/page.tsx; store.ts updateExpense,
 * deleteExpense, addAdditionalRevenue, updateAdditionalRevenue, deleteAdditionalRevenue): the one copy, for
 * the iPhone app (/api/app/write) and for the store when it takes them up. Adding an expense is
 * ./expenses.ts.
 *
 * A partner who fronted the cash has a loan row on their ledger, each row pointing at the other
 * (./expenses.ts). An edit keeps that pair true as the store's does: the same payer, amount and day keep
 * the row and give it the new words; anything else removes it and, if a partner still paid, draws a new
 * one. The store did that in three or four trips (delete, add, then the expense); here it is one commit.
 * Deleting an expense takes its loan row with it.
 *
 * Two kinds of row belong to another page, and are refused here rather than half changed:
 * - a partner's drawing (Partner Drawings, pointed at by a withdrawal on that partner's ledger): its
 *   amount is the ledger's. The Shareholders page deletes the pair (./shareholders.ts); deleting or
 *   editing only the expense here left the ledger counting a draw the expenses no longer showed.
 * - money taken on a repair (`repairId`): it changes on the repair, whose own delete removes it
 *   (store.ts RepairRevenueError, ./repair-admin.ts).
 *
 * The caller checks the delete code before a delete (lib/delete-code-gate.ts).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { AdditionalRevenue, Expense, PaidBy } from '@/lib/store';
import { PARTNER_DRAWINGS, PARTNER_SALARY } from '@/lib/partnership';

const EXPENSES = 'expenses';
const REVENUE = 'additional_revenue';

/** lib/shareholders.ts SHAREHOLDERS, without the browser's Firebase it reads the ledgers with. */
const PARTNERS = {
  ammar: { name: 'Ammar', ledger: 'ammar_ledger' },
  mina: { name: 'Mina', ledger: 'mina_ledger' },
} as const;
type PartnerId = keyof typeof PARTNERS;
const isPartner = (v: unknown): v is PartnerId => v === 'ammar' || v === 'mina';

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

/** Said when a row is another page's to change. */
export class LedgerRowRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'LedgerRowRefusal'; }
}

type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX = 1e12;

/** An ISO instant or a day, as the forms send `date.toISOString()`. */
function dateOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 40) return null;
  return Number.isNaN(new Date(v.trim()).getTime()) ? null : v.trim();
}

/** Text, trimmed; null when it is not text of up to `max` letters. */
function textOf(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' && v.length <= max ? v.trim() : null;
}

/** A document id as one path piece; '' for none, null when it is something else. */
function idOf(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= 200 && !s.includes('/') ? s : null;
}

// ── Expenses ─────────────────────────────────────────────────────────────────

/** What the expense form saves. Absent karigar, hisaab or partner: the row has none. */
export type ExpenseFields = Omit<Expense, 'id' | 'ledgerEntryId'> & { paidBy: PaidBy };

/**
 * The expense form's fields as its schema takes them (expense-form.tsx; the app's addExpense the same):
 * a date, a category, a description and an amount of more than 0; paid by the business unless a
 * partner's own cash was used; a hisaab only with its karigar; and the partner a salary paid only on a
 * Partner Salary row.
 */
export function expenseFieldsFrom(body: Record<string, unknown>): Cleaned<ExpenseFields> {
  const date = dateOf(body.date);
  if (!date) return { ok: false, error: 'A date is required.' };
  const category = textOf(body.category, 80);
  if (!category) return { ok: false, error: 'Category is required' };
  const description = textOf(body.description, 500);
  if (!description) return { ok: false, error: 'Description is required' };
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX) {
    return { ok: false, error: 'Amount must be a positive number' };
  }
  const paidBy = body.paidBy === undefined || body.paidBy === null || body.paidBy === '' ? 'business' : body.paidBy;
  if (paidBy !== 'business' && !isPartner(paidBy)) return { ok: false, error: 'Paid by the business, or a partner.' };
  const karigarId = idOf(body.karigarId);
  const batchId = idOf(body.batchId);
  if (karigarId === null) return { ok: false, error: 'Which karigar?' };
  if (batchId === null) return { ok: false, error: 'Which hisaab?' };
  const salary = category === PARTNER_SALARY;
  const shareholderId = salary && isPartner(body.shareholderId) ? body.shareholderId : '';
  if (salary && body.shareholderId && !shareholderId) return { ok: false, error: 'Which partner was paid?' };
  return {
    ok: true,
    value: {
      date, category, description, amount, paidBy,
      ...(karigarId && { karigarId }),
      ...(karigarId && batchId && { batchId }),
      ...(shareholderId && { shareholderId }),
    },
  };
}

type ExpenseDoc = Partial<Omit<Expense, 'id'>> & { id: string };

/**
 * The withdrawal that points at a Partner Drawings expense, and whose ledger it is on; null for any other
 * expense. Read before anything is asked, so a refusal costs no try of the delete code.
 */
export async function drawingEntryOf(db: DbPort, expense: { id: string; category?: string }): Promise<{ partner: PartnerId; name: string; entryId: string } | null> {
  if (expense.category !== PARTNER_DRAWINGS) return null;
  for (const partner of Object.keys(PARTNERS) as PartnerId[]) {
    // A withdrawal: a loan row pointing at the same expense is the cash a partner fronted, not a draw.
    const rows = await db.queryEquals<{ type?: string }>(PARTNERS[partner].ledger, 'linkedExpenseId', expense.id);
    const draw = rows.find((r) => r.type === 'withdrawal');
    if (draw) return { partner, name: PARTNERS[partner].name, entryId: draw.id };
  }
  return null;
}

/** Why a partner's drawing is not changed here, in the words the phone shows. */
export const drawingRefusal = (name: string, doing: 'change' | 'delete') =>
  new LedgerRowRefusal(`This is ${name}'s drawing, on ${name}'s ledger too. ${doing === 'delete' ? 'Delete it' : 'Change it'} on Shareholders, so the two stay one.`);

/** The same instant: a day re-sent as the form's ISO text is not a new day. */
const sameDay = (a: unknown, b: unknown) => {
  const x = new Date(String(a ?? '')).getTime();
  const y = new Date(String(b ?? '')).getTime();
  return Number.isFinite(x) && x === y;
};

/** Save the form over an expense, and keep a partner's loan row true to it. Answers with the expense. */
export async function updateExpense(db: DbPort, id: string, input: ExpenseFields, fx: SideEffects = {}): Promise<Expense> {
  const onFile = await db.get<ExpenseDoc>(EXPENSES, id);
  if (!onFile) throw new Error('No such expense.');
  const drawing = await drawingEntryOf(db, onFile);
  if (drawing) throw drawingRefusal(drawing.name, 'change');

  const saved = await db.runTransaction(async (tx) => {
    const existing = await tx.get<ExpenseDoc>(EXPENSES, id);
    if (!existing) throw new Error('No such expense.');
    const prevPaidBy = existing.paidBy || 'business';
    const nextPaidBy = input.paidBy || 'business';
    const prevLedgerId = typeof existing.ledgerEntryId === 'string' && existing.ledgerEntryId ? existing.ledgerEntryId : undefined;
    const same = prevPaidBy === nextPaidBy && input.amount === existing.amount && sameDay(input.date, existing.date);

    // The old loan row goes when the payer, the amount or the day moved.
    if (prevLedgerId && !same && isPartner(prevPaidBy)) tx.delete(PARTNERS[prevPaidBy].ledger, prevLedgerId);

    let ledgerEntryId: string | undefined;
    if (isPartner(nextPaidBy)) {
      const ledger = PARTNERS[nextPaidBy].ledger;
      if (same && prevLedgerId) {
        ledgerEntryId = prevLedgerId;
        tx.set(ledger, prevLedgerId, { description: `Expense paid: ${input.description}` }, true);
      } else {
        ledgerEntryId = db.newId(ledger);
        tx.set(ledger, ledgerEntryId, {
          type: 'payment',
          category: 'loan',
          description: `Expense paid: ${input.description}`,
          amount: input.amount,
          date: db.timestamp(new Date(input.date)),
          createdAt: db.serverTime(),
          linkedExpenseId: id,
        });
      }
    }

    // Every field the form shows, a cleared one written as null (as the store clears ledgerEntryId and
    // batchId): a karigar or a partner taken off the row goes, where a plain merge kept the old one.
    const patch: Record<string, unknown> = {
      date: input.date,
      category: input.category,
      description: input.description,
      amount: input.amount,
      paidBy: nextPaidBy,
      karigarId: input.karigarId ?? null,
      batchId: input.batchId ?? null,
      shareholderId: input.shareholderId ?? null,
      ledgerEntryId: ledgerEntryId ?? null,
    };
    tx.set(EXPENSES, id, patch, true);
    const after: Record<string, unknown> = { ...existing, ...patch, id };
    for (const k of ['karigarId', 'batchId', 'shareholderId', 'ledgerEntryId']) if (after[k] === null) delete after[k];
    return after as unknown as Expense;
  });
  log(fx, 'expense.update', `Updated expense: ${input.description}`, `ID: ${id}`, id);
  return saved;
}

/** Delete an expense, and the loan row on the ledger of a partner who fronted it, in one commit. */
export async function deleteExpense(db: DbPort, id: string, fx: SideEffects = {}): Promise<{ expenseId: string; ledgerEntryId?: string }> {
  const existing = await db.get<ExpenseDoc>(EXPENSES, id);
  if (!existing) throw new Error('No such expense.');
  const drawing = await drawingEntryOf(db, existing);
  if (drawing) throw drawingRefusal(drawing.name, 'delete');
  const b = db.batch();
  const paired = existing.ledgerEntryId && isPartner(existing.paidBy) ? existing.ledgerEntryId : undefined;
  if (paired && isPartner(existing.paidBy)) b.delete(PARTNERS[existing.paidBy].ledger, paired);
  b.delete(EXPENSES, id);
  await b.commit();
  log(fx, 'expense.delete', `Deleted expense: ${existing.description || id}`, `ID: ${id}`, id);
  return { expenseId: id, ...(paired && { ledgerEntryId: paired }) };
}

// ── Extra revenue ────────────────────────────────────────────────────────────

export type RevenueFields = Omit<AdditionalRevenue, 'id' | 'repairId'>;

/** The revenue form's schema (additional-revenue/page.tsx): a date, a description and an amount of more than 0. */
export function revenueFieldsFrom(body: Record<string, unknown>): Cleaned<RevenueFields> {
  const date = dateOf(body.date);
  if (!date) return { ok: false, error: 'A date is required.' };
  const description = textOf(body.description, 500);
  if (!description) return { ok: false, error: 'Description is required' };
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX) {
    return { ok: false, error: 'Amount must be a positive number' };
  }
  return { ok: true, value: { date, description, amount } };
}

/** Why money taken on a repair is not changed here (the revenue page's own toast). */
export const repairRefusal = () =>
  new LedgerRowRefusal('Change this on the repair: this money was taken on a repair ticket, and deleting it here would leave the ticket showing paid.');

export async function addExtraRevenue(db: DbPort, input: RevenueFields, fx: SideEffects = {}): Promise<AdditionalRevenue> {
  const id = db.newId(REVENUE);
  const row = { date: input.date, description: input.description, amount: input.amount };
  const b = db.batch();
  b.set(REVENUE, id, row);
  await b.commit();
  log(fx, 'revenue.create', `Added revenue: ${input.description}`, `Amount: ${input.amount.toLocaleString()}`, id);
  return { id, ...row };
}

/** The form's three fields over the row; anything else on it (a website order's `orderId`) stays. */
export async function updateExtraRevenue(db: DbPort, id: string, input: RevenueFields, fx: SideEffects = {}): Promise<AdditionalRevenue> {
  const saved = await db.runTransaction(async (tx) => {
    const row = await tx.get<Partial<AdditionalRevenue>>(REVENUE, id);
    if (!row) throw new Error('No such revenue entry.');
    if (row.repairId) throw repairRefusal();
    const patch = { date: input.date, description: input.description, amount: input.amount };
    tx.set(REVENUE, id, patch, true);
    return { ...row, ...patch, id } as AdditionalRevenue;
  });
  log(fx, 'revenue.update', `Updated revenue: ${input.description}`, `ID: ${id}`, id);
  return saved;
}

export async function deleteExtraRevenue(db: DbPort, id: string, fx: SideEffects = {}): Promise<{ revenueId: string }> {
  const row = await db.get<Partial<AdditionalRevenue>>(REVENUE, id);
  if (!row) throw new Error('No such revenue entry.');
  if (row.repairId) throw repairRefusal();
  const b = db.batch();
  b.delete(REVENUE, id);
  await b.commit();
  log(fx, 'revenue.delete', `Deleted revenue: ${row.description || id}`, `ID: ${id}`, id);
  return { revenueId: id };
}
