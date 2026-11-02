/** Read-only adapter for SwiftUI. The shared resolver and command catalogue produce
 * ordinary app operations; the phone reviews them before calling /api/app/write.
 * No database or browser store is touched while a sentence is interpreted.
 */
import type { AppState, HisaabEntry } from '@/lib/store';
import type { Book } from './args';
import { newDraft } from './edit';
import { documentsFor } from './documents';
import { answerQuestion } from './answers';
import { resolveIntent, type RawIntent } from './resolve';
import { runSteps, stepsFrom, viewStep, type RawStep, type Step } from './steps';

export interface NativeOperation { op: string; fields: Record<string, unknown> }
export interface NativeCard {
  title: string; summary: string; problem: string | null;
  operations: NativeOperation[]; href?: string;
  handoff?: { kind: string; payload: unknown };
}
export interface NativeVoicePlan { transcript: string; cards: NativeCard[]; answer?: string; href?: string }
type Raw = RawIntent & { transcript?: string; steps?: (RawStep | string)[] };

export async function nativeVoicePlan(raw: Raw, book: Book, settings: Record<string, unknown>, hisaabEntries: HisaabEntry[]): Promise<NativeVoicePlan> {
  const documents = documentsFor(book.orders, book.invoices);
  const ctx = { book, documents };
  const plan: NativeVoicePlan = { transcript: raw.transcript ?? '', cards: [] };
  const reading = resolveIntent(raw, { roster: book.roster, aliases: book.aliases, documents });
  if (['ask', 'query_balance'].includes(reading.action) && !reading.ambiguous) {
    const a = answerQuestion(reading.query ?? (reading.action === 'query_balance' ? 'person_balance' : 'summary'), {
      data: { ...book, hisaabEntries }, person: reading.person,
      field: reading.fields ? Object.keys(reading.fields)[0] : null,
    });
    return { ...plan, answer: a.text, href: a.goTo };
  }
  if (['help', 'unknown', 'undo'].includes(reading.action)) {
    return { ...plan, answer: reading.action === 'undo' ? 'Open the record to reverse a saved entry.'
      : raw.summary || 'Try a payment, an expense, a shop question, or ask to open a page.' };
  }
  const parsed = raw.action === 'do' ? stepsFrom(raw.steps) : { steps: [{ kind: 'classic', draft: { ...newDraft(raw), edited: true } } as Step], dropped: [] };
  if (parsed.dropped.length) return { ...plan, answer: `Not recognised: ${parsed.dropped.join(', ')}. Please change the sentence.` };
  if (!parsed.steps.length) return { ...plan, answer: 'Say what you would like to do.' };
  for (const step of parsed.steps) {
    const view = viewStep(step, ctx);
    const operations: NativeOperation[] = [];
    const card: NativeCard = { title: view.label, summary: view.summary, problem: view.problem, operations };
    if (!view.ready) { plan.cards.push(card); continue; }
    if (view.danger) {
      card.problem = 'Open the record to review this change and enter the delete code.';
      const target = view.args.find(a => a.r?.ok && typeof a.r.value === 'object');
      const value = target?.r?.ok ? target.r.value as { id?: string; sku?: string } : null;
      const paths: Record<string, string> = { order: '/orders', invoice: '/invoices', customer: '/customers', karigar: '/karigars', product: '/products', repair: '/repairs', expense: '/expenses', income: '/additional-revenue', given: '/given', job: '/workshop' };
      const base = paths[target?.spec.type ?? ''] ?? '/';
      card.href = value?.id || value?.sku ? `${base}/${encodeURIComponent(value.id ?? value.sku!)}` : base;
      plan.cards.push(card); continue;
    }
    if (view.args.some(a => a.r?.ok && a.r.ref) || view.pieces.some(p => p.some(a => a.r?.ok && a.r.ref))) {
      card.problem = 'Save the first entry, then ask for this step using its name.';
      plan.cards.push(card); continue;
    }
    const add = (op: string, fields: Record<string, unknown>, result: unknown = fields) => {
      operations.push({ op, fields: JSON.parse(JSON.stringify(fields)) });
      return Promise.resolve(result);
    };
    const methods: Record<string, (...a: any[]) => Promise<unknown>> = {
      addHisaabEntry: entry => add('addHisaabEntry', entry),
      addExpense: expense => add('addExpense', expense),
      addAdditionalRevenue: revenue => add('addExtraRevenue', revenue),
      addCustomer: customer => add('addCustomer', customer, { ...customer, id: 'new' }),
      addKarigar: karigar => add('addKarigar', { karigar }, { ...karigar, id: 'new' }),
      updateCustomer: (customerId, patch) => add('updateCustomer', { customerId, patch }),
      updateKarigar: (karigarId, patch) => add('updateKarigar', { karigarId, patch }),
      recordOrderAdvance: (orderId, amount, notes, method) => add('recordOrderAdvance', { orderId, amount, notes, method }, book.orders.find(o => o.id === orderId)),
      updateInvoicePayment: (invoiceId, amount, date, method) => add('recordPayment', { invoiceId, amount, date, method }, book.invoices.find(i => i.id === invoiceId)),
      updateOrderStatus: (orderId, status) => add('setOrderStatus', { orderId, status }),
      updateSettings: patch => {
        const rates = Object.fromEntries(Object.entries(patch).filter(([k]) => k.includes('RatePerGram')));
        return Object.keys(rates).length ? add('setRates', { rates }) : add('updateSettings', { patch });
      },
      updateOrderItemKarigar: (orderId, index, karigarId) => add('setPieceKarigar', { orderId, index, karigarId }),
      assignOrderItemsToKarigar: async (orderId, karigarId) => {
        const o = book.orders.find(o => o.id === orderId);
        if (!o) throw new Error('Order not found.');
        for (let index = 0; index < o.items.length; index++) await add('setPieceKarigar', { orderId, index, karigarId });
      },
      updateOrderItemStatus: (orderId, index, done) => add('setPieceDone', { orderId, index, done }),
      updateOrderItemGiven: (orderId, index, givenAt) => add('setPieceGiven', { orderId, index, given: !!givenAt, givenAt }),
      updateInvoiceItemKarigar: (invoiceId, index, karigarId) => add('setInvoicePieceKarigar', { invoiceId, index, karigarId }),
      updateInvoiceItemStatus: (invoiceId, index, done) => add('setInvoicePieceDone', { invoiceId, index, done }),
      updateInvoiceDiscount: (invoiceId, discountAmount) => add('updateInvoiceDiscount', { invoiceId, discountAmount }, book.invoices.find(i => i.id === invoiceId)),
      setRepairStatus: (repairId, status) => add('setRepairStatus', { repairId, status }),
      recordRepairPayment: (repairId, payment) => add('recordRepairPayment', { repairId, ...payment }),
      addRepair: repair => add('addRepair', { repair }, { ...repair, id: 'new' }),
      setKarigarJobStatus: (jobId, status) => add('setStockJobStatus', { jobId, status }),
      setKarigarJobGiven: (jobId, givenAt) => add('setStockJobGiven', { jobId, given: !!givenAt, givenAt }),
      addGivenItem: item => add('addGivenItem', { item }, { ...item, id: 'new' }),
      markGivenItemReturned: (id, returnedDate) => add('markGivenReturned', { id, returnedDate }),
      // One detail of a record (record-edit.ts, and the order/stock piece commands), as the record's page writes it.
      updateOrder: (orderId, patch) => add('updateOrder', { orderId, order: orderEditBody(book, orderId, patch) }),
      updateOrderItemDetails: (orderId, itemIndex, patch) => add('updateOrderPieceDetails', { orderId, itemIndex, patch: pieceDetailsBody(patch, true) }),
      updateInvoiceItemDetails: (invoiceId, itemIndex, patch) => add('updateInvoicePieceDetails', { invoiceId, itemIndex, patch: pieceDetailsBody(patch, false) }),
      updateProduct: (sku, patch) => add('updateProduct', { sku, piece: productFormBody(book, sku, patch) }),
      updateKarigarJobDetails: (jobId, patch) => add('updateStockJobDetails', { jobId, patch }),
    };
    const data = { settings, orders: book.orders, generatedInvoices: book.invoices, repairs: book.repairs, products: book.products, customers: book.customers, karigars: book.karigars, karigarJobs: book.karigarJobs };
    const store = new Proxy(data, {
      get(target, key: string) {
        if (key in target) return target[key as keyof typeof target];
        return methods[key] ?? (() => { throw new Error('This change needs its record or form.'); });
      },
    }) as unknown as AppState;
    const result = await runSteps([step], ctx, {
      s: store, now: new Date().toISOString(), go: href => { card.href = href; },
      handOff: (kind, payload) => { card.handoff = { kind, payload }; },
    });
    if (result.error) { card.problem = result.error; card.operations = []; }
    if (!card.href) card.href = result.done[0]?.href;
    plan.cards.push(card);
  }
  return plan;
}

