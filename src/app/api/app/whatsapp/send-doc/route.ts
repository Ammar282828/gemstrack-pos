/**
 * POST { kind: 'invoice' | 'order', id, to?, perPiece? } → that document's PDF sent to its customer on
 * WhatsApp from this house's own line (owner, 2026-11-02: "send the pdf (order or invoice) directly to
 * the customer on whatsapp (use my number whatsapp api for this)"). The web, the iPhone and Android all
 * call this one route; the PDF is drawn here (lib/app-pdf.ts), so every surface sends the same file.
 *
 * `to` defaults to the customer's number on file. Answers { sent: true, to: '+92 300 ••• 4567', fileName,
 * at, by }; a refusal is { error } — with `fallback: 'link'` (503) when this house's line isn't
 * connected, so the caller opens WhatsApp on the device with a link instead. Owners and staff, signed
 * in; the WhatsApp daily cap per account (lib/daily-cap.ts). The checks: lib/customer-doc-server.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { parseSendDoc } from '@/lib/customer-doc';
import { sendCustomerDoc } from '@/lib/customer-doc-server';
import { dailyCap, WHATSAPP_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const parsed = parseSendDoc(await req.json().catch(() => ({})));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const capped = await dailyCap('whatsapp', who.email, req, WHATSAPP_PER_DAY);
  if (capped) return capped;
  try {
    const r = await sendCustomerDoc(parsed, who);
    if (!r.ok) return NextResponse.json(r.body, { status: r.status });
    const { toFull: _full, ...body } = r.body;
    return NextResponse.json(body);
  } catch (e) {
    console.error('[/api/app/whatsapp/send-doc]', parsed.kind, parsed.id, e);
    return NextResponse.json({ error: 'The PDF could not be sent. Try again; if it keeps happening, check Settings → WhatsApp.' }, { status: 502 });
  }
}
