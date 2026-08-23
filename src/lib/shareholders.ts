/**
 * The two shareholder ledgers, read and written in one place.
 *
 * Mina and Ammar each had their own page, ~830 lines apiece, differing by
 * little more than a name and a collection. Both pages already loaded *both*
 * ledgers — one for itself and one for the distribution waterfall — which is
 * the tell that this was always one subject.
 *
 * On drawings and double counting: a partner taking money out is not a
 * business expense in accounting terms, it is a reduction of their equity.
 * But money physically left the till, and that belongs in Expenses where cash
 * out is read. So a withdrawal writes both — and the partnership P&L
 * deliberately excludes the PARTNER_DRAWINGS category, otherwise the draw
 * would hit the partner twice: once against their equity and again as half of
 * a shared expense.
 */

import {
  collection, addDoc, getDocs, deleteDoc, doc,
  orderBy, query, serverTimestamp, Timestamp, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PARTNER_DRAWINGS, type LedgerCategory, type LedgerType } from '@/lib/partnership';

export { PARTNER_DRAWINGS, isBusinessCost } from '@/lib/partnership';

export const SHAREHOLDERS = [
  { id: 'mina', name: 'Mina', ledger: 'mina_ledger', pronounPossessive: 'her' },
  { id: 'ammar', name: 'Ammar', ledger: 'ammar_ledger', pronounPossessive: 'his' },
] as const;

export type ShareholderId = typeof SHAREHOLDERS[number]['id'];
export type Shareholder = typeof SHAREHOLDERS[number];

export const shareholderById = (id: ShareholderId): Shareholder =>
  SHAREHOLDERS.find(s => s.id === id)!;

export interface LedgerRow {
  id: string;
  description: string;
  amount: number;
  date: Date;
  category: LedgerCategory;
  type: LedgerType;
  /** Set on withdrawals: the Expense row created alongside it. */
  linkedExpenseId?: string;
}

function toDate(v: unknown): Date {
  if (!v) return new Date();
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v as string);
}

export async function loadLedger(who: ShareholderId): Promise<LedgerRow[]> {
  const snap = await getDocs(query(collection(db, shareholderById(who).ledger), orderBy('date', 'desc')));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      description: data.description || '',
      amount: Number(data.amount) || 0,
      date: toDate(data.date),
      // Entries logged before the loan/equity split default to equity.
      category: (data.category === 'loan' ? 'loan' : 'equity') as LedgerCategory,
      type: (data.type === 'withdrawal' ? 'withdrawal' : 'payment') as LedgerType,
      linkedExpenseId: data.linkedExpenseId && data.linkedExpenseId !== 'pending'
        ? String(data.linkedExpenseId) : undefined,
    };
  });
}

export async function addLedgerEntry(who: ShareholderId, row: {
  type: LedgerType;
  category: LedgerCategory;
  description: string;
  amount: number;
  date: Date;
  linkedExpenseId?: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, shareholderById(who).ledger), {
    type: row.type,
    category: row.category,
    description: row.description,
    amount: row.amount,
    date: Timestamp.fromDate(row.date),
    createdAt: serverTimestamp(),
    ...(row.linkedExpenseId ? { linkedExpenseId: row.linkedExpenseId } : {}),
  });
  return ref.id;
}

export async function linkExpense(who: ShareholderId, entryId: string, expenseId: string): Promise<void> {
  await setDoc(doc(db, shareholderById(who).ledger, entryId), { linkedExpenseId: expenseId }, { merge: true });
}

export async function deleteLedgerEntry(who: ShareholderId, entryId: string): Promise<void> {
  await deleteDoc(doc(db, shareholderById(who).ledger, entryId));
}

