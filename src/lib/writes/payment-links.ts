/**
 * A payment link for an invoice or an order (lib/safepay.ts), and what happens when it is paid.
 *
 * `payment_links/<tracker token>`: { target: 'invoice' | 'order', targetId, amount, url, state: 'open' | 'paid' | 'expired' | 'attention',
 * createdAt, createdBy, customerName?, paidAt? }. Made by the owner or the counter (op createPaymentLink); the five-minute tick
 * reads each open one back from Safepay (settleOpenLinks) and, once paid, records the money where it belongs, once: an invoice
 * payment `pay-safepay-<token>` or an order advance `adv-safepay-<token>`, by Card (Safepay's checkout; never the drawer).
 * A link unpaid after 30 days is closed (expired) but still read for a late payment until it is 90 days old. Money that arrives
 * for a cancelled or refunded record is recorded nowhere: the link turns `attention` and the owner is told. (The field is `state`.)
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { rupees } from '@/lib/money';
import { checkoutUrl, openTracker, readTracker, trackerPaid, type SafepayTracker } from '@/lib/safepay';
import { LINK, type LinkState } from '@/lib/machines';
import { assertMove } from '@/lib/machines/machine';
import { recordInvoicePayment } from './invoice-payment';
import { recordOrderAdvance } from './order-advance';

const LINKS = 'payment_links';
const OPEN_DAYS = 30;
/** An expired link is still read for a late payment this long after it was made. */
const LATE_DAYS = 90;

export interface PaymentLink {
  id: string;
  target: 'invoice' | 'order';
  targetId: string;
  amount: number;
  url: string;
  state: LinkState;
  /** Set with state 'attention': why the money was not recorded. */
  attentionReason?: string;
  attentionAt?: string;
  createdAt: string;
  createdBy?: string;
  customerName?: string;
  paidAt?: string;
}

export async function createPaymentLink(
  db: DbPort,
  input: { target: 'invoice' | 'order'; targetId: string; amount: number; by?: string; returnTo: string },
  deps: { open?: (amount: number) => Promise<SafepayTracker>; now?: string } = {},
): Promise<PaymentLink> {
  const amount = rupees(input.amount);
  if (!(amount >= 1)) throw new Error('The amount must be at least 1 rupee.');
  const doc = await db.get<{ customerName?: string; balanceDue?: number; status?: string }>(input.target === 'invoice' ? 'invoices' : 'orders', input.targetId);
  if (!doc) throw new Error(`No such ${input.target}.`);
  if (doc.status === 'Refunded' || doc.status === 'Cancelled') throw new Error(`That ${input.target} is ${doc.status.toLowerCase()}.`);
  const t = await (deps.open ?? openTracker)(amount);
  const link: PaymentLink = {
    id: t.token, target: input.target, targetId: input.targetId, amount,
    url: checkoutUrl(t.token, input.targetId, input.returnTo), state: 'open',
    createdAt: deps.now || new Date().toISOString(), ...(input.by && { createdBy: input.by }),
    ...(doc.customerName && { customerName: doc.customerName }),
  };
  await db.runTransaction(async tx => { tx.set(LINKS, t.token, link as unknown as Record<string, unknown>); });
  return link;
}

/**
 * Safepay says paid, and the money has nowhere open to go (its order is cancelled or refunded, its invoice refunded or gone):
 * the link is marked `attention` with the reason and the owner is told in the activity log. Never retried, never recorded.
 */
async function moneyOnClosedRecord(db: DbPort, link: PaymentLink, kind: 'order' | 'invoice', id: string, why: string, paidAt: string, fx: SideEffects): Promise<'attention'> {
  assertMove(LINK, link.state, 'attention', 'unapplied', {});
  const reason = `PKR ${link.amount.toLocaleString('en-PK')} was paid by Safepay link, but ${why}. Nothing was recorded: refund the customer or put it where it belongs.`;
  await db.update(LINKS, link.id, { state: 'attention', attentionReason: reason, attentionAt: paidAt });
  void Promise.resolve(fx.log?.(`${kind}.update`, `Safepay money arrived on a closed ${kind}: ${id}`, reason, id)).catch(() => undefined);
  return 'attention';
}

