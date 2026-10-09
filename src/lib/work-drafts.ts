/**
 * Orders and sales started and not yet saved — the Drafts section.
 *
 * The owner, 2026-09-27: "drafts should have a separate section (order/invoice drafts) and be
 * saved there, dont draft ongoing orders … deal with them smartly". So:
 *
 *  - Only a new order form and a new sale are ever drafted. An order being edited or invoiced,
 *    an invoice on screen, an estimate being changed — those already exist and are never copied
 *    into Drafts. (The old device-only drafts did exactly that: the form kept saving after the
 *    record was written, and a sale's customer stayed in the fields while its invoice was shown.)
 *  - Each unfinished form is a draft of its own, in Firestore `drafts`, so every device in the
 *    shop sees the same list and a sale started on a phone is finished at the counter.
 *  - A draft is written as you type, removed the moment its order or invoice is saved (and never
 *    written again after that), removed when the form is emptied, and forgotten after a month.
 *
 * This file is the pure part (tested); the Firestore reads and writes are in
 * components/drafts/use-work-drafts.ts.
 */

export type WorkDraftKind = 'order' | 'sale';

/** What a draft's card shows without opening it. */
export interface DraftSummary {
  /** Who it is for, or "No customer yet". */
  title: string;
  /** What is in it, in a few words. */
  detail: string;
  /** Pieces in it. */
  items: number;
  /** The running total, PKR (0 when unknown). */
  total: number;
}

export interface WorkDraft<T = Record<string, unknown>> extends DraftSummary {
  id: string;
  kind: WorkDraftKind;
  data: T;
  /** The device it was last typed on ("iPhone", "Mac"…). */
  device: string;
  createdAt: string;
  updatedAt: string;
  /** Anything too big to keep in a draft and left out (the order's sample photos, rarely). */
  leftOut?: string[];
}

/** A month without a keystroke and a draft is clutter, not work in hand. */
export const DRAFT_MAX_AGE_DAYS = 30;
/** Firestore holds up to 1 MiB a document; stay well clear of it. */
export const DRAFT_MAX_BYTES = 900_000;

