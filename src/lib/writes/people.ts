/**
 * Customers and karigars: a profile edited, a karigar added. The one copy, run by the browser (store.ts
 * `updateCustomer`, `addKarigar`, `updateKarigar`, on the client SDK) and by the iPhone app
 * (/api/app/write, ops-people.ts, on the Admin SDK).
 *
 * Two layers, so the browser's other callers (the order form's sizes, the voice assistant, the contact
 * import) keep exactly what they had:
 * - `updateCustomer`, `addKarigar` and `updateKarigar` write what they are given, as the store always did.
 * - `cleanCustomerEdit` and `cleanKarigarEdit` are the phone's door: the web forms' own rules
 *   (components/customer/customer-form.tsx, components/karigar/karigar-form.tsx) applied to a body nobody
 *   has checked. Only the fields those forms edit get through (never an id, `deletedAt`, a Shopify id or
 *   the tags), text is trimmed, and a field the phone did not send is left as it is on file.
 *
 * A rename touches this one document and no other, as in the browser: invoices, orders and hisaab rows keep
 * the name they were written with (the Hisaab page puts its own rows right on a visit, hisaab-sync.ts), and
 * "Merge duplicates" is the one thing that rewrites them. There is no Shopify push either: the browser's
 * `PUSH_TO_SHOPIFY` is off.
 */

import * as z from 'zod';
import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Customer, CustomerSource, Karigar } from '@/lib/store';
import { normalizePhoneNumber } from '@/lib/utils';
import { cleanObject } from './create-invoice';

const CUSTOMERS = 'customers';
const KARIGARS = 'karigars';

/** store.ts CUSTOMER_SOURCES, written out so the server never loads the store; the types below keep the two lists equal. */
export const CUSTOMER_SOURCE_WORDS = ['taheri_spillover', 'referral', 'walkin', 'social_media', 'website', 'other'] as const satisfies readonly CustomerSource[];
const _everySourceListed: Exclude<CustomerSource, (typeof CUSTOMER_SOURCE_WORDS)[number]> extends never ? true : never = true;
void _everySourceListed;

/** What the customer form edits: the text boxes. The referral source is the form's select, kept apart. */
export const CUSTOMER_TEXT_FIELDS = [
  'name', 'phone', 'altPhone', 'email', 'address', 'city', 'country',
  'ringSize', 'bangleSize', 'braceletSize', 'chainLength', 'birthday', 'anniversary', 'preference', 'notes',
] as const;

/** What the karigar form edits. */
export const KARIGAR_TEXT_FIELDS = [
  'name', 'contact', 'altPhone', 'specialty', 'workshop', 'address', 'city', 'country', 'notes', 'email',
] as const;

/**
 * A customer's patch. `source: ''` is "Not specified": the browser's select can only leave the field alone,
 * and a source a person means to take off needs to be blank (everything that reads it treats '' as none).
 */
export type CustomerWrite = Omit<Partial<Customer>, 'id' | 'source'> & { source?: CustomerSource | '' };
export type KarigarWrite = Omit<Partial<Karigar>, 'id'>;

const log = (fx: SideEffects, action: string, title: string, detail: string, id: string) =>
  void Promise.resolve(fx.log?.(action, title, detail, id)).catch(() => undefined);

/** The most a person could mean in one box (a long note); a paste gone wrong is not stored. */
const MAX_TEXT = 4000;

const LABELS: Record<string, string> = {
  name: 'Name', phone: 'Phone number', altPhone: 'Second number', email: 'Email address', address: 'Address',
  city: 'City', country: 'Country', ringSize: 'Ring size', bangleSize: 'Bangle size', braceletSize: 'Bracelet size',
  chainLength: 'Chain length', birthday: 'Birthday', anniversary: 'Anniversary', preference: 'Preferences',
  notes: 'Notes', source: 'Referral source', contact: 'Contact number', specialty: 'Specialty', workshop: 'Workshop',
};
const label = (k: string) => LABELS[k] ?? k;

