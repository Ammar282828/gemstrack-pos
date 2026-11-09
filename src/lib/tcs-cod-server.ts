/**
 * TCS's Cash on Delivery API, called (the pure half and the endpoints are lib/tcs-cod.ts). Server only: the account is the
 * sealed set in app_private/tcs (Settings → Integrations → TCS), read here and never sent to a browser.
 */
import { adminDb } from '@/lib/firebase-admin';
import { tcsCredentials } from '@/lib/tcs-payments-server';
import { codReady, type TcsCredentials } from '@/lib/tcs-payments';
import {
  TCS_COD_BASE, buildCreateOrder, cnFromReply, normaliseTcsTrack, parseCities, parsePaymentDetails, replyShape,
  returnStatusOf, tcsRefusal, type TcsBookingInput, type TcsTrack,
} from '@/lib/tcs-cod';

/** A refusal worth telling the person as it is (not configured, TCS said no). */
export class TcsError extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = 'TcsError'; }
}

/** The account, when it can book; a TcsError saying what is missing when not. */
export async function codAccount(): Promise<TcsCredentials> {
  const c = await tcsCredentials();
  if (!c) throw new TcsError('TCS is not connected. An owner adds the account in Settings → Integrations → TCS.', 409);
  if (!codReady(c)) throw new TcsError('The TCS account has no cost centre code or account number yet. Add them in Settings → Integrations → TCS.', 409);
  return c;
}

async function call(c: TcsCredentials, method: 'GET' | 'POST' | 'PUT', path: string, opts: { query?: Record<string, string>; body?: unknown; timeout?: number } = {}): Promise<{ status: number; json: unknown }> {
  const u = new URL(`${TCS_COD_BASE}${path}`);
  for (const [k, v] of Object.entries(opts.query || {})) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(u, {
      method,
      headers: { 'X-IBM-Client-Id': c.clientId, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(opts.timeout ?? 20000),
      cache: 'no-store',
    });
  } catch (e) {
    throw new TcsError(`TCS did not answer (${e instanceof Error ? e.name : 'network'}). Try again.`, 504);
  }
  const text = await res.text();
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const ok = (r: { status: number; json: unknown }) => r.status >= 200 && r.status < 300 && returnStatusOf(r.json).ok;

/** TCS's cities, kept a day in tcs_meta/cities (one list for the booking form's suggestions and the name check). */
export async function tcsCities(force = false): Promise<string[]> {
  const ref = adminDb.collection('tcs_meta').doc('cities');
  const kept = (await ref.get()).data() as { at?: string; cities?: string[] } | undefined;
  if (!force && kept?.cities?.length && kept.at && Date.now() - Date.parse(kept.at) < 24 * 3600_000) return kept.cities;
  const c = await codAccount();
  const r = await call(c, 'GET', '/cities');
  // The list may come without a returnStatus; a list is a list.
  const cities = r.status < 300 ? parseCities(r.json) : [];
  if (!cities.length) {
    if (kept?.cities?.length) return kept.cities;
    throw new TcsError(tcsRefusal(r.json, r.status));
  }
  await ref.set({ at: new Date().toISOString(), cities });
  return cities;
}

/** Book a parcel; its consignment number. The reply's outline is logged on the first booking that works. */
export async function tcsCreateOrder(input: TcsBookingInput): Promise<{ cn: string; raw: unknown }> {
  const c = await codAccount();
  const built = buildCreateOrder(c, input);
  if (!built.ok) throw new TcsError(built.error, 400);
  const r = await call(c, 'POST', '/create-order', { body: built.payload, timeout: 30000 });
  const cn = cnFromReply(r.json);
  if (!ok(r) || !cn) {
    if (ok(r) && !cn) console.error('[tcs-cod] booked but no consignment number found; reply shape:', JSON.stringify(replyShape(r.json)));
    throw new TcsError(ok(r) ? 'TCS took the booking but its reply had no consignment number. Check TCS before booking again.' : tcsRefusal(r.json, r.status));
  }
  const seen = adminDb.collection('tcs_meta').doc('create-order-shape');
  if (!(await seen.get()).exists) {
    const shape = replyShape(r.json);
    console.info('[tcs-cod] first create-order reply shape:', JSON.stringify(shape));
    await seen.set({ at: new Date().toISOString(), shape: JSON.stringify(shape) }).catch(() => {});
  }
  return { cn, raw: r.json };
}

export async function tcsCancelOrder(cn: string): Promise<void> {
  const c = await codAccount();
  const r = await call(c, 'PUT', '/cancel-order', { body: { userName: c.username, password: c.password, consignmentNumber: cn } });
  if (!ok(r)) throw new TcsError(tcsRefusal(r.json, r.status));
}

/** Where a parcel is, by TCS; null when TCS knows nothing of it yet. */
export async function tcsTrackOrder(cn: string): Promise<TcsTrack | null> {
  const c = await codAccount();
  const r = await call(c, 'GET', '/track-order', { query: { userName: c.username, password: c.password, referenceNo: cn } });
  if (r.status === 401 || r.status === 403) throw new TcsError(tcsRefusal(r.json, r.status));
  if (!ok(r)) return null;
  return normaliseTcsTrack(r.json);
}

export async function tcsPaymentDetails(cn: string) {
  const c = await codAccount();
  const r = await call(c, 'GET', '/payment-details', { query: { consignmentNumber: cn } });
  if (!ok(r)) throw new TcsError(tcsRefusal(r.json, r.status));
  return parsePaymentDetails(r.json);
}

/** The raw /payment-details reply for a parcel (every field TCS sent, for lib/shipment-costs.ts); null when TCS has none. */
export async function tcsPaymentDetailsRaw(cn: string): Promise<unknown | null> {
  const c = await codAccount();
  const r = await call(c, 'GET', '/payment-details', { query: { consignmentNumber: cn } });
  if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) throw new TcsError(tcsRefusal(r.json, r.status));
  return ok(r) ? r.json : null;
}

/** The raw /payment-invoice reply for a payment invoice number; null when TCS has none. */
export async function tcsPaymentInvoice(invoiceNumber: string): Promise<unknown | null> {
  const c = await codAccount();
  const r = await call(c, 'GET', '/payment-invoice', { query: { invoiceNumber } });
  return ok(r) ? r.json : null;
}
