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
 * Pure parts here; the daily run is lib/tcs-payments-server.ts. Credentials are an owner's to give (Settings → Integrations →
 * TCS), kept sealed in app_private/tcs; never in the repository.
 */

export interface TcsCredentials { clientId: string; clientSecret: string; username: string; password: string; customerNo: string }

export function checkTcsCredentials(c: Partial<TcsCredentials>): string | null {
  for (const k of ['clientId', 'clientSecret', 'username', 'password', 'customerNo'] as const) {
    if (typeof c[k] !== 'string' || !c[k]!.trim()) return `TCS ${({ clientId: 'client ID', clientSecret: 'client secret', username: 'username', password: 'password', customerNo: 'account (customer) number' })[k]} is missing.`;
    if (c[k]!.length > 500) return 'One of the TCS details is too long.';
  }
  return null;
}

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
}

/** "09/09/2024" → "2024-09-09" (TCS writes day/month/year); null for none. */
export function tcsDay(s: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function parcelOf(row: Record<string, unknown>): TcsParcel | null {
  const cn = String(row['cn by courier'] ?? '').trim();
  if (!/^\d{6,20}$/.test(cn)) return null;
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
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Each booking month's courier charges as one expense, id `tcs-charges-<yyyy-mm>`, replaced as the month fills. */
export function chargeExpenses(parcels: TcsParcel[], now: Date): { id: string; date: string; category: string; description: string; amount: number; paidBy: 'business' }[] {
  const by = new Map<string, { n: number; charges: number }>();
  for (const p of parcels) {
    if (!p.bookedOn || !(p.deliveryCharges > 0)) continue;
    const m = p.bookedOn.slice(0, 7);
    const t = by.get(m) ?? { n: 0, charges: 0 };
    t.n += 1; t.charges += p.deliveryCharges;
    by.set(m, t);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, t]) => {
    const [y, mo] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, mo, 0, 12));
    return {
      id: `tcs-charges-${month}`,
      date: (last.getTime() > now.getTime() ? now : last).toISOString(),
      category: 'Courier & Delivery',
      description: `TCS, ${MONTHS[mo - 1]} ${y}: ${t.n} parcel${t.n === 1 ? '' : 's'} sent`,
      amount: Math.round(t.charges),
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
