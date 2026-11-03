/**
 * The description history, read from the books (orders' pieces, and the pieces described at the counter on
 * invoices) and kept in memory five minutes per process. Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { buildHistory, cleanCombos, type DescribeEntry, type DescribeRow } from '@/lib/describe';
import { isOneOffSku } from '@/lib/sku';
import { resolveCategoryId } from '@/lib/website/catalogue-category';

/** Categories are kept as ids (cat001); an old line that holds a title is read as its id. */
const catOf = (v: unknown) => (typeof v === 'string' ? resolveCategoryId(v) ?? v : '');

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; rows: DescribeRow[] } | null = null;

export const forgetDescribeHistory = () => { cache = null; };

type Piece = Record<string, unknown>;
const listOf = (v: unknown): Piece[] =>
  (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object) : []).filter((x): x is Piece => !!x && typeof x === 'object');

async function readRows(): Promise<DescribeRow[]> {
  const [orders, invoices] = await Promise.all([
    adminDb.collection('orders').select('items', 'createdAt').get(),
    adminDb.collection('invoices').select('items', 'createdAt').get(),
  ]);
  const rows: DescribeRow[] = [];
  for (const d of orders.docs) {
    const at = String(d.get('createdAt') ?? '');
    for (const it of listOf(d.get('items'))) rows.push({ text: it.description, category: catOf(it.itemCategory), at });
  }
  for (const d of invoices.docs) {
    const at = String(d.get('createdAt') ?? '');
    // Only the pieces described by hand: a stock piece's name is its product's, not a description.
    for (const it of listOf(d.get('items'))) {
      if (!isOneOffSku(String(it.sku ?? ''))) continue;
      rows.push({ text: it.name, category: catOf(it.itemCategory || it.categoryId), at });
    }
  }
  return rows;
}

export async function describeHistory(category: string): Promise<DescribeEntry[]> {
  if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), rows: await readRows() };
  return buildHistory(cache.rows, category);
}

/** The owner's saved stone combinations (`app_settings/global.stoneCombos`). */
export async function readStoneCombos(): Promise<string[]> {
  const snap = await adminDb.collection('app_settings').doc('global').get();
  const r = cleanCombos(snap.exists ? snap.data()?.stoneCombos ?? [] : []);
  return r.ok ? r.combos : [];
}
