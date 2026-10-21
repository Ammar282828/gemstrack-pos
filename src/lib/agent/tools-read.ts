/**
 * Reading the books for an outside AI (scope `read`): every figure is the ERP's own, worked out by the same
 * functions the screens and the reports use — the widget's figures (widget/server.ts), Today's cash
 * (analytics/todays-cash.ts), what is owed (owed.ts, hisaab included), the monthly report's Analytics rules
 * (reports/monthly.ts), order timing (order-timing.ts), the stock's price at today's rates (pricing.ts).
 * Rows come whole from Firestore through the Admin SDK, as the reports read them. Server-only.
 */

import { z } from 'zod';
import type { Customer, Invoice, Order, Product, Repair, AdditionalRevenue, Expense } from '@/lib/store';
import { rows } from '@/lib/notifications/reports';
import { currentWidgetSummary } from '@/lib/widget/server';
import { todaysCash } from '@/lib/analytics/todays-cash';
import { owedToYou, type LedgerRow } from '@/lib/owed';
import { buildMonthlyReport, karachiMonth, parseMonth } from '@/lib/reports/monthly';
import { orderTiming } from '@/lib/order-timing';
import { orderAdvancePayments } from '@/lib/order-payment';
import { _calculateProductCostsInternal } from '@/lib/pricing';
import { loadRates } from '@/lib/website/config';
import { REPAIR_STATUSES } from '@/lib/repairs';
import { ORDER_STATUSES } from '@/lib/writes/order-status';
import { STORE_CONFIG } from '@/lib/store-config';
import { tool, ToolError, type AgentTool } from './registry';

const READ = ['read'] as const;
const KARACHI_MS = 5 * 3_600_000;

type Row = Record<string, unknown> & { id: string };
const load = <T,>(name: string) => rows(name) as unknown as Promise<(T & Row)[]>;

const has = (hay: unknown[], q: string | undefined) => {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = hay.map(v => String(v ?? '')).join(' ').toLowerCase();
  return words.every(w => text.includes(w) || text.replace(/\D/g, '').includes(w.replace(/\D/g, '') || '\u0000'));
};
const lim = (n: number | undefined, d = 20) => Math.min(100, Math.max(1, n ?? d));
const newest = (a: { createdAt?: string }, b: { createdAt?: string }) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));

const liveCustomers = async () => (await load<Customer>('customers')).filter(c => !c.deletedAt);

const invoiceRow = (i: Invoice) => ({
  id: i.id, date: i.createdAt, customer: i.customerName || 'Walk-in', customerId: i.customerId ?? null,
  total: i.grandTotal, paid: i.amountPaid, due: i.balanceDue, status: i.status ?? 'Active', pieces: (Array.isArray(i.items) ? i.items : Object.values(i.items ?? {})).length,
  takenBy: i.takenBy ?? null, fromOrder: i.sourceOrderId ?? null,
});

const orderRow = (o: Order, now: Date) => ({
  id: o.id, date: o.createdAt, customer: o.customerName || 'Walk-in', customerId: o.customerId ?? null, status: o.status,
  promised: o.promisedDate ?? null, timing: orderTiming(o, new Date(now.getTime() + KARACHI_MS)).state,
  estimate: o.grandTotal, advance: orderAdvancePayments(o).reduce((s, p) => s + p.amount, 0),
  pieces: (o.items ?? []).map(it => it.description).filter(Boolean).slice(0, 6), invoice: o.invoiceId ?? null, takenBy: o.takenBy ?? null,
});

