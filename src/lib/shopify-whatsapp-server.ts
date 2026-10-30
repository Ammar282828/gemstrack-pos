/**
 * The server side of lib/shopify-whatsapp.ts: a web order's first message, the customer's replies, and the
 * thank-you when a bank transfer is marked paid. Each order's conversation is one document in
 * `shopify_whatsapp/<Shopify order id>`, whose `state` moves on once, in a transaction, so a notice that
 * comes twice (Mina's store sends each to two addresses) or a reply WAHA delivers again never sends twice.
 *
 *   cod:  awaiting-confirmation → confirmed (Shopify tag "Confirm", the shop's own word) | declined (tag
 *         "Cancel requested"; a person cancels it in Shopify)
 *   bank: awaiting-payment → slip-received (tag "Payment screenshot") → paid (when Shopify says so)
 *   paid: sent
 *   any:  failed | no-whatsapp (the shop is told, to reach the customer another way)
 */

import { adminDb } from '@/lib/firebase-admin';
import { STORE_CONFIG } from '@/lib/store-config';
import { pushToShop } from '@/lib/push/send';
import { sendWhatsAppMessage, toWhatsAppNumber, whatsAppNumberExists } from '@/lib/whatsapp';
import { shopifyRequest } from '@/app/api/shopify/_lib';
import {
  BANK_PAID_REPLY, COD_CONFIRMED_REPLY, COD_DECLINED_REPLY, SLIP_RECEIVED_REPLY,
  messageKey, orderFlowKind, orderMessage, orderPhone, readCodReply, readPollVote, withTag,
  type OrderFlowKind, type ShopifyOrderLike, type WhatsAppOrderState,
} from '@/lib/shopify-whatsapp';

const COLLECTION = 'shopify_whatsapp';
export const shopifyOrderWhatsAppOn = () => process.env.SHOPIFY_ORDER_WHATSAPP === '1';

export type FlowState = WhatsAppOrderState;

export interface OrderFlow {
  orderId: string;
  name: string;
  kind: OrderFlowKind;
  /** The number messaged, international digits ("923001234567"). */
  phone: string;
  state: FlowState;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** COD: the poll's message key (`messageKey`), which a tap on it names. */
  pollKey?: string;
}

const invoiceUrl = (o: { order_number?: number | string; name?: string }) =>
  `/invoices/${encodeURIComponent(`SHOPIFY-${o.order_number ?? String(o.name || '').replace('#', '')}`)}`;

/**
 * The order's WhatsApp state onto its ERP invoice (`whatsappOrder`), so the ERP shows it beside the Shopify chip
 * (owner, 2026-10-30: "add the tag in shopify and pos"). The pull's SHOPIFY-<n>, else the invoice carrying this
 * Shopify order id. Never throws: the invoice may not be in yet.
 */
async function markInvoice(f: Pick<OrderFlow, 'orderId' | 'name' | 'state'>): Promise<void> {
  try {
    const invoices = adminDb.collection('invoices');
    let ref = invoices.doc(`SHOPIFY-${f.name.replace(/^#/, '')}`);
    if (!(await ref.get()).exists) {
      const q = await invoices.where('shopifyOrderId', '==', f.orderId).limit(1).get();
      if (q.empty) return;
      ref = q.docs[0].ref;
    }
    await ref.set({ whatsappOrder: { state: f.state, at: new Date().toISOString() } }, { merge: true });
  } catch (e) { console.error('[shopify-whatsapp] invoice', f.name, (e as Error)?.message); }
}

/** Move a flow from one of `from` to `to`, once. Returns the flow when this call did it. */
async function advance(orderId: string, from: FlowState[], to: FlowState, extra: Partial<OrderFlow> = {}): Promise<OrderFlow | null> {
  const ref = adminDb.collection(COLLECTION).doc(orderId);
  return adminDb.runTransaction(async t => {
    const snap = await t.get(ref);
    const f = snap.data() as OrderFlow | undefined;
    if (!f || !from.includes(f.state)) return null;
    const next = { ...f, ...extra, state: to, updatedAt: new Date().toISOString() };
    t.set(ref, next);
    return next;
  }).then(async next => { if (next) await markInvoice(next); return next; });
}

