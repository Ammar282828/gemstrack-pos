/**
 * Send an invoice's or an order's PDF to its customer on WhatsApp, from this house's own line: the one
 * send behind /api/app/whatsapp/send-doc (web, iPhone, Android) and the older /api/invoices/[id]/whatsapp.
 * The PDF is drawn here (lib/app-pdf.ts), so every surface sends the same file Print saves for the
 * caller's role. Server-only.
 *
 * The checks, in order: the line is connected (lib/customer-doc.ts lineGate; the caller offers a link
 * instead), the document exists, the number (typed, else on file) is a number, the number is on
 * WhatsApp (a send to one that isn't arrives nowhere and reports success). Then the file, with the
 * customer's words under it (lib/invoice-share.ts), and a note on the document (`sentOnWhatsApp`).
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendWhatsAppFile, whatsAppNumberExists, whatsAppProvider } from '@/lib/whatsapp';
import { invoicePdf, isDocId, orderPdf, type PdfViewer, type ServerPdf } from '@/lib/app-pdf';
import { invoiceWhatsAppCaption, orderWhatsAppCaption } from '@/lib/invoice-share';
import { lineGate, maskNumber, resolveRecipient, type SendDocRequest } from '@/lib/customer-doc';
import { STORE_CONFIG } from '@/lib/store-config';
import type { Invoice, Order } from '@/lib/store';

export type SendDocResult =
  | { ok: true; status: 200; body: { sent: true; ok: true; to: string; toFull: string; fileName: string; at: string; by: string } }
  | { ok: false; status: number; body: { error: string; fallback?: 'link' } };

const fail = (status: number, error: string, fallback?: 'link'): SendDocResult => ({ ok: false, status, body: { error, ...(fallback ? { fallback } : {}) } });

/** The name the shop gave itself in Settings ("Taheri"), else the house's. */
async function shopName(): Promise<string> {
  const s = await adminDb.doc('app_settings/global').get().catch(() => null);
  return String(s?.get('shopName') || '').trim() || STORE_CONFIG.name;
}

async function customerPhones(customerId: unknown): Promise<string[]> {
  const id = String(customerId || '');
  if (!isDocId(id)) return [];
  const snap = await adminDb.collection('customers').doc(id).get().catch(() => null);
  if (!snap?.exists) return [];
  return [snap.get('phone'), snap.get('altPhone')].filter(Boolean).map(String);
}

/**
 * Sends it. `pdf` is for the older invoice route, whose browser hands in the PDF it drew; otherwise
 * the server draws it. `who` is the signed-in email the send is recorded against.
 */
export async function sendCustomerDoc(req: SendDocRequest, who: { email: string; role: PdfViewer }, pdf?: ServerPdf): Promise<SendDocResult> {
  const gate = lineGate(whatsAppProvider());
  if (gate) return fail(gate.status, gate.error, gate.fallback);
  if (!isDocId(req.id)) return fail(400, 'Which invoice or order?');

  const collection = req.kind === 'invoice' ? 'invoices' : 'orders';
  const ref = adminDb.collection(collection).doc(req.id);
  const snap = await ref.get();
  if (!snap.exists) return fail(404, `No ${req.kind} ${req.id}.`);
  const doc = snap.data() as Invoice | Order;

  const recipient = resolveRecipient(req.to, [doc.customerContact, ...(await customerPhones(doc.customerId))]);
  if ('error' in recipient) return fail(400, recipient.error);
  const { to } = recipient;
  if ((await whatsAppNumberExists(to)) === false) return fail(422, `${maskNumber(to)} isn't on WhatsApp — check the number.`);

  const file = pdf ?? (req.kind === 'invoice' ? await invoicePdf(req.id, who.role, { perPiece: req.perPiece }) : await orderPdf(req.id, who.role));
  if (!file) return fail(404, `No ${req.kind} ${req.id}.`);
  const name = await shopName();
  const caption = req.kind === 'invoice' ? invoiceWhatsAppCaption(doc as Invoice, name) : orderWhatsAppCaption(doc as Order, name);
  await sendWhatsAppFile(to, new Blob([new Uint8Array(file.bytes)], { type: 'application/pdf' }), file.fileName, caption);

  const sent = { at: new Date().toISOString(), to: `+${to}`, by: who.email };
  // A courtesy (the page's "Sent"); the customer already has the file.
  await ref.set({ sentOnWhatsApp: sent }, { merge: true }).catch(e => console.warn('[send-doc] could not note the send', e));
  return { ok: true, status: 200, body: { sent: true, ok: true, to: maskNumber(to), toFull: sent.to, fileName: file.fileName, at: sent.at, by: sent.by } };
}
