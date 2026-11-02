/**
 * Send an invoice's PDF to its customer on WhatsApp, from the shop's own line: the owner, 2026-10-05 —
 * "directly send a pdf of the invoice to the customer instead of a link". Owners and staff, signed in.
 *
 *   POST { to?: '+923…', pdf?: '<base64>', perPiece?: boolean }
 *
 * Kept for callers from before /api/app/whatsapp/send-doc, which every surface now uses: the send is
 * that one (lib/customer-doc-server.ts) — both houses, from each house's own line, `to` defaulting to
 * the customer's number on file. A browser may still hand in the PDF it drew; without one the server
 * draws it. Answers as it always did: { ok, fileName, to: '+92…', at, by }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { staffGate } from '@/lib/website/staff-gate';
import { roleForEmail } from '@/lib/roles';
import { parseSendDoc } from '@/lib/customer-doc';
import { sendCustomerDoc } from '@/lib/customer-doc-server';
import { invoicePdfFileName } from '@/lib/invoice-pdf';
import { adminDb } from '@/lib/firebase-admin';
import type { Invoice } from '@/lib/store';
import { dailyCap, WHATSAPP_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A5 invoices are 100–400 KB; WhatsApp takes documents far larger, the gateway's request less so. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const email = await staffGate(req);
  if (email instanceof NextResponse) return email;
  const capped = await dailyCap('whatsapp', email, req, WHATSAPP_PER_DAY);
  if (capped) return capped;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { to?: string; pdf?: string; perPiece?: boolean };
  const parsed = parseSendDoc({ kind: 'invoice', id, to: body.to, perPiece: body.perPiece });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The browser's own drawing, when it sent one.
  let pdf;
  if (body.pdf) {
    const bytes = Buffer.from(String(body.pdf), 'base64');
    if (bytes.length < 5 || bytes.length > MAX_BYTES || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
      return NextResponse.json({ error: 'That is not an invoice PDF.' }, { status: 400 });
    }
    const snap = await adminDb.collection('invoices').doc(id).get().catch(() => null);
    if (!snap?.exists) return NextResponse.json({ error: `No invoice ${id}.` }, { status: 404 });
    pdf = { bytes: new Uint8Array(bytes), fileName: invoicePdfFileName({ ...(snap.data() as Invoice), id }, { perPiece: parsed.perPiece }) };
  }

  try {
    const role = roleForEmail(email) === 'owner' || email === 'dev-bypass' ? 'owner' : 'staff';
    const r = await sendCustomerDoc(parsed, { email, role }, pdf);
    if (!r.ok) return NextResponse.json(r.body, { status: r.status });
    const { fileName, at, by, toFull } = r.body;
    return NextResponse.json({ ok: true, fileName, at, by, to: toFull });
  } catch (e) {
    console.error('[invoice whatsapp]', id, e);
    return NextResponse.json({ error: 'Something went wrong. Try again; if it keeps happening, tell the shop admin.' }, { status: 500 });
  }
}