async function tagOrder(shop: string, token: string, orderId: string, tag: string): Promise<void> {
  try {
    const r = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}.json?fields=id,tags`);
    const tags = withTag(r?.order?.tags, tag);
    if (tags !== r?.order?.tags) await shopifyRequest(shop, token, 'PUT', `/orders/${orderId}.json`, { order: { id: Number(orderId), tags } });
  } catch (e) {
    console.error('[shopify-whatsapp] tag', orderId, tag, (e as Error)?.message);
  }
}

/**
 * A new web order (the orders/create notice, after the ERP has it): its first message, once.
 * Never throws: a WhatsApp failure is recorded and the shop told, and the notice still answers 200.
 */
export async function startOrderFlow(order: ShopifyOrderLike): Promise<{ started: boolean; kind?: OrderFlowKind; state?: FlowState; reason?: string }> {
  if (!shopifyOrderWhatsAppOn()) return { started: false, reason: 'off' };
  const kind = orderFlowKind(order);
  if (!kind) return { started: false, reason: 'not-a-web-order-to-message' };
  const phone = toWhatsAppNumber(orderPhone(order));
  if (phone.length < 11) return { started: false, reason: 'no-phone' };
  const orderId = String(order.id);
  const name = order.name || `#${order.order_number}`;
  const now = new Date().toISOString();
  const first: FlowState = kind === 'cod' ? 'awaiting-confirmation' : kind === 'bank' ? 'awaiting-payment' : 'sent';
  const ref = adminDb.collection(COLLECTION).doc(orderId);
  const mine = await adminDb.runTransaction(async t => {
    if ((await t.get(ref)).exists) return false;
    t.set(ref, { orderId, name, kind, phone, state: first, createdAt: now, updatedAt: now } satisfies OrderFlow);
    return true;
  });
  if (!mine) return { started: false, reason: 'already-started' };
  await markInvoice({ orderId, name, state: first });

  const fail = async (state: FlowState, error: string, title: string) => {
    await ref.set({ state, error, updatedAt: new Date().toISOString() }, { merge: true });
    await markInvoice({ orderId, name, state });
    await pushToShop({ kind: 'orders', title, body: `${name} · ${phone} · ${error}`, url: invoiceUrl(order), key: `shopify-wa-fail_${orderId}` });
  };
  try {
    if ((await whatsAppNumberExists(phone)) === false) {
      await fail('no-whatsapp', 'not on WhatsApp', 'Order has no WhatsApp: reach them another way');
      return { started: false, kind, state: 'no-whatsapp' };
    }
    await sendWhatsAppMessage(phone, orderMessage(kind, order, { bankLine: STORE_CONFIG.bankLine, iban: STORE_CONFIG.iban }));
    return { started: true, kind, state: first };
  } catch (e) {
    await fail('failed', (e as Error)?.message?.slice(0, 200) || 'send failed', 'Order WhatsApp did not send');
    return { started: false, kind, state: 'failed' };
  }
}

/** A bank-transfer order Shopify now calls paid: the customer is told, once. */
export async function followUpPaidOrder(order: ShopifyOrderLike): Promise<boolean> {
  if (!shopifyOrderWhatsAppOn()) return false;
  if (order.financial_status !== 'paid') return false;
  const f = await advance(String(order.id), ['awaiting-payment', 'slip-received'], 'paid');
  if (!f || f.kind !== 'bank') return false;
  try { await sendWhatsAppMessage(f.phone, BANK_PAID_REPLY(f)); } catch (e) { console.error('[shopify-whatsapp] paid', f.name, (e as Error)?.message); }
  return true;
}

/** The customer's open conversation: their newest flow still waiting for them. */
async function openFlowFor(phone: string): Promise<OrderFlow | null> {
  const snap = await adminDb.collection(COLLECTION).where('phone', '==', phone).get();
  const open = snap.docs.map(d => d.data() as OrderFlow)
    .filter(f => f.state === 'awaiting-confirmation' || f.state === 'awaiting-payment')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return open[0] ?? null;
}