/** Fields of an order voice may change through the order form's write (`updateOrder`): never its money. */
const ORDER_VOICE_FIELDS = new Set(['promisedDate', 'notes', 'items']);

/**
 * The body /api/app/write's updateOrder takes: the fields changed, and every piece by its place (`editIndex`) with
 * only what changed on it, so the server lays each over the piece it has on file (a photo or a karigar is never
 * sent back stale). Money (advance, discount, totals) is refused: those are their own confirmed steps.
 */
export function orderEditBody(book: Book, orderId: string, patch: Record<string, unknown>): Record<string, unknown> {
  const o = book.orders.find(x => x.id === orderId);
  if (!o) throw new Error('Order not found.');
  if (Object.keys(patch).some(k => !ORDER_VOICE_FIELDS.has(k))) throw new Error('This change needs its record or form.');
  const stored = (o.items ?? []) as unknown as Record<string, unknown>[];
  const sent = Array.isArray(patch.items) ? (patch.items as Record<string, unknown>[]) : stored;
  if (sent.length !== stored.length) throw new Error('This change needs its record or form.');
  const items = sent.map((it, i) => {
    const changed = Object.fromEntries(Object.entries(it ?? {}).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(stored[i]?.[k])));
    return { ...changed, editIndex: i };
  });
  const { items: _items, ...rest } = patch;
  return { ...rest, items };
}

