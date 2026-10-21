/**
 * Changing the books for an outside AI (scopes `write:shop` and `write:money`). Every tool here is one of the
 * app's own writes, run through the iPhone app's route code (app/api/app/write/run-op.ts) as the owner who
 * made the key: the same roles, the database lock, the request id that records a money change once, the
 * shared write (lib/writes/*), the activity log ("… · via <label>"), and the same follow-ups (the WhatsApp
 * alert, the Shopify sync), which the server runs here instead of the phone. So a sale or a payment an AI
 * takes is the app's own, to the rupee. Anything that deletes needs the house's delete code, checked by the
 * write exactly as for the app (decisions: Delete code). Server-only.
 */

import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runWriteOp } from '@/app/api/app/write/run-op';
import { adminDb } from '@/lib/firebase-admin';
import { loadRates } from '@/lib/website/config';
import { sendLiveAlert, type AlertRequest } from '@/lib/notifications/send-alert';
import { ORDER_STATUS_WORDS, PAYMENT_METHOD_WORDS } from '@/lib/voice/documents';
import { REPAIR_STATUSES } from '@/lib/repairs';
import { RATE_KEYS } from '@/lib/rates';
import { CUSTOMER_TEXT_FIELDS } from '@/lib/writes/people';
import { tool, ToolError, type AgentCtx, type AgentTool } from './registry';
import type { Scope } from './scopes';

const SHOP = ['write:shop'] as const;
const MONEY = ['write:money'] as const;

type FollowUp = { path: string; body: Record<string, unknown> };

