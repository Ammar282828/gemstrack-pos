/**
 * TCS's own account, read directly (owner, 2026-11-09: TCS's "API User Guide v1.0", OCI Connect): what each parcel cost to send
 * and whether TCS has paid the shop the cash it collected. Universal Courier books and tracks through Shopify; this is the
 * money side it never shows.
 *
 * - Authorization: POST https://ociconnect.tcscourier.com/auth/api/auth {clientid, clientsecret} → result.accessToken (bearer).
 * - E-COM authentication: GET …/ecom/api/authentication/token ?username&password (bearer) → accesstoken.
 * - Payment detail: GET …/ecom/api/Payment/detail ?accesstoken&customerno&fromdate&todate (bearer) → detail[]: "booking date",
 *   "cn by courier", "cn status", "order no", "payment status" (Y/N), "amount paid", "parcel weight", "city",
 *   "delivery charges", "delivery date", "payment date".
 *
 * Pure parts here; the daily run is lib/tcs-payments-server.ts. Booking and tracking (the Cash on Delivery API) are lib/tcs-cod.ts. Credentials are an owner's to give (Settings → Integrations →
 * TCS), kept sealed in app_private/tcs; never in the repository.
 */

import { costDescription, costOf, type Costs } from '@/lib/shipment-costs';

/**
 * The shop's TCS account, one sealed set (Settings → Integrations → TCS). Two of TCS's APIs read it:
 * - the Cash on Delivery API (api.tcscourier.com, lib/tcs-cod.ts): booking, cancelling, tracking. Needs the client ID
 *   (X-IBM-Client-Id), username, password, cost centre code and account number;
 * - OCI Connect (above): the money side. Needs the client secret as well; without it the daily payment run sits out.
 * `customerNo` is the account number as an older save kept it.
 */
export interface TcsCredentials {
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
  costCenterCode: string;
  accountNo: string;
  /** Where parcels are sent from (TCS's city name); Karachi when left blank. */
  originCity?: string;
  /** @deprecated the account number before 2026-11-09. */
  customerNo?: string;
}

const NAMES: Record<string, string> = {
  clientId: 'client ID', clientSecret: 'client secret', username: 'username', password: 'password',
  costCenterCode: 'cost centre code', accountNo: 'account number', originCity: 'sending city',
};

/** A saved set as it reads today: the old account number moved over, blanks dropped, the sending city defaulted. */
export function normaliseTcsCredentials(raw: Partial<TcsCredentials> | null | undefined): TcsCredentials | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const c: TcsCredentials = {
    clientId: t(raw.clientId), username: t(raw.username), password: t(raw.password),
    costCenterCode: t(raw.costCenterCode), accountNo: t(raw.accountNo) || t(raw.customerNo),
    originCity: t(raw.originCity) || 'Karachi',
  };
  if (t(raw.clientSecret)) c.clientSecret = t(raw.clientSecret);
  return c;
}

/** Booking, cancelling and tracking can run (the Cash on Delivery API's set). */
export const codReady = (c: TcsCredentials | null | undefined): c is TcsCredentials =>
  !!c && !!c.clientId && !!c.username && !!c.password && !!c.costCenterCode && !!c.accountNo;

/** The daily payment run can too (OCI Connect also needs the client secret). */
export const ociReady = (c: TcsCredentials | null | undefined): c is TcsCredentials & { clientSecret: string } =>
  !!c && !!c.clientId && !!c.clientSecret && !!c.username && !!c.password && !!c.accountNo;

/** Why a set cannot be saved, or null. The Cash on Delivery API's five are needed; the secret and the city are optional. */
export function checkTcsCredentials(c: Partial<TcsCredentials>): string | null {
  for (const k of ['clientId', 'username', 'password', 'costCenterCode', 'accountNo'] as const) {
    if (typeof c[k] !== 'string' || !c[k]!.trim()) return `TCS ${NAMES[k]} is missing.`;
  }
  for (const k of ['clientId', 'clientSecret', 'username', 'password', 'costCenterCode', 'accountNo', 'originCity'] as const) {
    const v = c[k];
    if (v !== undefined && typeof v !== 'string') return `TCS ${NAMES[k]} is not text.`;
    if (typeof v === 'string' && v.length > 500) return 'One of the TCS details is too long.';
  }
  return null;
}