/**
 * Records one paid link's money (idempotent by the token) and marks the link paid. Where it goes: an invoice's link, its
 * invoice; an order's link, the order's advance, or, when the order has been invoiced since, the INVOICE as a payment (the
 * invoice is where an invoiced order's money is taken). A cancelled or refunded record takes nothing: see moneyOnClosedRecord.
 */
export async function settlePaidLink(db: DbPort, link: PaymentLink, paidAt: string, fx: SideEffects = {}): Promise<'paid' | 'attention'> {
  assertMove(LINK, link.state, 'paid', 'paid', {});
  const requestId = `safepay-${link.id}`;
  const reference = `Safepay ${link.id.slice(6, 14)}`;
  let target = link.target, targetId = link.targetId;
  if (target === 'order') {
    const o = await db.get<{ status?: string; invoiceId?: string; advances?: { id?: string }[] }>('orders', targetId);
    if (o) {
      if (o.status === 'Cancelled' || o.status === 'Refunded') return moneyOnClosedRecord(db, link, 'order', targetId, `order ${targetId} is ${o.status}`, paidAt, fx);
      // The advance went in before the link could be marked (a failed second write): it is only left to mark.
      if ((o.advances || []).some(a => a.id === `adv-${requestId}`)) { await db.update(LINKS, link.id, { state: 'paid', paidAt }); return 'paid'; }
      if (o.invoiceId) { target = 'invoice'; targetId = o.invoiceId; }
    }
  }
  if (target === 'invoice') {
    const inv = await db.get<{ status?: string }>('invoices', targetId);
    if (!inv) return moneyOnClosedRecord(db, link, 'invoice', targetId, `invoice ${targetId} no longer exists`, paidAt, fx);
    if (inv.status === 'Refunded') return moneyOnClosedRecord(db, link, 'invoice', targetId, `invoice ${targetId} is refunded`, paidAt, fx);
    await recordInvoicePayment(db, { invoiceId: targetId, amount: link.amount, date: paidAt, method: 'Card', reference, requestId } as never, fx);
  } else {
    await recordOrderAdvance(db, { orderId: targetId, amount: link.amount, date: paidAt, method: 'Card', notes: 'Paid by link (Safepay)', requestId }, fx);
  }
  await db.update(LINKS, link.id, { state: 'paid', paidAt });
  return 'paid';
}

/**
 * Every open link read back from Safepay: paid ones recorded, old unpaid ones closed. A closed (expired) link is still read
 * for LATE_DAYS after it was made, because a customer can pay a link after we gave up on it; after that it is left alone.
 */
export async function settleOpenLinks(
  db: DbPort,
  deps: { read?: (token: string) => Promise<SafepayTracker | null>; now?: Date } = {},
  fx: SideEffects = {},
): Promise<{ checked: number; paid: string[]; expired: string[]; attention: string[]; errors: string[] }> {
  const now = deps.now ?? new Date();
  const age = (l: PaymentLink) => now.getTime() - Date.parse(l.createdAt);
  const [open, expired] = await Promise.all([db.queryEquals<PaymentLink>(LINKS, 'state', 'open'), db.queryEquals<PaymentLink>(LINKS, 'state', 'expired')]);
  const watched = [...open, ...expired.filter(l => age(l) <= LATE_DAYS * 86400000)];
  const out = { checked: watched.length, paid: [] as string[], expired: [] as string[], attention: [] as string[], errors: [] as string[] };
  for (const link of watched) {
    try {
      const t = await (deps.read ?? readTracker)(link.id);
      if (t && trackerPaid(t)) {
        const result = await settlePaidLink(db, link, now.toISOString(), fx);
        (result === 'paid' ? out.paid : out.attention).push(`${link.target} ${link.targetId}`);
      } else if (link.state === 'open' && age(link) > OPEN_DAYS * 86400000) {
        assertMove(LINK, link.state, 'expired', 'expire', {});
        await db.update(LINKS, link.id, { state: 'expired' });
        out.expired.push(link.id);
      }
    } catch (e) {
      out.errors.push(`${link.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