export const newDraftId = (kind: WorkDraftKind, now = Date.now()) =>
  `${kind}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const draftHref = (d: { kind: WorkDraftKind; id: string }) =>
  d.kind === 'order' ? `/orders/add?draft=${encodeURIComponent(d.id)}` : `/invoices/new?draft=${encodeURIComponent(d.id)}`;

export const isExpired = (d: { updatedAt?: string }, now = Date.now()) => {
  const t = Date.parse(d.updatedAt || '');
  return !Number.isFinite(t) || now - t > DRAFT_MAX_AGE_DAYS * 864e5;
};

/**
 * Is there anything here worth keeping? A form mounts with defaults — empty strings, zeros, one
 * blank row, today's rates — and a draft of that is noise. Rates and dates alone never count.
 */
export function isWorthKeeping(data: unknown, ignore: readonly string[] = []): boolean {
  const skip = new Set(ignore);
  const meaningful = (v: unknown): boolean => {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'boolean') return false;
    if (Array.isArray(v)) return v.some(meaningful);
    if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).some(([k, x]) => !skip.has(k) && meaningful(x));
    return typeof v === 'string' ? v.trim() !== '' : true;
  };
  return meaningful(data);
}

/** Fields a blank order or sale already has filled in, which say nothing about the work. A blank
 *  order promises a date and carries today's rates; every blank row has a random `id`. */
export const ORDER_DEFAULT_FIELDS = [
  'id', 'goldRate18k', 'goldRate21k', 'goldRate22k', 'goldRate24k', 'palladiumRate18k', 'palladiumRate12k',
  'promisedDate', 'metalType', 'karat', 'wastagePercentage', 'makingCharges', 'source', 'takenBy', 'customerId', 'advanceMethod',
] as const;
export const SALE_DEFAULT_FIELDS = ['id', 'selectedCustomerId', 'takenBy', 'paymentMethod', 'method', 'discountAmountInput'] as const;

/**
 * Plain data Firestore will take: no `undefined`, no functions, nothing that is not JSON. Too big,
 * and the long data URLs (an order item's sample photo) are left out rather than losing the draft.
 */
export function toStorable<T>(data: T): { data: T; leftOut?: string[] } {
  const json = JSON.stringify(data ?? {});
  if (json.length <= DRAFT_MAX_BYTES) return { data: JSON.parse(json) as T };
  const leftOut = new Set<string>();
  const slim = JSON.parse(json, (key, v) => {
    if (typeof v === 'string' && v.startsWith('data:') && v.length > 20_000) { leftOut.add('photos'); return ''; }
    return v;
  }) as T;
  return { data: slim, leftOut: [...leftOut] };
}

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;
const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
const num = (o: Record<string, unknown>, k: string) => {
  const v = o[k];
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** An order form's card: the customer, the pieces by what they are, the advance. */
export function summarizeOrder(data: Record<string, unknown>, total = 0): DraftSummary {
  const items = (Array.isArray(data.items) ? data.items : []).filter(i => isWorthKeeping(i, ['metalType', 'karat', 'wastagePercentage', 'makingCharges', 'isCompleted']));
  const names = items
    .map(i => (i && typeof i === 'object' ? str(i as Record<string, unknown>, 'description') || str(i as Record<string, unknown>, 'itemCategory') : ''))
    .filter(Boolean);
  const advance = num(data, 'advancePayment');
  const detail = [
    names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : items.length ? plural(items.length, 'piece') : 'No pieces yet',
    advance > 0 ? `advance ${pkr(advance)}` : '',
  ].filter(Boolean).join(' · ');
  return { title: str(data, 'customerName') || 'No customer yet', detail, items: items.length, total: Math.max(0, total) };
}

/** A sale's card: the customer, the pieces in the cart, the running total. */
export function summarizeSale(data: Record<string, unknown>, customerName = ''): DraftSummary {
  const cart = Array.isArray(data.cart) ? (data.cart as Record<string, unknown>[]) : [];
  const names = cart.map(i => str(i, 'name') || str(i, 'sku')).filter(Boolean);
  const total = num(data, 'subtotal');
  const detail = [
    names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'No pieces yet',
    num(data, 'discountAmountInput') > 0 ? `discount ${pkr(num(data, 'discountAmountInput'))}` : '',
  ].filter(Boolean).join(' · ');
  return { title: customerName || str(data, 'walkInCustomerName') || 'No customer yet', detail, items: cart.length, total: Math.max(0, total) };
}

/** Where a draft was typed, in the shop's words. */
export function deviceName(ua: string): string {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

/**
 * The drafts kept in this browser before they moved to Firestore (gemstrack:draft:…) were mostly
 * orders and sales that had in fact been saved — the old form kept writing after the save. One is
 * worth carrying over only when nothing for the same customer was saved after it was last typed.
 */
export function legacyAlreadySaved(
  draft: { kind: 'order' | 'invoice'; savedAt: string; data: Record<string, unknown> },
  saved: { customerName?: string; createdAt: string }[],
): boolean {
  const who = (draft.kind === 'order' ? str(draft.data, 'customerName') : str(draft.data, 'walkInCustomerName')).toLowerCase();
  const at = Date.parse(draft.savedAt) - 10 * 60e3;
  if (!who) return false;
  return saved.some(r => (r.customerName || '').trim().toLowerCase() === who && Date.parse(r.createdAt) >= at);
}

/** A draft's id as newDraftId makes it: its kind, the time in base 36, a few letters. */
export const DRAFT_ID_RE = /^(order|sale)-[0-9a-z]{6,12}-[0-9a-z]{1,8}$/;

export type DraftWrite =
  | { ok: true; id: string; doc: Omit<WorkDraft, 'id'> }
  | { ok: false; error: string };

/**
 * A draft sent by the iPhone app (/api/app/drafts), as the web's forms write one: its kind and id, the form's
 * values as they stand, and the card worked out here from them (summarizeOrder, summarizeSale), never taken on
 * trust. `total` is the order's balance or the sale's subtotal as the phone shows it; `customerName` is the
 * customer picked, for a sale's card. Too big and the photos are left out, as in the browser.
 */
export function draftWrite(body: Record<string, unknown>, now = new Date()): DraftWrite {
  const id = typeof body.id === 'string' ? body.id : '';
  const kind = body.kind === 'order' || body.kind === 'sale' ? body.kind : null;
  if (!kind || !DRAFT_ID_RE.test(id) || !id.startsWith(`${kind}-`)) return { ok: false, error: 'Not a draft.' };
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'A draft holds a form.' };
  const { data: storable, leftOut } = toStorable(data as Record<string, unknown>);
  if (JSON.stringify(storable).length > DRAFT_MAX_BYTES) return { ok: false, error: 'Too big to keep as a draft.' };
  const total = Number(body.total);
  const name = typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 120) : '';
  const summary = kind === 'order'
    ? summarizeOrder(storable, Number.isFinite(total) ? total : 0)
    : summarizeSale(storable, name);
  const created = typeof body.createdAt === 'string' ? Date.parse(body.createdAt) : NaN;
  // When it was begun, as the phone says; never later than now.
  const createdAt = Number.isFinite(created) && created <= now.getTime() ? new Date(created).toISOString() : now.toISOString();
  const device = typeof body.device === 'string' && body.device.trim() ? body.device.trim().slice(0, 40) : 'iPhone';
  return {
    ok: true, id,
    doc: { kind, data: storable, ...summary, device, createdAt, updatedAt: now.toISOString(), ...(leftOut?.length ? { leftOut } : {}) },
  };
}
