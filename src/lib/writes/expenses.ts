/**
 * An expense: the one copy, for the browser (store.ts addExpense) and the iPhone app
 * (/api/app/write addExpense).
 *
 * When a partner fronted the cash (`paidBy` ammar or mina), the money is a loan to the business,
 * so a matching row goes on that partner's ledger, each pointing at the other. Both rows are
 * written in one commit, with ids drawn first: the browser used to write the ledger row, then the
 * expense, then go back to link them (three trips, and a half-written pair if the line dropped).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Expense } from '@/lib/store';
import { cleanObject } from './create-invoice';

const EXPENSES = 'expenses';
const LEDGER = { ammar: 'ammar_ledger', mina: 'mina_ledger' } as const;

export async function addExpense(db: DbPort, input: Omit<Expense, 'id'>, fx: SideEffects = {}): Promise<Expense> {
  const paidBy = input.paidBy;
  const ledger = paidBy === 'ammar' || paidBy === 'mina' ? LEDGER[paidBy] : null;
  const id = db.newId(EXPENSES);
  const ledgerEntryId = ledger ? db.newId(ledger) : undefined;
  const persisted = cleanObject({ ...input, ...(ledgerEntryId && { ledgerEntryId }) }) as Omit<Expense, 'id'>;

  const b = db.batch();
  if (ledger && ledgerEntryId) {
    b.set(ledger, ledgerEntryId, {
      type: 'payment',
      category: 'loan',
      description: `Expense paid: ${input.description}`,
      amount: input.amount,
      date: db.timestamp(new Date(input.date)),
      createdAt: db.serverTime(),
      linkedExpenseId: id,
    });
  }
  b.set(EXPENSES, id, persisted as unknown as Record<string, unknown>);
  await b.commit();

  void Promise.resolve(fx.log?.('expense.create', `Added expense: ${input.description}`,
    `Category: ${input.category} | Amount: ${input.amount.toLocaleString()}${paidBy && paidBy !== 'business' ? ` | Paid by: ${paidBy}` : ''}`, id)).catch(() => undefined);
  return { id, ...persisted } as Expense;
}
