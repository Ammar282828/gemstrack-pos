/**
 * The live alerts as documents (doc.ts): a new sale, a payment, a new order, an order finished
 * or cancelled, a website order, and the test. Built on the server from what Firestore holds
 * (send-alert.ts reads it), never from words a browser sends, so the PDF is the book's own
 * record of the moment. Pure, tested.
 */

import type { Invoice, InvoiceItem, Order, OrderItem, Payment } from '@/lib/store';
import { orderAdvancePayments } from '@/lib/order-payment';
import { describeExchanges, exchangeTotal, invoiceExchanges, orderExchanges } from '@/lib/exchange';
import type { OrderSummaryForMessage } from '@/lib/website/notify';
import { clock, longDay, plural, pkr, rs, shortDay, stamp, type AlertDoc, type Section, type Table } from './doc';

export type OrderAlert = 'new' | 'Completed' | 'Cancelled' | 'Refunded';

const who = (name: unknown) => String(name || '').trim() || 'Walk-in';
const list = <T>(v: T[] | Record<string, T> | undefined | null): T[] => (Array.isArray(v) ? v : v ? Object.values(v) : []);
const join = (parts: unknown[]) => parts.map(p => String(p ?? '').trim()).filter(Boolean).join(' · ');

/** "21k · 9.46 g" — what a piece is, in the fewest words. */
function weighs(karat: string | undefined, metal: string | undefined, g: number | undefined): string {
  const grams = Number(g) > 0 ? `${Number(g).toFixed(2)} g` : '';
  const kind = karat ? karat.toUpperCase() : metal && metal !== 'gold' ? metal[0].toUpperCase() + metal.slice(1) : '';
  return join([kind, grams]);
}

const invoicePieces = (items: InvoiceItem[]): Table => ({
  columns: [{ label: 'Piece' }, { label: 'Metal', width: 23 }, { label: 'Price', width: 19, align: 'right' }],
  rows: items.map(i => [i.name || i.sku || 'Piece', weighs(i.karat, i.metalType, i.metalWeightG), rs(i.itemTotal ?? (Number(i.unitPrice) || 0) * (Number(i.quantity) || 1))]),
  details: items.map(i => join([i.size ? `size ${i.size}` : '', i.diamondDetails, i.stoneDetails, i.adminNote ? `note: ${i.adminNote}` : '']) || undefined),
});

const paymentsTable = (payments: Payment[], highlight?: number): Table => ({
  columns: [{ label: 'Date', width: 15 }, { label: 'How' }, { label: 'Amount', width: 22, align: 'right' }],
  rows: payments.map(p => [shortDay(p.date), p.method || 'Not recorded', rs(p.amount)]),
  details: payments.map((p, i) => join([i === highlight ? 'this payment' : '', p.reference ? `ref ${p.reference}` : '', p.notes]) || undefined),
  foot: payments.length > 1 ? ['', plural(payments.length, 'payment'), rs(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0))] : undefined,
});

function invoiceBill(inv: Invoice): Section {
  const ex = invoiceExchanges(inv);
  const exTotal = exchangeTotal(ex);
  const pairs: NonNullable<Section['pairs']> = [{ label: 'Pieces', value: rs(inv.subtotal) }];
  if (Number(inv.discountAmount) > 0) pairs.push({ label: 'Discount', value: `- ${rs(inv.discountAmount)}` });
  if (Number(inv.adjustmentsAmount)) pairs.push({ label: 'Adjustments', value: rs(inv.adjustmentsAmount) });
  if (exTotal > 0) pairs.push({ label: `Exchange: ${describeExchanges(ex)}`, value: `- ${rs(exTotal)}` });
  pairs.push({ label: 'Total', value: pkr(inv.grandTotal), strong: true });
  pairs.push({ label: 'Paid', value: rs(inv.amountPaid) });
  pairs.push({ label: 'Balance', value: Number(inv.balanceDue) > 0 ? pkr(inv.balanceDue) : 'Paid in full', strong: true, tone: Number(inv.balanceDue) > 0 ? 'flag' : undefined });
  return { title: 'The bill', pairs };
}

