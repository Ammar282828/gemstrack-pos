/**
 * Changing a reading before it is written (owner, 2026-10-01: "have the ability to make any
 * changes").
 *
 * The shop can change anything on the card: what kind of entry it is, the person, the order
 * or invoice, the figure, the weight, the karat, how it was paid, the status, the date, the
 * note, a customer's details. Each change is made to the model's reply (the draft) and the
 * reading is built again by resolveIntent(), so every rule that guards a spoken entry (the
 * person pinned to a real row, a payment no larger than what is owed, a karigar kept off the
 * customer side) guards an edited one too. Nothing here writes.
 *
 * Once anything has been changed the model's own sentence no longer describes the entry, so
 * the card says what will be written in words made here (describeReading).
 */

import { READ_ONLY_ACTIONS, resolveIntent, CUSTOMER_FIELDS, KARIGAR_FIELDS, type RawIntent, type Reading, type ResolveOptions, type VoiceAction } from './resolve';
import type { DocEntry } from './documents';
import type { RankedName } from './phonetics';

export interface Draft {
  raw: RawIntent;
  pinPerson: RankedName | null;
  pinDoc: DocEntry | null;
  /** Something on the card was changed by hand. */
  edited: boolean;
  /** The person was chosen by hand: a correction worth remembering for next time. */
  personChosen: boolean;
}

export type Edit =
  | { kind: 'action'; action: VoiceAction }
  | { kind: 'person'; person: RankedName }
  | { kind: 'doc'; doc: DocEntry }
  | { kind: 'amount'; value: number | null }
  | { kind: 'grams'; value: number | null }
  | { kind: 'karat'; value: number | null }
  | { kind: 'description'; value: string }
  /** A record field (name, phone …) or an order/invoice field (status, date, method). */
  | { kind: 'field'; key: string; value: string };

export const newDraft = (raw: RawIntent): Draft => ({ raw: { ...raw }, pinPerson: null, pinDoc: null, edited: false, personChosen: false });

/** The actions the card offers, in the shop's words. Grouped as they are on the card. */
export const WRITE_ACTIONS: { action: VoiceAction; label: string }[] = [
  { action: 'record_payment', label: 'They paid the shop' },
  { action: 'record_owed', label: 'They owe the shop (on credit)' },
  { action: 'record_payout', label: 'The shop paid them' },
  { action: 'record_we_owe', label: 'The shop owes them' },
  { action: 'write_off', label: 'Write off what they owe' },
  { action: 'invoice_payment', label: 'Payment on an invoice' },
  { action: 'order_advance', label: 'Advance on an order' },
  { action: 'order_status', label: "Change an order's status" },
  { action: 'order_promise', label: "Change an order's promised date" },
  { action: 'gold_received', label: 'Gold received from them' },
  { action: 'gold_paid', label: 'Gold given to them' },
  { action: 'expense', label: 'Shop expense' },
  { action: 'other_income', label: 'Other income' },
  { action: 'new_customer', label: 'New customer' },
  { action: 'new_karigar', label: 'New karigar' },
  { action: 'edit_customer', label: "Change a customer's details" },
  { action: 'edit_karigar', label: "Change a karigar's details" },
];

const DOC_KIND: Partial<Record<VoiceAction, 'order' | 'invoice'>> = {
  order_advance: 'order', order_status: 'order', order_promise: 'order', invoice_payment: 'invoice',
};
export const docKindFor = (a: VoiceAction) => DOC_KIND[a] ?? null;

/** What each action shows on the card to be changed. */
export function editableFor(a: VoiceAction): {
  person: 'customer' | 'karigar' | 'any' | null; doc: 'order' | 'invoice' | null;
  amount: boolean; grams: boolean; method: boolean; status: boolean; date: boolean; note: boolean;
  fields: readonly string[] | null;
} {
  const none = { person: null, doc: null, amount: false, grams: false, method: false, status: false, date: false, note: false, fields: null };
  switch (a) {
    case 'record_payment': case 'record_owed': case 'record_payout': case 'record_we_owe': case 'write_off':
      return { ...none, person: 'any', amount: true, note: true };
    case 'gold_received': case 'gold_paid':
      return { ...none, person: 'any', grams: true, note: true };
    case 'expense': case 'other_income':
      return { ...none, amount: true, note: true };
    case 'invoice_payment':
      return { ...none, person: 'customer', doc: 'invoice', amount: true, method: true };
    case 'order_advance':
      return { ...none, person: 'customer', doc: 'order', amount: true, note: true };
    case 'order_status':
      return { ...none, person: 'customer', doc: 'order', status: true };
    case 'order_promise':
      return { ...none, person: 'customer', doc: 'order', date: true };
    case 'new_customer':
      return { ...none, fields: CUSTOMER_FIELDS };
    case 'new_karigar':
      return { ...none, fields: KARIGAR_FIELDS };
    case 'edit_customer':
      return { ...none, person: 'customer', fields: CUSTOMER_FIELDS };
    case 'edit_karigar':
      return { ...none, person: 'karigar', fields: KARIGAR_FIELDS };
    default:
      return none;
  }
}

/**
 * The first change fixes what the model's sentence was standing in for: a figure it recovered
 * from its summary, the status and the method it read out of it, the person and the document
 * already pinned. After that the summary is dropped, so a figure cleared by hand is not
 * quietly recovered from the model's old sentence.
 */