/** What a parcel cost, by part (lib/shipment-costs.ts). */
export type ParcelCosts = Pick<Costs, 'delivery' | 'tax' | 'fuel' | 'codFee' | 'insurance' | 'withholding' | 'other' | 'total'>;

export interface TcsParcel {
  cn: string;
  bookedOn: string;      // yyyy-MM-dd
  status: string;        // TCS's cn status (OK delivered, RO returned, …)
  orderNo: string;
  paid: boolean;         // TCS has paid the shop for it
  amountPaid: number;
  deliveryCharges: number;
  deliveredOn: string | null;
  paidOn: string | null;
  city: string;
  /** Every cost on the row, not only the delivery charge. Parcels kept before 2026-11-09 have none: the delivery charge is all. */
  costs?: ParcelCosts;
}

/** "09/09/2024" → "2024-09-09" (TCS writes day/month/year); null for none. */
export function tcsDay(s: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function parcelOf(row: Record<string, unknown>): TcsParcel | null {
  const cn = String(row['cn by courier'] ?? '').trim();
  if (!/^\d{6,20}$/.test(cn)) return null;
  const { lines: _lines, codCollected: _c, amountPaid: _a, ...costs } = costOf(row);
  return {
    cn,
    bookedOn: tcsDay(row['booking date']) || '',
    status: String(row['cn status'] ?? '').trim(),
    orderNo: String(row['order no'] ?? '').trim(),
    paid: String(row['payment status'] ?? '').trim().toUpperCase() === 'Y',
    amountPaid: Number(row['amount paid']) || 0,
    deliveryCharges: Number(row['delivery charges']) || 0,
    deliveredOn: tcsDay(row['delivery date']),
    paidOn: tcsDay(row['payment date']),
    city: String(row['city'] ?? '').trim(),
    costs,
  };
}

/** A parcel's costs: the full set when read, else its delivery charge. */
const costsOf = (p: TcsParcel): ParcelCosts => p.costs ?? { delivery: p.deliveryCharges, tax: 0, fuel: 0, codFee: 0, insurance: 0, withholding: 0, other: 0, total: p.deliveryCharges };

/**
 * Each booking month's courier costs as one expense, id `tcs-charges-<yyyy-mm>`, replaced as the month fills: delivery, tax, fuel,
 * COD fee, insurance and the rest (withholding is tax on the payout, not a cost, and stays out).
 */
export function chargeExpenses(parcels: TcsParcel[], now: Date): { id: string; date: string; category: string; description: string; amount: number; paidBy: 'business' }[] {
  const by = new Map<string, { n: number; delivery: number; tax: number; fuel: number; codFee: number; insurance: number; other: number; total: number }>();
  for (const p of parcels) {
    const c = costsOf(p);
    if (!p.bookedOn || !(c.total > 0)) continue;
    const m = p.bookedOn.slice(0, 7);
    const t = by.get(m) ?? { n: 0, delivery: 0, tax: 0, fuel: 0, codFee: 0, insurance: 0, other: 0, total: 0 };
    t.n += 1; t.delivery += c.delivery; t.tax += c.tax; t.fuel += c.fuel; t.codFee += c.codFee; t.insurance += c.insurance; t.other += c.other; t.total += c.total;
    by.set(m, t);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => {
    const [y, mo] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0, 12));
    return {
      id: `tcs-charges-${month}`,
      date: (last.getTime() > now.getTime() ? now : last).toISOString(),
      category: 'Courier & Delivery',
      description: costDescription(month, t.n, t),
      amount: Math.round(t.total),
      paidBy: 'business' as const,
    };
  }).filter(e => e.amount >= 1);
}

/** What TCS has paid out, and the delivered parcels it has not paid for yet. */
export function payoutSummary(parcels: TcsParcel[]): { paidOut: number; lastPaidOn: string | null; unpaidDelivered: number } {
  let paidOut = 0, lastPaidOn: string | null = null, unpaidDelivered = 0;
  for (const p of parcels) {
    if (p.paid) { paidOut += p.amountPaid; if (p.paidOn && (!lastPaidOn || p.paidOn > lastPaidOn)) lastPaidOn = p.paidOn; }
    else if (p.deliveredOn && /^(OK|DV|DELIVERED)$/i.test(p.status)) unpaidDelivered += 1;
  }
  return { paidOut: Math.round(paidOut), lastPaidOn, unpaidDelivered };
}