export const READ_TOOLS: AgentTool[] = [
  tool({
    name: 'shop_summary', title: 'The day at a glance', effect: 'read', scopes: [...READ],
    description: 'The figures on the ERP’s Home and the phone widget: made today, this month, today’s gold (or silver) rate, the drawer, what is owed, orders and repairs due — and the team note.',
    input: z.object({}),
    run: async () => ({ data: await currentWidgetSummary() }),
  }),
  tool({
    name: 'todays_cash', title: 'Today’s cash', effect: 'read', scopes: [...READ],
    description: 'Today’s cash (Karachi day), as Home › Today’s cash shows it: every payment, advance and repair payment in, by method, expenses paid out, and the drawer.',
    input: z.object({}),
    run: async () => {
      const [invoices, orders, repairs, extraRevenues, expenses] = await Promise.all([
        load<Invoice>('invoices'), load<Order>('orders'), load<Repair>('repairs'), load<AdditionalRevenue>('additional_revenue'), load<Expense>('expenses'),
      ]);
      return { data: todaysCash({ invoices, orders, repairs, extraRevenues, expenses }) };
    },
  }),
  tool({
    name: 'whats_owed', title: 'What is owed', effect: 'read', scopes: [...READ],
    description: 'What customers owe the shop, as the dashboard’s Owed to you works it out (invoices with a balance, walk-ins and the hisaab’s hand-written balances): the total, who owes most, and the oldest unpaid invoices.',
    input: z.object({ limit: z.number().int().min(1).max(100).optional().describe('How many people and invoices (default 15).') }),
    run: async a => {
      const [invoices, customers, hisaab] = await Promise.all([load<Invoice>('invoices'), liveCustomers(), load<LedgerRow>('hisaab')]);
      const names = new Map(customers.map(c => [c.id, c.name]));
      const o = owedToYou(invoices, id => names.get(id), hisaab);
      const n = lim(a.limit, 15);
      return {
        data: {
          total: o.total, walkIn: o.walkIn, fromHisaab: o.ledger, unreadable: o.bad,
          byCustomer: [...o.byKey.entries()].sort((x, y) => y[1].amount - x[1].amount).slice(0, n)
            .map(([k, v]) => ({ customer: k.startsWith('name:') ? k.slice(5) : names.get(k) ?? k, customerId: names.has(k) ? k : null, amount: v.amount, invoices: v.count })),
          oldestInvoices: o.invoices.slice(0, n).map(invoiceRow),
        },
      };
    },
  }),
  tool({
    name: 'find_orders', title: 'Find orders', effect: 'read', scopes: [...READ],
    description: 'Orders, newest first: by words (customer, phone, piece, order number), status, or only those not yet invoiced. Each with its promised date and whether it is late.',
    input: z.object({
      query: z.string().max(120).optional(),
      status: z.enum(ORDER_STATUSES).optional(),
      open_only: z.boolean().optional().describe('Only orders not yet invoiced, cancelled or refunded.'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async a => {
      const now = new Date();
      const list = (await load<Order>('orders'))
        .filter(o => (!a.status || o.status === a.status) && (!a.open_only || (!o.invoiceId && o.status !== 'Cancelled' && o.status !== 'Refunded')))
        .filter(o => has([o.id, o.customerName, o.customerContact, o.notes, ...(o.items ?? []).map(i => i.description)], a.query))
        .sort(newest).slice(0, lim(a.limit));
      return { data: list.map(o => orderRow(o, now)) };
    },
  }),
  tool({
    name: 'get_order', title: 'An order', effect: 'read', scopes: [...READ],
    description: 'One order in full: its pieces (with karigar and whether each is done or given), estimate, advances, notes and its invoice.',
    input: z.object({ orderId: z.string().min(1).max(80) }),
    run: async a => {
      const o = (await load<Order>('orders')).find(x => x.id === a.orderId);
      if (!o) throw new ToolError(`No order ${a.orderId}.`, 404);
      const items = (o.items ?? []).map((it, index) => {
        const { sampleImageDataUri: _p, ...rest } = it as typeof it & { sampleImageDataUri?: string };
        return { index, ...rest };
      });
      return { data: { ...orderRow(o, new Date()), items, advances: orderAdvancePayments(o).map((p, lineIndex) => ({ lineIndex, ...p })), notes: o.notes ?? '', delivery: o.delivery ?? null } };
    },
  }),
  tool({
    name: 'find_invoices', title: 'Find invoices', effect: 'read', scopes: [...READ],
    description: 'Invoices, newest first: by words (customer, phone, invoice number, piece), a customer, only unpaid ones, or a date range (YYYY-MM-DD).',
    input: z.object({
      query: z.string().max(120).optional(),
      customerId: z.string().max(80).optional(),
      unpaid_only: z.boolean().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async a => {
      const from = a.from ? Date.parse(`${a.from}T00:00:00+05:00`) : -Infinity;
      const to = a.to ? Date.parse(`${a.to}T23:59:59+05:00`) : Infinity;
      const list = (await load<Invoice>('invoices'))
        .filter(i => (!a.customerId || i.customerId === a.customerId) && (!a.unpaid_only || (Number(i.balanceDue) >= 1 && i.status !== 'Refunded')))
        .filter(i => { const t = Date.parse(i.createdAt); return t >= from && t <= to; })
        .filter(i => has([i.id, i.customerName, i.customerContact, ...(Array.isArray(i.items) ? i.items : []).map(x => `${x.name} ${x.sku}`)], a.query))
        .sort(newest).slice(0, lim(a.limit));
      return { data: list.map(invoiceRow) };
    },
  }),
  tool({
    name: 'get_invoice', title: 'An invoice', effect: 'read', scopes: [...READ],
    description: 'One invoice in full: its pieces and prices, discount, exchanges, payments (each with its index and date, which delete_invoice_payment needs) and what is due.',
    input: z.object({ invoiceId: z.string().min(1).max(80) }),
    run: async a => {
      const i = (await load<Invoice>('invoices')).find(x => x.id === a.invoiceId);
      if (!i) throw new ToolError(`No invoice ${a.invoiceId}.`, 404);
      // The customer's link key stays out; everything else is the owner's own record.
      const { shareToken: _t, ...rest } = i as Invoice & Row;
      return { data: { ...rest, paymentHistory: (i.paymentHistory ?? []).map((p, index) => ({ index, ...p })) } };
    },
  }),
  tool({
    name: 'find_customers', title: 'Find customers', effect: 'read', scopes: [...READ],
    description: 'Customers by name or phone, with what each owes on invoices.',
    input: z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(50).optional() }),
    run: async a => {
      const [customers, invoices] = await Promise.all([liveCustomers(), load<Invoice>('invoices')]);
      const owed = new Map<string, number>();
      for (const i of invoices) if (i.customerId && i.status !== 'Refunded' && Number(i.balanceDue) > 0) owed.set(i.customerId, (owed.get(i.customerId) ?? 0) + Number(i.balanceDue));
      return { data: customers.filter(c => has([c.name, c.phone, c.altPhone, c.email, c.city], a.query)).slice(0, lim(a.limit, 15)).map(c => ({ id: c.id, name: c.name, phone: c.phone ?? '', city: c.city ?? '', owes: owed.get(c.id) ?? 0 })) };
    },
  }),
  tool({
    name: 'get_customer', title: 'A customer', effect: 'read', scopes: [...READ],
    description: 'One customer: their details and sizes, their invoices and orders, and what they owe.',
    input: z.object({ customerId: z.string().min(1).max(80) }),
    run: async a => {
      const [customers, invoices, orders] = await Promise.all([liveCustomers(), load<Invoice>('invoices'), load<Order>('orders')]);
      const c = customers.find(x => x.id === a.customerId);
      if (!c) throw new ToolError(`No customer ${a.customerId}.`, 404);
      const theirs = invoices.filter(i => i.customerId === c.id).sort(newest);
      const now = new Date();
      return {
        data: {
          customer: c,
          owes: theirs.filter(i => i.status !== 'Refunded').reduce((s, i) => s + Math.max(0, Number(i.balanceDue) || 0), 0),
          invoices: theirs.slice(0, 30).map(invoiceRow),
          orders: orders.filter(o => o.customerId === c.id).sort(newest).slice(0, 30).map(o => orderRow(o, now)),
        },
      };
    },
  }),
  tool({
    name: 'find_repairs', title: 'Find repairs', effect: 'read', scopes: [...READ],
    description: 'Repair tickets, newest first: by words or status (received = in the shop, ready, collected, cancelled).',
    input: z.object({ query: z.string().max(120).optional(), status: z.enum(REPAIR_STATUSES).optional(), limit: z.number().int().min(1).max(100).optional() }),
    run: async a => {
      const list = (await load<Repair>('repairs')).filter(r => (!a.status || r.status === a.status) && has([r.id, r.customerName, r.customerContact, ...(r.pieces ?? []).map(p => JSON.stringify(p))], a.query))
        .sort((x, y) => String(y.receivedAt ?? '').localeCompare(String(x.receivedAt ?? ''))).slice(0, lim(a.limit));
      return { data: list.map(r => ({ id: r.id, customer: r.customerName, status: r.status, received: r.receivedAt, promised: r.promisedDate ?? null, pieces: r.pieces, payments: r.payments ?? [], karigar: r.karigarName ?? null })) };
    },
  }),
  tool({
    name: 'find_stock', title: 'Find stock', effect: 'read', scopes: [...READ],
    description: 'Pieces in stock (not sold), by words (name, SKU, karat, stones), each with its weight and its price at today’s rates as the sale screen works it out.',
    input: z.object({ query: z.string().max(120).optional(), limit: z.number().int().min(1).max(100).optional() }),
    run: async a => {
      const [products, rates] = await Promise.all([load<Product>('products'), loadRates()]);
      const { updatedAt: _u, ...r } = rates;
      const list = products.filter(p => has([p.sku, p.name, p.karat, p.metalType, p.stoneDetails, p.diamondDetails, p.description], a.query)).slice(0, lim(a.limit));
      return {
        data: list.map(p => {
          let price: number | null = null;
          try { price = Math.round(_calculateProductCostsInternal(p, r as never).totalPrice); } catch { /* left out */ }
          return { sku: p.sku, name: p.name, metal: p.metalType, karat: p.karat ?? null, weightG: p.metalWeightG, stones: p.stoneDetails ?? null, diamonds: p.diamondDetails ?? null, priceToday: price };
        }),
      };
    },
  }),
  tool({
    name: 'gold_rates', title: 'Today’s rates', effect: 'read', scopes: [...READ],
    description: 'The rates set in the ERP (per gram: gold by karat, palladium, platinum, silver) and when they were last set.',
    input: z.object({}),
    run: async () => ({ data: { ...(await loadRates()), metal: STORE_CONFIG.defaultMetal } }),
  }),
  tool({
    name: 'month_summary', title: 'A month’s figures', effect: 'read', scopes: [...READ],
    description: 'A month by Analytics’ own rules (the Monthly PDF’s): revenue (jewellery, open orders, other income), cash in by method, expenses, net, what is owed, metal sold, against the month before. Default: this month so far.',
    input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM (default this month).') }),
    run: async a => {
      const month = a.month ? parseMonth(a.month) : karachiMonth(new Date());
      if (!month) throw new ToolError('month is YYYY-MM.');
      const [invoices, orders, expenses, extraRevenues] = await Promise.all([load<Invoice>('invoices'), load<Order>('orders'), load<Expense>('expenses'), load<AdditionalRevenue>('additional_revenue')]);
      const r = buildMonthlyReport({ invoices, orders, expenses, extraRevenues }, month);
      const { sales, openOrders, payments, income, expenseRows, ...figures } = r;
      return { data: { ...figures, biggestSales: [...sales].filter(x => !x.refunded).sort((x, y) => y.value - x.value).slice(0, 10), openOrders: openOrders.length, payments: payments.length, otherIncome: income.length, expenseLines: expenseRows.length } };
    },
  }),
];
