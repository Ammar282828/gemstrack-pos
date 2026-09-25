/**
 * Gold (or anything else) the customer hands over, taken off the bill at an agreed value.
 *
 * One shape everywhere (the owner, 2026-09-25: "make the exchange gold field uniform and add
 * the ability to add another"): an order's exchange and an invoice's are the same list of
 * rows — what it is, karat, grams, the rate it was taken at, and the value that comes off —
 * and an order's list is carried onto its invoice as it is.
 *
 * Older documents hold one exchange on an order (advanceInExchangeDescription/Value) and one
 * description with two amounts on an invoice (exchangeDescription, exchangeAmount1/2);
 * orderExchanges and invoiceExchanges read either. Every write also keeps those old fields as
 * totals (orderExchangeFields, invoiceExchangeFields), so all the arithmetic that reads them —
 * balances, analytics, Shopify, the per-piece split — stays right without knowing about rows.
 */

export interface ExchangeEntry {
  /** "Old 22k ring", "Broken chain". */
  description: string;
  karat?: string;
  weightG?: number;
  /** The rate it was taken at — often below the day's. */
  ratePerGram?: number;
  /** What comes off the bill, PKR. */
  value: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export const exchangeTotal = (list: ExchangeEntry[] | undefined | null) =>
  (list || []).reduce((sum, e) => sum + num(e.value), 0);

/** "Old ring · 22k · 5.2 g at 22,000/g" */
export function describeExchangeEntry(e: ExchangeEntry): string {
  const parts = [e.description?.trim() || 'Gold'];
  if (e.karat) parts.push(e.karat);
  if (num(e.weightG) > 0) parts.push(`${num(e.weightG)} g${num(e.ratePerGram) > 0 ? ` at ${Math.round(num(e.ratePerGram)).toLocaleString('en-PK')}/g` : ''}`);
  return parts.join(' · ');
}

export const describeExchanges = (list: ExchangeEntry[]) => list.map(describeExchangeEntry).join('; ');

const clean = (list: ExchangeEntry[]) => list
  .filter((e) => num(e.value) > 0 || e.description?.trim())
  .map((e) => ({
    description: e.description?.trim() || '',
    ...(e.karat ? { karat: e.karat } : {}),
    ...(num(e.weightG) > 0 ? { weightG: num(e.weightG) } : {}),
    ...(num(e.ratePerGram) > 0 ? { ratePerGram: num(e.ratePerGram) } : {}),
    value: num(e.value),
  }));

interface OrderExchangeLike { exchanges?: ExchangeEntry[]; advanceInExchangeDescription?: string; advanceInExchangeValue?: number }
interface InvoiceExchangeLike { exchanges?: ExchangeEntry[]; exchangeDescription?: string; exchangeAmount1?: number; exchangeAmount2?: number }

/** An order's exchange rows, from the list or from the one exchange older orders kept. */
export function orderExchanges(order: OrderExchangeLike | null | undefined): ExchangeEntry[] {
  if (!order) return [];
  if (Array.isArray(order.exchanges) && order.exchanges.length) return clean(order.exchanges);
  const value = num(order.advanceInExchangeValue);
  const description = order.advanceInExchangeDescription?.trim() || '';
  return value > 0 || description ? [{ description, value }] : [];
}

/** An invoice's exchange rows, from the list or from an older invoice's description and two amounts. */
export function invoiceExchanges(inv: InvoiceExchangeLike | null | undefined): ExchangeEntry[] {
  if (!inv) return [];
  if (Array.isArray(inv.exchanges) && inv.exchanges.length) return clean(inv.exchanges);
  const out: ExchangeEntry[] = [];
  if (num(inv.exchangeAmount1) > 0) out.push({ description: inv.exchangeDescription?.trim() || '', value: num(inv.exchangeAmount1) });
  if (num(inv.exchangeAmount2) > 0) out.push({ description: out.length ? '' : inv.exchangeDescription?.trim() || '', value: num(inv.exchangeAmount2) });
  if (!out.length && inv.exchangeDescription?.trim()) out.push({ description: inv.exchangeDescription.trim(), value: 0 });
  return out;
}

/** What an order stores for its exchange rows: the rows, and the old single-exchange totals. */
export function orderExchangeFields(list: ExchangeEntry[]) {
  const rows = clean(list);
  return {
    exchanges: rows,
    advanceInExchangeDescription: describeExchanges(rows),
    advanceInExchangeValue: exchangeTotal(rows),
  };
}

/** What an invoice stores for its exchange rows: the rows, and the old fields as one total. */
export function invoiceExchangeFields(list: ExchangeEntry[]) {
  const rows = clean(list);
  const total = exchangeTotal(rows);
  return rows.length
    ? { exchanges: rows, exchangeDescription: describeExchanges(rows), ...(total > 0 ? { exchangeAmount1: total } : {}) }
    : {};
}

// ── The rows as typed in a form (components/shared/exchange-rows.tsx) ──────────
// Kept as strings while being typed; ExchangeEntry when the document is written.

export interface ExchangeRow {
  id: string;
  description: string;
  karat: string;
  weightG: string;
  ratePerGram: string;
  value: string;
  /** Someone typed the value; grams × rate no longer overwrites it. */
  valueTyped: boolean;
}

const n = (s: string) => parseFloat(s) || 0;
const newId = () => Math.random().toString(36).slice(2, 9);

export const blankExchangeRow = (): ExchangeRow =>
  ({ id: newId(), description: '', karat: '', weightG: '', ratePerGram: '', value: '', valueTyped: false });

export const rowsFromExchanges = (list: ExchangeEntry[]): ExchangeRow[] => (list.length ? list.map((e) => ({
  id: newId(),
  description: e.description || '',
  karat: e.karat || '',
  weightG: e.weightG ? String(e.weightG) : '',
  ratePerGram: e.ratePerGram ? String(e.ratePerGram) : '',
  value: e.value ? String(e.value) : '',
  valueTyped: true,
})) : [blankExchangeRow()]);

export const exchangesFromRows = (rows: ExchangeRow[]): ExchangeEntry[] => rows
  .map((r) => ({
    description: r.description.trim(),
    ...(r.karat ? { karat: r.karat } : {}),
    ...(n(r.weightG) > 0 ? { weightG: n(r.weightG) } : {}),
    ...(n(r.ratePerGram) > 0 ? { ratePerGram: n(r.ratePerGram) } : {}),
    value: n(r.value),
  }))
  .filter((e) => e.value > 0 || e.description);

export const exchangeRowsTotal = (rows: ExchangeRow[]) => rows.reduce((sum, r) => sum + n(r.value), 0);

/** Apply a change to one row; grams × rate refills the value unless it was typed. */
export function applyExchangeRowChange(row: ExchangeRow, patch: Partial<ExchangeRow>): ExchangeRow {
  const next = { ...row, ...patch };
  if ('value' in patch) next.valueTyped = !!patch.value;
  if (!next.valueTyped && ('weightG' in patch || 'ratePerGram' in patch)) {
    const computed = Math.round(n(next.weightG) * n(next.ratePerGram));
    next.value = computed > 0 ? String(computed) : '';
  }
  return next;
}
