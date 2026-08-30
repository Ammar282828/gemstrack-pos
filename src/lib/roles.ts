/**
 * Who is signed in, and what they are allowed to be shown.
 *
 * Three kinds of person use this app:
 *
 *   owner    Ammar and Mina. Everything, including the money.
 *   staff    Someone manning the shop: sells, takes orders, keeps the bench
 *            moving. No expenses, no ledger, no shareholder finances, no
 *            settings, no analytics.
 *   karigar  A craftsman, who only ever sees their own work (/my-work).
 *
 * Staff, like karigars, get NO direct Firestore access — see firestore.rules.
 * That is not belt-and-braces on top of a hidden menu; it is the actual
 * boundary. The app reads Firestore straight from the browser, so anything the
 * database will hand over is readable in devtools no matter what the UI draws.
 * Hiding a page hides nothing. Staff reads therefore go through /api/staff/*,
 * which runs server-side and returns only the collections and fields below.
 *
 * The same reasoning is written out at greater length in karigar-auth.ts; this
 * is the second role built on it.
 */

import { STORE_CONFIG } from './store-config';

export type Role = 'owner' | 'staff' | 'karigar' | 'none';

const normalise = (email: string | undefined | null): string =>
  String(email || '').trim().toLowerCase();

const list = (raw: string | undefined): string[] =>
  (raw ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

/** Shop floor accounts, comma-separated. Empty by default: no staff until named. */
export const STAFF_EMAILS = list(process.env.NEXT_PUBLIC_STORE_STAFF_EMAILS);

export const OWNER_EMAILS = STORE_CONFIG.allowedEmails.map(e => e.trim().toLowerCase());

export const isOwner = (email: string | undefined | null): boolean => {
  const e = normalise(email);
  return !!e && OWNER_EMAILS.includes(e);
};

export const isStaff = (email: string | undefined | null): boolean => {
  const e = normalise(email);
  // Owner wins. Listing an owner as staff by mistake must not demote them out
  // of their own books.
  return !!e && !isOwner(e) && STAFF_EMAILS.includes(e);
};

/**
 * Karigars are resolved from Firestore (they have a record), so this cannot
 * decide between 'karigar' and 'none' on its own — callers that need the
 * distinction ask karigar-auth. Everything else is decided here.
 */
export function roleForEmail(email: string | undefined | null): Exclude<Role, 'karigar'> {
  if (isOwner(email)) return 'owner';
  if (isStaff(email)) return 'staff';
  return 'none';
}

// ── what staff may see ──────────────────────────────────────────────────────

/**
 * Collections staff may read, in the shape the client store expects.
 *
 * Everything absent is absent on purpose: `expenses`, `hisaab`,
 * `additional_revenue`, `karigar_batches`, `silver_transactions` and
 * `activity_log` are the shop's books and its costs. `karigars` IS included —
 * work has to be assigned to a person by name — but a karigar's pay is in
 * karigar_batches and hisaab, which are not.
 */
export const STAFF_COLLECTIONS = [
  'orders',
  'invoices',
  'customers',
  'products',
  'sold_products',
  'categories',
  'karigars',
  'given_items',
  'karigar_jobs',
] as const;

export type StaffCollection = (typeof STAFF_COLLECTIONS)[number];

export const isStaffCollection = (name: string): name is StaffCollection =>
  (STAFF_COLLECTIONS as readonly string[]).includes(name);

/**
 * Fields stripped from what staff receive, per collection.
 *
 * This is the part a rules-only approach cannot do: rules grant or deny whole
 * documents, so an employee who can open an order to work on it would also get
 * every number inside it. Filtering happens on the server, after the read.
 *
 * `*` applies to every collection.
 */
export const STAFF_HIDDEN_FIELDS: Record<string, readonly string[]> = {
  // Never for anyone but an owner: an internal note is written on the
  // assumption the customer and the shop floor will not read it.
  '*': ['adminNote'],
  // What a piece cost to make, as opposed to what it sells for. Staff quote
  // and take payment from the totals, which stay.
  orders: ['ratesApplied'],
  invoices: ['ratesApplied'],
  // A karigar's own rates and running balance.
  karigars: ['ratePerGram', 'openingBalance', 'notes', 'email'],
  // What the shop paid for stock, versus what it asks for it.
  products: ['costPrice', 'purchasePrice', 'supplier'],
};

/** Item-level fields inside an order or invoice that reveal the cost side. */
export const STAFF_HIDDEN_ITEM_FIELDS: readonly string[] = [
  'metalCost',
  'wastageCost',
  'adminNote',
];
