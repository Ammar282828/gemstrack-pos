/** The daily TCS run (lib/tcs-payments.ts) against the house's database. Server only. */
import { adminDb } from '@/lib/firebase-admin';
import { handTotalForMonth, recordedByHand } from '@/lib/manual-twins';
import { openSecret, sealSecret } from '@/lib/safepay-fees';
import { backfillCod, cnIndex, codOnlyParcels, recordOciRows, summariseCosts } from '@/lib/shipment-costs-server';
import { chargeExpenses, codReady, normaliseTcsCredentials, ociReady, parcelOf, payoutSummary, type TcsCredentials, type TcsParcel } from '@/lib/tcs-payments';

const BASE = 'https://ociconnect.tcscourier.com';
const PRIVATE = () => adminDb.collection('app_private').doc('tcs');

export async function saveTcsCredentials(c: TcsCredentials | null): Promise<void> {
  await PRIVATE().set({ sealed: c ? sealSecret(JSON.stringify(c)) : null, at: new Date().toISOString() }, { merge: true });
}

export async function tcsCredentials(): Promise<TcsCredentials | null> {
  const sealed = (await PRIVATE().get()).data()?.sealed;
  if (typeof sealed !== 'string') return null;
  try { return normaliseTcsCredentials(JSON.parse(openSecret(sealed) || 'null')); } catch { return null; }
}

async function tokens(c: TcsCredentials): Promise<{ bearer: string; access: string }> {
  const a = await fetch(`${BASE}/auth/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientid: c.clientId, clientsecret: c.clientSecret || '' }), signal: AbortSignal.timeout(20000),
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

/** TCS's payment detail rows (raw, every field) for a window of booking days (yyyy-MM-dd). */
async function paymentRows(c: TcsCredentials, t: { bearer: string; access: string }, from: string, to: string): Promise<Record<string, unknown>[]> {
  const u = new URL(`${BASE}/ecom/api/Payment/detail`);
  u.searchParams.set('accesstoken', t.access); u.searchParams.set('customerno', c.accountNo);
  u.searchParams.set('fromdate', from); u.searchParams.set('todate', to);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t.bearer}` }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`TCS payment detail: ${j?.message || r.status}`);
  return (Array.isArray(j?.detail) ? j.detail : []).filter((x: unknown) => !!x && typeof x === 'object');
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86400_000;
/** The first day the backfill reaches for. */
const BACKFILL_FLOOR = '2024-01-01';
/** A run's time for the OCI backfill windows before it hands over to the next tick. */
const OCI_BUDGET_MS = 100_000;
const COD_PER_RUN = 150;

/**
 * Once a day (and every tick until the backfill is through): TCS's payment detail kept per parcel (tcs_parcels) and its full cost
 * per parcel (shipment_costs, lib/shipment-costs-server.ts), linked to the order; each month's costs an expense; the payout summary.
 *
 * Backfill (tcs_meta/costs-backfill): the first run, and one forced by saving credentials, reads OCI in 30-day windows back from
 * today to 2024-01-01 (it stops after 3 empty windows in a row), carrying on at the next tick if time runs out; and COD's
 * payment-details for every order number that has no cost yet, 150 a run. After that, the last 60 days and any new numbers.
 */
