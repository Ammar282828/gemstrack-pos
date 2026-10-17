/**
 * Import Shopify CSV (the Invoices page's dialog): a Shopify orders export, each order an invoice, numbered on
 * from the last invoice number. The one copy, run by the browser (owners, the client SDK) and by the iPhone app
 * (/api/app/write `importShopifyCsv`, the Admin SDK).
 *
 * The numbers are taken in one transaction before anything is written (the page read the counter, wrote every
 * invoice, then moved the counter: a sale made in between took a number the import then overwrote), and an
 * invoice already on file at either end of the run stops it, as Finalize's guard does.
 */

import type { DbPort } from '@/lib/db-port';

/** One CSV line into its fields: commas inside quotes stay in the field. */
export function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

/** The rows under the header line, each by its column's name. */
export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  });
}

/** What the dialog says once a file is picked: how many rows, and the first five names. */
export function shopifyCsvPreview(content: string): { rows: number; firstNames: string[] } {
  const rows = parseCSV(content);
  return { rows: rows.length, firstNames: rows.slice(0, 5).map(r => r['Billing Name'] || r['Shipping Name'] || 'Walk-in') };
}

/** Shopify's orders, oldest first: a multi-piece order is one row per line item, and only names like #1001 count. */
export function shopifyCsvOrders(content: string) {
  const rows = parseCSV(content);
  const VALID_ORDER_NAME = /^#\d+$/;
  const orderMap = new Map<string, { header: Record<string, string>; items: Record<string, string>[] }>();
  for (const row of rows) {
    const name = row['Name'];
    if (!name || !VALID_ORDER_NAME.test(name)) continue;
    if (!orderMap.has(name)) orderMap.set(name, { header: row, items: [] });
    orderMap.get(name)!.items.push(row);
  }
  const orders = [...orderMap.values()].sort((a, b) =>
    new Date(a.header['Created at']).getTime() - new Date(b.header['Created at']).getTime());
  return { rows: rows.length, orders };
}

export const invoiceNumber = (n: number) => `INV-${String(n).padStart(6, '0')}`;

/** One Shopify order as the invoice it becomes, numbered `n`. `now` stands in for a missing date. */
export function shopifyCsvInvoice(order: { header: Record<string, string>; items: Record<string, string>[] }, n: number, now: string) {
  const h = order.header;
  const createdAt = h['Created at'] ? new Date(h['Created at']).toISOString() : now;
  const billingName = h['Billing Name'] || h['Shipping Name'] || 'Walk-in Customer';
  const total = parseFloat(h['Total']) || 0;
  const discount = parseFloat(h['Discount Amount']) || 0;
  const financialStatus = h['Financial Status'] || 'paid';
  const amountPaid = financialStatus === 'paid' ? total : 0;
  const balanceDue = total - amountPaid;

  const items = order.items.map(row => {
    const price = parseFloat(row['Lineitem price']) || 0;
    const qty = parseInt(row['Lineitem quantity']) || 1;
    const sku = row['Lineitem sku'] || `SHOP-${h['Name'].replace('#', '')}-${(row['Lineitem name'] || '').slice(0, 8)}`;
    return {
      sku,
      name: row['Lineitem name'] || 'Item',
      categoryId: '',
      metalType: 'gold',
      karat: '21k',
      metalWeightG: 0,
      stoneWeightG: 0,
      quantity: qty,
      unitPrice: price,
      itemTotal: price * qty,
      metalCost: 0,
      wastageCost: 0,
      wastagePercentage: 0,
      makingCharges: price * qty,
      diamondChargesIfAny: 0,
      stoneChargesIfAny: 0,
      miscChargesIfAny: 0,
    };
  });
  const itemSubtotal = items.reduce((sum, item) => sum + (item.itemTotal || 0), 0);
  const adjustmentsAmount = total - (itemSubtotal - discount);

  return {
    id: invoiceNumber(n),
    shopifyOrderName: h['Name'],
    customerId: '',
    customerName: billingName,
    customerContact: h['Billing Phone'] || h['Phone'] || '',
    items,
    subtotal: itemSubtotal,
    discountAmount: discount,
    ...(adjustmentsAmount !== 0 && { adjustmentsAmount }),
    grandTotal: total,
    amountPaid,
    balanceDue,
    createdAt,
    ratesApplied: {},
    paymentHistory: amountPaid > 0 ? [{ amount: amountPaid, date: createdAt, notes: 'Shopify payment' }] : [],
    source: 'shopify_import',
  };
}

export async function importShopifyCsv(
  db: DbPort,
  content: string,
  onProgress: (msg: string) => void = () => undefined,
  now: string = new Date().toISOString(),
): Promise<{ imported: number; first?: string; last?: string }> {
  const { rows, orders } = shopifyCsvOrders(content);
  onProgress(`Parsed ${rows} rows…`);
  onProgress(`${rows} rows → ${orders.length} unique orders…`);
  if (orders.length === 0) return { imported: 0 };

  // The run of numbers, taken before anything is written.
  const start = await db.runTransaction(async tx => {
    const settings = await tx.get<{ lastInvoiceNumber?: number }>('app_settings', 'global');
    const last = Number(settings?.lastInvoiceNumber) || 7;
    const [first, end] = await Promise.all([
      tx.get('invoices', invoiceNumber(last + 1)),
      tx.get('invoices', invoiceNumber(last + orders.length)),
    ]);
    if (first || end) {
      throw new Error(`Invoice ${first ? invoiceNumber(last + 1) : invoiceNumber(last + orders.length)} already exists: the invoice counter (lastInvoiceNumber=${last}) is stale. Correct it under Settings, Document numbering, first.`);
    }
    tx.update('app_settings', 'global', { lastInvoiceNumber: last + orders.length });
    return last + 1;
  });
  onProgress(`Starting from ${invoiceNumber(start)}…`);

  let batch = db.batch();
  let batchCount = 0;
  let imported = 0;
  for (const order of orders) {
    const invoice = shopifyCsvInvoice(order, start + imported, now);
    batch.set('invoices', invoice.id, invoice);
    batchCount++;
    imported++;
    if (batchCount >= 400) {
      await batch.commit();
      onProgress(`Committed batch (${imported} so far)…`);
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();
  return { imported, first: invoiceNumber(start), last: invoiceNumber(start + imported - 1) };
}
