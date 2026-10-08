/**
 * A live alert (a sale, a payment, an order, an order finished or cancelled): read the record
 * from Firestore, make its document (alerts.ts), send the PDF to every number in Settings.
 *
 * Called by /api/notifications/alert, which the app posts to after the write (the owner's own
 * write, and a staff write through /api/staff/write alike — staff payments and orders never
 * alerted before). The browser names the record; the server reads it and decides, against the
 * same Settings switches as before, whether to send. Each alert is claimed in `notif_alerts` for
 * ten minutes, so a double tap or a second tab does not send it twice, and the claim keeps what
 * happened.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import type { Invoice, Order, OrderStatus } from '@/lib/store';
import { readNotifSettings } from './dispatch';
import { orderDoc, paymentDoc, saleDoc, testDoc, type OrderAlert } from './alerts';
import { sendDoc } from './send-doc';
import type { AlertDoc } from './doc';
import type { NotifSettings } from './schedule';
import { pushDoc } from '@/lib/push/send';

export type LiveEvent = 'sale' | 'payment' | 'order' | 'order-status' | 'test';

export interface AlertRequest {
  event: LiveEvent;
  /** INV-… or ORD-…. */
  id?: string;
  /** The payment, as it was recorded (to find it in the history). */
  payment?: { amount: number; date: string };
  status?: OrderStatus;
  /** Test only: one of the saved numbers. */
  to?: string;
}

export interface AlertResult {
  status: 'sent' | 'off' | 'already' | 'failed';
  sent?: number;
  recipients?: number;
  failed?: string[];
  error?: string;
  fileName?: string;
}

const ALERTS = 'notif_alerts';
const WINDOW_MS = 10 * 60 * 1000;
const last9 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-9);

/** Settings → Notifications' switch for each alert. */
function switchFor(r: AlertRequest, s: NotifSettings): boolean {
  const on = (k: string) => !!(s as Record<string, unknown>)[k];
  switch (r.event) {
    case 'sale': return on('notifNewInvoice');
    case 'payment': return on('notifPaymentReceived');
    case 'order': return on('notifNewOrder');
    case 'order-status': return r.status === 'Completed' ? on('notifOrderCompleted') : on('notifOrderCancelled');
    case 'test': return true;
  }
}

/** What Settings has switched on, in words, for the test document. */
export function enabledAlerts(s: NotifSettings | null): string[] {
  const on = (k: string) => !!(s as Record<string, unknown> | null)?.[k];
  return [
    on('notifNewInvoice') && 'A new sale: its pieces, the bill and the payments',
    on('notifPaymentReceived') && 'A payment: how much, how, and what is still owed',
    on('notifNewOrder') && 'A new order: its pieces, the estimate and the advance',
    on('notifOrderCompleted') && 'An order completed',
    on('notifOrderCancelled') && 'An order cancelled or refunded',
    on('notifDailyChecklist') && 'The morning checklist',
    on('notifEndOfDay') && 'The end of the day',
    on('notifDailyReport') && 'The daily report',
    on('notifWeeklyReport') && 'The weekly report (Mondays)',
    on('notifOrderOverdue') && 'Orders past their date',
    on('notifGivenItems') && 'Given items not back',
    on('notifKarigarPayment') && 'Karigar balances (Mondays)',
    on('notifAdsDaily') && "Yesterday's ads",
    on('notifMonthlyReport') && 'The monthly report (the 1st)',
  ].filter((x): x is string => !!x);
}

async function read<T>(collection: string, id: string): Promise<T | null> {
  const snap = await adminDb.collection(collection).doc(id).get();
  return snap.exists ? ({ ...snap.data(), id: snap.id } as T) : null;
}

