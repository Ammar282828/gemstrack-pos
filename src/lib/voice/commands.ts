/**
 * Everything voice can do besides the khata's own entries (owner, 2026-10-01: "voice should be
 * able to do absolutely anything in my pos").
 *
 * One catalogue: each command says what it is (for the model), what it takes (args.ts reads the
 * spoken values into real rows), what it will do (for the card) and how (the same store action a
 * page's button calls, so a spoken change is the same change with the same log and the same
 * checks — a delete still asks for the delete code). The model picks commands from this list by
 * id; nothing outside it can be reached by talking.
 *
 * Three kinds:
 *   read-only   go somewhere, open something: done at once, no card.
 *   writes      shown on the card, changeable, done on "Write it down".
 *   forms       an order, a sale, a new piece: priced by their own forms, so voice fills the form
 *               in and opens it (handoff.ts) and the shop presses Create there.
 *
 * The khata's own entries (record_payment, gold_received, order_status …) stay in resolve.ts and
 * apply.ts, which hold their rules; a step may be one of those too (steps.ts).
 */

import type {
  AppState, Customer, GivenItem, Invoice, Karigar, KarigarJob, Order, PaymentType, Product, Repair, Settings,
} from '@/lib/store';
import { staticCategories } from '@/lib/categories';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { STORE_CONFIG } from '@/lib/store-config';
import { ORDER_CATEGORIES, type OrderDraft, type DraftItem } from '@/lib/vision/order-draft';
import type { BillLine } from '@/lib/vision/bill-draft';
import { orderAdvancePayments } from '@/lib/order-payment';
import { PAYMENT_METHOD_WORDS } from './documents';
import type { ArgSpec, ArgType } from './args';
import type { HandoffKind } from './handoff';
import type { RankedName } from './phonetics';

/** A person as args.ts pins one. */
type Who = Pick<RankedName, 'id' | 'name' | 'kind'>;
/** The resolved values, by arg name; a piece list under `pieces`. */
export type Vals = Record<string, any> & { pieces?: Record<string, any>[] };
/** What each value reads as on the card. */
export type Labels = Record<string, string | undefined> & { pieces?: Record<string, string | undefined>[] };

export interface Made { type: ArgType; value: unknown }

export interface Done {
  said: string;
  href?: string;
  undo?: () => Promise<void>;
  /** What this step made or found, for a later step's "$n". */
  made?: Made;
}

export interface RunCtx {
  s: AppState;
  go: (href: string) => void;
  handOff: (kind: HandoffKind, payload: unknown) => void;
  now: string;
}

export interface CommandDef {
  id: string;
  /** What it is, in the shop's words: the card's "What". */
  label: string;
  /** For the model: when to use it. */
  say: string;
  args: ArgSpec[];
  /** A list of pieces: each `start` value begins one; the fields after it belong to it. */
  pieces?: { start: ArgSpec; fields: ArgSpec[] };
  readOnly?: boolean;
  /** It takes something away (the store asks for the delete code as well). */
  danger?: boolean;
  /** It fills a form in rather than writing (the shop finishes it there). */
  form?: boolean;
  describe: (l: Labels) => string;
  run: (v: Vals, x: RunCtx) => Promise<Done>;
}

const RATE_KEYS: Record<string, keyof Settings> = {
  '24k': 'goldRatePerGram24k', '22k': 'goldRatePerGram22k', '21k': 'goldRatePerGram21k', '18k': 'goldRatePerGram18k',
  silver: 'silverRatePerGram', platinum: 'platinumRatePerGram', palladium: 'palladiumRatePerGram',
  'palladium 18k': 'palladiumRatePerGram18k', 'palladium 12k': 'palladiumRatePerGram12k',
};

const ALERTS: Record<string, keyof Settings> = {
  'all alerts': 'notifEnabled', 'sale alerts': 'notifNewInvoice', 'payment alerts': 'notifPaymentReceived',
  'new order alerts': 'notifNewOrder', 'order completed alerts': 'notifOrderCompleted', 'order cancelled alerts': 'notifOrderCancelled',
  'daily report': 'notifDailyReport', 'morning checklist': 'notifDailyChecklist', 'end of day': 'notifEndOfDay',
  'weekly report': 'notifWeeklyReport', 'overdue orders': 'notifOrderOverdue', 'given items': 'notifGivenItems',
  'karigar balances': 'notifKarigarPayment', 'ads summary': 'notifAdsDaily', 'monthly report': 'notifMonthlyReport',
} as unknown as Record<string, keyof Settings>;

const REPAIR_STATUS = ['received', 'ready', 'collected', 'cancelled'] as const;
const JOB_STATUS = ['pending', 'in-progress', 'completed'] as const;

const rs = (n: unknown) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
const pieceWord = (l: Labels) => (l.piece ? `piece ${l.piece} of ` : '');

// Arg shorthands.
const A = {
  customer: (name = 'customer', label = 'Customer', required = false): ArgSpec => ({ name, type: 'customer', label, required }),
  karigar: (name = 'karigar', label = 'Karigar', required = true): ArgSpec => ({ name, type: 'karigar', label, required }),
  person: (name = 'person', label = 'Who', required = true): ArgSpec => ({ name, type: 'person', label, required }),
  order: (open = false): ArgSpec => ({ name: 'order', type: 'order', label: 'Order', required: true, open }),
  invoice: (open = false): ArgSpec => ({ name: 'invoice', type: 'invoice', label: 'Invoice', required: true, open }),
  repair: (open = true): ArgSpec => ({ name: 'repair', type: 'repair', label: 'Repair', required: true, open }),
  money: (name: string, label: string, required = false): ArgSpec => ({ name, type: 'money', label, required }),
  grams: (name = 'weight', label = 'Weight', required = false): ArgSpec => ({ name, type: 'grams', label, required }),
  num: (name: string, label: string, required = false): ArgSpec => ({ name, type: 'number', label, required }),
  text: (name: string, label: string, required = false): ArgSpec => ({ name, type: 'text', label, required }),
  date: (name: string, label: string, required = false): ArgSpec => ({ name, type: 'date', label, required }),
  karat: (): ArgSpec => ({ name: 'karat', type: 'karat', label: 'Karat' }),
  method: (): ArgSpec => ({ name: 'method', type: 'enum', label: 'Paid by', options: PAYMENT_METHOD_WORDS, synonyms: { bank: 'Bank Transfer', transfer: 'Bank Transfer', online: 'Bank Transfer', easypaisa: 'Bank Transfer', jazz: 'Bank Transfer', check: 'Cheque', naqd: 'Cash' } }),
  piece: (): ArgSpec => ({ name: 'piece', type: 'number', label: 'Piece no.' }),
};

