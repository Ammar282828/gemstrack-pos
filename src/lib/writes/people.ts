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
  if (opts.mustExist) {
    const held = await db.get<{ deletedAt?: string }>(CUSTOMERS, id);
    if (!held || held.deletedAt) throw new Error('No such customer.');
  }
  const data = patch.phone !== undefined ? { ...patch, phone: normalizePhoneNumber(patch.phone) } : patch;
  const b = db.batch();
  b.set(CUSTOMERS, id, cleanObject(data) as Record<string, unknown>, true);
  await b.commit();
  log(fx, 'customer.update', `Updated customer: ${patch.name || id}`, `ID: ${id}`, id);
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
