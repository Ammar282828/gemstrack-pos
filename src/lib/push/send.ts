/**
 * A notification to the shop's phones (the ERP app: iPhones by APNs, Android by FCM): every phone an owner signed in
 * on that has not switched the kind off. Sent beside the WhatsApp alerts, from the same events
 * and with the same words (an AlertDoc's title and headline), but switched per phone, not by
 * Settings' WhatsApp switches: the phone is the owner's own.
 *
 *   sales     a new sale
 *   payments  a payment on an invoice, a website transfer slip, a payment on Shopify
 *   orders    a new order (the counter, the website, Shopify), one finished or cancelled,
 *             online orders waiting or let go
 *   karigar   a karigar marking a piece done
 *
 * Each notification is sent once (`push_sent/<key>`), however many times its event fires: Mina's
 * Shopify sends each notice to two addresses. Never throws: a notification is never in the way
 * of the write that caused it. A development server only logs.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { roleForEmail } from '@/lib/roles';
import { STORE_BRAND, STORE_CONFIG } from '@/lib/store-config';
import type { AlertDoc } from '@/lib/notifications/doc';
import { sendApns } from './apns';
import { sendFcm } from './fcm';
import { allDevices, forgetDevices, loadApnsKey, type PushKind } from './store';

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  /** The ERP page it opens. */
  url?: string;
  /** Sent once per key; omit for a one-off (a test). */
  key?: string;
  /**
   * The signed-in person whose action caused this event (their email). Every phone registered to
   * them is left out: nobody is told of their own action ("Not your own action"). Omit for what
   * no person did here (a customer's order, Shopify, the clock) and for reports and tests.
   */
  actor?: string;
}

export interface PushResult {
  status: 'sent' | 'none' | 'already' | 'no-key' | 'dev' | 'failed';
  sent?: number;
  phones?: number;
  error?: string;
}

/** Which kind an alert document is. */
export function kindOfDoc(doc: Pick<AlertDoc, 'kind'>): PushKind | null {
  switch (doc.kind) {
    case 'sale': return 'sales';
    case 'payment': case 'online-slip': return 'payments';
    case 'website-order': case 'online-waiting': case 'online-hold-ended': case 'order': return 'orders';
    case 'karigar': return 'karigar';
    default: return doc.kind.startsWith('order-') ? 'orders' : null; // order-completed, -cancelled, -refunded
  }
}

// One no-key line per instance per 10 minutes, so a busy shop does not flood the log.
let lastNoKeyWarn = 0;
export function warnNoKey(kind: string, now = Date.now()): boolean {
  if (now - lastNoKeyWarn < 10 * 60_000) return false;
  lastNoKeyWarn = now;
  console.warn(`[push] no-key: ${kind}`);
  return true;
}

const claimKey = (key: string) => key.replace(/[^\w.:-]/g, '_').slice(0, 200);

async function claim(key: string): Promise<boolean> {
  try {
    await adminDb.collection('push_sent').doc(claimKey(key)).create({ at: new Date().toISOString() });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw e;
  }
}

/** An actor is a signed-in person's email; 'scheduler', 'ai:<key>' and the like name nobody with a phone. */
export const actorEmail = (by?: string | null): string | undefined => (by && by.includes('@') ? by.trim().toLowerCase() : undefined);

/**
 * Who a notification goes to: with `only`, that one phone (a test); otherwise every owner phone that
 * has not switched the kind off, less every phone registered to the actor. A phone with no email
 * recorded cannot be told from anyone's, so it keeps receiving.
 */
export function recipientsFor<D extends { token: string; email: string; off: PushKind[] }>(
  devices: D[], m: Pick<PushMessage, 'kind' | 'actor'>, only?: { token: string }, isOwner: (email: string) => boolean = (e) => roleForEmail(e) === 'owner',
): D[] {
  if (only) return devices.filter((d) => d.token === only.token);
  const actor = actorEmail(m.actor);
  return devices.filter((d) => isOwner(d.email) && !d.off.includes(m.kind) && !(actor && d.email?.trim().toLowerCase() === actor));
}

export async function pushToShop(m: PushMessage, only?: { token: string }): Promise<PushResult> {
  try {
    if (process.env.NODE_ENV !== 'production' && process.env.PUSH_FROM_DEV !== '1') {
      console.log('[push: dev, not sent]', m.kind, m.title, '·', m.body);
      return { status: 'dev' };
    }
    const devices = recipientsFor(await allDevices(), m, only);
    const android = devices.filter((d) => d.platform === 'android');
    const ios = devices.filter((d) => d.platform !== 'android');
    // The Apple key is needed for iPhones only: Android goes through the backend's own service account.
    const key = ios.length ? await loadApnsKey() : null;
    if (ios.length && !android.length && !key) { warnNoKey(m.kind); return { status: 'no-key' }; }
    if (!devices.length) { console.warn(`[push] no devices: ${m.kind}`); return { status: 'none', phones: 0 }; }
    if (m.key && !(await claim(`${m.kind}_${m.key}`))) return { status: 'already' };
    // Which house this server is (the same id /api/app/business gives): one phone holds several businesses.
    const alert = { title: m.title, body: m.body, url: m.url, subtitle: STORE_CONFIG.name, business: STORE_BRAND };
    const nothing = { sent: 0, gone: [] as string[], failed: [] as { token: string; status: number; reason: string }[] };
    const [apns, fcm] = await Promise.all([
      key && ios.length ? sendApns(key, ios.map((d) => ({ token: d.token, bundleId: d.bundleId })), { ...alert, thread: `${STORE_BRAND}:${m.kind}` }) : nothing,
      android.length ? sendFcm(android.map((d) => d.token), { ...alert, kind: m.kind }) : nothing,
    ]);
    const gone = [...apns.gone, ...fcm.gone];
    const failed = [...apns.failed, ...fcm.failed];
    const sent = apns.sent + fcm.sent;
    if (gone.length) await forgetDevices(gone);
    if (failed.length) console.warn('[push] refused', failed.map((f) => `${f.status} ${f.reason}`).join('; '));
    console.log(`[push] ${m.kind} "${m.title}" ${sent}/${devices.length}`);
    return { status: sent ? 'sent' : 'failed', sent, phones: devices.length, ...(failed[0] ? { error: failed[0].reason } : {}) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[push]', m.kind, error);
    return { status: 'failed', error };
  }
}

/** An alert document (the WhatsApp PDF's) as a notification: its title, and its one line. */
export function pushDoc(doc: AlertDoc, opts: { url?: string; key?: string; kind?: PushKind; actor?: string }): Promise<PushResult> {
  const kind = opts.kind ?? kindOfDoc(doc);
  if (!kind) return Promise.resolve({ status: 'none' });
  return pushToShop({ kind, title: doc.title, body: doc.headline || doc.heading, url: opts.url, key: opts.key, actor: opts.actor });
}