/** The document for a request, or why there is none. */
async function build(r: AlertRequest, s: NotifSettings | null, now: Date): Promise<AlertDoc | string> {
  if (r.event === 'test') return testDoc(enabledAlerts(s), now);
  const id = String(r.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return 'No record named.';
  if (r.event === 'sale' || r.event === 'payment') {
    const inv = await read<Invoice>('invoices', id);
    if (!inv) return `${id} is not in the book.`;
    if (r.event === 'sale') return saleDoc(inv, now);
    const history = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
    const want = r.payment;
    let index = want ? history.findIndex(p => Math.abs(Number(p.amount) - Number(want.amount)) < 0.005 && p.date === want.date) : -1;
    if (index < 0) index = history.length - 1;
    if (index < 0) return `${id} has no payment.`;
    return paymentDoc(inv, index, now);
  }
  const order = await read<Order>('orders', id);
  if (!order) return `${id} is not in the book.`;
  if (r.event === 'order') return orderDoc(order, 'new', now);
  // Said only of an order that really is in that state now: the browser can't make one up.
  const status = r.status;
  if (status !== 'Completed' && status !== 'Cancelled' && status !== 'Refunded') return 'Not an alert status.';
  if (order.status !== status) return `${id} is ${order.status}, not ${status}.`;
  return orderDoc(order, status as OrderAlert, now);
}

/** Take the alert for ten minutes; false when it went (or is going) already. */
async function claim(key: string, r: AlertRequest, by: string): Promise<boolean> {
  const ref = adminDb.collection(ALERTS).doc(key);
  return adminDb.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as { at?: string; status?: string } | undefined;
    // One that failed may be tried again straight away.
    if (d?.at && d.status !== 'failed' && Date.now() - Date.parse(d.at) < WINDOW_MS) return false;
    tx.set(ref, { event: r.event, id: r.id ?? null, status: 'sending', at: new Date().toISOString(), by });
    return true;
  });
}

/**
 * The same alert on the shop's iPhones (lib/push/send.ts): each phone has its own switches, so
 * WhatsApp's below (numbers, on/off, per alert) do not decide it.
 */
async function pushLiveAlert(r: AlertRequest, now: Date): Promise<void> {
  if (r.event === 'test') return;
  try {
    const doc = await build(r, null, now);
    if (typeof doc === 'string') return;
    const id = String(r.id);
    await pushDoc(doc, {
      kind: r.event === 'sale' ? 'sales' : r.event === 'payment' ? 'payments' : 'orders',
      url: r.event === 'sale' || r.event === 'payment' ? `/invoices/${encodeURIComponent(id)}` : `/orders/${encodeURIComponent(id)}`,
      key: [r.event, id, r.status, r.payment?.date, r.payment?.amount].filter(Boolean).join('_'),
    });
  } catch (e) {
    console.error('[alert push]', r.event, r.id, e instanceof Error ? e.message : e);
  }
}

export async function sendLiveAlert(r: AlertRequest, by: string, now = new Date()): Promise<AlertResult> {
  await pushLiveAlert(r, now);
  const s = await readNotifSettings();
  const saved = (s?.notifPhones ?? []).map(String).filter(Boolean);
  let phones = saved;
  if (r.event === 'test') {
    const want = last9(r.to);
    phones = want ? saved.filter(p => last9(p) === want) : saved.slice(0, 1);
    if (!phones.length) return { status: 'off', error: 'That number is not one of the numbers saved in Settings.' };
  } else {
    if (!phones.length) return { status: 'off', error: 'No numbers are saved in Settings → Notifications.' };
    if (!s?.notifEnabled) return { status: 'off', error: 'Notifications are switched off.' };
    if (!switchFor(r, s)) return { status: 'off', error: 'This alert is switched off.' };
  }

  const key = [r.event, r.id, r.status, r.payment?.date, r.event === 'test' ? `${last9(r.to)}_${now.getTime()}` : ''].filter(Boolean).join('_').replace(/[^\w.:-]/g, '_').slice(0, 200);
  if (!(await claim(key, r, by))) return { status: 'already' };
  const ref = adminDb.collection(ALERTS).doc(key);

  let result: AlertResult;
  try {
    const doc = await build(r, s, now);
    if (typeof doc === 'string') result = { status: 'failed', error: doc };
    else {
      const out = await sendDoc(doc, phones);
      result = { status: out.sent ? 'sent' : 'failed', sent: out.sent, recipients: phones.length, failed: out.failed, fileName: out.fileName };
    }
  } catch (e) {
    result = { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  await ref.set({ ...result, finishedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  const line = `[alert] ${r.event} ${r.id ?? ''} ${result.status}${result.sent !== undefined ? ` ${result.sent}/${result.recipients}` : ''}`;
  if (result.status === 'failed') console.error(line, result.error ?? result.failed?.join('; '));
  else console.log(line);
  return result;
}
