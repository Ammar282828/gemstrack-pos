/**
 * WhatsApp for a House of Mina web order (owner, 2026-10-30: "for every type of order there is a separate
 * automation … for cod there is confirm decline, for bank transfer it is bank account details etc and
 * requesting screenshot, for paid orders just a nice message telling them details"). Sent from the house's
 * own line (WAHA_SESSION); on only where SHOPIFY_ORDER_WHATSAPP=1 (apphosting.mina.yaml).
 *
 * Pure: which flow an order gets, the words, how a reply is read. The server side is
 * lib/shopify-whatsapp-server.ts; the customer's replies come in through app/api/whatsapp/inbound.
 *
 * Only the website's own checkouts are messaged (`source_name` "web"). Orders the shop makes itself —
 * drafts, Instagram and WhatsApp orders typed in Shopify ("manual"), the ERP's pushes, PR gifting — are
 * with a customer already talking to the shop, and get nothing.
 */

export type OrderFlowKind = 'cod' | 'bank' | 'paid';

export interface ShopifyOrderLike {
  id: number | string;
  order_number?: number | string;
  name?: string;
  source_name?: string | null;
  payment_gateway_names?: string[] | null;
  financial_status?: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
  total_price?: string | number | null;
  currency?: string | null;
  phone?: string | null;
  tags?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null; phone?: string | null } | null;
  shipping_address?: { first_name?: string | null; name?: string | null; address1?: string | null; address2?: string | null; city?: string | null; phone?: string | null } | null;
  billing_address?: { first_name?: string | null; name?: string | null; phone?: string | null } | null;
  line_items?: { title?: string | null; variant_title?: string | null; quantity?: number | null; price?: string | number | null }[] | null;
  shipping_lines?: { price?: string | number | null }[] | null;
}

/** The order's flow, or null when it gets none. `now` bounds it to orders placed in the last two days. */
export function orderFlowKind(o: ShopifyOrderLike, now = Date.now()): OrderFlowKind | null {
  if (String(o.source_name || '') !== 'web') return null;
  if (o.cancelled_at) return null;
  if (!(Number(o.total_price) > 0)) return null;
  const placed = Date.parse(String(o.created_at || ''));
  if (!Number.isFinite(placed) || now - placed > 2 * 24 * 3600 * 1000) return null;
  const gateways = (o.payment_gateway_names || []).join(' ').toLowerCase();
  const paid = o.financial_status === 'paid' || o.financial_status === 'partially_paid';
  if (/cash on delivery|\bcod\b/.test(gateways)) return paid ? 'paid' : 'cod';
  if (/bank (deposit|transfer)/.test(gateways)) return paid ? 'paid' : 'bank';
  return paid ? 'paid' : null;
}

/** The number to message: the shipping address's, then the billing's, the order's, the customer's. */
export function orderPhone(o: ShopifyOrderLike): string {
  return String(o.shipping_address?.phone || o.billing_address?.phone || o.phone || o.customer?.phone || '').trim();
}

const rs = (n: number | string | null | undefined) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

function firstName(o: ShopifyOrderLike): string {
  const n = o.shipping_address?.first_name || o.customer?.first_name || o.billing_address?.first_name
    || (o.shipping_address?.name || o.billing_address?.name || '').split(' ')[0] || '';
  return n.trim();
}

/** The order as the messages show it: what, shipping, total, where to. */
function orderBlock(o: ShopifyOrderLike, totalLabel: string): string {
  const lines = (o.line_items || []).map(li => {
    const what = [li.title, li.variant_title && li.variant_title !== 'Default Title' ? `(${li.variant_title})` : ''].filter(Boolean).join(' ');
    const q = Number(li.quantity) || 1;
    return `• ${what}${q > 1 ? ` × ${q}` : ''} — ${rs((Number(li.price) || 0) * q)}`;
  });
  const shipping = (o.shipping_lines || []).reduce((t, s) => t + (Number(s.price) || 0), 0);
  if (shipping > 0) lines.push(`Delivery: ${rs(shipping)}`);
  lines.push(`*${totalLabel}: ${rs(o.total_price)}*`);
  const a = o.shipping_address;
  const where = [a?.address1, a?.address2, a?.city].map(s => (s || '').trim()).filter(Boolean).join(', ');
  if (where) lines.push('', `Delivering to: ${where}`);
  return lines.join('\n');
}

const orderName = (o: ShopifyOrderLike) => o.name || `#${o.order_number}`;
const hello = (o: ShopifyOrderLike) => (firstName(o) ? `Hi ${firstName(o)}` : 'Hi');

export interface BankDetails { bankLine: string; iban: string }