/** A new invoice: what was sold, to whom, what was paid and what is still owed. */
export function saleDoc(inv: Invoice, now = new Date()): AlertDoc {
  const items = list(inv.items as InvoiceItem[] | Record<string, InvoiceItem>);
  const payments = list(inv.paymentHistory);
  const owed = Number(inv.balanceDue) > 0;
  return {
    kind: 'sale',
    title: 'New sale',
    heading: inv.id,
    subheading: join([who(inv.customerName), inv.customerContact, inv.sourceOrderId ? `from ${inv.sourceOrderId}` : '', inv.takenBy ? `by ${inv.takenBy}` : '', inv.createdAt ? clock(inv.createdAt) : '']),
    headline: join([inv.id, who(inv.customerName), pkr(inv.grandTotal)]),
    figures: [
      { label: 'Total', value: pkr(inv.grandTotal), note: plural(items.length, 'piece') },
      owed
        ? { label: 'Balance', value: pkr(inv.balanceDue), note: `paid ${rs(inv.amountPaid)}`, tone: 'flag' }
        : { label: 'Paid', value: pkr(inv.amountPaid), note: 'in full' },
    ],
    sections: [
      { title: 'Pieces', table: invoicePieces(items), empty: 'No pieces on it.' },
      invoiceBill(inv),
      { title: 'Payments', table: paymentsTable(payments), empty: 'Nothing paid yet.' },
      ...(inv.internalNote ? [{ title: 'Note for the shop', text: [inv.internalNote] }] : []),
    ],
    at: now,
  };
}

/** A payment on an invoice: how much, how, and what is left. `index` is the payment's place in the history. */
export function paymentDoc(inv: Invoice, index: number, now = new Date()): AlertDoc {
  const payments = list(inv.paymentHistory);
  const p = payments[index] ?? payments[payments.length - 1] ?? { amount: 0, date: now.toISOString() };
  const owed = Number(inv.balanceDue) > 0;
  const items = list(inv.items as InvoiceItem[] | Record<string, InvoiceItem>);
  return {
    kind: 'payment',
    title: 'Payment received',
    heading: pkr(p.amount),
    subheading: join([inv.id, who(inv.customerName), p.method || 'how paid not recorded', p.date ? stamp(p.date) : '']),
    headline: join([inv.id, who(inv.customerName), pkr(p.amount)]),
    figures: [
      { label: 'Received', value: pkr(p.amount), note: join([p.method, p.reference ? `ref ${p.reference}` : '']) },
      owed
        ? { label: 'Still owed', value: pkr(inv.balanceDue), tone: 'flag', note: `of ${rs(inv.grandTotal)}` }
        : { label: 'Balance', value: 'Paid in full', note: `total ${rs(inv.grandTotal)}` },
    ],
    sections: [
      { title: 'Payments on this invoice', table: paymentsTable(payments, payments.indexOf(p)) },
      { title: 'Pieces', table: invoicePieces(items), empty: 'No pieces on it.' },
      invoiceBill(inv),
    ],
    at: now,
  };
}

const itemEstimate = (i: OrderItem) => Number(i.totalEstimate) || Number(i.manualPrice) || 0;

const ORDER_TITLE: Record<OrderAlert, string> = {
  new: 'New order', Completed: 'Order completed', Cancelled: 'Order cancelled', Refunded: 'Order refunded',
};

