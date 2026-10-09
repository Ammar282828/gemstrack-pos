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
import { INPUT_TO_RATE, type RateInputKey } from '@/lib/rates';
import { summarizeOrder, summarizeSale } from '@/lib/work-drafts';
import { KARAT_VALUES as karatValues, METAL_TYPES as metalTypeValues } from '@/lib/materials';
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
  /** The same work as a draft in Drafts, in the web form's own shape (NewOrderWebDraft, SaleWebDraft). */
  draft: Record<string, unknown>;
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

// A draft begun on the phone is finished at the counter in the web's own form (decisions.md "Drafts"): opened
// there, it must price exactly as the phone showed it, from the form's own fields.
describe.each(cases.orders.map((c) => [`${c.house}: ${c.name}`, c] as const))('order draft %s', (_n, c) => {
  it('opens in the order form at the figures the phone showed', () => {
    const d = c.draft as Record<string, unknown> & { items: OrderFormItem[] };
    const s = c.settings;
    // order-form.tsx `ratesForOrder`: the form's rate boxes, and the shop's flat palladium, platinum and silver.
    const rates = {
      goldRatePerGram18k: money(d.goldRate18k), goldRatePerGram21k: money(d.goldRate21k),
      goldRatePerGram22k: money(d.goldRate22k), goldRatePerGram24k: money(d.goldRate24k),
      palladiumRatePerGram: money(s.palladiumRatePerGram),
      palladiumRatePerGram18k: money(d.palladiumRate18k), palladiumRatePerGram12k: money(d.palladiumRate12k),
      platinumRatePerGram: money(s.platinumRatePerGram), silverRatePerGram: money(s.silverRatePerGram),
    };
    const web = orderEstimate({
      items: d.items, discountAmount: money(d.discountAmount), advancePayment: money(d.advancePayment),
      advanceInExchangeValue: money(d.advanceInExchangeValue), costRate24k: money(d.costRate24k),
    }, rates);
    expect(web.subtotal).toBeCloseTo(c.shown.subtotal, 2);
    expect(web.discount).toBeCloseTo(c.shown.discount, 2);
    expect(web.grandTotal).toBeCloseTo(c.shown.grandTotal, 2);
    // The form's own fields, of the form's own kinds.
    for (const it of d.items) {
      expect(metalTypeValues).toContain(it.metalType);
      if (it.karat !== undefined) expect(karatValues).toContain(it.karat);
      for (const k of ['estimatedWeightG', 'wastagePercentage', 'makingCharges', 'diamondCharges', 'stoneCharges', 'stoneWeightG', 'manualPrice'] as const) {
        expect(Number.isFinite(it[k]), k).toBe(true);
      }
      expect(it).not.toHaveProperty('totalEstimate');
    }
    expect(['__WALK_IN__', ...c.customers.map((cu) => cu.id)]).toContain(d.customerId);
    for (const row of d.exchangeRows as Record<string, unknown>[]) {
      for (const k of ['id', 'description', 'karat', 'weightG', 'ratePerGram', 'value']) expect(typeof row[k], k).toBe('string');
      expect(typeof row.valueTyped).toBe('boolean');
    }
    expect(typeof (d.delivery as { required: unknown }).required).toBe('boolean');
    expect(summarizeOrder(d, web.grandTotal).items).toBe(d.items.length);
  });
});

describe.each(cases.sales.map((c) => [`${c.house}: ${c.name}`, c] as const))('sale draft %s', (_n, c) => {
  it('opens on the sale page with the same pieces, at the rates the phone priced it at', () => {
    const d = c.draft as Record<string, unknown> & { cart: Record<string, unknown>[]; rates: Record<string, string>; typedRates: string[] };
    // The pieces as sent, less the tag's picture, which the sale takes from the live piece.
    const sentCart = (c.send.cart as Record<string, unknown>[]).map(({ qrCodeDataUrl: _qr, ...rest }) => rest);
    expect(d.cart).toEqual(sentCart);
    // sale-page.tsx `ratesForInvoice`: a box typed on the sale, else the shop's rate. The counter's rate for
    // every metal on the bill is the one the phone sent.
    const sent = c.send.rates as Record<string, number>;
    for (const [rateKey, value] of Object.entries(sent)) {
      const box = (Object.keys(INPUT_TO_RATE) as RateInputKey[]).find((k) => INPUT_TO_RATE[k] === rateKey);
      if (!box) continue;
      const counter = parseFloat(d.rates[box] ?? '') || money(c.settings[rateKey]);
      expect(counter, rateKey).toBeCloseTo(money(value), 2);
    }
    expect([...d.typedRates].sort()).toEqual(Object.keys(d.rates).sort());
    expect(money(d.subtotal)).toBeCloseTo(c.shown.subtotal, 2);
    expect(summarizeSale(d).items).toBe(d.cart.length);
    for (const p of d.salePayments as Record<string, unknown>[]) {
      for (const k of ['id', 'amount', 'method', 'reference']) expect(typeof p[k], k).toBe('string');
    }
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
