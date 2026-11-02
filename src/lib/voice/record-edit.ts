/**
 * One small change to one record (owner, 2026-11-02: "smart enough to know what im referring to and change small
 * details from there"). "Change the weight to 12 grams", "second piece size 7", "change the due date to Friday",
 * said while an order is open, is `edit | kind=order | id=ORD-000123 | piece=1 | field=weight | value=12`.
 *
 * An allow-list, not a field name passed through: each kind names the few fields voice may change, what each one
 * is (a date, grams, a karat, text), and which of the store's own writes changes it, so the change is the same
 * change the record's page makes, with its log and its checks (the iPhone sends it through /api/app/write, which
 * checks it again). Nothing here moves money: an advance, a payment or a discount stays its own confirmed step
 * (order_advance, invoice_payment, order_discount), and a price, a total or a balance is never a field here.
 *
 * Pure apart from `applyRecordEdit`, which only calls the store it is given.
 */

import type { AppState, Customer, Invoice, Karigar, KarigarJob, Order, Product, Repair } from '@/lib/store';
import { parseDate, parseKarat, parseNumber } from './args';

export const EDIT_KINDS = ['order', 'invoice', 'customer', 'karigar', 'product', 'repair', 'job'] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

type FieldType = 'text' | 'longtext' | 'date' | 'grams' | 'money' | 'percent' | 'karat' | 'phone' | 'enum';

export interface EditField {
  /** The record's own field (the store's name for it). */
  key: string;
  /** What the card calls it. */
  label: string;
  type: FieldType;
  /** Words people use for it ("due date", "promise", "ready by"). */
  words: readonly string[];
  options?: readonly string[];
  synonyms?: Record<string, string>;
}

const f = (key: string, label: string, type: FieldType, words: string[], extra: Partial<EditField> = {}): EditField =>
  ({ key, label, type, words: [label, key.toLowerCase(), ...words], ...extra });

const ORDER_STATUS_WORDS: Record<string, string> = {
  ready: 'Completed', done: 'Completed', complete: 'Completed', completed: 'Completed', ban: 'Completed', taiyar: 'Completed', finished: 'Completed',
  started: 'In Progress', 'in progress': 'In Progress', working: 'In Progress', shuru: 'In Progress',
  pending: 'Pending', waiting: 'Pending', cancel: 'Cancelled', cancelled: 'Cancelled', canceled: 'Cancelled',
};

