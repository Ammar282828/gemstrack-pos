/**
 * The POS's customers as rows for a Meta customer-list audience — normalised the
 * way Meta matches them, before hashing (audiences.ts hashes; nothing readable
 * leaves the server). Pure, and tested.
 *
 * Meta's rules: phone = digits with the country code and no leading zeros
 * (Pakistan's 0300 1234567 → 923001234567); email trimmed and lowercased; first
 * and last name lowercased letters only; country the lowercase ISO code.
 */

import { phoneKey } from '@/lib/contacts/vcard';

export type Segment = 'all' | 'buyers' | 'recent' | 'lapsed';

export const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: 'all', label: 'Every customer', hint: 'Everyone in the customer book with a phone or email.' },
  { key: 'buyers', label: 'Everyone who has bought', hint: 'Customers with at least one invoice.' },
  { key: 'recent', label: 'Bought in the last year', hint: 'Invoiced in the last 12 months.' },
  { key: 'lapsed', label: 'Haven’t bought in a year', hint: 'Bought before, but not in the last 12 months — to win back.' },
];

/** Digits with the country code, no leading zeros; '' when it can't be a phone number. Local numbers are Pakistani. */
export function metaPhone(raw: string | null | undefined, countryCode = '92'): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = s.slice(2);
  else if (!plus) {
    if (s.startsWith('0')) s = countryCode + s.replace(/^0+/, '');
    // "3001234567": a Pakistani mobile written without its 0.
    else if (countryCode === '92' && /^3\d{9}$/.test(s)) s = '92' + s;
  }
  s = s.replace(/^0+/, '');
  return s.length >= 8 && s.length <= 15 ? s : '';
}

export function metaEmail(raw: string | null | undefined): string {
  const e = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

/** Lowercase letters only (Latin a–z; other scripts kept as letters). */
export function metaName(raw: string | null | undefined): string {
  return String(raw ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}]/gu, '');
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam', 'begum', 'bhai', 'baji', 'sahab', 'sahib', 'haji']);

export function splitName(full: string | null | undefined): { fn: string; ln: string } {
  const words = String(full ?? '').split(/\s+/).map(w => w.replace(/[.,]/g, '')).filter(w => w && !TITLES.has(w.toLowerCase()));
  if (!words.length) return { fn: '', ln: '' };
  return { fn: metaName(words[0]), ln: words.length > 1 ? metaName(words[words.length - 1]) : '' };
}

const COUNTRY_BY_CODE: [string, string][] = [['92', 'pk'], ['971', 'ae'], ['966', 'sa'], ['44', 'gb'], ['1', 'us'], ['974', 'qa'], ['965', 'kw'], ['968', 'om'], ['973', 'bh'], ['91', 'in'], ['61', 'au'], ['49', 'de']];
export function countryOfPhone(phone: string): string {
  const hit = COUNTRY_BY_CODE.filter(([code]) => phone.startsWith(code)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : '';
}

export const SCHEMA = ['PHONE', 'EMAIL', 'FN', 'LN', 'COUNTRY'] as const;

export interface CustomerLike { id: string; name?: string; phone?: string; altPhone?: string; email?: string }
export interface InvoiceLike { customerId?: string; customerContact?: string; createdAt?: string }

/**
 * One row per customer (a second number is a second row, as Meta advises), in the
 * segment, with at least a phone or an email. Duplicates (same phone) are dropped.
 */
export function customerRows(customers: CustomerLike[], invoices: InvoiceLike[], segment: Segment, now = Date.now()): string[][] {
  const yearAgo = now - 365 * 86_400_000;
  const last = new Map<string, number>();
  const note = (key: string | null | undefined, t: number) => { if (key) last.set(key, Math.max(last.get(key) ?? 0, t)); };
  for (const inv of invoices) {
    const t = Date.parse(inv.createdAt ?? '') || 0;
    note(inv.customerId ? `id:${inv.customerId}` : null, t);
    const k = phoneKey(inv.customerContact);
    note(k ? `ph:${k}` : null, t);
  }
  const lastBuy = (c: CustomerLike) => Math.max(last.get(`id:${c.id}`) ?? 0, last.get(`ph:${phoneKey(c.phone)}`) ?? 0, last.get(`ph:${phoneKey(c.altPhone)}`) ?? 0);
  const inSegment = (c: CustomerLike) => {
    if (segment === 'all') return true;
    const t = lastBuy(c);
    if (segment === 'buyers') return t > 0;
    if (segment === 'recent') return t >= yearAgo;
    return t > 0 && t < yearAgo;
  };
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const c of customers) {
    if (!inSegment(c)) continue;
    const { fn, ln } = splitName(c.name);
    const email = metaEmail(c.email);
    const phones = [metaPhone(c.phone), metaPhone(c.altPhone)].filter(Boolean);
    const list = phones.length ? phones : email ? [''] : [];
    for (const ph of list) {
      const key = ph || `e:${email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([ph, email, fn, ln, ph ? countryOfPhone(ph) : '']);
    }
  }
  return rows;
}