/** An order taken, finished, cancelled or refunded. */
export function orderDoc(order: Order, kind: OrderAlert, now = new Date()): AlertDoc {
  const items = list(order.items as OrderItem[] | Record<string, OrderItem>);
  // The order page's lines, without its "Advance:" label or the form's stock words in every note.
  const advances = orderAdvancePayments(order, '').map(p => ({
    ...p, notes: String(p.notes ?? '').replace(/^:\s*/, '').replace(/^advance( payment)?( received)?\.?$/i, '').trim() || undefined,
  }));
  const ex = orderExchanges(order);
  const exTotal = exchangeTotal(ex);
  const balance = Number(order.grandTotal) || 0;
  const pairs: NonNullable<Section['pairs']> = [{ label: 'Estimate', value: rs(order.subtotal) }];
  if (Number(order.discountAmount) > 0) pairs.push({ label: 'Discount', value: `- ${rs(order.discountAmount)}` });
  if (Number(order.advancePayment) > 0) pairs.push({ label: 'Advance', value: `- ${rs(order.advancePayment)}` });
  if (exTotal > 0) pairs.push({ label: `Exchange: ${describeExchanges(ex)}`, value: `- ${rs(exTotal)}` });
  if (order.advanceGoldDetails) pairs.push({ label: `Gold given: ${order.advanceGoldDetails}`, value: '' });
  pairs.push({ label: kind === 'Completed' ? 'Balance at completion' : 'Balance', value: pkr(balance), strong: true, tone: kind === 'new' || balance <= 0 ? undefined : 'flag' });

  return {
    kind: kind === 'new' ? 'order' : `order-${kind.toLowerCase()}`,
    title: ORDER_TITLE[kind],
    heading: order.id,
    subheading: join([
      who(order.customerName), order.customerContact, order.takenBy ? `by ${order.takenBy}` : '',
      kind === 'new' ? (order.promisedDate ? `promised ${shortDay(order.promisedDate)}` : 'no promised date') : `taken ${shortDay(order.createdAt)}`,
      kind === 'Completed' && order.invoiceId ? `invoice ${order.invoiceId}` : '',
    ]),
    headline: join([order.id, who(order.customerName), pkr(order.subtotal)]),
    figures: [
      { label: 'Estimate', value: pkr(order.subtotal), note: plural(items.length, 'piece') },
      { label: kind === 'new' ? 'Advance' : 'Balance', value: kind === 'new' ? pkr((Number(order.advancePayment) || 0) + exTotal) : pkr(balance), tone: kind !== 'new' && balance > 0 ? 'flag' : undefined, note: kind === 'new' ? `balance ${rs(balance)}` : undefined },
    ],
    sections: [
      {
        title: 'Pieces',
        table: {
          columns: [{ label: 'Piece' }, { label: 'Metal', width: 23 }, { label: 'Estimate', width: 19, align: 'right' }],
          rows: items.map(i => [i.description || i.itemCategory || 'Piece', weighs(i.karat, i.metalType, i.estimatedWeightG), rs(itemEstimate(i))]),
          details: items.map(i => join([i.size ? `size ${i.size}` : '', i.platingType, i.diamondDetails, i.stoneDetails, i.adminNote ? `note: ${i.adminNote}` : '']) || undefined),
        },
        empty: 'No pieces on it.',
      },
      { title: 'Money', pairs },
      ...(advances.length ? [{ title: 'Advances', table: paymentsTable(advances) }] : []),
      ...(order.summary || order.notes ? [{ title: 'Notes', text: [order.summary, order.notes].filter((s): s is string => !!s) }] : []),
    ],
    at: now,
  };
}

/** A website order, for the shop. */
export function websiteOrderDoc(o: OrderSummaryForMessage, now = new Date()): AlertDoc {
  // Every online order waits for a person (lib/website/online.ts): the customer has no bank
  // details until it is confirmed, so the alert says what to do, not "awaiting the transfer".
  return {
    kind: 'website-order',
    title: 'Online order',
    heading: o.id,
    subheading: join([o.customerName, o.customerPhone, o.city]),
    headline: join([o.id, o.customerName, pkr(o.grandTotal), 'to confirm']),
    figures: [
      { label: 'Total', value: pkr(o.grandTotal), note: 'confirm it before anything else', tone: 'flag' },
      { label: 'Delivery', value: o.deliveryCharge ? pkr(o.deliveryCharge) : 'Free' },
    ],
    sections: [{
      title: 'Pieces',
      table: {
        columns: [{ label: 'Piece' }, { label: 'Price', width: 22, align: 'right' }],
        rows: o.lines.map(l => [l.description, rs(l.price)]),
        foot: ['Subtotal', rs(o.subtotal)],
      },
    }, {
      title: 'What to do',
      text: [
        'Open Orders in the ERP: it is at the top, under Online — to confirm. Confirm it and the customer gets the bank details and a day to pay at this price; decline it and they are told why.',
        'Nothing is in the book until you confirm: no order number, no customer, no piece.',
      ],
    }],
    footnote: `The customer's page: ${o.statusUrl}`,
    at: now,
  };
}

/** Online orders still waiting for someone to look at them (the five-minute tick, once each). */
export function onlineWaitingDoc(rows: { id: string; customerName: string; city?: string; grandTotal: number; placedAt: string }[], now = new Date()): AlertDoc {
  const total = rows.reduce((s, r) => s + r.grandTotal, 0);
  return {
    kind: 'online-waiting',
    title: 'Online orders waiting',
    heading: `${plural(rows.length, 'online order')} to confirm`,
    subheading: 'The customers have no bank details until you do.',
    headline: join([plural(rows.length, 'online order'), pkr(total), 'waiting']),
    sections: [{
      title: 'Waiting',
      table: {
        columns: [{ label: 'Order' }, { label: 'Placed', width: 18 }, { label: 'PKR', width: 20, align: 'right' }],
        rows: rows.map(r => [join([r.id, r.customerName, r.city]), `${shortDay(r.placedAt)} ${clock(r.placedAt)}`, rs(r.grandTotal)]),
      },
    }],
    footnote: 'Orders → Online — to confirm, in the ERP.',
    at: now,
  };
}