/** What may be changed, kind by kind: `record` on the record itself, `piece` on one of its pieces. */
export const EDIT_FIELDS: Record<EditKind, { record: EditField[]; piece?: EditField[] }> = {
  order: {
    record: [
      f('promisedDate', 'due date', 'date', ['due', 'promised date', 'promise', 'promised', 'ready by', 'delivery date', 'date', 'deadline']),
      f('notes', 'note', 'longtext', ['notes', 'order note', 'remark']),
      f('status', 'status', 'enum', ['state', 'stage'], { options: ['Pending', 'In Progress', 'Completed', 'Cancelled'], synonyms: ORDER_STATUS_WORDS }),
    ],
    piece: [
      f('description', 'description', 'text', ['name', 'item', 'what', 'piece name']),
      f('size', 'size', 'text', ['ring size', 'bangle size', 'length']),
      f('estimatedWeightG', 'weight', 'grams', ['grams', 'gram', 'wt', 'wazan']),
      f('karat', 'karat', 'karat', ['carat', 'kt', 'purity']),
      f('adminNote', 'instructions', 'longtext', ['note', 'karigar note', 'instruction', 'notes']),
    ],
  },
  invoice: {
    // A bill's figures (weight, price, payments) are what it was priced and paid from: only the words that print on
    // it and the bench instructions change here (lib/workshop-details.ts).
    record: [],
    piece: [
      f('name', 'description', 'text', ['name', 'item', 'what']),
      f('size', 'size', 'text', ['ring size', 'length']),
      f('adminNote', 'instructions', 'longtext', ['note', 'karigar note', 'instruction', 'notes']),
    ],
  },
  customer: {
    record: [
      f('name', 'name', 'text', []),
      f('phone', 'phone', 'phone', ['number', 'mobile', 'phone number', 'contact', 'whatsapp']),
      f('altPhone', 'second number', 'phone', ['other number', 'alt phone', 'second phone']),
      f('email', 'email', 'text', ['mail']),
      f('address', 'address', 'longtext', ['ghar']),
      f('city', 'city', 'text', []),
      f('ringSize', 'ring size', 'text', []),
      f('bangleSize', 'bangle size', 'text', ['kara size', 'kangan size']),
      f('braceletSize', 'bracelet size', 'text', []),
      f('chainLength', 'chain length', 'text', ['chain size']),
      f('birthday', 'birthday', 'date', ['date of birth', 'dob']),
      f('anniversary', 'anniversary', 'date', []),
      f('preference', 'preference', 'text', ['likes']),
      f('notes', 'notes', 'longtext', ['note']),
    ],
  },
  karigar: {
    record: [
      f('name', 'name', 'text', []),
      f('contact', 'phone', 'phone', ['number', 'mobile', 'contact']),
      f('specialty', 'specialty', 'text', ['speciality', 'work']),
      f('workshop', 'workshop', 'text', []),
      f('notes', 'notes', 'longtext', ['note']),
    ],
  },
  product: {
    record: [
      f('metalWeightG', 'weight', 'grams', ['grams', 'gram', 'wt']),
      f('makingCharges', 'making', 'money', ['making charges', 'majoori', 'labour']),
      f('wastagePercentage', 'wastage', 'percent', ['wastage percent']),
      f('size', 'size', 'text', []),
      f('description', 'description', 'text', ['name']),
      f('customPrice', 'price', 'money', ['fixed price', 'tag price']),
    ],
  },
  repair: {
    record: [
      f('status', 'status', 'enum', ['state'], { options: ['received', 'ready', 'collected', 'cancelled'],
        synonyms: { done: 'ready', taiyar: 'ready', ban: 'ready', complete: 'ready', picked: 'collected', 'picked up': 'collected', liya: 'collected', cancel: 'cancelled', back: 'received', wapas: 'received' } }),
    ],
  },
  job: {
    record: [
      f('status', 'status', 'enum', ['state'], { options: ['pending', 'in-progress', 'completed'],
        synonyms: { started: 'in-progress', 'in progress': 'in-progress', working: 'in-progress', done: 'completed', ready: 'completed', complete: 'completed', taiyar: 'completed' } }),
      f('description', 'description', 'text', ['name', 'item']),
      f('size', 'size', 'text', []),
      f('weightG', 'weight', 'grams', ['grams', 'gram']),
      f('notes', 'instructions', 'longtext', ['note', 'notes']),
    ],
  },
};

/** The allow-list as the model reads it: one line a kind. */
export function editFieldLines(): string[] {
  return EDIT_KINDS.map(kind => {
    const { record, piece } = EDIT_FIELDS[kind];
    const parts = [record.length ? record.map(x => x.label).join(', ') : '', piece?.length ? `per piece: ${piece.map(x => x.label).join(', ')}` : '']
      .filter(Boolean);
    return `  ${kind}: ${parts.join('; ')}`;
  });
}