export interface InboundMessage { phone: string; text: string; media: boolean }

/**
 * A message from a customer to the house's line (app/api/whatsapp/inbound). Acts only on an answer to an
 * order of theirs that is waiting: 1 / 2 to a cash-on-delivery order, a picture or PDF to a bank transfer.
 * Anything else — a question, a second photo — is for a person on the phone, and is left alone.
 */
export async function handleInbound(m: InboundMessage, creds: () => Promise<{ shop: string; token: string }>): Promise<string> {
  if (!shopifyOrderWhatsAppOn() || !m.phone) return 'off';
  const flow = await openFlowFor(m.phone);
  if (!flow) return 'no-open-order';

  if (flow.kind === 'cod' && flow.state === 'awaiting-confirmation') {
    const answer = m.media ? null : readCodReply(m.text);
    if (!answer) return 'not-an-answer';
    return answerCod(flow, answer, creds);
  }

  if (flow.kind === 'bank' && flow.state === 'awaiting-payment') {
    if (!m.media) return 'not-an-answer';
    const f = await advance(flow.orderId, ['awaiting-payment'], 'slip-received');
    if (!f) return 'already-answered';
    const { shop, token } = await creds();
    await tagOrder(shop, token, f.orderId, 'Payment screenshot');
    await sendWhatsAppMessage(f.phone, SLIP_RECEIVED_REPLY(f)).catch(e => console.error('[shopify-whatsapp] reply', f.name, (e as Error)?.message));
    await pushToShop({ kind: 'payments', title: 'Payment screenshot on WhatsApp', body: `${f.name} · check the bank, then mark it paid in Shopify`, url: invoiceUrl(f), key: `shopify-wa-slip_${f.orderId}` });
    return 'slip-received';
  }
  return 'not-an-answer';
}

/** The customer's answer to a COD order, by reply or by a tap on its poll: tag it, thank them, tell the shop. Once. */
async function answerCod(flow: OrderFlow, answer: 'confirm' | 'decline', creds: () => Promise<{ shop: string; token: string }>): Promise<string> {
  const to: FlowState = answer === 'confirm' ? 'confirmed' : 'declined';
  const f = await advance(flow.orderId, ['awaiting-confirmation'], to);
  if (!f) return 'already-answered';
  const { shop, token } = await creds();
  await tagOrder(shop, token, f.orderId, answer === 'confirm' ? 'Confirm' : 'Cancel requested');
  await sendWhatsAppMessage(f.phone, answer === 'confirm' ? COD_CONFIRMED_REPLY(f) : COD_DECLINED_REPLY(f)).catch(e => console.error('[shopify-whatsapp] reply', f.name, (e as Error)?.message));
  await pushToShop(answer === 'confirm'
    ? { kind: 'orders', title: 'COD order confirmed on WhatsApp', body: `${f.name} · ready to dispatch`, url: invoiceUrl(f), key: `shopify-wa-${to}_${f.orderId}` }
    : { kind: 'orders', title: 'Customer cancelled on WhatsApp', body: `${f.name} · cancel it in Shopify`, url: invoiceUrl(f), key: `shopify-wa-${to}_${f.orderId}` });
  return to;
}

/**
 * A tap on a COD order's poll (WAHA's `poll.vote`, app/api/whatsapp/inbound), matched by the poll's message key. Polls were
 * sent on 2026-10-30 only (the owner went back to "reply 1 / 2" the same day); kept so a tap on one of those still counts.
 */
export async function handlePollVote(pollId: string, selected: string[], creds: () => Promise<{ shop: string; token: string }>): Promise<string> {
  if (!shopifyOrderWhatsAppOn()) return 'off';
  const answer = readPollVote(selected);
  if (!answer) return 'not-an-answer';
  const key = messageKey(pollId);
  if (!key) return 'no-poll';
  const snap = await adminDb.collection(COLLECTION).where('pollKey', '==', key).limit(1).get();
  const flow = snap.docs[0]?.data() as OrderFlow | undefined;
  if (!flow) return 'no-open-order';
  if (flow.state !== 'awaiting-confirmation') return 'already-answered';
  return answerCod(flow, answer, creds);
}
