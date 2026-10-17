/**
 * The Invoices pages' last ERP-only moves, native on the phone: the customer's link for an invoice from before
 * links had keys (Send on WhatsApp gives it one, invoice-viewer.tsx), and Import Shopify CSV (the list's
 * dialog). Each runs its shared write (lib/writes/invoice-share-key.ts, shopify-csv-import.ts) on the Admin SDK.
 *
 * Owners only: in the browser both are the page's own Firestore write, which the shop floor cannot make
 * (roles.ts).
 *
 * `importShopifyCsv` with `preview: true` answers what the dialog shows once a file is picked (the rows and the
 * first names) and writes nothing; without it, the invoices are written and numbered on from the counter.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { giveInvoiceShareKey } from '@/lib/writes/invoice-share-key';
import { importShopifyCsv, shopifyCsvOrders, shopifyCsvPreview } from '@/lib/writes/shopify-csv-import';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const INVOICES2_OPS: OpRoles = {
  giveInvoiceShareKey: ['owner'],
  importShopifyCsv: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** A Shopify export of a few thousand orders is well under this. */
const CSV_LIMIT = 8 * 1024 * 1024;

export const runInvoices2Op: OpHandler = async (op, body, ctx) => {
  if (!(op in INVOICES2_OPS)) return null;

  switch (op) {
    case 'giveInvoiceShareKey': {
      const invoiceId = idOf(body.invoiceId);
      if (!invoiceId) return bad('An invoice is needed.');
      const out = await giveInvoiceShareKey(adminPort, invoiceId);
      if (!out) return bad(`Invoice ${invoiceId} not found.`, 409);
      if (out.given) await ctx.log('invoice.update', `Link key given to ${invoiceId}`, 'For the customer\'s link on WhatsApp', invoiceId);
      return NextResponse.json({ ok: true, invoiceId, shareToken: out.shareToken, followUps: ctx.followUps });
    }

    case 'importShopifyCsv': {
      const csv = typeof body.csv === 'string' ? body.csv : '';
      if (!csv.trim()) return bad('Choose a Shopify orders export (CSV).');
      if (csv.length > CSV_LIMIT) return bad('That file is too big to import in one go.');
      if (body.preview === true) {
        const { orders } = shopifyCsvOrders(csv);
        return NextResponse.json({ ok: true, ...shopifyCsvPreview(csv), orders: orders.length });
      }
      const progress: string[] = [];
      try {
        const out = await importShopifyCsv(adminPort, csv, msg => progress.push(msg));
        if (out.imported > 0) {
          await ctx.log('invoice.create', `Imported ${out.imported} invoices from a Shopify CSV`, `${out.first} to ${out.last}`, out.first);
        }
        return NextResponse.json({ ok: true, ...out, progress, followUps: ctx.followUps });
      } catch (e) {
        // A stale counter is refused before anything is written, in words the person can act on.
        if (e instanceof Error && /already exists/.test(e.message)) return bad(e.message, 409);
        throw e;
      }
    }
  }
  return null;
};
