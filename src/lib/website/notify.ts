/**
 * The WhatsApp messages an online order produces as it moves: received, confirmed (with the bank
 * details) or declined, paid, reminded, shipped. Sent through the shop's own gateway, so they arrive from the number
 * customers already know. The customer's are words; the shop's copy is a PDF
 * like every alert to the shop (lib/notifications, owner 2026-10-01).
 *
 * A notification that fails must never fail the order — the order is in the
 * book either way, and the shop can read it there. So every send is caught
 * and reported, not thrown.
 */

import { sendWhatsAppMessage } from '@/lib/whatsapp';
import type { WebsiteBankDetails } from './types';

const fmt = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

/** The shop's own number, from the same env the site's links use. */
export function shopNumber(): string | null {
  const url = process.env.NEXT_PUBLIC_STORE_WHATSAPP_URL || '';
  const m = url.match(/(\d{10,15})/);
  return m ? m[1] : null;
}

export interface OrderSummaryForMessage {
  id: string;
  customerName: string;
  customerPhone?: string;
  city?: string;
  lines: { description: string; price: number }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  statusUrl: string;
  /** Today's price is held until then for the transfer. */
  holdUntil?: string;
}

/** "Sunday 5 October, 2:30 pm" in Karachi. */
export function karachiTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** The shop's hours, as the site and the policies say them. */
const HOURS = 'Saturday to Thursday 11 am – 9 pm, Friday 3:30 – 8 pm';

const lineList = (o: OrderSummaryForMessage) => {
  const lines = o.lines.map((l, i) => `${i + 1}. ${l.description} — ${fmt(l.price)}`).join('\n');
  const delivery = o.deliveryCharge ? `\nDelivery: ${fmt(o.deliveryCharge)}` : '\nDelivery: free';
  return `${lines}${delivery}\n*Total: ${fmt(o.grandTotal)}*`;
};

/** The moment it is placed: received, not yet accepted — and no bank details, so nobody pays early. */
export function customerReceivedMessage(o: OrderSummaryForMessage): string {
  return `Assalamualaikum ${o.customerName}, thank you for your order at TAHERI.\n\nOrder ${o.id}\n${lineList(o)}\n\nWe look at every order ourselves before we take any payment. We will confirm yours here on WhatsApp during shop hours (${HOURS}) and send the bank details then — please don't transfer anything before that.\n\nYour order: ${o.statusUrl}`;
}

/** Confirmed by the shop: the bank details, and how long today's price is held. */
export function customerConfirmedMessage(o: OrderSummaryForMessage, bank: WebsiteBankDetails): string {
  const account = [bank.bankName, bank.accountTitle, bank.iban ? `IBAN ${bank.iban}` : '', bank.accountNumber ? `A/C ${bank.accountNumber}` : '']
    .filter(Boolean).join('\n');
  const hold = o.holdUntil ? `\n\nThe price is held for you until *${karachiTime(o.holdUntil)}*. Gold moves daily, so if the transfer has not reached us by then we will check with you before anything changes.` : '';
  return `Assalamualaikum ${o.customerName}, your order ${o.id} is confirmed.\n\n${lineList(o)}\n\nPlease transfer the full amount to:\n${account}${hold}\n\nThen upload the transfer slip on your order page, or send it here quoting ${o.id}. We start on your piece the day the transfer clears, and send you the Leopards tracking number when it leaves us.\n\nYour order: ${o.statusUrl}${bank.instructions ? `\n\n${bank.instructions}` : ''}`;
}

export function customerDeclinedMessage(orderId: string, name: string, reason: string, statusUrl: string): string {
  return `Assalamualaikum ${name}, thank you for your order ${orderId}. We are sorry — we can't take it as it was placed: ${reason.trim().replace(/\.$/, '')}.\n\nNothing has been charged. Reply here and we will help you find the right piece.\n\n${statusUrl}`;
}

export function customerPaidMessage(orderId: string, name: string): string {
  return `Assalamualaikum ${name}, we have received your transfer for order ${orderId}. Jazakallah. We are preparing your piece and will send the Leopards tracking number as soon as it is booked.`;
}

export function customerReminderMessage(orderId: string, name: string, total: number, holdUntil: string, statusUrl: string): string {
  return `Assalamualaikum ${name}, a reminder that order ${orderId} (${fmt(total)}) is held at its price until ${karachiTime(holdUntil)}. If you have already transferred, upload the slip on your order page so we can start — or reply here: ${statusUrl}`;
}

export function customerExpiredMessage(orderId: string, name: string): string {
  return `Assalamualaikum ${name}, we did not receive the transfer for order ${orderId}, so we have closed it — gold moves daily and the price was held for a day. If you would still like the piece, place it again on taheri.shop at today's rate, or reply here and we will help.`;
}

export function customerShippedMessage(orderId: string, name: string, cn: string, trackingUrl: string): string {
  return `Assalamualaikum ${name}, your order ${orderId} is on its way with Leopards.\nTracking number: ${cn}\n${trackingUrl}`;
}

/** Fire-and-report. Returns what went wrong, if anything, so the caller can log it. */
export async function trySend(to: string | null | undefined, body: string): Promise<string | null> {
  // WEBSITE_NOTIFY=off keeps a development server that points at the live
  // book from messaging real people while a checkout is being tested.
  if (process.env.WEBSITE_NOTIFY === 'off') { console.log('[website notify: off]', to, body.split('\n')[0]); return 'notifications off'; }
  if (!to) return 'no recipient';
  try { await sendWhatsAppMessage(to, body); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

/**
 * A document to the shop: a PDF (lib/notifications) to the alert numbers in Settings → Notifications,
 * like every other alert, or to the shop's own number when none are set. It went only to the shop's
 * own number before, which is the line the gateway sends from, so it arrived as a message to itself.
 */
export async function trySendShopDoc(build: () => Promise<import('@/lib/notifications/doc').AlertDoc> | import('@/lib/notifications/doc').AlertDoc, label: string): Promise<string | null> {
  if (process.env.WEBSITE_NOTIFY === 'off') { console.log('[website notify: off] shop', label); return 'notifications off'; }
  try {
    const [{ sendDoc }, { readNotifSettings }] = await Promise.all([import('@/lib/notifications/send-doc'), import('@/lib/notifications/dispatch')]);
    const s = await readNotifSettings().catch(() => null);
    const saved = s?.notifEnabled ? (s.notifPhones ?? []).map(String).filter(Boolean) : [];
    const own = shopNumber();
    const to = saved.length ? saved : own ? [own] : [];
    if (!to.length) return 'no recipient';
    const r = await sendDoc(await build(), to);
    return r.sent ? null : r.failed.join('; ') || 'not sent';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The shop's copy of a new online order. */
export function trySendShopCopy(o: OrderSummaryForMessage): Promise<string | null> {
  return trySendShopDoc(async () => (await import('@/lib/notifications/alerts')).websiteOrderDoc(o), o.id);
}
