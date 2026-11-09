/**
 * Safepay's fees, and the tax on them, as the ERP's expenses (owner, 2026-11-09: "check my … safe pay statements to see how much
 * tax has been cut", "make this automatic"). Safepay's reporter (`GET /reporter/api/v2/payments`, header X-SFPY-MERCHANT-SECRET
 * with the merchant's SECRET key) lists every card payment; each payment's own record (`/reporter/api/v2/payments/<tracker>`)
 * carries its charge in paisa: amount (gross), fees (Safepay's cut, the tax on it included), tax (that tax), net, and
 * withholding_tax {income_tax_withholding, sales_tax_withholding, digital_presence_tax}.
 *
 * Once a day (the five-minute tick) every month's charges are added up and written as ONE expense per month, id
 * `safepay-fees-<yyyy-mm>`, category "Payment Fees", replaced as the month fills: never a second row for the same month.
 * A payment's charge is read once and kept (`safepay_charges/<tracker>`); only new payments are fetched.
 *
 * The secret key: pasted by an owner in Settings → Integrations → Safepay, kept encrypted (AES-256-GCM, key derived from the
 * server's CRON_SECRET) in `app_private/safepay` (Admin SDK only). Never in the repository, never sent to a browser.
 */
import crypto from 'crypto';

const API = 'https://api.getsafepay.com';
const PAGE = 30; // Safepay's most per page

// ── The secret, sealed ──────────────────────────────────────────────────────────────────────────────────────────
const sealKey = () => crypto.createHash('sha256').update(`safepay-secret:${process.env.CRON_SECRET || ''}`).digest();

export function sealSecret(plain: string): string {
  if (!process.env.CRON_SECRET) throw new Error('This server cannot keep a secret (no CRON_SECRET).');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}

export function openSecret(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch { return null; }
}

/** Safepay's secret key: 64 hex characters (the dashboard's Developer → API → Secret key). */
export const isSafepaySecret = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/i.test(k.trim());

// ── The arithmetic ───────────────────────────────────────────────────────────────────────────────────────────────
export interface Charge {
  tracker: string;
  /** The payment's time, ISO. */
  at: string;
  gross: number;
  /** Safepay's cut, the tax on it included (rupees, two places). */
  fees: number;
  /** Of `fees`, the tax on the fee. */
  taxOnFee: number;
  incomeTaxWithheld: number;
  salesTaxWithheld: number;
  digitalPresenceTax: number;
  net: number;
}

const rs = (x: { amount?: number } | null | undefined) => Math.round(Number(x?.amount) || 0) / 100;

/** One payment's charge from its reporter record (null when it has none: not captured). */
export function chargeOf(record: unknown): Charge | null {
  const c = (record as { data?: { charge?: Record<string, unknown> } })?.data?.charge;
  if (!c || !c.tracker) return null;
  const w = (c.withholding_tax || {}) as Record<string, { amount?: number }>;
  const seconds = Number((c.created_at as { seconds?: number })?.seconds) || 0;
  return {
    tracker: String(c.tracker),
    at: new Date(seconds * 1000).toISOString(),
    gross: rs(c.amount as never), fees: rs(c.fees as never), taxOnFee: rs(c.tax as never), net: rs(c.net as never),
    incomeTaxWithheld: rs(w.income_tax_withholding), salesTaxWithheld: rs(w.sales_tax_withholding), digitalPresenceTax: rs(w.digital_presence_tax),
  };
}

/** Karachi's month of an ISO time ("2026-11"). */
export const karachiMonth = (iso: string) => new Date(Date.parse(iso) + 5 * 3600_000).toISOString().slice(0, 7);

export interface MonthFees { month: string; payments: number; gross: number; fees: number; taxOnFee: number; withheld: number; net: number }

/** Each month's totals, oldest first. "Withheld" is the three withholding taxes together (taken on top of the fee). */
export function feesByMonth(charges: Charge[]): MonthFees[] {
  const by = new Map<string, MonthFees>();
  for (const c of charges) {
    const m = karachiMonth(c.at);
    const t = by.get(m) ?? { month: m, payments: 0, gross: 0, fees: 0, taxOnFee: 0, withheld: 0, net: 0 };
    t.payments += 1; t.gross += c.gross; t.fees += c.fees; t.taxOnFee += c.taxOnFee;
    t.withheld += c.incomeTaxWithheld + c.salesTaxWithheld + c.digitalPresenceTax; t.net += c.net;
    by.set(m, t);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month))
    .map(t => ({ ...t, gross: r2(t.gross), fees: r2(t.fees), taxOnFee: r2(t.taxOnFee), withheld: r2(t.withheld), net: r2(t.net) }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month's expense: what Safepay kept (fee, its tax, any withholding), whole rupees, dated the month's last day (or today). */
export function feeExpense(t: MonthFees, now: Date): { id: string; date: string; category: string; description: string; amount: number; paidBy: 'business' } {
  const [y, m] = t.month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12));
  const date = (last.getTime() > now.getTime() ? now : last).toISOString();
  const kept = t.fees + t.withheld;
  const parts = [`fees ${t.fees.toLocaleString('en-PK', { maximumFractionDigits: 2 })} (tax on the fee ${t.taxOnFee.toLocaleString('en-PK', { maximumFractionDigits: 2 })})`];
  if (t.withheld > 0) parts.push(`tax withheld ${t.withheld.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`);
  return {
    id: `safepay-fees-${t.month}`, date, category: 'Payment Fees', paidBy: 'business',
    description: `Safepay, ${MONTHS[m - 1]} ${y}: ${t.payments} card payment${t.payments === 1 ? '' : 's'} of PKR ${Math.round(t.gross).toLocaleString('en-PK')}; ${parts.join('; ')}`,
    amount: Math.round(kept),
  };
}

// ── Safepay ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function get(path: string, secret: string) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-SFPY-MERCHANT-SECRET': secret }, signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Safepay ${res.status}: ${body?.message || body?.code || 'no answer'}`);
  return body;
}

/** Every completed payment's tracker (refunded ones too: their fee was taken), newest first. */
export async function listPaidTrackers(secret: string): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page < 200; page++) {
    const q = `limit=${PAGE}&page=${page}&direction=DESC&states[0]=TRACKER_ENDED&states[1]=TRACKER_PARTIAL_REFUND&states[2]=TRACKER_REFUNDED&currencies[0]=PKR`;
    const d = (await get(`/reporter/api/v2/payments?${q}`, secret))?.data;
    const list: { token?: string }[] = d?.list || [];
    out.push(...list.map(p => String(p.token || '')).filter(Boolean));
    if (list.length < PAGE || out.length >= (Number(d?.count) || 0)) break;
  }
  return out;
}

export async function fetchCharge(tracker: string, secret: string): Promise<Charge | null> {
  return chargeOf(await get(`/reporter/api/v2/payments/${encodeURIComponent(tracker)}`, secret));
}
