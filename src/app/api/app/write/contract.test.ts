/**
 * The phone's money against the ERP's (apps/iphone/Packages/Contract).
 *
 * apps/iphone/contract/cases.json is written by the app's own New order and New sale code: for each case,
 * what the screen showed and what it sent. Here each payload goes through /api/app/write as the phone
 * sends it, and what the ERP saves must be what the phone showed:
 * - an order's totals are stored as sent, so they must be the web form's own (lib/order-estimate.ts);
 * - a sale is priced again by the ERP, so its saved figures must equal the ones on the phone.
 * All made-up data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderEstimate, pricedOrderItems, type OrderFormItem } from '@/lib/order-estimate';
import { NextRequest } from 'next/server';
import type { DbPort, TxCtx } from '@/lib/db-port';

// The same in-memory database as route.test.ts, behind both the Admin SDK and the port.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id?: string) => {
        const key = id ?? `auto${++ids}`;
        return {
          id: key,
          get: async () => ({ exists: !!col(c)[key], data: () => col(c)[key] }),
          set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => put(c, key, d, o?.merge),
          // Firestore's create: refused (ALREADY_EXISTS, code 6) when the document is there.
          create: async (d: Record<string, unknown>) => { if (col(c)[key]) throw Object.assign(new Error('exists'), { code: 6 }); put(c, key, d); },
          delete: async () => { delete col(c)[key]; },
        };
      },
      add: async (d: Record<string, unknown>) => { const id = `auto${++ids}`; put(c, id, d); return { id }; },
      get: async () => ({ docs: Object.entries(col(c)).map(([id, d]) => ({ id, data: () => d })) }),
      select: () => ({ get: async () => ({ docs: Object.keys(col(c)).map((id) => ({ id, data: () => ({}) })) }) }),
    }),
  },
}));

const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { const id = `auto${++ids}`; put(c, id, d); return id; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId() { return `auto${++ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));
vi.mock('@/lib/people', () => ({ personFor: () => undefined }));

const { POST } = await import('./route');

const call = async (body: unknown, email: string | null = 'owner@example.com') => {
  const res = await POST(new NextRequest('https://erp.example.com/api/app/write', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> & { followUps?: { path: string; body: Record<string, unknown> }[] } };
};


type Case = {
  name: string; house: string;
  send: Record<string, unknown>;
  shown: Record<string, number>;
  settings: Record<string, unknown>;
  stock: Record<string, Record<string, unknown>>;
  customers: Record<string, unknown>[];
};
const file = path.join(process.cwd(), 'apps/iphone/contract/cases.json');
const cases = JSON.parse(fs.readFileSync(file, 'utf8')) as { orders: Case[]; sales: Case[] };

const money = (v: unknown) => Number(v) || 0;
const seed = (c: Case) => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  put('app_settings', 'global', { lastInvoiceNumber: 0, lastOrderNumber: 0, ...c.settings });
  for (const [sku, p] of Object.entries(c.stock || {})) put('products', sku, p);
  for (const cu of c.customers || []) put('customers', String(cu.id), cu);
};

describe('the contract holds cases for both houses', () => {
  it('has orders and sales from Taheri and from House of Mina', () => {
    for (const list of [cases.orders, cases.sales]) {
      expect(list.some((c) => c.house === 'taheri')).toBe(true);
      expect(list.some((c) => c.house === 'mina')).toBe(true);
    }
  });
});

describe.each(cases.orders.map((c) => [`${c.house}: ${c.name}`, c] as const))('order %s', (_n, c) => {
  beforeEach(() => seed(c));

  it('is saved with the totals the web form would have worked out, which are the ones the phone showed', async () => {
    const sent = c.send.order as Record<string, unknown> & { items: OrderFormItem[]; ratesApplied: Record<string, number> };
    const web = orderEstimate({
      items: sent.items, discountAmount: money(sent.discountAmount), advancePayment: money(sent.advancePayment),
      advanceInExchangeValue: money(sent.advanceInExchangeValue), costRate24k: money(sent.costRate24k),
    }, sent.ratesApplied);
    // What the phone showed is the web's figure.
    expect(c.shown.subtotal).toBeCloseTo(web.subtotal, 2);
    expect(c.shown.discount).toBeCloseTo(web.discount, 2);
    expect(c.shown.grandTotal).toBeCloseTo(web.grandTotal, 2);
    // Each piece as the web saves it.
    const pieces = pricedOrderItems(sent.items, sent.ratesApplied);
    sent.items.forEach((it, i) => {
      expect(money(it.totalEstimate)).toBeCloseTo(money(pieces[i].totalEstimate), 2);
      expect(money(it.metalCost)).toBeCloseTo(money(pieces[i].metalCost), 2);
      expect(money(it.wastageCost)).toBeCloseTo(money(pieces[i].wastageCost), 2);
      expect('karat' in it && it.karat !== undefined).toBe('karat' in pieces[i] && pieces[i].karat !== undefined);
    });

    const r = await call({ op: 'createOrder', ...c.send });
    expect(r.status, String(r.body.error)).toBe(200);
    const id = (r.body.order as { id: string }).id;
    const saved = data.orders[id];
    expect(money(saved.subtotal)).toBeCloseTo(web.subtotal, 2);
    expect(money(saved.discountAmount)).toBeCloseTo(web.discount, 2);
    expect(money(saved.grandTotal)).toBeCloseTo(web.grandTotal, 2);
    expect((saved.items as unknown[]).length).toBe(sent.items.length);
  });
});

describe.each(cases.sales.map((c) => [`${c.house}: ${c.name}`, c] as const))('sale %s', (_n, c) => {
  beforeEach(() => seed(c));

  it('is saved, priced again by the ERP, at the figures the phone showed', async () => {
    const r = await call({ op: 'createInvoice', ...c.send });
    expect(r.status, String(r.body.error)).toBe(200);
    const inv = r.body.invoice as Record<string, unknown>;
    expect(money(inv.subtotal)).toBeCloseTo(c.shown.subtotal, 2);
    expect(money(inv.discountAmount)).toBeCloseTo(c.shown.discount, 2);
    expect(money(inv.grandTotal)).toBeCloseTo(c.shown.grandTotal, 2);
    expect(money(inv.amountPaid)).toBeCloseTo(c.shown.paid, 2);
    expect(money(inv.balanceDue)).toBeCloseTo(c.shown.balanceDue, 2);
    // The books carry exactly what is still owed on it (or held as credit), nothing more.
    const rows = Object.values(data.hisaab || {}).filter((h) => h.linkedInvoiceId === inv.id);
    const booked = rows.reduce((s, h) => s + money(h.cashDebit) - money(h.cashCredit), 0);
    // Paise over (a "paid in full" rounded up) are not held as credit: under half a rupee is settled
    // (lib/invoice-credit inCredit), so nothing is booked for it.
    const settledPaise = c.shown.balanceDue < 0 && c.shown.balanceDue >= -0.5;
    expect(booked).toBeCloseTo(settledPaise ? 0 : c.shown.balanceDue, 2);
    // Every piece from stock is sold, once.
    for (const sku of Object.keys(c.stock || {})) {
      expect(data.products?.[sku]).toBeUndefined();
      expect(data.sold_products?.[sku]).toBeDefined();
    }
  });
});