export type Cleaned<T> = { ok: true; patch: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The named fields of `input` as trimmed text; anything not named is dropped. */
function textFields(input: unknown, names: readonly string[]): Cleaned<Record<string, string>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Nothing to save.');
  const src = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of names) {
    if (!(k in src)) continue;
    const v = src[k];
    if (typeof v !== 'string') return fail(`${label(k)} must be text.`);
    const t = v.trim();
    if (t.length > MAX_TEXT) return fail(`${label(k)} is too long.`);
    out[k] = t;
  }
  return { ok: true, patch: out };
}

/** The forms' own check (zod's `string().email()`), so the phone refuses what the web refuses. */
const validEmail = (s: string) => z.string().email().safeParse(s).success;

/** A date input's value: yyyy-mm-dd and a day the calendar has. */
export function isIsoDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The customer form's fields, checked: what the phone may change on a profile. A name left blank becomes
 * "Customer - <number>", or "Unnamed Customer", as the form does; the numbers go in as the store saves them
 * (E.164, +92 by default). Left out are left alone.
 */
export function cleanCustomerEdit(input: unknown): Cleaned<CustomerWrite> {
  const r = textFields(input, [...CUSTOMER_TEXT_FIELDS, 'source']);
  if (!r.ok) return r;
  const f = r.patch;
  if (!Object.keys(f).length) return fail('Nothing to save.');

  if (f.email && !validEmail(f.email)) return fail('Invalid email address');
  if ('source' in f && f.source && !(CUSTOMER_SOURCE_WORDS as readonly string[]).includes(f.source)) return fail('Referral source is not one of the shop\'s.');
  for (const k of ['birthday', 'anniversary']) {
    if (f[k] && !isIsoDay(f[k])) return fail(`${label(k)} must be a date, like 1990-06-30.`);
  }

  if ('phone' in f) f.phone = normalizePhoneNumber(f.phone);
  // The second number is the form's PhoneField too, which hands over E.164.
  if ('altPhone' in f) f.altPhone = normalizePhoneNumber(f.altPhone);
  if ('name' in f && !f.name) f.name = f.phone ? `Customer - ${f.phone}` : 'Unnamed Customer';
  return { ok: true, patch: f as CustomerWrite };
}

/**
 * The karigar form's fields, checked. A new karigar needs a name; an edit may leave it out but not blank it.
 * The login email is stored lowercase: it is matched against the Google account's address on every
 * karigar-portal request. The contact number is the form's PhoneField (E.164); the second number is free
 * text there ("Workshop line, or a son's phone") and stays as typed.
 */
export function cleanKarigarEdit(input: unknown, mode: 'add' | 'update'): Cleaned<KarigarWrite> {
  const r = textFields(input, KARIGAR_TEXT_FIELDS);
  if (!r.ok) return r;
  const f = r.patch;
  if (!Object.keys(f).length) return fail('Nothing to save.');

  if (mode === 'add' && !f.name) return fail('Name is required');
  if ('name' in f && !f.name) return fail('Name is required');
  if ('email' in f) {
    f.email = f.email.toLowerCase();
    if (f.email && !validEmail(f.email)) return fail('Enter a valid email');
  }
  if ('contact' in f) f.contact = normalizePhoneNumber(f.contact);
  return { ok: true, patch: f as KarigarWrite };
}

/**
 * A customer saved over: the fields given, merged into the document. The number is made E.164 on every
 * save so it stays the same whichever form did the edit. `mustExist` is the phone's door: a customer who
 * is not on file, or has been removed, is refused rather than made out of a patch.
 */
