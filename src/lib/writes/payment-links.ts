/**
 * A payment link for an invoice or an order (lib/safepay.ts), and what happens when it is paid.
 *
 * `payment_links/<tracker token>`: { target: 'invoice' | 'order', targetId, amount, url, state: 'open' | 'paid' | 'expired',
 * createdAt, createdBy, customerName?, paidAt? }. Made by the owner or the counter (op createPaymentLink); the five-minute tick
 * reads each open one back from Safepay (settleOpenLinks) and, once paid, records the money where it belongs, once: an invoice
 * payment `pay-safepay-<token>` or an order advance `adv-safepay-<token>`, by Card (Safepay's checkout; never the drawer).
 * A link unpaid after 30 days is closed.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { rupees } from '@/lib/money';
import { checkoutUrl, openTracker, readTracker, trackerPaid, type SafepayTracker } from '@/lib/safepay';
import { recordInvoicePayment } from './invoice-payment';
import { recordOrderAdvance } from './order-advance';

const LINKS = 'payment_links';
const OPEN_DAYS = 30;

export interface PaymentLink {
  id: string;
  target: 'invoice' | 'order';
  targetId: string;
  amount: number;
  url: string;
  state: 'open' | 'paid' | 'expired';
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

/** Records one paid link's money on its invoice or order (idempotent by the token) and marks the link paid. */
export async function settlePaidLink(db: DbPort, link: PaymentLink, paidAt: string, fx: SideEffects = {}): Promise<void> {
  const requestId = `safepay-${link.id}`;
  const reference = `Safepay ${link.id.slice(6, 14)}`;
  if (link.target === 'invoice') {
    await recordInvoicePayment(db, { invoiceId: link.targetId, amount: link.amount, date: paidAt, method: 'Card', reference, requestId } as never, fx);
  } else {
    await recordOrderAdvance(db, { orderId: link.targetId, amount: link.amount, date: paidAt, method: 'Card', notes: 'Paid by link (Safepay)', requestId }, fx);
  }
  await db.update(LINKS, link.id, { state: 'paid', paidAt });
}

/** Every open link read back from Safepay: paid ones recorded, old unpaid ones closed. */
export async function settleOpenLinks(
  db: DbPort,
  deps: { read?: (token: string) => Promise<SafepayTracker | null>; now?: Date } = {},
  fx: SideEffects = {},
): Promise<{ checked: number; paid: string[]; expired: string[]; errors: string[] }> {
  const now = deps.now ?? new Date();
  const open = await db.queryEquals<PaymentLink>(LINKS, 'state', 'open');
  const out = { checked: open.length, paid: [] as string[], expired: [] as string[], errors: [] as string[] };
  for (const link of open) {
    try {
      const t = await (deps.read ?? readTracker)(link.id);
      if (t && trackerPaid(t)) {
        await settlePaidLink(db, link, now.toISOString(), fx);
        out.paid.push(`${link.target} ${link.targetId}`);
      } else if (now.getTime() - Date.parse(link.createdAt) > OPEN_DAYS * 86400000) {
        await db.update(LINKS, link.id, { state: 'expired' });
        out.expired.push(link.id);
      }
    } catch (e) {
      out.errors.push(`${link.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
