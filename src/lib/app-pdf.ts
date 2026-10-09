/**
 * The invoice and the workshop slip as PDFs, drawn on the server: the iPhone app shows and shares
 * them natively (/api/app/pdf/*), and the shop line's WhatsApp send can carry an invoice without a
 * browser drawing it first. The same builders the browser prints with (lib/invoice-pdf.ts,
 * lib/order-slip-pdf.ts: one builder each), given the server's pictures (pdf-inputs-server.ts) and
 * Karachi's days.
 *
 * Owners and staff, as their browsers print. Staff are drawn from the copy their browser holds
 * (lib/staff-view.ts): no rates applied, no line's metal or wastage cost, no internal notes, so
 * a staff member's slip has the bench's own notes but never the owner's (`adminNote`), as on the web.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { staffView } from '@/lib/staff-view';
import { drawInvoicePdf, invoicePdfFileName } from '@/lib/invoice-pdf';
import { drawOrderSlipPdf, orderSlipFileName } from '@/lib/order-slip-pdf';
import { KARACHI_DATES } from '@/lib/pdf-inputs';
import { serverPdfImages } from '@/lib/pdf-inputs-server';
import type { Customer, Invoice, Order } from '@/lib/store';

/** Who the paper is for: everything for an owner, the shop floor's copy for staff. */
export type PdfViewer = 'owner' | 'staff';

export interface ServerPdf {
  bytes: Uint8Array;
  fileName: string;
}

/** The signed-in owner or staff member (as /api/app/drafts lets them in), or the refusal. */
export async function pdfViewer(req: NextRequest): Promise<{ email: string; role: PdfViewer } | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Not yours to print.' }, { status: 403 });
  return { email, role };
}

/** A document id, never a path into another collection. */
export const isDocId = (id: string) => !!id && id.length <= 200 && !id.includes('/') && !/^__.*__$/.test(id) && id !== '.' && id !== '..';

type Doc = Record<string, unknown>;

async function read(collection: string, id: string, viewer: PdfViewer): Promise<Doc | null> {
  if (!isDocId(id)) return null;
  const snap = await adminDb.collection(collection).doc(id).get();
  if (!snap.exists) return null;
  // As the browser's store holds it ({ ...data, id }), and as staff's server copy strips it.
  const doc: Doc = { ...(snap.data() as Doc), id: snap.id };
  return viewer === 'owner' ? doc : staffView(collection, doc);
}

/** The customer on file, for the address and email the bill prints; a walk-in or a gone record has none. */
async function customerOf(inv: Invoice, viewer: PdfViewer): Promise<Customer | null> {
  const id = String(inv.customerId || '');
  if (!isDocId(id)) return null;
  try {
    return (await read('customers', id, viewer)) as Customer | null;
  } catch {
    return null;
  }
}

/** The customer's invoice, as Print saves it (one per piece with `perPiece`); null when there is no such invoice. */
export async function invoicePdf(id: string, viewer: PdfViewer, opts: { perPiece?: boolean } = {}): Promise<ServerPdf | null> {
  const invoice = (await read('invoices', id, viewer)) as Invoice | null;
  if (!invoice) return null;
  const [customer, images] = await Promise.all([customerOf(invoice, viewer), serverPdfImages()]);
  const doc = drawInvoicePdf(invoice, { customer, perPiece: opts.perPiece, images, dates: KARACHI_DATES });
  return { bytes: new Uint8Array(doc.output('arraybuffer')), fileName: invoicePdfFileName(invoice, opts) };
}

/** The workshop order slip, as Print slip saves it; null when there is no such order. */
export async function orderSlipPdf(id: string, viewer: PdfViewer): Promise<ServerPdf | null> {
  const order = (await read('orders', id, viewer)) as Order | null;
  if (!order) return null;
  const doc = drawOrderSlipPdf(order, { images: await serverPdfImages(), dates: KARACHI_DATES });
  return { bytes: new Uint8Array(doc.output('arraybuffer')), fileName: orderSlipFileName(order) };
}

/**
 * `inline`, so a browser shows it; the name twice, plain for old clients and exactly (a customer's
 * name in Urdu, an accent) for the rest (RFC 6266).
 */
export function contentDisposition(fileName: string): string {
  const plain = fileName.replace(/[^\x20-\x7e]+/g, '').replace(/["\\]/g, '').replace(/\s+/g, ' ').trim() || 'document.pdf';
  return `inline; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function pdfResponse(pdf: ServerPdf): NextResponse {
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(pdf.fileName),
      // The books, for whoever is signed in: never kept by a cache between.
      'Cache-Control': 'private, no-store',
    },
  });
}
