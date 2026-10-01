/**
 * The monthly report on the server: reads the month's data from this house's Firestore, draws
 * the PDF (monthly-pdf.ts) with the house's wordmark, and hands back the bytes. Used by
 * `/api/reports/monthly` (the download) and by the WhatsApp report on the 1st of the month.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { adminDb } from '@/lib/firebase-admin';
import { STORE_LOGO_URL } from '@/lib/store-config';
import type { AdditionalRevenue, Expense, Invoice, Order } from '@/lib/store';
import { buildMonthlyReport, type MonthlyReport, type MonthRef } from './monthly';
import { buildMonthlyPdf, monthlyPdfName, type ReportLogo } from './monthly-pdf';

const rows = async <T>(name: string): Promise<T[]> =>
  (await adminDb.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }) as T);

let logoPending: Promise<ReportLogo | null> | null = null;

/** The wordmark from public/ on disk, else from the ERP's own address; none is fine — the header sets the name in type. */
export function serverLogo(): Promise<ReportLogo | null> {
  logoPending ??= (async () => {
    const url = STORE_LOGO_URL;
    const format: ReportLogo['format'] = /\.jpe?g($|\?)/i.test(url) ? 'JPEG' : 'PNG';
    const asData = (buf: Buffer) => ({ dataUrl: `data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, format });
    if (url.startsWith('/')) {
      for (const dir of [path.join(process.cwd(), 'public'), path.join(process.cwd(), '.next', 'standalone', 'public')]) {
        try { return asData(await readFile(path.join(dir, url.replace(/^\/+/, '')))); } catch { /* next place */ }
      }
    }
    const origin = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const abs = url.startsWith('/') ? (origin ? `${origin}${url}` : '') : url;
    if (!abs) return null;
    try {
      const res = await fetch(abs, { signal: AbortSignal.timeout(8000) });
      return res.ok ? asData(Buffer.from(await res.arrayBuffer())) : null;
    } catch {
      return null;
    }
  })();
  return logoPending;
}

export async function monthlyReportPdf(month: MonthRef, now = new Date()): Promise<{ report: MonthlyReport; bytes: Uint8Array; fileName: string }> {
  const [invoices, orders, expenses, extraRevenues, logo] = await Promise.all([
    rows<Invoice>('invoices'),
    rows<Order>('orders'),
    rows<Expense>('expenses'),
    rows<AdditionalRevenue>('additional_revenue'),
    serverLogo(),
  ]);
  const report = buildMonthlyReport({ invoices, orders, expenses, extraRevenues }, month, now);
  const doc = buildMonthlyPdf(report, logo);
  return { report, bytes: new Uint8Array(doc.output('arraybuffer')), fileName: monthlyPdfName(report) };
}
