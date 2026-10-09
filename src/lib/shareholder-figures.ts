/**
 * The Shareholders page's figures, as one pure function each (src/app/shareholders/page.tsx works
 * them out in its own useMemos, line for line the same): the business's profit and loss since the
 * partnership started, each partner's position from their ledger and their half of it, and what
 * unequal salaries move between them. Here so the iPhone app's port (ERPCore ShareholderFigures)
 * has one copy to follow and its cases to pass; the page can take them from here unchanged.
 *
 * No imports with a database in them, so a server route or a test can use it as it is.
 */

import { PARTNER_DRAWINGS, PARTNER_SALARY, categorise, isBusinessCost, partnerBalance, type LedgerCategory, type LedgerEntry, type LedgerType, type PartnerBalance } from '@/lib/partnership';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';

/** Expenses from "Pearls - Studs x2" onward. */
export const EXPENSE_CUTOFF = '2025-07-02';
/** Revenue from Shopify order #1103 onward. */
export const REVENUE_CUTOFF = '2025-07-16';

type InvoiceLike = { createdAt?: string; status?: string; sourceOrderId?: string } & NonNullable<Parameters<typeof invoiceSaleValue>[0]>;
type OrderLike = { id: string; createdAt?: string; status?: string; subtotal?: number; invoiceId?: string };
type ExpenseLike = { id: string; date: string; amount: number; category?: string | null; shareholderId?: string; description: string };
type RevenueLike = { date: string; amount: number };

export interface ShareholderLedgerRow {
  id: string;
  description: string;
  amount: number;
  date: Date;
  category: LedgerCategory;
  type: LedgerType;
  linkedExpenseId?: string;
}

/** A sale counts on the day its order was taken (store.ts getInvoiceRevenueDate). */
const revenueDate = (inv: { createdAt?: string; sourceOrderId?: string }, ordersById: Map<string, { createdAt?: string }>): string => {
  if (inv.sourceOrderId) {
    const order = ordersById.get(inv.sourceOrderId);
    if (order?.createdAt) return order.createdAt;
  }
  return inv.createdAt as string;
};

/** The business P&L since the partnership started, and each partner's half of it. */
export function partnershipTotals(
  expenses: ExpenseLike[], invoices: InvoiceLike[], orders: OrderLike[], additionalRevenues: RevenueLike[],
) {
  const ordersById = new Map(orders.map(o => [o.id, o]));
  // Drawings are excluded here on purpose: a partner taking money out is a
  // reduction of their own equity, not a shared cost. Counting it here would
  // charge them for it twice.
  const businessExpenses = expenses.filter(e => e.date >= EXPENSE_CUTOFF && isBusinessCost(e));
  const totalExpenses = businessExpenses.reduce((s, e) => s + e.amount, 0);

  const invoiceRevenue = invoices
    .filter(inv => inv.createdAt && inv.status !== 'Refunded'
      && revenueDate(inv, ordersById) >= REVENUE_CUTOFF)
    .reduce((s, inv) => s + invoiceSaleValue(inv), 0); // part-exchange included, as Analytics

  const invoicedOrderIds = new Set<string>();
  orders.forEach(o => { if (o.invoiceId) invoicedOrderIds.add(o.id); });
  invoices.forEach(inv => { if (inv.sourceOrderId) invoicedOrderIds.add(inv.sourceOrderId); });
  const orderRevenue = orders
    .filter(o => o.createdAt && o.status !== 'Cancelled' && o.status !== 'Refunded'
      && !invoicedOrderIds.has(o.id) && o.createdAt >= REVENUE_CUTOFF)
    .reduce((s, o) => s + (o.subtotal || 0), 0);

  const additionalRev = additionalRevenues
    .filter(r => r.date >= REVENUE_CUTOFF)
    .reduce((s, r) => s + r.amount, 0);

  const totalRevenue = invoiceRevenue + orderRevenue + additionalRev;
  const drawings = expenses
    .filter(e => e.date >= EXPENSE_CUTOFF && e.category === PARTNER_DRAWINGS)
    .reduce((s, e) => s + e.amount, 0);

  return { totalExpenses, totalRevenue, drawings, expShare: totalExpenses / 2, revShare: totalRevenue / 2 };
}

/** Salary rows live in Expenses, not the ledger — a wage is a cost of doing
 *  business, not a movement of anybody's capital. Newest first, per partner. */
export function salariesByPartner<E extends ExpenseLike>(expenses: E[]): Record<string, E[]> {
  const out: Record<string, E[]> = { mina: [], ammar: [] };
  for (const e of expenses) {
    if (e.category !== PARTNER_SALARY || !e.shareholderId) continue;
    (out[e.shareholderId] ||= []).push(e);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  return out;
}

export interface PartnerPosition<E extends ExpenseLike = ExpenseLike> {
  id: string;
  name: string;
  rows: ShareholderLedgerRow[];
  payments: ShareholderLedgerRow[];
  withdrawals: ShareholderLedgerRow[];
  salaries: E[];
  contributed: number;
  withdrawn: number;
  salaryPaid: number;
  balance: PartnerBalance;
}

/** One partner's position, from their ledger plus their half of the P&L. */
export function partnerPositions<E extends ExpenseLike>(
  partners: readonly { id: string; name: string }[],
  ledgers: Record<string, ShareholderLedgerRow[]>,
  salariesBy: Record<string, E[]>,
  totals: { expShare: number; revShare: number },
): PartnerPosition<E>[] {
  return partners.map(s => {
    const rows = ledgers[s.id] || [];
    const payments = rows.filter(r => r.type === 'payment');
    const withdrawals = rows.filter(r => r.type === 'withdrawal');
    const buckets = categorise(payments as unknown as LedgerEntry[], withdrawals as unknown as LedgerEntry[]);
    const salaries = salariesBy[s.id] || [];
    return {
      id: s.id,
      name: s.name,
      rows, payments, withdrawals, salaries,
      contributed: payments.reduce((a, p) => a + p.amount, 0),
      withdrawn: withdrawals.reduce((a, w) => a + w.amount, 0),
      salaryPaid: salaries.reduce((a, e) => a + e.amount, 0),
      balance: partnerBalance(buckets, totals.expShare, totals.revShare),
    };
  });
}

/** Unequal salaries quietly move money between partners; equal ones cancel. */
export function salaryGap<P extends { salaryPaid: number }>(positions: P[]): { ahead: P; behind: P; transferred: number } | null {
  const [a, b] = positions;
  if (!a || !b) return null;
  const diff = a.salaryPaid - b.salaryPaid;
  if (Math.abs(diff) < 1) return null;
  const ahead = diff > 0 ? a : b;
  const behind = diff > 0 ? b : a;
  return { ahead, behind, transferred: Math.abs(diff) / 2 };
}

/** A ledger document as the page reads it (lib/shareholders.ts loadLedger), its date already a Date. */
export function ledgerRowFrom(id: string, data: Record<string, unknown>, date: Date): ShareholderLedgerRow {
  return {
    id,
    description: (data.description as string) || '',
    amount: Number(data.amount) || 0,
    date,
    // Entries logged before the loan/equity split default to equity.
    category: data.category === 'loan' ? 'loan' : 'equity',
    type: data.type === 'withdrawal' ? 'withdrawal' : 'payment',
    linkedExpenseId: data.linkedExpenseId && data.linkedExpenseId !== 'pending' ? String(data.linkedExpenseId) : undefined,
  };
}
