/**
 * POST { to: '+923…' } → the invoice's PDF sent to the customer on WhatsApp from the shop's own line, with
 * the PDF drawn here rather than by a browser: the iPhone app's Send on WhatsApp (Taheri's,
 * NEXT_PUBLIC_STORE_INVOICE_WHATSAPP_PDF; House of Mina sends a link from the phone).
 *
 * The send itself is /api/invoices/[id]/whatsapp, the browser's, handed the PDF Print saves
 * (lib/app-pdf.ts, for the caller's role as their browser would draw it): one send, so its checks (the
 * house, the number, the line, "is it on WhatsApp"), its name and words (lib/invoice-share.ts) and its
 * record on the invoice (`sentOnWhatsApp`) are the browser's own. Owners and staff, signed in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { invoicePdf, pdfViewer } from '@/lib/app-pdf';
import { POST as sendInvoicePdf } from '@/app/api/invoices/[id]/whatsapp/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { to?: string };

  let pdf;
  try {
    pdf = await invoicePdf(id, who.role);
  } catch (e) {
    console.error('[/api/app/pdf/invoice/whatsapp]', id, e);
    return NextResponse.json({ error: 'The invoice PDF could not be drawn.' }, { status: 500 });
  }
  if (!pdf) return NextResponse.json({ error: `No invoice ${id}.` }, { status: 404 });

  // The same request the browser makes, as the same person (their token goes with it).
  const headers = new Headers({ 'content-type': 'application/json' });
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  const send = new NextRequest(new URL(`/api/invoices/${encodeURIComponent(id)}/whatsapp`, req.nextUrl.origin), {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: body.to ?? '', pdf: Buffer.from(pdf.bytes).toString('base64') }),
  });
  return sendInvoicePdf(send, { params: Promise.resolve({ id }) });
}