const go = (href: string, said: string) => async (_v: Vals, x: RunCtx): Promise<Done> => { x.go(href); return { said, href }; };

/** The items of an order or invoice a "piece n" names: that one, or all of them. */
function piecesOf<T>(items: T[] | undefined, piece: unknown): number[] {
  const list = Array.isArray(items) ? items : [];
  const n = Number(piece);
  if (Number.isFinite(n) && n >= 1) {
    if (n > list.length) throw new Error(`There is no piece ${n}; it has ${list.length}.`);
    return [n - 1];
  }
  return list.map((_, i) => i);
}

export const COMMANDS: CommandDef[] = [
  // ── Going places: no card ────────────────────────────────────────────────
  {
    id: 'go', label: 'Open a screen', readOnly: true,
    say: 'Open any screen of the ERP by name (the list under SCREENS).',
    args: [{ name: 'screen', type: 'screen', label: 'Screen', required: true }],
    describe: l => `Open ${l.screen}.`,
    run: async (v, x) => { x.go(v.screen); return { said: 'Opened.', href: v.screen }; },
  },
  {
    id: 'open_customer', label: "Open a customer's page", readOnly: true,
    say: "A customer's page.", args: [A.customer('customer', 'Customer', true)],
    describe: l => `Open ${l.customer}.`,
    run: async (v, x) => go(`/customers/${(v.customer as Who).id}`, `Opened ${(v.customer as Who).name}.`)(v, x),
  },
  {
    id: 'open_karigar', label: "Open a karigar's page", readOnly: true,
    say: "A karigar's page, their work.", args: [A.karigar()],
    describe: l => `Open ${l.karigar}.`,
    run: async (v, x) => go(`/karigars/${(v.karigar as Who).id}`, `Opened ${(v.karigar as Who).name}.`)(v, x),
  },
  {
    id: 'open_hisaab', label: "Open someone's hisaab", readOnly: true,
    say: "A person's khata/hisaab ledger.", args: [A.person()],
    describe: l => `Open ${l.person}'s hisaab.`,
    run: async (v, x) => go(`/hisaab/${(v.person as Who).id}?type=${(v.person as Who).kind}`, `Opened ${(v.person as Who).name}'s hisaab.`)(v, x),
  },
  {
    id: 'open_repair', label: 'Open a repair', readOnly: true,
    say: 'A repair ticket (REP number, or whose).', args: [A.repair(false)],
    describe: l => `Open ${l.repair}.`,
    run: async (v, x) => go(`/repairs?id=${(v.repair as Repair).id}`, `Opened ${(v.repair as Repair).id}.`)(v, x),
  },
  {
    id: 'open_piece', label: 'Open a piece in stock', readOnly: true,
    say: 'A piece in stock by its tag/SKU or what it is.', args: [{ name: 'product', type: 'product', label: 'Piece', required: true }],
    describe: l => `Open ${l.product}.`,
    run: async (v, x) => go(`/products/${encodeURIComponent((v.product as Product).sku)}`, `Opened ${(v.product as Product).sku}.`)(v, x),
  },
  {
    id: 'print_invoice', label: 'Print an invoice', readOnly: true,
    say: 'Print / PDF an invoice.', args: [A.invoice()],
    describe: l => `Print ${l.invoice}.`,
    run: async (v, x) => go(`/invoices/${(v.invoice as Invoice).id}?do=print`, `Printing ${(v.invoice as Invoice).id}.`)(v, x),
  },
  {
    id: 'send_invoice', label: 'Send an invoice on WhatsApp', readOnly: true,
    say: "Send an invoice to its customer on WhatsApp.", args: [A.invoice()],
    describe: l => `Send ${l.invoice} to the customer on WhatsApp.`,
    run: async (v, x) => go(`/invoices/${(v.invoice as Invoice).id}?do=share`, `Opening WhatsApp for ${(v.invoice as Invoice).id}.`)(v, x),
  },
  {
    id: 'finalize_order', label: 'Finalize an order into an invoice', readOnly: true,
    say: "Turn a finished order into an invoice (opens Finalize with the final weights to confirm).", args: [A.order(true)],
    describe: l => `Finalize ${l.order} into an invoice.`,
    run: async (v, x) => go(`/orders/${(v.order as Order).id}?do=finalize`, `Finalizing ${(v.order as Order).id}.`)(v, x),
  },

  // ── Rates and settings ───────────────────────────────────────────────────
  {
    id: 'set_rate', label: "Set today's rate",
    say: "Set the shop's rate per gram: 21k, 22k, 24k, 18k gold, silver, platinum, palladium. One step per rate said.",
    args: [
      { name: 'metal', type: 'enum', label: 'Rate for', required: true, options: Object.keys(RATE_KEYS), synonyms: { ikkis: '21k', baees: '22k', chobis: '24k', athara: '18k', chandi: 'silver', sona: '21k' } },
      A.money('rate', 'Per gram', true),
    ],
    describe: l => `Set the ${l.metal} rate to ${l.rate} a gram.`,
    run: async (v, x) => {
      const key = RATE_KEYS[v.metal as string];
      const before = Number((x.s.settings as unknown as Record<string, number>)[key]) || 0;
      await x.s.updateSettings({ [key]: v.rate } as Partial<Settings>, { source: 'voice' });
      return { said: `${v.metal} is now ${rs(v.rate)} a gram.`, undo: () => x.s.updateSettings({ [key]: before } as Partial<Settings>, { source: 'voice undo' }) };
    },
  },
  {
    id: 'alerts', label: 'Switch WhatsApp alerts on or off',
    say: 'Turn a WhatsApp alert or report on or off.',
    args: [{ name: 'which', type: 'enum', label: 'Which', required: true, options: Object.keys(ALERTS) }, { name: 'on', type: 'bool', label: 'On or off', required: true }],
    describe: l => `Switch ${l.which} ${String(l.on).toLowerCase()}.`,
    run: async (v, x) => {
      const key = ALERTS[v.which as string];
      const before = !!(x.s.settings as unknown as Record<string, unknown>)[key];
      await x.s.updateSettings({ [key]: !!v.on } as Partial<Settings>);
      return { said: `${v.which} ${v.on ? 'on' : 'off'}.`, undo: () => x.s.updateSettings({ [key]: before } as Partial<Settings>) };
    },
  },

  // ── Orders ───────────────────────────────────────────────────────────────
  {
    id: 'new_order', label: 'New order', form: true,
    say: 'Take a new order: the customer, each piece (what, karat, weight, making, size, stones), advance and how paid, promised date, karigar, old gold given. Opens the order form filled in.',
    args: [
      A.customer(), { name: 'phone', type: 'phone', label: 'Phone' }, A.money('advance', 'Advance'), { ...A.method(), name: 'advance_method', label: 'Advance by' },
      A.money('discount', 'Discount'), A.date('promised', 'Promised for'), A.karigar('karigar', 'Karigar', false),
      A.text('exchange', 'Old gold given'), A.money('exchange_value', 'Old gold worth'), A.text('notes', 'Notes'),
    ],
    pieces: {
      start: A.text('piece', 'Piece', true),
      fields: [{ name: 'category', type: 'enum', label: 'Kind', options: ORDER_CATEGORIES }, A.karat(), A.grams(), A.money('making', 'Making'), A.text('size', 'Size'), A.text('stones', 'Stones'), A.money('price', 'Fixed price')],
    },
    describe: l => `Open a new order${l.customer ? ` for ${l.customer}` : ''} with ${(l.pieces ?? []).map(p => [p.piece, p.karat, p.weight].filter(Boolean).join(' ')).join('; ') || 'its pieces'}${l.advance ? `, ${l.advance} advance` : ''}${l.promised ? `, promised ${l.promised}` : ''} — check it and press Create.`,
    run: async (v, x) => {
      const who = v.customer as Who | null;
      const guess = (w: Who | null | undefined) => (w ? { heard: w.name, pinned: { ...w, score: 1, via: 'exact' as const }, candidates: [] } : null);
      const items: DraftItem[] = (v.pieces ?? []).map(p => ({
        description: p.piece, itemCategory: p.category ?? null, karat: p.karat ? parseInt(String(p.karat), 10) : null,
        weightG: p.weight ?? null, makingCharges: p.making ?? null, size: p.size ?? null, stoneDetails: p.stones ?? null, lineTotal: p.price ?? null,
      }));
      const draft: OrderDraft & { advanceMethod?: string } = {
        items, customer: guess(who), karigar: guess(v.karigar as Who | null),
        customerPhone: v.phone ?? null, advancePayment: v.advance ?? null, discount: v.discount ?? null,
        expectedDate: v.promised ?? null, notes: v.notes ?? null,
        exchange: v.exchange || v.exchange_value ? { description: v.exchange ?? null, value: v.exchange_value ?? null } : null,
        ...(v.advance_method ? { advanceMethod: v.advance_method } : {}),
      };
      x.handOff('order', draft);
      x.go('/orders/add?voice=1');
      return { said: 'The order is filled in. Check it and press Create.' };
    },
  },
  {
    id: 'order_discount', label: "Change an order's discount",
    say: 'Set the discount agreed on an order.', args: [A.order(true), A.money('amount', 'Discount', true)],
    describe: l => `Discount on ${l.order} to ${l.amount}.`,
    run: async (v, x) => {
      const o = v.order as Order;
      const exchange = Number(o.advanceInExchangeValue) || 0;
      const before = { discountAmount: o.discountAmount ?? 0, grandTotal: o.grandTotal };
      const grandTotal = o.subtotal - v.amount - (Number(o.advancePayment) || 0) - exchange;
      await x.s.updateOrder(o.id, { discountAmount: v.amount, grandTotal });
      return { said: `${o.id}: discount ${rs(v.amount)}, balance ${rs(grandTotal)}.`, href: `/orders/${o.id}`, undo: () => x.s.updateOrder(o.id, before) };
    },
  },
  {
    id: 'order_note', label: 'Add a note to an order',
    say: 'Write a note on an order.', args: [A.order(), A.text('note', 'Note', true)],
    describe: l => `Note on ${l.order}: "${l.note}".`,
    run: async (v, x) => {
      const o = v.order as Order;
      await x.s.updateOrder(o.id, { notes: [o.notes, v.note].filter(Boolean).join('\n') });
      return { said: `Noted on ${o.id}.`, href: `/orders/${o.id}`, undo: () => x.s.updateOrder(o.id, { notes: o.notes ?? '' }) };
    },
  },
  {
    id: 'order_assign', label: "Give an order's pieces to a karigar",
    say: "Assign an order's piece (or all its pieces) to a karigar.", args: [A.order(true), A.karigar(), A.piece()],
    describe: l => `Give ${pieceWord(l) || 'every piece of '}${l.order} to ${l.karigar}.`,
    run: async (v, x) => {
      const o = v.order as Order, k = v.karigar as Who;
      const idx = piecesOf(o.items, v.piece);
      const before = idx.map(i => o.items[i]?.karigarId ?? '');
      if (v.piece) await x.s.updateOrderItemKarigar(o.id, idx[0], k.id);
      else await x.s.assignOrderItemsToKarigar(o.id, k.id, false);
      return { said: `${o.id}: ${v.piece ? `piece ${v.piece}` : 'all pieces'} to ${k.name}.`, href: `/orders/${o.id}`,
        undo: async () => { for (const [n, i] of idx.entries()) await x.s.updateOrderItemKarigar(o.id, i, before[n]); } };
    },
  },
  {
    id: 'order_piece_done', label: "Mark an order's piece made",
    say: "A piece of an order is made (or all of them).", args: [A.order(true), A.piece()],
    describe: l => `Mark ${pieceWord(l) || 'every piece of '}${l.order} made.`,
    run: async (v, x) => {
      const o = v.order as Order;
      const idx = piecesOf(o.items, v.piece);
      for (const i of idx) await x.s.updateOrderItemStatus(o.id, i, true);
      return { said: `${o.id}: ${idx.length === 1 ? `piece ${idx[0] + 1}` : 'every piece'} made.`, href: `/orders/${o.id}`,
        undo: async () => { for (const i of idx) await x.s.updateOrderItemStatus(o.id, i, !!o.items[i]?.isCompleted); } };
    },
  },
  {
    id: 'order_piece_given', label: "Hand an order's piece to its karigar",
    say: "The gold/piece of an order physically went to the karigar today.", args: [A.order(true), A.piece()],
    describe: l => `Mark ${pieceWord(l) || 'every piece of '}${l.order} handed to the karigar.`,
    run: async (v, x) => {
      const o = v.order as Order;
      const idx = piecesOf(o.items, v.piece);
      for (const i of idx) await x.s.updateOrderItemGiven(o.id, i, x.now);
      return { said: `${o.id}: handed over.`, href: `/orders/${o.id}`,
        undo: async () => { for (const i of idx) await x.s.updateOrderItemGiven(o.id, i, o.items[i]?.givenAt ?? null); } };
    },
  },
  {
    id: 'order_piece_change', label: "Change a piece on an order",
    say: "Change a piece of an order: its size, weight, stones, description or note.",
    args: [A.order(true), { ...A.piece(), required: true }, A.text('size', 'Size'), A.grams(), A.text('stones', 'Stones'), A.text('description', 'Description'), A.text('note', 'Note')],
    describe: l => `Piece ${l.piece} of ${l.order}: ${[l.description && `"${l.description}"`, l.size && `size ${l.size}`, l.weight, l.stones && `stones ${l.stones}`, l.note && `note "${l.note}"`].filter(Boolean).join(', ')}.`,
    run: async (v, x) => {
      const o = v.order as Order;
      const [i] = piecesOf(o.items, v.piece);
      const it = o.items[i];
      const patch = { ...(v.size ? { size: v.size } : {}), ...(v.weight ? { estimatedWeightG: v.weight } : {}), ...(v.stones ? { stoneDetails: v.stones } : {}), ...(v.description ? { description: v.description } : {}), ...(v.note ? { adminNote: v.note } : {}) };
      if (!Object.keys(patch).length) throw new Error('Nothing to change on the piece.');
      await x.s.updateOrderItemDetails(o.id, i, patch);
      return { said: `${o.id}, piece ${i + 1} changed.`, href: `/orders/${o.id}`,
        undo: () => x.s.updateOrderItemDetails(o.id, i, { size: it.size ?? '', estimatedWeightG: it.estimatedWeightG, stoneDetails: it.stoneDetails ?? '', description: it.description, adminNote: it.adminNote ?? '' }) };
    },
  },
  {
    id: 'order_remove_piece', label: 'Take a piece off an order', danger: true,
    say: 'Remove a piece from an order.', args: [A.order(true), { ...A.piece(), required: true }],
    describe: l => `Remove piece ${l.piece} from ${l.order}.`,
    run: async (v, x) => { const o = v.order as Order; const [i] = piecesOf(o.items, v.piece); await x.s.removeItemFromOrder(o.id, i); return { said: `Piece ${i + 1} taken off ${o.id}.`, href: `/orders/${o.id}` }; },
  },
  {
    id: 'delete_advance', label: 'Delete an advance on an order', danger: true,
    say: 'Delete an advance recorded on an order (which one: 1 = first; default the latest).', args: [A.order(true), A.num('which', 'Which advance')],
    describe: l => `Delete ${l.which ? `advance ${l.which}` : 'the latest advance'} on ${l.order}.`,
    run: async (v, x) => {
      const o = v.order as Order;
      const lines = orderAdvancePayments(o, '');
      const i = v.which ? Number(v.which) - 1 : lines.length - 1;
      if (!lines[i]) throw new Error(`${o.id} has no advance ${i + 1}.`);
      await x.s.deleteOrderAdvance(o.id, i);
      return { said: `Advance of ${rs(lines[i].amount)} deleted from ${o.id}.`, href: `/orders/${o.id}` };
    },
  },
  {
    id: 'refund_order', label: 'Refund an order', danger: true,
    say: 'Refund an order (the customer gets the advance back).', args: [A.order()],
    describe: l => `Refund ${l.order}.`,
    run: async (v, x) => { const o = v.order as Order; await x.s.refundOrder(o.id); return { said: `${o.id} refunded.`, href: `/orders/${o.id}` }; },
  },
  {
    id: 'undo_invoice', label: 'Undo an invoice back to its order', danger: true,
    say: 'Take an invoiced order back to an open order (the invoice is removed).', args: [A.order()],
    describe: l => `Undo the invoice of ${l.order}, back to an open order.`,
    run: async (v, x) => {
      const o = v.order as Order;
      if (!o.invoiceId) throw new Error(`${o.id} has no invoice.`);
      await x.s.revertOrderFromInvoice(o.id, o.invoiceId);
      return { said: `${o.invoiceId} undone; ${o.id} is open again.`, href: `/orders/${o.id}` };
    },
  },
  {
    id: 'delete_order', label: 'Delete an order', danger: true,
    say: 'Delete an order entirely (one entered by mistake).', args: [A.order()],
    describe: l => `Delete ${l.order}.`,
    run: async (v, x) => { const o = v.order as Order; await x.s.deleteOrder(o.id); return { said: `${o.id} deleted.`, href: '/orders' }; },
  },

  // ── Sales and invoices ───────────────────────────────────────────────────
  {
    id: 'new_sale', label: 'New sale', form: true,
    say: 'Sell: pieces from stock by tag (sku) and/or pieces described (what, karat, weight, making, price), the customer, discount, what was paid and how. Opens the sale filled in.',
    args: [A.customer(), A.money('discount', 'Discount'), A.money('paid', 'Paid now'), A.method()],
    pieces: {
      start: A.text('piece', 'Piece', true),
      fields: [{ name: 'sku', type: 'product', label: 'From stock' }, { name: 'category', type: 'enum', label: 'Kind', options: ORDER_CATEGORIES }, A.karat(), A.grams(), A.money('making', 'Making'), A.text('stones', 'Stones'), A.money('price', 'Price')],
    },
    describe: l => `Open a sale${l.customer ? ` to ${l.customer}` : ''}: ${(l.pieces ?? []).map(p => p.sku || [p.piece, p.karat, p.weight, p.price].filter(Boolean).join(' ')).join('; ') || 'its pieces'}${l.paid ? `, ${l.paid} paid${l.method ? ` by ${l.method}` : ''}` : ''} — check it and press Create.`,
    run: async (v, x) => {
      const pieces = v.pieces ?? [];
      const payload = {
        customerId: (v.customer as Who | null)?.id ?? null,
        skus: pieces.filter(p => p.sku).map(p => (p.sku as Product).sku),
        // A price said is the piece's price as agreed (a fixed-price line); otherwise it is priced from the rate.
        lines: pieces.filter(p => !p.sku).map((p): BillLine => (p.price ? {
          description: p.piece, itemCategory: p.category ?? null, karat: p.karat ? parseInt(String(p.karat), 10) : null,
          lineTotal: p.price, note: [p.weight ? `${p.weight} g` : '', p.stones].filter(Boolean).join(', ') || null,
        } : {
          description: p.piece, itemCategory: p.category ?? null, karat: p.karat ? parseInt(String(p.karat), 10) : null,
          weightG: p.weight ?? null, makingCharges: p.making ?? null, note: p.stones ?? null,
        })),
        discount: v.discount ?? null, paid: v.paid ?? null, method: v.method ?? null,
      };
      x.handOff('sale', payload);
      x.go('/invoices/new?voice=1');
      return { said: 'The sale is filled in. Check it and press Create.' };
    },
  },
  {
    id: 'invoice_discount', label: "Change an invoice's discount",
    say: 'Change the discount on an invoice.', args: [A.invoice(), A.money('amount', 'Discount', true)],
    describe: l => `Discount on ${l.invoice} to ${l.amount}.`,
    run: async (v, x) => {
      const i = v.invoice as Invoice;
      const before = Number(i.discountAmount) || 0;
      const u = await x.s.updateInvoiceDiscount(i.id, v.amount);
      if (!u) throw new Error('The discount was not changed.');
      return { said: `${i.id}: discount ${rs(v.amount)}, balance ${rs(u.balanceDue)}.`, href: `/invoices/${i.id}`, undo: async () => { await x.s.updateInvoiceDiscount(i.id, before); } };
    },
  },
  {
    id: 'invoice_assign', label: "Give an invoice's pieces to a karigar",
    say: "Send a sold piece (resizing, a repair) to a karigar.", args: [A.invoice(), A.karigar(), A.piece()],
    describe: l => `Give ${pieceWord(l) || 'every piece of '}${l.invoice} to ${l.karigar}.`,
    run: async (v, x) => {
      const i = v.invoice as Invoice, k = v.karigar as Who;
      const idx = piecesOf(i.items, v.piece);
      const before = idx.map(n => i.items[n]?.karigarId ?? '');
      for (const n of idx) await x.s.updateInvoiceItemKarigar(i.id, n, k.id);
      return { said: `${i.id}: to ${k.name}.`, href: `/invoices/${i.id}`, undo: async () => { for (const [m, n] of idx.entries()) await x.s.updateInvoiceItemKarigar(i.id, n, before[m]); } };
    },
  },
  {
    id: 'invoice_piece_done', label: "Mark an invoice's bench work done",
    say: "The bench work on a sold piece is done.", args: [A.invoice(), A.piece()],
    describe: l => `Mark ${pieceWord(l) || 'every piece of '}${l.invoice} done.`,
    run: async (v, x) => {
      const i = v.invoice as Invoice;
      const idx = piecesOf(i.items, v.piece);
      for (const n of idx) await x.s.updateInvoiceItemStatus(i.id, n, true);
      return { said: `${i.id}: done.`, href: `/invoices/${i.id}`, undo: async () => { for (const n of idx) await x.s.updateInvoiceItemStatus(i.id, n, !!i.items[n]?.isCompleted); } };
    },
  },
  {
    id: 'refund_invoice', label: 'Refund on an invoice', danger: true,
    say: 'Give money back on an invoice (part or all).', args: [A.invoice(), A.money('amount', 'Refund', true), A.text('reason', 'Why')],
    describe: l => `Refund ${l.amount} on ${l.invoice}${l.reason ? ` — ${l.reason}` : ''}.`,
    run: async (v, x) => {
      const i = v.invoice as Invoice;
      const u = await x.s.refundInvoicePartial(i.id, v.amount, v.reason || 'Refund by voice');
      if (!u) throw new Error('The refund was not recorded.');
      return { said: `${rs(v.amount)} refunded on ${i.id}.`, href: `/invoices/${i.id}` };
    },
  },
  {
    id: 'delete_payment', label: 'Delete a payment on an invoice', danger: true,
    say: 'Delete a payment recorded on an invoice (which: 1 = first; default the latest).', args: [A.invoice(), A.num('which', 'Which payment')],
    describe: l => `Delete ${l.which ? `payment ${l.which}` : 'the latest payment'} on ${l.invoice}.`,
    run: async (v, x) => {
      const i = v.invoice as Invoice;
      const list = Array.isArray(i.paymentHistory) ? i.paymentHistory : [];
      const n = v.which ? Number(v.which) - 1 : list.length - 1;
      const p = list[n];
      if (!p) throw new Error(`${i.id} has no payment ${n + 1}.`);
      await x.s.deleteInvoicePayment(i.id, n, { amount: p.amount, date: p.date });
      return { said: `Payment of ${rs(p.amount)} deleted from ${i.id}.`, href: `/invoices/${i.id}` };
    },
  },
  {
    id: 'delete_invoice', label: 'Delete an invoice', danger: true,
    say: 'Delete an invoice (a duplicate, a mistake).', args: [A.invoice()],
    describe: l => `Delete ${l.invoice}.`,
    run: async (v, x) => { const i = v.invoice as Invoice; await x.s.deleteInvoice(i.id, false); return { said: `${i.id} deleted.`, href: '/invoices' }; },
  },

  // ── Repairs ──────────────────────────────────────────────────────────────
  {
    id: 'new_repair', label: 'New repair',
    say: 'Take a repair: the customer, each piece and the work on it (weight, price), promised date, advance, karigar.',
    args: [A.customer(), { name: 'phone', type: 'phone', label: 'Phone' }, A.date('promised', 'Promised for'), A.money('advance', 'Advance'), A.method(), A.karigar('karigar', 'Karigar', false)],
    pieces: { start: A.text('item', 'Piece', true), fields: [A.text('work', 'Work'), A.grams(), A.money('price', 'Price')] },
    describe: l => `New repair${l.customer ? ` for ${l.customer}` : ''}: ${(l.pieces ?? []).map(p => [p.item, p.work && `(${p.work})`, p.price].filter(Boolean).join(' ')).join('; ')}${l.advance ? `, ${l.advance} advance` : ''}${l.promised ? `, ready ${l.promised}` : ''}.`,
    run: async (v, x) => {
      const who = v.customer as Who | null, k = v.karigar as Who | null;
      const pieces = (v.pieces ?? []).map(p => ({ item: p.item, work: p.work ?? '', ...(p.weight ? { weightG: p.weight } : {}), ...(p.price ? { price: p.price } : {}) }));
      if (!pieces.length) throw new Error('Which piece is in for repair?');
      const r = await x.s.addRepair({
        customerId: who?.id, customerName: who?.name || 'Walk-in', customerContact: v.phone ?? undefined, pieces,
        receivedAt: x.now, promisedDate: v.promised ?? undefined, karigarId: k?.id, karigarName: k?.name,
        advance: v.advance ?? undefined, advanceMethod: (v.method ?? undefined) as PaymentType | undefined,
      });
      return { said: `${r.id} taken in.`, href: `/repairs?id=${r.id}`, made: { type: 'repair', value: r }, undo: () => x.s.deleteRepair(r.id) };
    },
  },
  {
    id: 'repair_status', label: "Change a repair's status",
    say: 'A repair is ready, collected, cancelled, or back in the shop.',
    args: [A.repair(false), { name: 'status', type: 'enum', label: 'Status', required: true, options: REPAIR_STATUS, synonyms: { taiyar: 'ready', ban: 'ready', done: 'ready', 'le gaye': 'collected', picked: 'collected', liya: 'collected', cancel: 'cancelled', wapas: 'received' } }],
    describe: l => `${l.repair} is ${l.status}.`,
    run: async (v, x) => {
      const r = v.repair as Repair;
      await x.s.setRepairStatus(r.id, v.status);
      return { said: `${r.id} is ${v.status}.`, href: `/repairs?id=${r.id}`, undo: () => x.s.setRepairStatus(r.id, r.status) };
    },
  },
  {
    id: 'repair_payment', label: 'Payment on a repair',
    say: 'Money taken for a repair.', args: [A.repair(), A.money('amount', 'Amount', true), A.method()],
    describe: l => `${l.amount}${l.method ? ` by ${l.method}` : ''} for ${l.repair}.`,
    run: async (v, x) => {
      const r = v.repair as Repair;
      await x.s.recordRepairPayment(r.id, { amount: v.amount, date: x.now, ...(v.method ? { method: v.method } : {}) });
      return { said: `${rs(v.amount)} taken for ${r.id}.`, href: `/repairs?id=${r.id}` };
    },
  },
  {
    id: 'delete_repair', label: 'Delete a repair', danger: true,
    say: 'Delete a repair ticket.', args: [A.repair(false)],
    describe: l => `Delete ${l.repair}.`,
    run: async (v, x) => { const r = v.repair as Repair; await x.s.deleteRepair(r.id); return { said: `${r.id} deleted.`, href: '/repairs' }; },
  },

  // ── Stock ────────────────────────────────────────────────────────────────
  {
    id: 'new_piece', label: 'New piece in stock', form: true,
    say: 'Add a piece to stock: what kind, karat, weight, making, wastage, stones, size. Opens the New piece form filled in.',
    args: [
      { name: 'category', type: 'enum', label: 'Kind', options: staticCategories.map(c => c.title) }, A.karat(), A.grams(), A.money('making', 'Making'),
      A.num('wastage', 'Wastage %'), A.text('stones', 'Stones'), A.money('stone_charges', 'Stone charges'), A.text('size', 'Size'), A.text('description', 'Description'), A.money('price', 'Fixed price'),
    ],
    describe: l => `Open a new piece: ${[l.category, l.karat, l.weight, l.making && `making ${l.making}`, l.price && `price ${l.price}`].filter(Boolean).join(', ') || 'blank'} — check it and press Save.`,
    run: async (v, x) => {
      const cat = staticCategories.find(c => c.title === v.category);
      const seed: Partial<Product> = {
        ...(cat ? { categoryId: cat.id } : {}), ...(v.karat ? { karat: v.karat } : {}), ...(v.weight ? { metalWeightG: v.weight } : {}),
        ...(v.making ? { makingCharges: v.making } : {}), ...(v.wastage != null ? { wastagePercentage: v.wastage } : {}),
        ...(v.stones ? { stoneDetails: v.stones } : {}), ...(v.stone_charges ? { stoneCharges: v.stone_charges } : {}),
        ...(v.size ? { size: v.size } : {}), ...(v.description ? { description: v.description } : {}),
        ...(v.price ? { isCustomPrice: true, customPrice: v.price } : {}),
      };
      x.handOff('piece', seed);
      x.go('/products/add?voice=1');
      return { said: 'The new piece is filled in. Check it and press Save.' };
    },
  },
  {
    id: 'piece_change', label: 'Change a piece in stock',
    say: "Change a stock piece's weight, making, wastage, size, description or fixed price.",
    args: [{ name: 'product', type: 'product', label: 'Piece', required: true }, A.grams(), A.money('making', 'Making'), A.num('wastage', 'Wastage %'), A.text('size', 'Size'), A.text('description', 'Description'), A.money('price', 'Fixed price')],
    describe: l => `${l.product}: ${[l.weight, l.making && `making ${l.making}`, l.wastage && `wastage ${l.wastage}%`, l.size && `size ${l.size}`, l.description && `"${l.description}"`, l.price && `price ${l.price}`].filter(Boolean).join(', ')}.`,
    run: async (v, x) => {
      const p = v.product as Product;
      const patch: Partial<Product> = {
        ...(v.weight ? { metalWeightG: v.weight } : {}), ...(v.making != null ? { makingCharges: v.making } : {}), ...(v.wastage != null ? { wastagePercentage: v.wastage } : {}),
        ...(v.size ? { size: v.size } : {}), ...(v.description ? { description: v.description } : {}), ...(v.price ? { isCustomPrice: true, customPrice: v.price } : {}),
      };
      if (!Object.keys(patch).length) throw new Error('Nothing to change on the piece.');
      const before = Object.fromEntries(Object.keys(patch).map(k => [k, (p as unknown as Record<string, unknown>)[k] ?? null])) as Partial<Product>;
      await x.s.updateProduct(p.sku, patch);
      return { said: `${p.sku} changed.`, href: `/products/${encodeURIComponent(p.sku)}`, undo: () => x.s.updateProduct(p.sku, before) };
    },
  },
  {
    id: 'delete_piece', label: 'Delete a piece from stock', danger: true,
    say: 'Delete a piece from stock.', args: [{ name: 'product', type: 'product', label: 'Piece', required: true }],
    describe: l => `Delete ${l.product} from stock.`,
    run: async (v, x) => { const p = v.product as Product; await x.s.deleteProduct(p.sku); return { said: `${p.sku} deleted.`, href: '/products' }; },
  },

  // ── The workshop ─────────────────────────────────────────────────────────
  {
    id: 'new_job', label: 'Give a karigar a job',
    say: 'Hand work to a karigar that is not on an order: what, karat, weight, quantity, size, agreed making.',
    args: [A.karigar(), A.text('description', 'What', true), A.text('category', 'Kind'), A.karat(), A.grams(), A.num('quantity', 'How many'), A.text('size', 'Size'), A.money('cost', 'Agreed making'), A.text('notes', 'Notes')],
    describe: l => `${l.karigar} to make ${[l.quantity, l.description, l.karat, l.weight].filter(Boolean).join(' ')}${l.cost ? ` for ${l.cost}` : ''}.`,
    run: async (v, x) => {
      const k = v.karigar as Who;
      const job = await x.s.addKarigarJob({
        karigarId: k.id, karigarName: k.name, description: v.description, status: 'pending', assignedDate: x.now,
        metalType: STORE_CONFIG.defaultMetal as KarigarJob['metalType'],
        ...(v.category ? { itemCategory: v.category } : {}), ...(v.karat ? { karat: v.karat } : {}), ...(v.weight ? { weightG: v.weight } : {}),
        ...(v.quantity ? { quantity: v.quantity } : {}), ...(v.size ? { size: v.size } : {}), ...(v.cost ? { agreedCost: v.cost } : {}), ...(v.notes ? { notes: v.notes } : {}),
      });
      if (!job) throw new Error('The job was not saved.');
      return { said: `Job given to ${k.name}.`, href: `/karigars/${k.id}`, made: { type: 'job', value: job }, undo: () => x.s.deleteKarigarJob(job.id) };
    },
  },
  {
    id: 'job_status', label: "Change a karigar job's status",
    say: 'A karigar job is started or done.',
    args: [{ name: 'job', type: 'job', label: 'Job', required: true }, { name: 'status', type: 'enum', label: 'Status', required: true, options: JOB_STATUS, synonyms: { done: 'completed', ready: 'completed', taiyar: 'completed', started: 'in-progress', shuru: 'in-progress', progress: 'in-progress' } }],
    describe: l => `${l.job}: ${l.status}.`,
    run: async (v, x) => { const j = v.job as KarigarJob; await x.s.setKarigarJobStatus(j.id, v.status); return { said: `${j.description}: ${v.status}.`, undo: () => x.s.setKarigarJobStatus(j.id, j.status) }; },
  },
  {
    id: 'job_given', label: 'Hand a job to its karigar',
    say: 'The metal for a karigar job physically went to him today.', args: [{ name: 'job', type: 'job', label: 'Job', required: true }],
    describe: l => `${l.job}: handed to the karigar.`,
    run: async (v, x) => { const j = v.job as KarigarJob; await x.s.setKarigarJobGiven(j.id, x.now); return { said: 'Handed over.', undo: () => x.s.setKarigarJobGiven(j.id, j.givenAt ?? null) }; },
  },
  {
    id: 'delete_job', label: 'Delete a karigar job', danger: true,
    say: 'Delete a karigar job.', args: [{ name: 'job', type: 'job', label: 'Job', required: true }],
    describe: l => `Delete the job "${l.job}".`,
    run: async (v, x) => { const j = v.job as KarigarJob; await x.s.deleteKarigarJob(j.id); return { said: 'Job deleted.' }; },
  },
  {
    id: 'silver_given', label: 'Silver to a karigar',
    say: 'Silver handed to a karigar, with the surcharge per gram.', args: [A.karigar(), A.grams('grams', 'Silver', true), A.money('surcharge', 'Surcharge a gram'), A.text('description', 'Note')],
    describe: l => `${l.grams} of silver to ${l.karigar}${l.surcharge ? ` at ${l.surcharge} a gram` : ''}.`,
    run: async (v, x) => {
      const k = v.karigar as Who;
      const sur = Number(v.surcharge) || 0;
      const t = await x.s.addSilverTransaction({ karigarId: k.id, karigarName: k.name, date: x.now, silverGrams: v.grams, surchargePerGram: sur, totalSurcharge: Math.round(v.grams * sur), ...(v.description ? { description: v.description } : {}) });
      if (!t) throw new Error('Not saved.');
      return { said: `${v.grams} g of silver to ${k.name}.`, href: `/karigars/${k.id}`, undo: () => x.s.deleteSilverTransaction(t.id) };
    },
  },

  // ── Given out, money, people ─────────────────────────────────────────────
  {
    id: 'give_item', label: 'Give something out',
    say: 'Something handed out to come back: a sample, a piece on approval. To a person in the book, or by name.',
    args: [A.person('person', 'To', false), A.text('to_name', 'To (not in the book)'), A.text('description', 'What', true), A.text('notes', 'Notes')],
    describe: l => `${l.description} given to ${l.person || l.to_name || '?'}.`,
    run: async (v, x) => {
      const p = v.person as Who | null;
      if (!p && !v.to_name) throw new Error('Given to whom?');
      const g = await x.s.addGivenItem({
        date: x.now, description: v.description, status: 'out',
        recipientType: p ? p.kind : 'other', recipientName: p?.name ?? v.to_name, ...(p ? { recipientId: p.id } : {}), ...(v.notes ? { notes: v.notes } : {}),
      } as Omit<GivenItem, 'id'>);
      if (!g) throw new Error('Not saved.');
      return { said: `${v.description} given to ${p?.name ?? v.to_name}.`, href: '/given', made: { type: 'given', value: g }, undo: () => x.s.deleteGivenItem(g.id) };
    },
  },
  {
    id: 'given_back', label: 'Something given out came back',
    say: 'Something given out has been returned.', args: [{ name: 'given', type: 'given', label: 'What', required: true }],
    describe: l => `${l.given} came back.`,
    run: async (v, x) => { const g = v.given as GivenItem; await x.s.markGivenItemReturned(g.id, x.now); return { said: `${g.description} back.`, href: '/given', undo: () => x.s.updateGivenItem(g.id, { status: 'out', returnedDate: undefined }) }; },
  },
  {
    id: 'delete_given', label: 'Delete a given-out record', danger: true,
    say: 'Delete a given-out record.', args: [{ name: 'given', type: 'given', label: 'What', required: true }],
    describe: l => `Delete "${l.given}".`,
    run: async (v, x) => { const g = v.given as GivenItem; await x.s.deleteGivenItem(g.id); return { said: 'Deleted.', href: '/given' }; },
  },
  {
    id: 'expense_with_category', label: 'Shop expense (with its category)',
    say: `A shop expense when a category is said or plain: ${EXPENSE_CATEGORIES.join(', ')}.`,
    args: [A.money('amount', 'Amount', true), A.text('description', 'For', true), { name: 'category', type: 'enum', label: 'Category', options: EXPENSE_CATEGORIES }],
    describe: l => `Expense of ${l.amount} — ${l.description}${l.category ? ` (${l.category})` : ''}.`,
    run: async (v, x) => {
      const e = await x.s.addExpense({ date: x.now, category: v.category || 'Other', description: v.description, amount: v.amount, paidBy: 'business' });
      if (!e) throw new Error('Not saved.');
      return { said: `${rs(v.amount)} expense.`, href: '/expenses', undo: () => x.s.deleteExpense(e.id) };
    },
  },
  {
    id: 'delete_expense', label: 'Delete an expense', danger: true,
    say: 'Delete an expense (by what it was for, or "last").', args: [{ name: 'expense', type: 'expense', label: 'Expense', required: true }],
    describe: l => `Delete the expense "${l.expense}".`,
    run: async (v, x) => { const e = v.expense as { id: string }; await x.s.deleteExpense(e.id); return { said: 'Expense deleted.', href: '/expenses' }; },
  },
  {
    id: 'delete_income', label: 'Delete other income', danger: true,
    say: 'Delete an other-income line (by what, or "last").', args: [{ name: 'income', type: 'income', label: 'Income', required: true }],
    describe: l => `Delete the income "${l.income}".`,
    run: async (v, x) => { const e = v.income as { id: string }; await x.s.deleteAdditionalRevenue(e.id); return { said: 'Income deleted.', href: '/additional-revenue' }; },
  },
  {
    id: 'delete_ledger_entry', label: "Delete someone's latest hisaab entry", danger: true,
    say: "Delete the latest entry on a person's khata/hisaab.", args: [A.person()],
    describe: l => `Delete ${l.person}'s latest hisaab entry.`,
    run: async (v, x) => {
      const p = v.person as Who;
      const latest = x.s.hisaabEntries.filter(h => h.entityId === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (!latest) throw new Error(`${p.name} has no hisaab entries.`);
      await x.s.deleteHisaabEntry(latest.id);
      return { said: `Deleted ${p.name}'s entry of ${String(latest.date).slice(0, 10)}.`, href: `/hisaab/${p.id}?type=${p.kind}` };
    },
  },
  {
    id: 'delete_customer', label: 'Delete a customer', danger: true,
    say: 'Remove a customer.', args: [A.customer('customer', 'Customer', true)],
    describe: l => `Delete the customer ${l.customer}.`,
    run: async (v, x) => { const c = v.customer as Who; await x.s.deleteCustomer(c.id); return { said: `${c.name} removed.`, href: '/customers', undo: () => x.s.restoreCustomer(c.id) }; },
  },
  {
    id: 'delete_karigar', label: 'Delete a karigar', danger: true,
    say: 'Remove a karigar.', args: [A.karigar()],
    describe: l => `Delete the karigar ${l.karigar}.`,
    run: async (v, x) => { const k = v.karigar as Who; await x.s.deleteKarigar(k.id); return { said: `${k.name} removed.`, href: '/karigars', undo: () => x.s.restoreKarigar(k.id) }; },
  },
  {
    id: 'merge_customers', label: 'Merge two customers', danger: true,
    say: 'Two records are one customer: keep one, fold the other into it.', args: [A.customer('keep', 'Keep', true), A.customer('remove', 'Fold in', true)],
    describe: l => `Merge ${l.remove} into ${l.keep}.`,
    run: async (v, x) => {
      const keep = v.keep as Who, rm = v.remove as Who;
      if (keep.id === rm.id) throw new Error('That is the same customer twice.');
      const r = await x.s.mergeCustomers(keep.id, rm.id);
      return { said: `${rm.name} merged into ${keep.name} (${r.updatedDocs} records moved).`, href: `/customers/${keep.id}` };
    },
  },
];

export const COMMAND = new Map(COMMANDS.map(c => [c.id, c]));

/** The catalogue as the model reads it: one command a line, its args after it (* required, [..] a piece list). */
export function commandLines(): string[] {
  const arg = (a: ArgSpec) => `${a.name}${a.required ? '*' : ''}:${a.type === 'enum' ? (a.options ?? []).join('/') : a.type}`;
  return COMMANDS.map(c => {
    const args = c.args.map(arg);
    if (c.pieces) args.push(`[${arg(c.pieces.start)} ${c.pieces.fields.map(arg).join(' ')}]...`);
    // Not "|": that is the step line's own separator, and the model copies what it reads.
    return `${c.id} — ${c.say} (${args.join(', ')})`;
  });
}

export type { Customer, Karigar };