const lc = (s: unknown) => String(s ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (s: unknown) => String(s ?? '').replace(/\D+/g, '');

/** The field a spoken word names, among the allowed ones. */
export function fieldFor(fields: readonly EditField[], said: string): EditField | null {
  const s = lc(said);
  if (!s) return null;
  return fields.find(x => lc(x.key) === s || x.words.some(w => lc(w) === s))
    ?? fields.find(x => x.words.some(w => s.includes(lc(w)) && lc(w).length > 3)) ?? null;
}

/** A record found by what the step names it: its id, its number ("123" for ORD-000123), a SKU, or a name. */
function byId<T>(list: readonly T[] | undefined, said: string, idOf: (t: T) => string, nameOf?: (t: T) => string): T | null {
  const rows = list ?? [];
  const s = lc(said);
  const exact = rows.find(r => lc(idOf(r)) === s);
  if (exact) return exact;
  const n = digits(said);
  if (n && /\d/.test(said) && !/[a-z]{4,}/i.test(said.replace(/^(ord|inv|rep|order|invoice|repair)\W*/i, ''))) {
    const hits = rows.filter(r => { const d = digits(idOf(r)); return d && Number(d) === Number(n); });
    if (hits.length === 1) return hits[0];
  }
  if (nameOf) {
    const named = rows.filter(r => lc(nameOf(r)) === s);
    if (named.length === 1) return named[0];
  }
  return null;
}

export interface EditInput { kind: string; id: string; piece?: number | string | null; field: string; value: string }

/** The store's rows a change is checked against. */
export type EditBook = Pick<AppState, 'orders' | 'generatedInvoices' | 'customers' | 'karigars' | 'products' | 'repairs'> & { karigarJobs?: KarigarJob[] };

export type PlannedEdit = {
  ok: true;
  kind: EditKind;
  /** The record's id (a product's SKU). */
  id: string;
  /** The piece's place, from 0. */
  index: number | null;
  field: EditField;
  /** The value as it will be written. */
  value: string | number;
  /** What it was. */
  before: unknown;
  /** "ORD-000123, piece 2: size to 7." */
  said: string;
  href: string;
  record: EditRecord;
} | { ok: false; reason: string };

type EditRecord = Order | Invoice | Customer | Karigar | Product | Repair | KarigarJob;

const refuse = (reason: string): PlannedEdit => ({ ok: false, reason });

/** The value said, as the field keeps it; a reason when it is not one. */
function valueFor(field: EditField, raw: string, today: string): { ok: true; value: string | number; label: string } | { ok: false; reason: string } {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, reason: `What should the ${field.label} be?` };
  switch (field.type) {
    case 'text': return v.length > 300 ? { ok: false, reason: `The ${field.label} is too long.` } : { ok: true, value: v, label: `"${v}"` };
    case 'longtext': return v.length > 2000 ? { ok: false, reason: `The ${field.label} is too long.` } : { ok: true, value: v, label: `"${v}"` };
    case 'date': {
      const d = parseDate(v, today);
      return d ? { ok: true, value: d, label: d } : { ok: false, reason: `"${v}" is not a date.` };
    }
    case 'grams': case 'money': case 'percent': {
      const n = parseNumber(v);
      if (n == null || !Number.isFinite(n) || n < 0) return { ok: false, reason: `"${v}" is not a figure.` };
      if (field.type === 'percent' && n > 100) return { ok: false, reason: 'Wastage is between 0 and 100.' };
      if (field.type === 'grams' && (n <= 0 || n > 100_000)) return { ok: false, reason: `"${v}" is not a weight.` };
      const label = field.type === 'grams' ? `${n} g` : field.type === 'percent' ? `${n}%` : `Rs ${Math.round(n).toLocaleString('en-PK')}`;
      return { ok: true, value: field.type === 'money' ? Math.round(n) : n, label };
    }
    case 'karat': {
      const k = parseKarat(v);
      return k ? { ok: true, value: k, label: k } : { ok: false, reason: `"${v}" is not a karat.` };
    }
    case 'phone': {
      const d = v.replace(/[^\d+]/g, '');
      return d.replace(/\D/g, '').length >= 7 ? { ok: true, value: d, label: d } : { ok: false, reason: `"${v}" is not a phone number.` };
    }
    case 'enum': {
      const s = lc(v);
      const hit = (field.options ?? []).find(o => lc(o) === s) ?? field.synonyms?.[s]
        ?? Object.entries(field.synonyms ?? {}).find(([w]) => s.includes(w))?.[1];
      return hit ? { ok: true, value: hit, label: hit.toLowerCase() } : { ok: false, reason: `"${v}" is not one of: ${(field.options ?? []).join(', ')}.` };
    }
  }
}