export async function updateCustomer(db: DbPort, id: string, patch: CustomerWrite, fx: SideEffects = {}, opts: { mustExist?: boolean } = {}): Promise<void> {
  const held = await db.get<{ deletedAt?: string; name?: string; phone?: string }>(CUSTOMERS, id);
  if (opts.mustExist && (!held || held.deletedAt)) throw new Error('No such customer.');
  const data = patch.phone !== undefined ? { ...patch, phone: normalizePhoneNumber(patch.phone) } : patch;
  const b = db.batch();
  b.set(CUSTOMERS, id, cleanObject(data) as Record<string, unknown>, true);
  await b.commit();
  log(fx, 'customer.update', `Updated customer: ${patch.name || id}`, `ID: ${id}`, id);
  // The same customer everywhere (owner, 2026-11-26: "I edit the customer name in the customer base, it should also then
  // update the name in the orders because it's the same customer").
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const phone = typeof data.phone === 'string' ? data.phone : '';
  const renamed = !!name && name !== (held?.name ?? '').trim();
  const renumbered = !!phone && phone !== (held?.phone ?? '');
  if (held && (renamed || renumbered)) {
    const n = await carryCustomer(db, id, { name: renamed ? name : null, phone: renumbered ? phone : null, oldPhone: held.phone ?? '' });
    if (n) log(fx, 'customer.update', `Carried ${renamed ? `the name "${name}"` : 'the new number'} to ${n} record${n === 1 ? '' : 's'}`, `Orders, invoices, repairs and the khata of ID: ${id}`, id);
  }
}

/** Records that copy a customer's name and number when they are made, by the field that links them back. */
const CARRIED = [
  { col: 'orders', link: 'customerId', name: 'customerName', phone: 'customerContact' },
  { col: 'invoices', link: 'customerId', name: 'customerName', phone: 'customerContact' },
  { col: 'repairs', link: 'customerId', name: 'customerName', phone: 'customerContact' },
  { col: 'hisaab', link: 'entityId', name: 'entityName', phone: null },
] as const;

/**
 * A customer's new name onto every order, invoice, repair and khata entry linked to them (by id, never by matching
 * names: two Fatimas stay two). The number moves only where the record held the old one or none, so a delivery number
 * typed on one order stays. Returns how many records changed. Chunked: a Firestore batch takes 500 writes.
 */
export async function carryCustomer(db: DbPort, id: string, to: { name: string | null; phone: string | null; oldPhone: string }): Promise<number> {
  const changes: { col: string; id: string; patch: Record<string, unknown> }[] = [];
  for (const c of CARRIED) {
    const rows = await db.queryEquals<Record<string, unknown>>(c.col, c.link, id);
    for (const r of rows) {
      if (c.col === 'hisaab' && r.entityType !== 'customer') continue;
      const patch: Record<string, unknown> = {};
      if (to.name && r[c.name] !== to.name) patch[c.name] = to.name;
      if (to.phone && c.phone && r[c.phone] !== to.phone) {
        const had = String(r[c.phone] ?? '');
        if (!had || normalizePhoneNumber(had) === normalizePhoneNumber(to.oldPhone)) patch[c.phone] = to.phone;
      }
      if (Object.keys(patch).length) changes.push({ col: c.col, id: r.id, patch });
    }
  }
  for (let i = 0; i < changes.length; i += 400) {
    const b = db.batch();
    for (const ch of changes.slice(i, i + 400)) b.update(ch.col, ch.id, ch.patch);
    await b.commit();
  }
  return changes.length;
}

/** A new karigar, under an id made as the store makes it. */
export async function addKarigar(db: DbPort, data: Omit<Karigar, 'id'>, fx: SideEffects = {}, opts: { id?: string } = {}): Promise<Karigar> {
  const id = opts.id ?? `karigar-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const karigar = { ...data, id } as Karigar;
  const b = db.batch();
  b.set(KARIGARS, id, cleanObject(karigar) as unknown as Record<string, unknown>);
  await b.commit();
  log(fx, 'karigar.create', `Created karigar: ${karigar.name}`, `ID: ${id}`, id);
  return karigar;
}

/** A karigar saved over: the fields given, merged. `mustExist` as for a customer. */
export async function updateKarigar(db: DbPort, id: string, patch: KarigarWrite, fx: SideEffects = {}, opts: { mustExist?: boolean } = {}): Promise<void> {
  if (opts.mustExist) {
    const held = await db.get<{ deletedAt?: string }>(KARIGARS, id);
    if (!held || held.deletedAt) throw new Error('No such karigar.');
  }
  const b = db.batch();
  b.set(KARIGARS, id, cleanObject(patch) as Record<string, unknown>, true);
  await b.commit();
  log(fx, 'karigar.update', `Updated karigar: ${patch.name || id}`, `ID: ${id}`, id);
}