export async function syncTcsPayments(now = new Date(), force = false) {
  const c = await tcsCredentials();
  // OCI (client secret) gives the payment report; the COD API's set alone still costs each parcel by its number.
  const oci = ociReady(c), codOk = codReady(c);
  if (!c || (!oci && !codOk)) return null;
  const state = adminDb.collection('shopify_sync').doc('tcs-payments');
  const last = (await state.get()).data()?.at as string | undefined;
  const bfRef = adminDb.collection('tcs_meta').doc('costs-backfill');
  let bf = (force ? {} : (await bfRef.get()).data() || {}) as { ociCursor?: string; ociEmpty?: number; ociDone?: boolean; codDone?: boolean; retryAfter?: string; ociRetryAfter?: string };
  const codWaiting = !!bf.retryAfter && Date.parse(bf.retryAfter) > now.getTime();
  // A refused login (wrong details) waits six hours instead of being tried at every five-minute tick.
  const ociWaiting = !force && !!bf.ociRetryAfter && Date.parse(bf.ociRetryAfter) > now.getTime();
  const dailyDue = !last || now.getTime() - Date.parse(last) >= 24 * 3600_000;
  const backfilling = (oci && !bf.ociDone && !ociWaiting) || (codOk && !bf.codDone && !codWaiting);
  if (!force && !dailyDue && !backfilling) return null;
  const kept = adminDb.collection('tcs_parcels');
  const idx = await cnIndex();
  let t: Awaited<ReturnType<typeof tokens>> | null = null;
  const read = async (from: string, to: string) => {
    t ??= await tokens(c);
    const rows = await paymentRows(c, t, from, to);
    for (const row of rows) { const p = parcelOf(row); if (p) await kept.doc(p.cn).set(p, { merge: true }); }
    await recordOciRows(rows, idx, now);
    return rows.length;
  };
  const started = Date.now();
  let ociError: string | undefined;
  try {
  if (!oci || ociWaiting) { /* COD alone */ }
  // OCI, backwards from today; the cursor is saved after each window.
  else if (!bf.ociDone) {
    let to = bf.ociCursor ? new Date(`${bf.ociCursor}T12:00:00Z`) : now;
    let empty = bf.ociEmpty || 0, done = false;
    while (Date.now() - started < OCI_BUDGET_MS) {
      const from = new Date(to.getTime() - 29 * DAY);
      const n = await read(day(from), day(to));
      empty = n ? 0 : empty + 1;
      to = new Date(from.getTime() - DAY);
      if (empty >= 3 || day(to) < BACKFILL_FLOOR) { done = true; break; }
      await bfRef.set({ ociCursor: day(to), ociEmpty: empty, ociDone: false, at: now.toISOString() }, { merge: true });
    }
    bf = { ...bf, ociCursor: day(to), ociEmpty: empty, ociDone: done };
    await bfRef.set({ ...bf, at: now.toISOString() }, { merge: true });
  } else {
    // Daily: the last 60 days (parcels change as they are delivered and paid).
    for (let back = 60; back > 0; back -= 30) {
      const from = new Date(now.getTime() - back * DAY);
      await read(day(from), day(new Date(Math.min(now.getTime(), from.getTime() + 29 * DAY))));
    }
  }
  if (oci && !ociWaiting && bf.ociRetryAfter) await bfRef.set({ ociRetryAfter: null, ociError: null }, { merge: true });
  } catch (e) {
    ociError = e instanceof Error ? e.message : String(e);
    await bfRef.set({ ociRetryAfter: new Date(now.getTime() + 6 * 3600_000).toISOString(), ociError: ociError.slice(0, 200) }, { merge: true });
  }
  // COD, per parcel number that has no cost yet; stands aside for a while when TCS refuses (no subscription).
  let cod: { costed: number; remaining: number; error?: string } | null = null;
  if (codOk && !codWaiting && (bf.ociDone || force || !oci || ociWaiting || !!ociError)) {
    const cods = await import('@/lib/tcs-cod-server');
    cod = await backfillCod(idx, { details: cods.tcsPaymentDetailsRaw, invoice: cods.tcsPaymentInvoice }, COD_PER_RUN, now);
    await bfRef.set({
      codDone: !cod.error && cod.remaining === 0, codRemaining: cod.remaining, at: now.toISOString(),
      ...(cod.error ? { retryAfter: new Date(now.getTime() + 6 * 3600_000).toISOString(), lastError: cod.error.slice(0, 200) } : { retryAfter: null, lastError: null }),
    }, { merge: true });
  }
  const all = (await kept.get()).docs.map(d => d.data() as TcsParcel);
  // Parcels known only through the COD API count too, dated by their order.
  const codOnly = (await codOnlyParcels(new Set(all.map(p => p.cn)))).map(p => ({
    cn: p.cn, bookedOn: p.bookedOn, status: '', orderNo: '', paid: false, amountPaid: 0, deliveryCharges: p.costs.delivery, city: '', costs: p.costs,
  }) as TcsParcel);
  const months: string[] = [];
  const charges = chargeExpenses([...all, ...codOnly], now);
  const hand = charges.length ? await recordedByHand(`${charges[0].id.slice(12)}-01`, now.toISOString().slice(0, 10)) : [];
  for (const e of charges) {
    // TCS charges already recorded by hand for the month count against it: only the rest is added.
    const byHand = Math.round(handTotalForMonth(hand, e.id.slice(12), /\btcs\b/i));
    const { id, ...row } = e;
    if (e.amount - byHand < 1) { await adminDb.collection('expenses').doc(id).delete().catch(() => {}); continue; }
    if (byHand > 0) { row.amount = e.amount - byHand; row.description = `${row.description} (less PKR ${byHand.toLocaleString('en-PK')} already recorded)`; }
    await adminDb.collection('expenses').doc(id).set(row, { merge: true });
    months.push(`${id.slice(12)}: ${e.amount}`);
  }
  const costs = await summariseCosts(now);
  const summary = payoutSummary(all);
  // `at` marks the daily run: a tick that only carried the backfill on leaves it alone.
  const ran = dailyDue || force || !last ? now.toISOString() : last;
  await state.set({ at: ran, parcels: all.length, months, ...summary });
  return { parcels: all.length, months, ...summary, costs, backfill: { ociDone: !!bf.ociDone, ...(ociError ? { ociError } : {}), ...(cod ? { cod } : {}) } };
}

export interface TcsStatus {
  connected: boolean;
  /** Booking, cancelling and tracking from the ERP can run (the Cash on Delivery API's set is complete). */
  booking?: boolean;
  /** The daily payment run can (the client secret is there too). */
  payments?: boolean;
  originCity?: string;
  parcels?: number; paidOut?: number; lastPaidOn?: string | null; unpaidDelivered?: number; at?: string;
  /** This year's parcels costed, their full cost and the tax in it (lib/shipment-costs-server.ts). */
  costs?: { year: number; parcels: number; total: number; tax: number; delivery: number };
}

export async function tcsStatus(): Promise<TcsStatus> {
  const c = await tcsCredentials();
  if (!c) return { connected: false };
  const [s, k] = await Promise.all([
    adminDb.collection('shopify_sync').doc('tcs-payments').get().then(d => d.data() || {}),
    adminDb.collection('tcs_meta').doc('costs-summary').get().then(d => d.data() as TcsStatus['costs'] | undefined),
  ]);
  return {
    connected: true, booking: codReady(c), payments: ociReady(c), originCity: c.originCity,
    parcels: s.parcels, paidOut: s.paidOut, lastPaidOn: s.lastPaidOn, unpaidDelivered: s.unpaidDelivered, at: s.at,
    ...(k ? { costs: k } : {}),
  };
}
