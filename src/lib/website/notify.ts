/**
 * The two WhatsApp messages a website order produces, and the two more as it
 * moves. Sent through the shop's own gateway, so they arrive from the number
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
}

export function customerPlacedMessage(o: OrderSummaryForMessage, bank: WebsiteBankDetails): string {
  const lines = o.lines.map((l, i) => `${i + 1}. ${l.description} — ${fmt(l.price)}`).join('\n');
  const delivery = o.deliveryCharge ? `\nDelivery: ${fmt(o.deliveryCharge)}` : '';
  const account = [bank.bankName, bank.accountTitle, bank.iban ? `IBAN ${bank.iban}` : '', bank.accountNumber ? `A/C ${bank.accountNumber}` : '']
    .filter(Boolean).join('\n');
  return `Assalamualaikum ${o.customerName}, thank you for your order at TAHERI.\n\nOrder ${o.id}\n${lines}${delivery}\n*Total: ${fmt(o.grandTotal)}*\n\nPlease transfer the full amount to:\n${account}\n\nThen send us the transfer slip here, quoting ${o.id}. We book your piece with Leopards the day the transfer clears and send you the tracking number.\n\nYour order: ${o.statusUrl}${bank.instructions ? `\n\n${bank.instructions}` : ''}`;
}

export function customerPaidMessage(orderId: string, name: string): string {
  return `Assalamualaikum ${name}, we have received your transfer for order ${orderId}. Jazakallah. We are preparing your piece and will send the Leopards tracking number as soon as it is booked.`;
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
 * The shop's copy of a website order: a PDF (lib/notifications/alerts.ts websiteOrderDoc) to the
 * alert numbers in Settings → Notifications, like every other alert, or to the shop's own number
 * when none are set. It went only to the shop's own number before, which is the line the gateway
 * sends from, so it arrived as a message to itself.
 */
export async function trySendShopCopy(o: OrderSummaryForMessage): Promise<string | null> {
  if (process.env.WEBSITE_NOTIFY === 'off') { console.log('[website notify: off] shop copy', o.id); return 'notifications off'; }
  try {
    const [{ sendDoc }, { websiteOrderDoc }, { readNotifSettings }] = await Promise.all([
      import('@/lib/notifications/send-doc'), import('@/lib/notifications/alerts'), import('@/lib/notifications/dispatch'),
    ]);
    const s = await readNotifSettings().catch(() => null);
    const saved = s?.notifEnabled ? (s.notifPhones ?? []).map(String).filter(Boolean) : [];
    const own = shopNumber();
    const to = saved.length ? saved : own ? [own] : [];
    if (!to.length) return 'no recipient';
    const r = await sendDoc(websiteOrderDoc(o), to);
    return r.sent ? null : r.failed.join('; ') || 'not sent';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