/** Checks the change against the book: the record, the piece, the field and the value. Writes nothing. */
export function planRecordEdit(input: EditInput, book: EditBook, today: string): PlannedEdit {
  const kind = lc(input.kind).replace(/ /g, '') as EditKind;
  if (!(EDIT_KINDS as readonly string[]).includes(kind)) return refuse(`Voice changes an order, invoice, customer, karigar, piece, repair or job, not "${input.kind}".`);
  const fields = EDIT_FIELDS[kind];
  const id = String(input.id ?? '').trim();
  if (!id) return refuse(`Which ${kind}?`);
  const pieceNo = input.piece == null || input.piece === '' ? null : Number(input.piece);
  if (pieceNo != null && (!Number.isInteger(pieceNo) || pieceNo < 1)) return refuse(`"${input.piece}" is not a piece number.`);

  let record: EditRecord;
  let name: string;
  let href: string;
  let items: unknown[] | null = null;
  switch (kind) {
    case 'order': {
      const o = byId(book.orders, id, x => x.id);
      if (!o) return refuse(`No order ${id}.`);
      record = o; name = o.id; href = `/orders/${o.id}`; items = o.items ?? [];
      break;
    }
    case 'invoice': {
      const i = byId(book.generatedInvoices, id, x => x.id);
      if (!i) return refuse(`No invoice ${id}.`);
      record = i; name = i.id; href = `/invoices/${i.id}`; items = i.items ?? [];
      break;
    }
    case 'customer': {
      const c = byId(book.customers, id, x => x.id, x => x.name);
      if (!c) return refuse(`No customer ${id}.`);
      record = c; name = c.name; href = `/customers/${c.id}`;
      break;
    }
    case 'karigar': {
      const k = byId(book.karigars, id, x => x.id, x => x.name);
      if (!k) return refuse(`No karigar ${id}.`);
      record = k; name = k.name; href = `/karigars/${k.id}`;
      break;
    }
    case 'product': {
      const p = byId(book.products, id, x => x.sku);
      if (!p) return refuse(`No piece ${id} in stock.`);
      record = p; name = p.sku; href = `/products/${encodeURIComponent(p.sku)}`;
      break;
    }
    case 'repair': {
      const r = byId(book.repairs, id, x => x.id);
      if (!r) return refuse(`No repair ${id}.`);
      record = r; name = r.id; href = `/repairs?id=${r.id}`;
      break;
    }
    case 'job': {
      const j = byId(book.karigarJobs ?? [], id, x => x.id);
      if (!j) return refuse(`No workshop job ${id}.`);
      record = j; name = j.description || j.id; href = '/workshop';
      break;
    }
  }

  // A field of a piece when a piece was named, or when the field is only a piece's (with one piece, that one).
  const onRecord = fieldFor(fields.record, input.field);
  const onPiece = fields.piece ? fieldFor(fields.piece, input.field) : null;
  let index: number | null = null;
  let field: EditField | null;
  if (onPiece && (pieceNo != null || !onRecord)) {
    const count = items?.length ?? 0;
    if (pieceNo == null && count !== 1) return refuse(count ? `Which piece? ${name} has ${count}.` : `${name} has no pieces.`);
    index = (pieceNo ?? 1) - 1;
    if (index >= count) return refuse(`There is no piece ${index + 1}; ${name} has ${count}.`);
    field = onPiece;
  } else {
    field = onRecord;
  }
  if (!field) {
    const all = [...fields.record, ...(fields.piece ?? [])].map(x => x.label);
    return refuse(all.length ? `Voice can change a ${kind}'s ${[...new Set(all)].join(', ')}: not "${input.field}".` : `Open the ${kind} to change that.`);
  }

  const v = valueFor(field, input.value, today);
  if (!v.ok) return refuse(v.reason);
  const host = (index != null ? (items![index] as Record<string, unknown>) : (record as unknown as Record<string, unknown>));

  // A karat is a gold piece's; a refunded order is closed; an invoiced order's pieces are its invoice's now.
  if (field.type === 'karat' && host.metalType && host.metalType !== 'gold') return refuse(`Piece ${index! + 1} is ${host.metalType}: it has no karat.`);
  if (kind === 'order') {
    const o = record as Order;
    if (o.status === 'Refunded') return refuse(`${o.id} is refunded.`);
    if (field.key === 'status' && o.invoiceId) return refuse(`${o.id} is invoiced: its status follows the invoice.`);
  }
  const before = host[field.key] ?? null;
  const where = index != null ? `${name}, piece ${index + 1}` : name;
  return { ok: true, kind, id: kind === 'product' ? (record as Product).sku : (record as { id: string }).id, index, field, value: v.value, before,
    said: `${where}: ${field.label} to ${v.label}.`, href, record };
}

