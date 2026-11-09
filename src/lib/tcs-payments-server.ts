/** The daily TCS run (lib/tcs-payments.ts) against the house's database. Server only. */
import { adminDb } from '@/lib/firebase-admin';
import { openSecret, sealSecret } from '@/lib/safepay-fees';
import { chargeExpenses, parcelOf, payoutSummary, type TcsCredentials, type TcsParcel } from '@/lib/tcs-payments';

const BASE = 'https://ociconnect.tcscourier.com';
const PRIVATE = () => adminDb.collection('app_private').doc('tcs');

export async function saveTcsCredentials(c: TcsCredentials | null): Promise<void> {
  await PRIVATE().set({ sealed: c ? sealSecret(JSON.stringify(c)) : null, at: new Date().toISOString() }, { merge: true });
}

export async function tcsCredentials(): Promise<TcsCredentials | null> {
  const sealed = (await PRIVATE().get()).data()?.sealed;
  if (typeof sealed !== 'string') return null;
  try { return JSON.parse(openSecret(sealed) || 'null'); } catch { return null; }
}

async function tokens(c: TcsCredentials): Promise<{ bearer: string; access: string }> {
  const a = await fetch(`${BASE}/auth/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientid: c.clientId, clientsecret: c.clientSecret }), signal: AbortSignal.timeout(20000),
  });
  const aj = await a.json().catch(() => ({}));
  const bearer = aj?.result?.accessToken;
  if (!bearer) throw new Error(`TCS refused the client ID and secret (${aj?.code || a.status}).`);
  const u = new URL(`${BASE}/ecom/api/authentication/token`);
  u.searchParams.set('username', c.username); u.searchParams.set('password', c.password);
  const e = await fetch(u, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20000) });
  const ej = await e.json().catch(() => ({}));
  if (!ej?.accesstoken) throw new Error(`TCS refused the username and password (${ej?.code || ej?.message || e.status}).`);
  return { bearer, access: ej.accesstoken };
}

/** TCS's payment detail for a window of booking days (yyyy-MM-dd). */
async function paymentDetail(c: TcsCredentials, t: { bearer: string; access: string }, from: string, to: string): Promise<TcsParcel[]> {
  const u = new URL(`${BASE}/ecom/api/Payment/detail`);
  u.searchParams.set('accesstoken', t.access); u.searchParams.set('customerno', c.customerNo);
  u.searchParams.set('fromdate', from); u.searchParams.set('todate', to);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t.bearer}` }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`TCS payment detail: ${j?.message || r.status}`);
  return (Array.isArray(j?.detail) ? j.detail : []).map(parcelOf).filter(Boolean) as TcsParcel[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Once a day: the last 120 days of parcels kept, each month's charges an expense, the payout summary stored. */
export async function syncTcsPayments(now = new Date(), force = false) {
  const c = await tcsCredentials();
  if (!c) return null;
  const state = adminDb.collection('shopify_sync').doc('tcs-payments');
  const last = (await state.get()).data()?.at as string | undefined;
  if (!force && last && now.getTime() - Date.parse(last) < 24 * 3600_000) return null;
  const t = await tokens(c);
  const kept = adminDb.collection('tcs_parcels');
  for (let back = 120; back > 0; back -= 30) {
    const from = new Date(now.getTime() - back * 86400_000);
    const to = new Date(Math.min(now.getTime(), from.getTime() + 29 * 86400_000));
    for (const p of await paymentDetail(c, t, day(from), day(to))) await kept.doc(p.cn).set(p, { merge: true });
  }
  const all = (await kept.get()).docs.map(d => d.data() as TcsParcel);
  const months: string[] = [];
  for (const e of chargeExpenses(all, now)) {
    const { id, ...row } = e;
    await adminDb.collection('expenses').doc(id).set(row, { merge: true });
    months.push(`${id.slice(12)}: ${e.amount}`);
  }
  const summary = payoutSummary(all);
  await state.set({ at: now.toISOString(), parcels: all.length, months, ...summary });
  return { parcels: all.length, months, ...summary };
}

export async function tcsStatus(): Promise<{ connected: boolean; parcels?: number; paidOut?: number; lastPaidOn?: string | null; unpaidDelivered?: number; at?: string } > {
  if (!(await tcsCredentials())) return { connected: false };
  const s = (await adminDb.collection('shopify_sync').doc('tcs-payments').get()).data() || {};
  return { connected: true, parcels: s.parcels, paidOut: s.paidOut, lastPaidOn: s.lastPaidOn, unpaidDelivered: s.unpaidDelivered, at: s.at };
}
