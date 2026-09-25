/**
 * The categories this shop files its expenses under.
 *
 * A difference between the houses, so a variable (CLAUDE.md, "every difference is a variable"):
 * Taheri's list is the default; House of Mina's own — worked out from all its past expenses,
 * the owner's ask of 2026-09-25 — is NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES in apphosting.mina.yaml,
 * comma-separated (so no commas in a name).
 *
 * Whatever the list, two names are always in it because lib/partnership.ts reads them by name:
 * 'Partner Drawings' — money a shareholder takes out; real cash leaving the till, but kept out
 * of the partnership P&L — and 'Partner Salary' — a partner paid for work, a real cost that
 * does count against profit. 'Other' is always last.
 *
 * The category on an expense is free text (the form accepts a typed one), so an expense can
 * carry a name that is not in the list; the expenses page offers those in its filter too.
 */

const TAHERI = [
  'Rent', 'Salaries', 'Utilities', 'Marketing', 'Supplies',
  'Repairs & Maintenance', 'Taxes', 'Travel', 'Making Charges',
];
const ALWAYS = ['Partner Drawings', 'Partner Salary'];

const configured = (process.env.NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES ?? '')
  .split(',').map((c) => c.trim()).filter(Boolean);

export const EXPENSE_CATEGORIES: readonly string[] = [...new Set([
  ...(configured.length ? configured : TAHERI).filter((c) => c !== 'Other' && !ALWAYS.includes(c)),
  ...ALWAYS,
  'Other',
])];

export type ExpenseCategory = string;
