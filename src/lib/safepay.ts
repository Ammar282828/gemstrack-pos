/**
 * Safepay payment links (owner, 2026-11-09, House of Mina: "a quick payment feature in my erp, like a quick link that isn't
 * through shopify, just directly online"). Safepay's checkout takes the house's PUBLIC key only: a tracker is opened for an
 * amount (POST /order/v1/init), the customer pays on Safepay's own page, and the tracker is read back (GET /order/v1/<token>)
 * to see whether it was paid. No secret is involved, so replacing the secret key in Safepay's dashboard leaves this alone.
 * On where the house has given its public key: Settings → Integrations → Safepay (`app_settings/global.safepayPublicKey`,
 * op setSafepayKey), or SAFEPAY_PUBLIC_KEY. Never in the repository (gemstrack-pos is public).
 */

const API = 'https://api.getsafepay.com';
const CHECKOUT = 'https://getsafepay.com/components';

export const isSafepayPublicKey = (k: unknown): k is string => typeof k === 'string' && /^sec_[0-9a-f-]{20,64}$/i.test(k.trim());

let cached: { key: string; at: number } | null = null;
/** The house's public key: its setting, else the environment; read at most once a minute. */
export async function safepayKey(): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.key;
  let key = (process.env.SAFEPAY_PUBLIC_KEY || '').trim();
  try {
    const { adminDb } = await import('@/lib/firebase-admin');
    const saved = (await adminDb.collection('app_settings').doc('global').get()).data()?.safepayPublicKey;
    if (isSafepayPublicKey(saved)) key = saved.trim();
  } catch { /* no database here (tests): the environment's */ }
  cached = { key, at: Date.now() };
  return key;
}
export const forgetSafepayKey = () => { cached = null; };
export const paymentLinksOn = async (): Promise<boolean> => isSafepayPublicKey(await safepayKey());

export interface SafepayTracker {
  token: string;
  amount: number;
  currency: string;
  state: string;
  transaction: unknown;
}

/** A tracker for `amount` rupees; its token is the link's id. */
export async function openTracker(amount: number): Promise<SafepayTracker> {
  const res = await fetch(`${API}/order/v1/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: await safepayKey(), amount, currency: 'PKR', environment: 'production' }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  const d = body?.data;
  if (!res.ok || !d?.token) throw new Error(`Safepay did not make the link: ${body?.status?.errors?.[0] || body?.message || res.status}`);
  return { token: String(d.token), amount: Number(d.amount) || amount, currency: String(d.currency || 'PKR'), state: String(d.state || ''), transaction: d.transaction ?? null };
}

export async function readTracker(token: string): Promise<SafepayTracker | null> {
  if (!/^track_[0-9a-f-]{20,}$/i.test(token)) return null;
  const res = await fetch(`${API}/order/v1/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  const d = body?.data;
  if (!res.ok || !d) throw new Error(`Safepay: ${res.status}`);
  return { token, amount: Number(d.amount) || 0, currency: String(d.currency || 'PKR'), state: String(d.state || ''), transaction: d.transaction ?? null };
}

/**
 * Paid: Safepay has a transaction on the tracker and the tracker has ended, or the transaction itself says it went through.
 * An open tracker (TRACKER_STARTED, no transaction) is waiting; anything else is read again later.
 */
export function trackerPaid(t: Pick<SafepayTracker, 'state' | 'transaction'>): boolean {
  if (!t.transaction || typeof t.transaction !== 'object') return false;
  const tx = t.transaction as { state?: string; status?: string };
  const word = String(tx.state || tx.status || '').toLowerCase();
  if (/fail|declin|cancel|refund|void|revers/.test(word)) return false;
  return t.state === 'TRACKER_ENDED' || /paid|captur|success|complet|settl/.test(word);
}

/** The customer's page: Safepay's checkout for the tracker, back to `returnTo` when done or cancelled. */
export function checkoutUrl(token: string, orderRef: string, returnTo: string): string {
  const q = new URLSearchParams({ env: 'production', beacon: token, source: 'custom', order_id: orderRef, redirect_url: returnTo, cancel_url: returnTo });
  return `${CHECKOUT}?${q.toString()}`;
}
