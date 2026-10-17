/**
 * The Hisaab page's sums: each person's balance (debit less credit over their rows, cash and metal),
 * and one person's ledger with the balance as it stood after each row.
 *
 * Here, not in the pages, because the server prints the same Summary and Ledger PDFs for the iPhone
 * app (/api/app/pdf/hisaab): one way of adding up a hisaab, or the phone's paper and the page's would
 * disagree. The drawing is hisaab-pdf.ts.
 */

import { parseISO } from 'date-fns';
import type { HisaabEntry } from '@/lib/store';
import { WALK_IN_ENTITY, WALK_IN_NAME } from '@/lib/walk-in';

export interface HisaabAccountBalance {
  entityId: string;
  entityName: string;
  entityType: 'customer' | 'karigar';
  /** Positive: theirs to pay (receivable); negative: the shop's (payable). */
  cashBalance: number;
  goldBalance: number;
}

/**
 * Everyone with something outstanding, by name, and the invoices a walk-in's rows follow (the
 * page lists those under the one walk-in row).
 */
export function hisaabAccounts(entries: HisaabEntry[]): { accounts: HisaabAccountBalance[]; walkInInvoiceIds: Set<string> } {
  const summaryMap: { [entityId: string]: HisaabAccountBalance } = {};
  // Walk-in sales left owing have no customer to hold them (lib/walk-in.ts), so their
  // entries sit under the entity 'walk-in' — one row, or "You will Get" would miss them.
  const walkInInvoiceIds = new Set<string>();
  entries.forEach(entry => {
    if (!entry.entityId) return;
    const walkIn = entry.entityId === WALK_IN_ENTITY;
    if (walkIn && entry.linkedInvoiceId) walkInInvoiceIds.add(entry.linkedInvoiceId);
    if (!summaryMap[entry.entityId]) {
      summaryMap[entry.entityId] = {
        entityId: entry.entityId,
        entityName: walkIn ? WALK_IN_NAME : entry.entityName,
        entityType: entry.entityType,
        cashBalance: 0,
        goldBalance: 0,
      };
    }
    summaryMap[entry.entityId].cashBalance += (entry.cashDebit - entry.cashCredit);
    summaryMap[entry.entityId].goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
  });
  const accounts = Object.values(summaryMap)
    .filter(summary => Math.abs(summary.cashBalance) > 0.001 || Math.abs(summary.goldBalance) > 0.001)
    .sort((a, b) => a.entityName.localeCompare(b.entityName));
  return { accounts, walkInInvoiceIds };
}

/** The page's search: a name containing the words, any case. */
export function searchAccounts<T extends { entityName: string }>(accounts: T[], q: string): T[] {
  if (!q) return accounts;
  const needle = q.toLowerCase();
  return accounts.filter(a => a.entityName.toLowerCase().includes(needle));
}

export type HisaabLedgerLine = HisaabEntry & { runningCashBalance: number; runningGoldBalance: number };

/** One person's rows, oldest first, each with the balance after it; and where it stands now. */
export function hisaabLedger(entries: HisaabEntry[], entityId: string): { lines: HisaabLedgerLine[]; finalCashBalance: number; finalGoldBalance: number } {
  let cashBalance = 0;
  let goldBalance = 0;
  const lines = entries
    .filter(entry => entry.entityId === entityId)
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
    .map(entry => {
      cashBalance += (entry.cashDebit - entry.cashCredit);
      goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
      return { ...entry, runningCashBalance: cashBalance, runningGoldBalance: goldBalance };
    });
  return { lines, finalCashBalance: cashBalance, finalGoldBalance: goldBalance };
}

/**
 * The ledger page's WhatsApp reminder of what a customer owes (hisaab/[entityId] handleSendReminder), in one place
 * so the web and the iPhone app send the same words. Null when nothing is owed to the shop.
 */
export function reminderMessage(name: string, shopName: string, due: number): string | null {
  if (!(due > 0)) return null;
  let message = `Dear ${name},\n\n`;
  message += `This is a friendly reminder from ${shopName} regarding your outstanding balance.\n\n`;
  message += `*Amount Due:* PKR ${due.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`;
  message += `We would appreciate it if you could settle the balance at your earliest convenience.\n\n`;
  message += `Thank you.`;
  return message;
}
