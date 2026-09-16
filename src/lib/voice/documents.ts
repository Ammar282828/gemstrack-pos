/**
 * The orders and invoices the shop can talk about.
 *
 * The khata assistant knew people and money, and nothing about the work. "Fatema ne
 * order pe bees hazaar advance diye" had nowhere to land: the sentence named an
 * order, and the book had no way to find one. This file is that way — it lists what
 * is open, turns "order sixteen" into ORD-000016, and pins "Fatema's order" to one
 * row or hands back the choice.
 *
 * Pure, and shared by the browser and the API route, so it must not pull the store
 * in: types only.
 */

import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import type { Order, Invoice } from '@/lib/store';
import type { RankedName } from './phonetics';

export type DocKind = 'order' | 'invoice';

export interface DocEntry {
  kind: DocKind;
  /** ORD-000016 / INV-000019 */
  id: string;
  customerId?: string;
  customerName: string;
  /** Read out beside the id, for the model and for the confirmation card. */
  label: string;
  /** Rupees still to collect. */
  balance: number;
  /** An order still at the bench and not yet invoiced; an invoice with money owed. */
  open: boolean;
  status?: string;
  promisedDate?: string;
  /** For undoing a spoken advance: what the order carried before. */
  advancePayment?: number;
  createdAt: string;
  href: string;
}

/** What a spoken status may become. Refunded is a money event, never a word said in passing. */
export const ORDER_STATUS_WORDS = ['Pending', 'In Progress', 'Completed', 'Cancelled'] as const;
export const PAYMENT_METHOD_WORDS = ['Cash', 'Card', 'Bank Transfer', 'Cheque'] as const;

const RECENT_DAYS = 90;
const CAP = 200;

const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'd MMM') : null;
}

function isRecent(iso: string, now: Date): boolean {
  const d = parseISO(iso);
  return isValid(d) && differenceInCalendarDays(now, d) <= RECENT_DAYS;
}

export function documentHref(kind: DocKind, id: string): string {
  return kind === 'order' ? `/orders/${id}` : `/cart?invoice_id=${id}`;
}

/**
 * Everything worth naming, open things first and newest first within that.
 *
 * Closed orders and paid invoices from the last three months are still here so
 * "show me Murtaza's invoice" works after he has paid; they are simply marked
 * closed, and no write will accept them.
 */
export function documentsFor(orders: Order[], invoices: Invoice[], now: Date = new Date()): DocEntry[] {
  const out: DocEntry[] = [];

  for (const o of orders) {
    const active = o.status === 'Pending' || o.status === 'In Progress';
    const open = (active || o.status === 'Completed') && !o.invoiceId;
    if (!open && !isRecent(o.createdAt, now)) continue;
    const balance = typeof o.grandTotal === 'number' ? Math.max(0, o.grandTotal) : 0;
    const pieces = Array.isArray(o.items) ? o.items.length : 0;
    const bits = [
      `${pieces} piece${pieces === 1 ? '' : 's'}`,
      o.status !== 'Pending' ? o.status : null,
      o.promisedDate ? `due ${shortDate(o.promisedDate)}` : null,
      o.invoiceId ? `invoiced as ${o.invoiceId}` : balance > 0 ? `${rupees(balance)} to collect` : 'paid',
    ].filter(Boolean);
    out.push({
      kind: 'order', id: o.id, customerId: o.customerId, customerName: o.customerName || 'Walk-in',
      label: bits.join(', '), balance, open, status: o.status, promisedDate: o.promisedDate,
      advancePayment: typeof o.advancePayment === 'number' ? o.advancePayment : 0,
      createdAt: o.createdAt, href: documentHref('order', o.id),
    });
  }

  for (const i of invoices) {
    const balance = typeof i.balanceDue === 'number' ? Math.max(0, i.balanceDue) : 0;
    const open = balance > 0 && i.status !== 'Refunded';
    if (!open && !isRecent(i.createdAt, now)) continue;
    const bits = [
      shortDate(i.createdAt),
      i.status === 'Refunded' ? 'refunded' : open ? `${rupees(balance)} due` : 'paid',
    ].filter(Boolean);
    out.push({
      kind: 'invoice', id: i.id, customerId: i.customerId, customerName: i.customerName || 'Walk-in',
      label: bits.join(', '), balance, open, createdAt: i.createdAt, href: documentHref('invoice', i.id),
    });
  }

  out.sort((a, b) => Number(b.open) - Number(a.open) || b.createdAt.localeCompare(a.createdAt));
  return out.slice(0, CAP);
}