/** The first message of each flow. */
export function orderMessage(kind: OrderFlowKind, o: ShopifyOrderLike, bank: BankDetails): string {
  if (kind === 'cod') {
    return [
      `${hello(o)} ✨`,
      `Thank you for shopping with *House of Mina*! Here is your order *${orderName(o)}*:`,
      '',
      orderBlock(o, 'Total, cash on delivery'),
      '',
      'Please confirm it so we can send it on its way: tap *Confirm* below ⬇️',
      '_(or reply *1* to confirm, *2* to cancel)_',
    ].join('\n');
  }
  if (kind === 'bank') {
    const bankLine = bank.bankLine.split('|').map(s => s.trim()).filter(Boolean).join(' · ');
    return [
      `${hello(o)} ✨`,
      `Thank you for shopping with *House of Mina*! Here is your order *${orderName(o)}*:`,
      '',
      orderBlock(o, 'Total'),
      '',
      'To complete it, please transfer the total to:',
      ...(bankLine ? [`*${bankLine}*`] : []),
      `IBAN: *${bank.iban}*`,
      '',
      'Then send the payment screenshot here and we will get your order on its way. 💌',
    ].join('\n');
  }
  return [
    `${hello(o)} ✨`,
    `Thank you for shopping with *House of Mina*! Your payment is in and your order *${orderName(o)}* is confirmed:`,
    '',
    orderBlock(o, 'Paid'),
    '',
    'We are getting it ready for you. Any questions, just reply here. 💌',
  ].join('\n');
}

export const COD_CONFIRMED_REPLY = (o: { name: string }) => `Thank you! Your order *${o.name}* is confirmed ✅ We will send it on its way soon.`;
export const COD_DECLINED_REPLY = (o: { name: string }) => `Noted, we will cancel your order *${o.name}*. If that was a mistake, just reply here and we will sort it out.`;
export const SLIP_RECEIVED_REPLY = (o: { name: string }) => `Thank you! We have your screenshot for *${o.name}* and will confirm as soon as the payment shows in our account.`;
export const BANK_PAID_REPLY = (o: { name: string }) => `Your payment for *${o.name}* is in, thank you! Your order is confirmed and we are getting it ready. 💌`;

/** The tap-to-answer question sent under a COD order's message (a WhatsApp poll; see sendWhatsAppPoll). */
export const COD_POLL_CONFIRM = '✅ Confirm order';
export const COD_POLL_CANCEL = '❌ Cancel order';
export const codPoll = (o: { name: string }) => ({ name: `Confirm your order ${o.name}?`, options: [COD_POLL_CONFIRM, COD_POLL_CANCEL] });

/** A tap on the COD poll: the option chosen, or null when the vote was taken back (no option). */
export function readPollVote(selected: string[] | null | undefined): 'confirm' | 'decline' | null {
  const s = (selected || []).map(x => String(x).trim());
  if (s.length !== 1) return null;
  return s[0] === COD_POLL_CONFIRM ? 'confirm' : s[0] === COD_POLL_CANCEL ? 'decline' : null;
}

/** The part of a WhatsApp message id both ends agree on ("true_92…@c.us_3EB0…" → "3EB0…"). */
export const messageKey = (id: string | null | undefined) => String(id || '').split('_').pop() || '';

/** A reply to the COD question: confirm, cancel, or neither (a question for a person, left alone). */
export function readCodReply(text: string): 'confirm' | 'decline' | null {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (!t || t.length > 40) return null;
  if (/^(1|1️⃣|✅|👍|yes|yes please|yess?|yep|ok|okay|confirm|confirmed|confirm it|haan|han|haa|ji|jee|ji haan|g|done)$/.test(t)) return 'confirm';
  if (/^(2|2️⃣|❌|no|nope|cancel|cancel it|cancel order|cancelled|nahi|nhi|nahin|na)$/.test(t)) return 'decline';
  return null;
}

/**
 * The customer's number from an incoming WAHA message. WhatsApp names most senders by their private id
 * (`…@lid`); GOWS carries the number beside it as `_data.Info.SenderAlt` ("923001234567@s.whatsapp.net",
 * sometimes with ":12" for the device). A `…@c.us` sender is the number itself.
 */
export function senderNumber(payload: { from?: string; _data?: { Info?: { SenderAlt?: string; Sender?: string } } }): string {
  const tryOne = (v?: string) => {
    const m = /^(\d{8,15})(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(String(v || ''));
    return m ? m[1] : '';
  };
  return tryOne(payload.from) || tryOne(payload._data?.Info?.SenderAlt) || tryOne(payload._data?.Info?.Sender);
}

/** Tags as Shopify stores them ("a, b, c"), with one added once. */
export function withTag(tags: string | null | undefined, tag: string): string {
  const list = String(tags || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.some(t => t.toLowerCase() === tag.toLowerCase())) list.push(tag);
  return list.join(', ');
}