/** The change, through the store's own write for that field; and how to put it back. */
export async function applyRecordEdit(p: Extract<PlannedEdit, { ok: true }>, s: AppState): Promise<() => Promise<void>> {
  const { kind, id, index, field, value, before } = p;
  const key = field.key;
  switch (kind) {
    case 'order': {
      const o = p.record as Order;
      if (index != null && key === 'karat') {
        // A piece's karat is the order form's field: the order's pieces with this one changed, as Save Changes sends them.
        const items = o.items.map((it, i) => (i === index ? { ...it, karat: value as Order['items'][number]['karat'] } : it));
        await s.updateOrder(o.id, { items });
        return () => s.updateOrder(o.id, { items: o.items });
      }
      if (index != null) {
        await s.updateOrderItemDetails(o.id, index, { [key]: value });
        return () => s.updateOrderItemDetails(o.id, index, { [key]: (before ?? (key === 'estimatedWeightG' ? 0 : '')) as never });
      }
      if (key === 'status') {
        await s.updateOrderStatus(o.id, value as Order['status']);
        return () => s.updateOrderStatus(o.id, o.status);
      }
      await s.updateOrder(o.id, { [key]: value } as Partial<Order>);
      return () => s.updateOrder(o.id, { [key]: before ?? '' } as Partial<Order>);
    }
    case 'invoice': {
      await s.updateInvoiceItemDetails(id, index!, { [key]: value });
      return () => s.updateInvoiceItemDetails(id, index!, { [key]: (before ?? '') as string });
    }
    case 'customer': {
      await s.updateCustomer(id, { [key]: value });
      return () => s.updateCustomer(id, { [key]: (before ?? '') as string });
    }
    case 'karigar': {
      await s.updateKarigar(id, { [key]: value });
      return () => s.updateKarigar(id, { [key]: (before ?? '') as string });
    }
    case 'product': {
      // A price makes it a fixed-price piece, as the form's Fixed price does (piece_change).
      const patch: Partial<Product> = key === 'customPrice' ? { isCustomPrice: true, customPrice: value as number } : { [key]: value };
      const product = p.record as Product;
      const back = Object.fromEntries(Object.keys(patch).map(k => [k, (product as unknown as Record<string, unknown>)[k] ?? null])) as Partial<Product>;
      await s.updateProduct(id, patch);
      return () => s.updateProduct(id, back);
    }
    case 'repair': {
      const r = p.record as Repair;
      await s.setRepairStatus(id, value as Repair['status']);
      return () => s.setRepairStatus(id, r.status);
    }
    case 'job': {
      const j = p.record as KarigarJob;
      if (key === 'status') {
        await s.setKarigarJobStatus(id, value as KarigarJob['status']);
        return () => s.setKarigarJobStatus(id, j.status);
      }
      await s.updateKarigarJobDetails(id, { [key]: value });
      return () => s.updateKarigarJobDetails(id, { [key]: (before ?? (key === 'weightG' ? 0 : '')) as never });
    }
  }
}