/** One line per document, the way the roster is given to the model. */
export function documentLines(docs: DocEntry[]): string[] {
  return docs.map((d) => `${d.kind === 'order' ? 'O' : 'I'}|${d.id}|${d.customerName}|${d.open ? 'open' : 'closed'}|${d.label}`);
}

/**
 * "order sixteen", "ORD 16", "ord-000016", "invoice number nineteen" — one id.
 *
 * Only the digits are trusted. The prefix comes from the kind the action already
 * implies, so a slip of the tongue cannot point a payment at an order.
 */
export function normaliseDocId(spoken: string | null | undefined, kind: DocKind): string | null {
  const digits = String(spoken ?? '').replace(/\D+/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${kind === 'order' ? 'ORD' : 'INV'}-${String(n).padStart(6, '0')}`;
}

/** The status he said, as the word the book uses — or nothing, never a guess. */
export function matchStatus(spoken: string | null | undefined): typeof ORDER_STATUS_WORDS[number] | null {
  const s = String(spoken ?? '').toLowerCase();
  if (!s) return null;
  if (/cancel|khatam|raddi/.test(s)) return 'Cancelled';
  if (/complet|done|ready|finish|taiyar|tayyar|ban gaya|ho gaya/.test(s)) return 'Completed';
  if (/progress|start|shuru|bench|working/.test(s)) return 'In Progress';
  if (/pending|wait|baaki|baqi/.test(s)) return 'Pending';
  return null;
}

export function matchMethod(spoken: string | null | undefined): typeof PAYMENT_METHOD_WORDS[number] {
  const s = String(spoken ?? '').toLowerCase();
  if (/card/.test(s)) return 'Card';
  if (/bank|transfer|online|easypaisa|jazz|raast/.test(s)) return 'Bank Transfer';
  if (/cheque|check/.test(s)) return 'Cheque';
  return 'Cash';
}

export interface DocResolution {
  doc: DocEntry | null;
  candidates: DocEntry[];
  ambiguous: boolean;
  blocked: string | null;
}

/**
 * Which order, which invoice.
 *
 * A spoken number wins outright. Otherwise the document is found through the person
 * the sentence was about: one open row is an answer, several are a question, none
 * is a plain "she has no open order" rather than a write against something closed.
 * A write never lands on a closed document; opening one is allowed.
 */
export function resolveDocument(
  { kind, spokenId, person, forWrite }: { kind: DocKind; spokenId?: string | null; person: RankedName | null; forWrite: boolean },
  docs: DocEntry[],
): DocResolution {
  const noun = kind === 'order' ? 'order' : 'invoice';
  const ofKind = docs.filter((d) => d.kind === kind);

  const id = normaliseDocId(spokenId, kind);
  if (id) {
    const hit = ofKind.find((d) => d.id === id);
    if (!hit) return { doc: null, candidates: [], ambiguous: false, blocked: `${id} is not in the book.` };
    if (forWrite && !hit.open) {
      return { doc: null, candidates: [], ambiguous: false, blocked: `${id} is ${hit.label.includes('invoiced') ? 'already invoiced' : hit.balance > 0 ? 'closed' : 'already paid'}.` };
    }
    return { doc: hit, candidates: [], ambiguous: false, blocked: null };
  }

  if (!person) {
    // Nothing to go on but the kind. A short list is still a fair question.
    const open = ofKind.filter((d) => d.open).slice(0, 5);
    if (open.length === 1 && forWrite) return { doc: open[0], candidates: [], ambiguous: false, blocked: null };
    if (open.length) return { doc: null, candidates: open, ambiguous: true, blocked: `Which ${noun}?` };
    return { doc: null, candidates: [], ambiguous: false, blocked: `Which ${noun}?` };
  }

  const theirs = ofKind.filter((d) =>
    (person.id && d.customerId === person.id) || d.customerName.toLowerCase() === person.name.toLowerCase());
  const open = theirs.filter((d) => d.open);
  const pool = forWrite ? open : (open.length ? open : theirs);

  if (pool.length === 1) return { doc: pool[0], candidates: [], ambiguous: false, blocked: null };
  if (pool.length > 1) return { doc: null, candidates: pool.slice(0, 5), ambiguous: true, blocked: `${person.name} has more than one ${noun}.` };
  if (theirs.length) return { doc: null, candidates: [], ambiguous: false, blocked: `${person.name} has no open ${noun}.` };
  return { doc: null, candidates: [], ambiguous: false, blocked: `${person.name} has no ${noun} in the book.` };
}
