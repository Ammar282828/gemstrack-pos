/**
 * Send an invoice's PDF to its customer on WhatsApp, from the shop's own line (WAHA, lib/whatsapp.ts):
 * the owner, 2026-10-05 — "directly send a pdf of the invoice to the customer instead of a link".
 * Owners and staff, signed in (staff-gate.ts).
 *
 *   POST { to: '+923…', pdf: '<base64>' }
 *
 * The browser draws the PDF — the same one Print saves (lib/invoice-pdf.ts), which needs the page's
 * logo and QR codes. Its name and the words under it are made here from the invoice itself
 * (lib/invoice-share.ts): "Invoice - <customer>", never the number.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { staffFail, staffGate } from '@/lib/website/staff-gate';
import { sendWhatsAppFile, toWhatsAppNumber, whatsAppNumberExists, whatsAppProvider } from '@/lib/whatsapp';
import { invoiceFileName, invoiceWhatsAppCaption } from '@/lib/invoice-share';
import { STORE_CONFIG, STORE_INVOICE_BY_CUSTOMER, STORE_INVOICE_WHATSAPP_PDF } from '@/lib/store-config';
import type { Invoice } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A5 invoices are 100–400 KB; WhatsApp takes documents far larger, the gateway's request less so. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { to?: string; pdf?: string };

  // Taheri's (NEXT_PUBLIC_STORE_INVOICE_WHATSAPP_PDF); House of Mina sends a link from the device.
  if (!STORE_INVOICE_WHATSAPP_PDF) return NextResponse.json({ error: 'This house sends invoices as a link.' }, { status: 404 });
  const to = toWhatsAppNumber(body.to);
  if (to.length < 11 || to.length > 15) return NextResponse.json({ error: "Enter the customer's WhatsApp number." }, { status: 400 });
  if (!whatsAppProvider()) return NextResponse.json({ error: "This shop's WhatsApp line isn't connected to the ERP." }, { status: 503 });
  const bytes = Buffer.from(String(body.pdf || ''), 'base64');
  if (bytes.length < 5 || bytes.length > MAX_BYTES || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
    return NextResponse.json({ error: 'That is not an invoice PDF.' }, { status: 400 });
  }

  try {
    const ref = adminDb.collection('invoices').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: `No invoice ${id}.` }, { status: 404 });
    const inv = snap.data() as Invoice;

    // A number that isn't on WhatsApp swallows the file and reports success.
    if ((await whatsAppNumberExists(to)) === false) {
      return NextResponse.json({ error: `+${to} isn't on WhatsApp — check the number.` }, { status: 422 });
    }
    // The name the shop gave itself in Settings ("Taheri"), as the counter's own message used.
    const shopName = String((await adminDb.doc('app_settings/global').get().catch(() => null))?.get('shopName') || '').trim() || STORE_CONFIG.name;
    const fileName = STORE_INVOICE_BY_CUSTOMER ? invoiceFileName(inv) : `Invoice-${id}.pdf`;
    await sendWhatsAppFile(to, new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName, invoiceWhatsAppCaption(inv, shopName));

    const sent = { at: new Date().toISOString(), to: `+${to}`, by: who };
    // The record is a courtesy (the viewer's "Sent"); the customer already has the file.
    await ref.set({ sentOnWhatsApp: sent }, { merge: true }).catch(e => console.warn('[invoice whatsapp] could not note the send', e));
    return NextResponse.json({ ok: true, fileName, ...sent });
  } catch (e) {
    return staffFail(e, 'invoice whatsapp');
  }
}
