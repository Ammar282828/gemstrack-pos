/**
 * POST { to?: '+923…', perPiece? } → the invoice's PDF sent to the customer on WhatsApp from the shop's own
 * line, drawn here. Kept for app builds from before /api/app/whatsapp/send-doc, which is the same send
 * (lib/customer-doc-server.ts: both houses, each from its own line; `to` defaults to the number on file).
 * Answers as it always did: { ok, fileName, to: '+92…', at, by }. Owners and staff, signed in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { parseSendDoc } from '@/lib/customer-doc';
import { sendCustomerDoc } from '@/lib/customer-doc-server';
import { dailyCap, WHATSAPP_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { to?: string; perPiece?: boolean };
  const parsed = parseSendDoc({ kind: 'invoice', id, to: body.to, perPiece: body.perPiece });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const capped = await dailyCap('whatsapp', who.email, req, WHATSAPP_PER_DAY);
  if (capped) return capped;
  try {
    const r = await sendCustomerDoc(parsed, who);
    if (!r.ok) return NextResponse.json(r.body, { status: r.status });
    const { fileName, at, by, toFull } = r.body;
    return NextResponse.json({ ok: true, fileName, at, by, to: toFull });
  } catch (e) {
    console.error('[/api/app/pdf/invoice/whatsapp]', id, e);
    return NextResponse.json({ error: 'The invoice PDF could not be sent.' }, { status: 500 });
  }
}