/** The Workshop's Details write: its name, size, weight (an order's piece only) and instructions. */
export function pieceDetailsBody(patch: Record<string, unknown>, order: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'description' || k === 'name') out.name = v;
    else if (k === 'size') out.size = v;
    else if (k === 'adminNote') out.instructions = v;
    else if (k === 'estimatedWeightG' && order) out.estimatedWeightG = Number(v) || 0;
    // Stones, diamonds and a sold piece's weight are changed on the record's own page.
    else throw new Error('This change needs its record or form.');
  }
  return out;
}

const PRODUCT_FORM_FIELDS = ['name', 'categoryId', 'metalType', 'karat', 'metalWeightG', 'silverRatePerGram', 'secondaryMetalType', 'secondaryMetalKarat',
  'secondaryMetalWeightG', 'wastagePercentage', 'makingCharges', 'hasDiamonds', 'hasStones', 'stoneWeightG', 'diamondCharges', 'stoneCharges',
  'miscCharges', 'stoneDetails', 'diamondDetails', 'isCustomPrice', 'customPrice', 'description', 'size', 'platingType', 'platingNote', 'nickelFree'] as const;
const PRODUCT_FIGURES = new Set(['metalWeightG', 'wastagePercentage', 'makingCharges', 'stoneWeightG', 'diamondCharges', 'stoneCharges', 'miscCharges']);

/** The stock form's whole piece, as the phone's form sends it (updateProduct checks it strictly), with the change laid over it. */
export function productFormBody(book: Book, sku: string, patch: Record<string, unknown>): Record<string, unknown> {
  const p = book.products.find(x => x.sku === sku) as unknown as Record<string, unknown> | undefined;
  if (!p) throw new Error(`No piece ${sku} is in stock.`);
  const merged: Record<string, unknown> = { ...p, ...patch };
  const out: Record<string, unknown> = {};
  for (const k of PRODUCT_FORM_FIELDS) {
    const v = merged[k];
    if (PRODUCT_FIGURES.has(k)) out[k] = Number(v) || 0;
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
