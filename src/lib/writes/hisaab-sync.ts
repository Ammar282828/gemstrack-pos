/**
 * The hisaab kept in step with the invoices: what store.ts `syncHisaabOutstandingBalances` did inside the
 * browser on every visit to Hisaab, as one plan both the browser and the server carry out (the iPhone app
 * asks for it through /api/app/write `syncHisaab` when an owner opens Hisaab).
 *
 * For each invoice, the rows the ERP itself manages (linked to the invoice and described as its outstanding
 * balance or its held credit) must say what the invoice says:
 * - owed (balanceDue > 0): one "Outstanding balance" debit of that much, no credit rows;
 * - overpaid (< 0): one "Credit held" row of the excess, no outstanding rows;
 * - settled or refunded: neither.
 * Rows of an invoice that no longer exists are removed. An invoice owed with no row at all (a Shopify import
 * never run through the sale) gets one. Rows typed by hand (no linkedInvoiceId) are never touched, and
 * nothing is booked to a walk-in or to an invoice whose customer cannot be found.
 */

import { creditDescription, isCreditRow } from '@/lib/invoice-credit';
import { isWalkInName } from '@/lib/walk-in';

type Inv = { id: string; customerId?: string; customerName?: string; balanceDue?: number; status?: string; createdAt?: string };
type Row = { id: string; linkedInvoiceId?: string; description?: string; cashDebit?: number; cashCredit?: number };
type Cust = { id: string; name?: string };

export type NewHisaabRow = {
  entityId: string; entityType: 'customer'; entityName: string; date?: string; description: string;
  cashDebit: number; cashCredit: number; goldDebitGrams: 0; goldCreditGrams: 0; linkedInvoiceId: string;
};

export type HisaabSyncPlan = {
  deletes: string[];
  updates: { id: string; patch: { cashDebit: number; cashCredit: number } }[];
  creates: NewHisaabRow[];
};

export const outstandingDescription = (invoiceId: string) => `Outstanding balance for Invoice ${invoiceId}`;

export function planHisaabSync(invoices: Inv[], rows: Row[], customers: Cust[]): HisaabSyncPlan {
  const plan: HisaabSyncPlan = { deletes: [], updates: [], creates: [] };

  // Shopify invoices can lack a customerId: match by name, never to a walk-in record.
  const customerByName: Record<string, { id: string; name: string }> = {};
  for (const c of customers) {
    if (c.name && !isWalkInName(c.name)) customerByName[c.name.toLowerCase().trim()] = { id: c.id, name: c.name };
  }
  const invoiceMap: Record<string, Inv> = {};
  for (const inv of invoices) invoiceMap[inv.id] = inv;

  const linkedByInvoice: Record<string, Row[]> = {};
  for (const h of rows) {
    if (!h.linkedInvoiceId) continue; // typed by hand: left alone
    (linkedByInvoice[h.linkedInvoiceId] ??= []).push(h);
  }

  const row = (inv: Inv, customerId: string, description: string, debit: number, credit: number): NewHisaabRow => ({
    entityId: customerId, entityType: 'customer', entityName: inv.customerName || 'Customer', date: inv.createdAt,
    description, cashDebit: debit, cashCredit: credit, goldDebitGrams: 0, goldCreditGrams: 0, linkedInvoiceId: inv.id,
  });

  for (const [invoiceId, linked] of Object.entries(linkedByInvoice)) {
    const inv = invoiceMap[invoiceId];
    // The invoice is gone: its rows go too.
    if (!inv) { linked.forEach((h) => plan.deletes.push(h.id)); continue; }

    const outstanding = linked.filter((h) => (h.cashDebit ?? 0) > 0 && h.description === outstandingDescription(inv.id));
    const credits = linked.filter((h) => isCreditRow(h, inv.id));
    const customerId = inv.customerId || customerByName[inv.customerName?.toLowerCase().trim() ?? '']?.id || '';
    const balanceDue = inv.status === 'Refunded' ? 0 : Number(inv.balanceDue ?? 0);

    if (balanceDue > 0) {
      credits.forEach((h) => plan.deletes.push(h.id));
      if (outstanding.length === 0) {
        if (customerId && customerId !== 'walk-in') plan.creates.push(row(inv, customerId, outstandingDescription(inv.id), balanceDue, 0));
      } else {
        if (outstanding[0].cashDebit !== balanceDue) plan.updates.push({ id: outstanding[0].id, patch: { cashDebit: balanceDue, cashCredit: 0 } });
        outstanding.slice(1).forEach((h) => plan.deletes.push(h.id));
      }
      continue;
    }

    if (balanceDue < 0) {
      outstanding.forEach((h) => plan.deletes.push(h.id));
      const creditAmount = Math.abs(balanceDue);
      if (credits.length === 0) {
        if (customerId && customerId !== 'walk-in') plan.creates.push(row(inv, customerId, creditDescription(inv.id), 0, creditAmount));
      } else {
        if (credits[0].cashCredit !== creditAmount) plan.updates.push({ id: credits[0].id, patch: { cashDebit: 0, cashCredit: creditAmount } });
        credits.slice(1).forEach((h) => plan.deletes.push(h.id));
      }
      continue;
    }

    // Settled: the ERP's own rows for it go.
    [...outstanding, ...credits].forEach((h) => plan.deletes.push(h.id));
  }

  // Owed with no row at all (a Shopify import never run through the sale).
  for (const inv of invoices) {
    if (linkedByInvoice[inv.id]) continue;
    if ((inv.balanceDue ?? 0) <= 0 || inv.status === 'Refunded') continue;
    const customerId = inv.customerId || customerByName[inv.customerName?.toLowerCase().trim() ?? '']?.id || '';
    if (!customerId || customerId === 'walk-in') continue;
    plan.creates.push(row(inv, customerId, outstandingDescription(inv.id), Number(inv.balanceDue), 0));
  }
  return plan;
}

export const planSize = (p: HisaabSyncPlan) => p.deletes.length + p.updates.length + p.creates.length;