/** The phone posts these after a write; for an AI the server does, waiting a little for them. */
export async function runFollowUps(list: FollowUp[], by: string, waitMs = 45_000): Promise<string[]> {
  const done: string[] = [];
  const one = async (f: FollowUp) => {
    try {
      if (f.path === '/api/notifications/alert') {
        const r = await sendLiveAlert(f.body as unknown as AlertRequest, by);
        done.push(`WhatsApp alert: ${r.status}`);
      } else if (f.path === '/api/shopify/sync/order' || f.path === '/api/shopify/sync/invoice') {
        const route = f.path.endsWith('order') ? await import('@/app/api/shopify/sync/order/route') : await import('@/app/api/shopify/sync/invoice/route');
        // The route's own handler, in this process, as the scheduler calls it (Bearer CRON_SECRET).
        const req = new NextRequest(`http://localhost${f.path}`, {
          method: 'POST', body: JSON.stringify(f.body),
          headers: { 'content-type': 'application/json', host: 'localhost', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        });
        const res = await route.POST(req);
        done.push(`Shopify: ${res.ok ? 'synced' : `not synced (${res.status})`}`);
      }
    } catch (e) {
      done.push(`${f.path}: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(list.map(one)), new Promise(r => { timer = setTimeout(r, waitMs); })]);
  if (timer) clearTimeout(timer);
  return done;
}

/** The app's request id for a change: the AI's own (so its retry is recorded once), else a new one. */
const requestId = (ctx: AgentCtx, given?: string) => `ai-${ctx.key.id}-${given ?? randomBytes(10).toString('hex')}`;

/** Run one of the app's writes as the key's owner, and answer what it answered. */
export async function write(ctx: AgentCtx, body: Record<string, unknown>): Promise<{ data: unknown; logged: boolean }> {
  let logged = false;
  const res = await runWriteOp({ email: ctx.key.email, role: ctx.key.role, via: `ai:${ctx.key.label}`, agent: ctx.key.label, onLog: () => { logged = true; } }, body);
  const out = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string; followUps?: FollowUp[] };
  if (!res.ok) throw new ToolError(String(out.error || `Not saved (${res.status}).`), res.status);
  const { followUps, ...rest } = out;
  const after = followUps?.length && !out.replayed ? await runFollowUps(followUps, `ai:${ctx.key.label}`) : [];
  return { data: { ...rest, ...(after.length ? { alsoDone: after } : {}) }, logged };
}

const REQUEST = z.string().regex(/^[A-Za-z0-9-]{4,40}$/).optional()
  .describe('Your own id for this change (letters, digits, dashes). Send the same one if you retry, so it is recorded once.');
const CODE = z.string().regex(/^\d{4,8}$/).describe('The shop’s delete code. Ask the owner for it each time; never guess or store it.');
const METHOD = z.enum(PAYMENT_METHOD_WORDS).optional().describe('How it was paid.');
const AMOUNT = z.number().positive().max(1e9).describe('Rupees, whole.');
const DAY = z.string().max(40).optional().describe('When (ISO date or time); default now.');

const customerFields = Object.fromEntries(CUSTOMER_TEXT_FIELDS.map(k => [k, z.string().max(500).optional()])) as Record<(typeof CUSTOMER_TEXT_FIELDS)[number], z.ZodOptional<z.ZodString>>;

const ran = async (ctx: AgentCtx, body: Record<string, unknown>) => {
  const r = await write(ctx, body);
  return { data: r.data, logged: r.logged };
};

export const WRITE_TOOLS: AgentTool[] = [
  // ── The shop ───────────────────────────────────────────────────────────────
  tool({
    name: 'add_customer', title: 'Add a customer', effect: 'write', scopes: [...SHOP],
    description: 'Add a customer to the book (find_customers first: don’t make a second record for someone already there).',
    input: z.object({ name: z.string().min(1).max(120), phone: z.string().max(40).optional(), email: z.string().max(120).optional(), address: z.string().max(300).optional() }),
    run: (a, ctx) => ran(ctx, { op: 'addCustomer', ...a }),
  }),
  tool({
    name: 'update_customer', title: 'Change a customer', effect: 'write', scopes: [...SHOP],
    description: 'Change a customer’s details: name, phones, email, address, city, country, sizes (ring, bangle, bracelet, chain), birthday, anniversary (YYYY-MM-DD), preference, notes. Only what you send changes.',
    input: z.object({ customerId: z.string().min(1).max(80), patch: z.object(customerFields).describe('The fields to change.') }),
    run: (a, ctx) => ran(ctx, { op: 'updateCustomer', customerId: a.customerId, patch: a.patch }),
  }),
  tool({
    name: 'set_order_status', title: 'Move an order on', effect: 'write', scopes: [...SHOP],
    description: 'Set an order’s status: Pending, In Progress, Completed or Cancelled (Completed sends the customer’s ready alert where the shop has it on). A refund is done by a person, from the order.',
    input: z.object({ orderId: z.string().min(1).max(80), status: z.enum(ORDER_STATUS_WORDS) }),
    run: (a, ctx) => ran(ctx, { op: 'setOrderStatus', orderId: a.orderId, status: a.status }),
  }),
  tool({
    name: 'add_repair', title: 'Take in a repair', effect: 'write', scopes: [...SHOP],
    description: 'Open a repair ticket of one or more pieces (what it is, the work). An advance taken with it also needs “Take money”.',
    needs: (a: { advance?: number }) => (a.advance && a.advance > 0 ? ['write:money' as Scope] : []),
    input: z.object({
      customerName: z.string().max(120).default(''), customerId: z.string().max(80).optional(), customerContact: z.string().max(40).optional(),
      pieces: z.array(z.object({ item: z.string().min(1).max(120), work: z.string().max(300).default(''), weightG: z.number().min(0).max(10_000).optional(), price: z.number().min(0).max(1e8).optional() })).min(1).max(20),
      promisedDate: z.string().max(40).optional(), takenBy: z.string().max(60).optional(), internalNote: z.string().max(500).optional(),
      advance: z.number().min(0).max(1e8).optional(), advanceMethod: METHOD, request_id: REQUEST,
    }),
    run: (a, ctx) => {
      const { request_id, ...repair } = a;
      return ran(ctx, { op: 'addRepair', repair, requestId: requestId(ctx, request_id) });
    },
  }),
  tool({
    name: 'set_repair_status', title: 'Move a repair on', effect: 'write', scopes: [...SHOP],
    description: 'Set a repair’s status: received (in the shop), ready, collected or cancelled.',
    input: z.object({ repairId: z.string().min(1).max(80), status: z.enum(REPAIR_STATUSES) }),
    run: (a, ctx) => ran(ctx, { op: 'setRepairStatus', repairId: a.repairId, status: a.status }),
  }),
  tool({
    name: 'add_given_item', title: 'Record something given out', effect: 'write', scopes: [...SHOP],
    description: 'Record something handed out — to a karigar, a customer or anyone else (Workshop › Given items).',
    input: z.object({
      description: z.string().min(1).max(300), recipientName: z.string().min(1).max(120), recipientType: z.enum(['karigar', 'customer', 'other']),
      recipientId: z.string().max(80).optional(), givenBy: z.string().max(60).optional().describe('Who at the shop gave it (one of the shop’s names).'), notes: z.string().max(500).optional(), date: DAY,
    }),
    run: (a, ctx) => ran(ctx, { op: 'addGivenItem', ...a }),
  }),
  tool({
    name: 'mark_given_returned', title: 'Mark a given item returned', effect: 'write', scopes: [...SHOP],
    description: 'Mark something given out as come back.',
    input: z.object({ id: z.string().min(1).max(80), returnedDate: DAY }),
    run: (a, ctx) => ran(ctx, { op: 'markGivenReturned', id: a.id, ...(a.returnedDate ? { returnedDate: a.returnedDate } : {}) }),
  }),
  tool({
    name: 'set_team_note', title: 'Pin the team note', effect: 'write', scopes: [...SHOP],
    description: 'Set the note pinned for the team on Home and the phones (at most 600 characters; "" clears it).',
    input: z.object({ text: z.string().max(600) }),
    run: (a, ctx) => ran(ctx, { op: 'updateSettings', patch: { teamNote: a.text } }),
  }),
  tool({
    name: 'delete_repair', title: 'Delete a repair', effect: 'write', scopes: [...SHOP],
    description: 'Delete a repair ticket. Needs the delete code.',
    input: z.object({ repairId: z.string().min(1).max(80), delete_code: CODE }),
    run: (a, ctx) => ran(ctx, { op: 'deleteRepair', repairId: a.repairId, deleteCode: a.delete_code }),
  }),
  tool({
    name: 'delete_given_item', title: 'Delete a given item', effect: 'write', scopes: [...SHOP],
    description: 'Delete a given-item record. Needs the delete code.',
    input: z.object({ id: z.string().min(1).max(80), delete_code: CODE }),
    run: (a, ctx) => ran(ctx, { op: 'deleteGivenItem', id: a.id, deleteCode: a.delete_code }),
  }),

  // ── Money ──────────────────────────────────────────────────────────────────
  tool({
    name: 'create_invoice', title: 'Make a sale', effect: 'write', scopes: [...MONEY],
    description: 'Sell pieces from stock (find_stock gives the SKUs) on a new invoice, priced at today’s rates exactly as the sale screen prices them; a piece already sold is refused. A customer by id, or a name and phone (a new name makes a new customer; none is a walk-in). Payments taken now go with it.',
    input: z.object({
      skus: z.array(z.string().min(1).max(80)).min(1).max(30),
      customer: z.object({ id: z.string().max(80).optional(), name: z.string().max(120).optional(), phone: z.string().max(40).optional() }).default({}),
      discount: z.number().min(0).max(1e9).default(0).describe('Rupees off the total.'),
      payments: z.array(z.object({ amount: AMOUNT, method: METHOD, reference: z.string().max(120).optional() })).max(6).default([]),
      takenBy: z.string().max(60).optional().describe('Who at the shop made the sale (one of the shop’s names).'),
      internal_note: z.string().max(500).optional(),
      request_id: REQUEST,
    }),
    run: async (a, ctx) => {
      const snaps = await Promise.all(a.skus.map(sku => adminDb.collection('products').doc(sku).get()));
      const missing = a.skus.filter((_, i) => !snaps[i].exists);
      if (missing.length) throw new ToolError(`Not in stock: ${missing.join(', ')}.`, 409);
      const { updatedAt: _u, ...rates } = await loadRates();
      return ran(ctx, {
        op: 'createInvoice', cart: snaps.map(s => ({ ...s.data(), sku: s.id })), customer: a.customer,
        rates, discountAmount: a.discount, payments: a.payments, takenBy: a.takenBy, internalNote: a.internal_note, requestId: requestId(ctx, a.request_id),
      });
    },
  }),
  tool({
    name: 'record_payment', title: 'Take a payment on an invoice', effect: 'write', scopes: [...MONEY],
    description: 'Record money paid on an invoice (more than is due becomes the customer’s credit, as at the counter).',
    input: z.object({ invoiceId: z.string().min(1).max(80), amount: AMOUNT, method: METHOD, reference: z.string().max(120).optional(), date: DAY, request_id: REQUEST }),
    run: (a, ctx) => ran(ctx, { op: 'recordPayment', invoiceId: a.invoiceId, amount: a.amount, method: a.method, reference: a.reference, date: a.date, requestId: requestId(ctx, a.request_id) }),
  }),
  tool({
    name: 'record_order_advance', title: 'Take an advance on an order', effect: 'write', scopes: [...MONEY],
    description: 'Record an advance paid on an order that is not invoiced yet.',
    input: z.object({ orderId: z.string().min(1).max(80), amount: AMOUNT, method: METHOD, notes: z.string().max(300).optional(), request_id: REQUEST }),
    run: (a, ctx) => ran(ctx, { op: 'recordOrderAdvance', orderId: a.orderId, amount: a.amount, method: a.method, notes: a.notes, requestId: requestId(ctx, a.request_id) }),
  }),
  tool({
    name: 'record_repair_payment', title: 'Take a payment on a repair', effect: 'write', scopes: [...MONEY],
    description: 'Record money paid on a repair (it goes to Extra revenue, as at the counter).',
    input: z.object({ repairId: z.string().min(1).max(80), amount: AMOUNT, method: METHOD, note: z.string().max(300).optional(), date: DAY, request_id: REQUEST }),
    run: (a, ctx) => ran(ctx, { op: 'recordRepairPayment', repairId: a.repairId, amount: a.amount, method: a.method, note: a.note, date: a.date, requestId: requestId(ctx, a.request_id) }),
  }),
  tool({
    name: 'add_expense', title: 'Record an expense', effect: 'write', scopes: [...MONEY],
    description: 'Record money paid out (Money › Expenses).',
    input: z.object({
      description: z.string().min(1).max(300), amount: AMOUNT, category: z.string().max(80).optional().describe('One of the shop’s expense categories (default Other).'),
      date: DAY, paidBy: z.enum(['business', 'ammar', 'mina']).optional().describe('Who paid it (default the business).'), request_id: REQUEST,
    }),
    run: (a, ctx) => ran(ctx, { op: 'addExpense', description: a.description, amount: a.amount, category: a.category, date: a.date, paidBy: a.paidBy, requestId: requestId(ctx, a.request_id) }),
  }),
  tool({
    name: 'set_rates', title: 'Set today’s rates', effect: 'write', scopes: [...MONEY],
    description: 'Set the rates per gram (any of: gold 24k, 22k, 21k, 18k; palladium; platinum; silver). Every sale and the website price from them, so only figures the owner gave you.',
    input: z.object({ rates: z.object(Object.fromEntries(RATE_KEYS.map(k => [k, z.number().positive().max(1e7).optional()])) as Record<(typeof RATE_KEYS)[number], z.ZodOptional<z.ZodNumber>>) }),
    run: (a, ctx) => {
      if (!Object.values(a.rates).some(v => typeof v === 'number')) throw new ToolError('Give at least one rate.');
      return ran(ctx, { op: 'setRates', rates: a.rates });
    },
  }),
  tool({
    name: 'delete_invoice_payment', title: 'Delete a payment', effect: 'write', scopes: [...MONEY],
    description: 'Take one payment off an invoice (get_invoice gives its index, amount and date). Needs the delete code.',
    input: z.object({ invoiceId: z.string().min(1).max(80), index: z.number().int().min(0).max(500), amount: z.number().min(0), paymentDate: z.string().min(1).max(64), delete_code: CODE }),
    run: (a, ctx) => ran(ctx, { op: 'deleteInvoicePayment', invoiceId: a.invoiceId, index: a.index, amount: a.amount, paymentDate: a.paymentDate, deleteCode: a.delete_code }),
  }),
  tool({
    name: 'delete_order_advance', title: 'Delete an advance', effect: 'write', scopes: [...MONEY],
    description: 'Take one advance off an open order (get_order gives its lineIndex and amount). Needs the delete code.',
    input: z.object({ orderId: z.string().min(1).max(80), lineIndex: z.number().int().min(0).max(500), amount: z.number().min(0), delete_code: CODE }),
    run: (a, ctx) => ran(ctx, { op: 'deleteOrderAdvance', orderId: a.orderId, lineIndex: a.lineIndex, amount: a.amount, deleteCode: a.delete_code }),
  }),
  tool({
    name: 'delete_invoice', title: 'Delete an invoice', effect: 'write', scopes: [...MONEY],
    description: 'Delete an invoice: its pieces go back to stock and its ledger rows go, as the invoice page’s Delete. Needs the delete code.',
    input: z.object({ invoiceId: z.string().min(1).max(80), delete_code: CODE }),
    run: (a, ctx) => ran(ctx, { op: 'deleteInvoice', invoiceId: a.invoiceId, deleteCode: a.delete_code }),
  }),
];