function settle(d: Draft, current: Reading): Draft {
  if (d.edited) return d;
  const fields: Record<string, unknown> = { ...(d.raw.fields ?? {}) };
  if (current.status) fields.status = current.status;
  if (current.method) fields.method = current.method;
  if (current.date) fields.date = current.date;
  return {
    ...d,
    edited: true,
    raw: { ...d.raw, action: current.action, amount: current.amount, fields, summary: '' },
    pinPerson: d.pinPerson ?? current.person,
    pinDoc: d.pinDoc ?? current.doc,
  };
}

export function applyEdit(draft: Draft, edit: Edit, current: Reading): Draft {
  const d = settle(draft, current);
  const raw = { ...d.raw };
  switch (edit.kind) {
    case 'action': {
      raw.action = edit.action;
      // An order is not an invoice: a document pinned for one kind is let go for the other.
      const kind = docKindFor(edit.action);
      const keepDoc = kind && d.pinDoc?.kind === kind ? d.pinDoc : null;
      // The other side of the book keeps the person only when the new action can take them.
      const want = editableFor(edit.action).person;
      const keepPerson = d.pinPerson && (want === 'any' || want === d.pinPerson.kind) ? d.pinPerson : null;
      // Let go means let go: the heard name is not matched again onto the other side.
      if (want && d.pinPerson && !keepPerson) delete raw.person;
      return { ...d, raw, pinDoc: keepDoc, pinPerson: keepPerson ?? (want ? null : d.pinPerson) };
    }
    case 'person': {
      const doc = d.pinDoc && (d.pinDoc.customerId === edit.person.id || d.pinDoc.customerName.toLowerCase() === edit.person.name.toLowerCase()) ? d.pinDoc : null;
      return { ...d, raw: { ...raw, person: { ...raw.person, name: edit.person.name, kind: edit.person.kind } }, pinPerson: { ...edit.person, via: 'exact', score: 1 }, pinDoc: doc, personChosen: true };
    }
    case 'doc':
      return { ...d, raw, pinDoc: edit.doc };
    case 'amount':
      return { ...d, raw: { ...raw, amount: edit.value } };
    case 'grams':
      return { ...d, raw: { ...raw, grams: edit.value } };
    case 'karat':
      return { ...d, raw: { ...raw, karat: edit.value } };
    case 'description':
      return { ...d, raw: { ...raw, description: edit.value } };
    case 'field': {
      const fields: Record<string, unknown> = { ...(raw.fields ?? {}) };
      if (edit.value.trim()) fields[edit.key] = edit.value; else delete fields[edit.key];
      return { ...d, raw: { ...raw, fields } };
    }
  }
}

/** The reading for a draft: built again by resolveIntent, and described here once it was changed. */
export function readDraft(d: Draft, opts: ResolveOptions): Reading {
  const r = resolveIntent(d.raw, { ...opts, pinPerson: d.pinPerson ?? undefined, pinDoc: d.pinDoc ?? undefined });
  return d.edited ? { ...r, summary: describeReading(r) } : r;
}

const rs = (n: number | null) => `Rs ${Math.round(n ?? 0).toLocaleString('en-PK')}`;
const who = (r: Reading) => r.person?.name ?? 'someone';
const note = (r: Reading) => (r.description ? ` — ${r.description}` : '');
const docName = (r: Reading) => (r.doc ? `${r.doc.id} (${r.doc.customerName})` : `the ${docKindFor(r.action) ?? 'order'}`);

/** What will be written, in one sentence. */
export function describeReading(r: Reading): string {
  switch (r.action) {
    case 'record_payment': return `${who(r)} paid the shop ${rs(r.amount)}${note(r)}.`;
    case 'record_owed': return `${who(r)} owes the shop ${rs(r.amount)} more${note(r)}.`;
    case 'record_payout': return `The shop paid ${who(r)} ${rs(r.amount)}${note(r)}.`;
    case 'record_we_owe': return `The shop owes ${who(r)} ${rs(r.amount)} more${note(r)}.`;
    case 'write_off': return `Write off ${rs(r.amount)} that ${who(r)} owes${note(r)}.`;
    case 'gold_received': return `${r.grams ?? 0} g of ${r.karat ?? ''}k received from ${who(r)}${note(r)}.`;
    case 'gold_paid': return `${r.grams ?? 0} g of ${r.karat ?? ''}k given to ${who(r)}${note(r)}.`;
    case 'expense': return `An expense of ${rs(r.amount)}${note(r)}.`;
    case 'other_income': return `${rs(r.amount)} of other income${note(r)}.`;
    case 'invoice_payment': return `${rs(r.amount)} by ${(r.method ?? 'Cash').toLowerCase()} against ${docName(r)}.`;
    case 'order_advance': return `${rs(r.amount)} advance on ${docName(r)}${note(r)}.`;
    case 'order_status': return `${docName(r)} is now ${(r.status ?? '?').toLowerCase()}.`;
    case 'order_promise': return `${docName(r)} is promised for ${r.date ?? '?'}.`;
    case 'new_customer': case 'new_karigar': {
      const f = r.fields ?? {};
      const rest = Object.entries(f).filter(([k]) => k !== 'name').map(([k, v]) => `${k} ${v}`).join(', ');
      return `New ${r.action === 'new_customer' ? 'customer' : 'karigar'} ${f.name ?? '?'}${rest ? `: ${rest}` : ''}.`;
    }
    case 'edit_customer': case 'edit_karigar': {
      const f = Object.entries(r.fields ?? {}).map(([k, v]) => `${k} to ${v}`).join(', ');
      return `Change ${who(r)}'s ${f || 'details'}.`;
    }
    default: return r.summary;
  }
}

/** True for readings the card can edit (anything that writes, and what it could not place). */
export const canEdit = (r: Reading) => !READ_ONLY_ACTIONS.has(r.action) || r.action === 'unknown';