/** The slip a customer sent from their order page, with the picture itself when it is one. */
export function onlineSlipDoc(o: { orderId: string; onlineId?: string; customerName: string; total: number; slip: { amount?: number; reference?: string; fromBank?: string }; image?: { dataUrl: string; format: 'JPEG' | 'PNG' } }, now = new Date()): AlertDoc {
  const ref = o.onlineId ? `${o.orderId} · ${o.onlineId}` : o.orderId;
  const short = o.slip.amount && Math.abs(o.slip.amount - o.total) > 0.5;
  return {
    kind: 'online-slip',
    title: 'Transfer slip',
    heading: ref,
    subheading: o.customerName,
    headline: join([o.orderId, o.customerName, 'slip', o.slip.amount ? pkr(o.slip.amount) : '']),
    figures: [
      { label: 'Order total', value: pkr(o.total) },
      { label: 'They say they sent', value: o.slip.amount ? pkr(o.slip.amount) : '—', ...(short ? { note: 'not the total', tone: 'flag' as const } : {}) },
    ],
    sections: [
      ...(o.slip.reference || o.slip.fromBank ? [{ title: 'From the customer', pairs: [
        ...(o.slip.fromBank ? [{ label: 'From', value: o.slip.fromBank }] : []),
        ...(o.slip.reference ? [{ label: 'Reference', value: o.slip.reference }] : []),
      ] }] : []),
      { title: 'What to do', text: ['Check the bank: a slip is not the money. When it is in, press Transfer received on the order (Orders → Online — awaiting transfer): it is paid in full, the customer is told, and you can give it out.'] },
      o.image ? { title: 'The slip', image: o.image } : { title: 'The slip', text: ['A PDF: open the order in the ERP to see it.'] },
    ],
    at: now,
  };
}

/** A confirmed online order whose price hold ran out with no transfer recorded (once). */
export function holdEndedDoc(o: { orderId: string; onlineId?: string; customerName: string; total: number; slipSent: boolean }, now = new Date()): AlertDoc {
  return {
    kind: 'online-hold-ended',
    title: 'Hold ended',
    heading: o.onlineId ? `${o.orderId} · ${o.onlineId}` : o.orderId,
    subheading: o.customerName,
    headline: join([o.orderId, o.customerName, pkr(o.total), 'hold ended']),
    figures: [{ label: 'Order total', value: pkr(o.total), note: o.slipSent ? 'a slip came: check it' : 'no slip came', tone: 'flag' }],
    sections: [{
      title: 'What to do',
      text: [
        'Check the bank before anything else: people often pay and forget the slip.',
        'Money in: Transfer received. Nothing came: Let it lapse, which cancels the order and tells the customer. Nothing happens on its own.',
      ],
    }],
    at: now,
  };
}

/** Settings' "Send test": what arrives, and that it does. */
export function testDoc(enabled: string[], now = new Date()): AlertDoc {
  return {
    kind: 'test',
    title: 'Test',
    heading: 'Alerts are working',
    subheading: longDay(now),
    headline: stamp(now),
    sections: [
      { title: 'Arrives as a PDF like this', text: enabled.length ? enabled : ['Every alert is switched off in Settings → Notifications.'] },
    ],
    at: now,
  };
}

/**
 * A message that was written as WhatsApp text (the gold update, written by the AI in WhatsApp's
 * *bold* and _italic_) as a document: a line that is only a bold phrase starts a section, the
 * rest are its paragraphs, the rules and the marks go.
 */
export function textDoc(o: { kind: string; title: string; headline: string; text: string }, now = new Date()): AlertDoc {
  const strip = (l: string) => l.replace(/[*_~]/g, '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim();
  const sections: Section[] = [];
  let heading = '';
  let current: Section | null = null;
  for (const raw of o.text.split('\n')) {
    const line = raw.trim();
    if (!line || /^[━─—=_-]{3,}$/.test(line)) continue;
    const isHead = /^[^a-z0-9]*\*[^*]+\*[^a-z0-9]*$/i.test(line) && strip(line).length <= 70;
    if (isHead) {
      if (!heading) { heading = strip(line); continue; }
      current = { title: strip(line), text: [] };
      sections.push(current);
      continue;
    }
    if (!current) { current = { title: 'Today', text: [] }; sections.push(current); }
    current.text!.push(strip(line.replace(/^[-•]\s*/, '• ')));
  }
  return { kind: o.kind, title: o.title, heading: heading || o.title, subheading: longDay(now), headline: o.headline, sections: sections.filter(x => x.text?.length), at: now };
}
