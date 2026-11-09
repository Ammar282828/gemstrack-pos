/**
 * Shopify's own bills to the merchant (the subscription, apps, transaction fees, shipping labels), read from the shop's mailbox
 * because Shopify has no merchant-billing API (owner: "automatically see my Shopify billing and add it to ERP").
 * Pure: telling a bill's mail from the rest, and reading its amounts out of the text. The mailbox and the books are
 * lib/shopify-bills-server.ts. Email formats were written from memory of Shopify's bills, not seen: the parser is tolerant
 * and the first mail it cannot read is kept (outlined, digits masked) so it can be fixed.
 */

export type BillLine = { label: string; amount: number };
export type ShopifyBill = {
  billNo?: string;
  total: number;
  currency: string;
  periodFrom?: string;
  periodTo?: string;
  lines: BillLine[];
  date: string; // ISO
};

const CUR_WORD = 'USD|PKR|CAD|EUR|GBP|AUD|INR|AED|SGD|NZD';
const SYMBOLS: Record<string, string> = { '$': 'USD', 'us$': 'USD', 'rs': 'PKR', 'rs.': 'PKR', '₨': 'PKR', '£': 'GBP', '€': 'EUR' };
// [currency before] number [currency after]
const MONEY = new RegExp(
  `(?:(${CUR_WORD}|US\\$|Rs\\.?|₨|\\$|£|€)\\s?)?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)(?:\\s?(${CUR_WORD})\\b)?`, 'gi');

const curOf = (s?: string) => (s ? (SYMBOLS[s.toLowerCase()] ?? s.toUpperCase()) : undefined);

/** Shopify's own senders (billing, notifications, the accounts team), not a customer's or a store's mail. */
export function isShopifyBillMail(m: { from: string; subject: string }): boolean {
  const from = (m.from || '').toLowerCase();
  if (!/@([a-z0-9-]+\.)*(shopify\.com|shopifyemail\.com|shopify\.email)\b/.test(from) && !/\bshopify\b/.test(from)) return false;
  const s = (m.subject || '').toLowerCase();
  if (/new order|\border\b|payout|newsletter|webinar|unsubscribe|% off|\bsale\b|tips|growth|marketing|welcome|verify|login|sign[- ]in|security|password|failed|declined|unsuccessful|abandoned|\bcustomer\b|\bcollective\b|launch/.test(s)) return false;
  return /\bbills?\b|billing|invoice|receipt|charge|payment/.test(s);
}

type Hit = { cur?: string; value: number; index: number; end: number };
function moneyIn(line: string): Hit[] {
  const out: Hit[] = [];
  for (const m of line.matchAll(MONEY)) {
    const cur = curOf(m[1] || m[3]);
    // A bare number counts only with a currency mark, or with decimals/thousands (so "Bill #123456" and dates are not money).
    if (!cur && !/[.,]/.test(m[2])) continue;
    const value = Number(m[2].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    out.push({ cur, value, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

const TOTAL = /^(grand\s+)?(total(\s+(charged|paid|billed|amount|due|usd))?|amount\s+(due|charged|paid|billed)|total\s+amount|balance\s+due|you\s+(were\s+)?(charged|paid))\b/i;
const SKIP = /^(subtotal|sub-total|balance|previous|credit applied|tax id|vat id|card|visa|mastercard|ending|payment method|date|invoice|bill|receipt|page|store|shop)\b/i;
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_RE = `(?:(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})`;

function isoDay(s: string): string | undefined {
  const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)/i, '$1') + ' UTC');
  const u = Number.isNaN(t) ? Date.parse(s.replace(/(\d)(st|nd|rd|th)/i, '$1')) : t;
  return Number.isNaN(u) ? undefined : new Date(u).toISOString().slice(0, 10);
}

/** Reads a bill; null when the text holds no amount at all. */
export function parseShopifyBill(m: { subject: string; text: string; date: Date | string }): ShopifyBill | null {
  const date = new Date(m.date).toISOString();
  const text = (m.text || '').replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ');
  const rows = text.split('\n').map(l => l.trim()).filter(Boolean);

  const lines: BillLine[] = [];
  let total: number | undefined;
  let currency: string | undefined;
  let largest = 0;
  const pending: string[] = []; // a label alone on one line, its amount on the next
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hits = moneyIn(row);
    if (!hits.length) { pending.length = 0; if (row.length < 60) pending.push(row); continue; }
    const last = hits[hits.length - 1];
    let label = row.slice(0, hits[0].index).replace(/[\s:.\-–—|]+$/, '').trim();
    if (!label) label = (pending[pending.length - 1] || row.slice(last.end)).replace(/^[\s:\-–—|]+|[\s:\-–—|]+$/g, '').trim();
    pending.length = 0;
    for (const h of hits) { if (h.cur && !currency) currency = h.cur; if (h.value > largest) largest = h.value; }
    if (TOTAL.test(label) || (!hits[0].index && TOTAL.test(row))) { if (total === undefined || /due|charged|paid/i.test(label) || hits[0].value > total) total = last.value; if (last.cur) currency = last.cur; continue; }
    if (!label || SKIP.test(label) || label.length > 80 || /^\d+$/.test(label)) continue;
    // "Tax: $2.00 (10%)" and the like: the first amount is the line's.
    lines.push({ label: label.replace(/\s{2,}/g, ' '), amount: hits[0].value });
  }
  // Subject may carry the whole bill ("Your Shopify bill for $29.00 USD").
  const subj = moneyIn(m.subject || '');
  if (!currency) currency = subj.find(h => h.cur)?.cur;
  if (total === undefined) total = subj.length ? subj[subj.length - 1].value : largest || undefined;
  if (total === undefined || !(total > 0)) return null;
  for (const h of subj) if (h.value > largest) largest = h.value;

  const no = /(?:bill|invoice|receipt)\s*(?:#|no\.?|number|id)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(m.subject || '')
    || /(?:bill|invoice|receipt)\s*(?:#|no\.?|number|id)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(text)
    || /#\s?(\d{4,})/.exec(m.subject || '');
  const bill: ShopifyBill = { total, currency: currency || 'USD', lines: lines.filter(l => l.amount > 0 && l.amount <= total!), date };
  if (no) bill.billNo = no[1];

  const range = new RegExp(`(${DATE_RE})\\s*(?:-|–|—|to|through|until)\\s*(${DATE_RE})`, 'i').exec(text)
    || new RegExp(`(?:from|period|billing period|for)[:\\s]+(${DATE_RE})\\s*(?:-|–|—|to|through)\\s*(${DATE_RE})`, 'i').exec(text);
  if (range) {
    const a = isoDay(range[1]), b = isoDay(range[2]);
    if (a) bill.periodFrom = a;
    if (b) bill.periodTo = b;
  }
  return bill;
}

/** "subscription 39, apps 10" for the expense's description: lines folded to short names, the biggest first. */
export function describeLines(lines: BillLine[], max = 6): string {
  const bucket = (l: string) => /subscription|plan|basic|shopify\b.*(monthly|annual)/i.test(l) ? 'subscription'
    : /app/i.test(l) ? 'apps' : /transaction|processing|card/i.test(l) ? 'transaction fees'
    : /label|shipping|postage/i.test(l) ? 'shipping labels' : /tax|vat|gst/i.test(l) ? 'tax' : l.toLowerCase().slice(0, 24);
  const sums = new Map<string, number>();
  for (const l of lines) sums.set(bucket(l.label), (sums.get(bucket(l.label)) ?? 0) + l.amount);
  return [...sums].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`).join(', ');
}
